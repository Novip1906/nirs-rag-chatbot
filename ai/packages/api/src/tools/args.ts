import { logger } from '@librechat/data-schemas';
import { ToolMessage } from '@langchain/core/messages';

export type ToolArgumentValue = string | number | boolean | null | ToolArgumentValue[];

export type ToolArguments = { [key: string]: ToolArgumentValue | undefined };

/** То, что доходит до инструмента: объект аргументов, сырая строка или ничего. */
export type RawToolArguments = string | ToolArguments | null;

export interface ToolInvocation {
  name?: string;
  id?: string;
  type?: string;
  args?: RawToolArguments;
}

/**
 * Второй вид вызова: `ON_TOOL_EXECUTE` (`packages/api/src/agents/handlers.ts`) зовёт
 * `tool.invoke(rawArgs, config)` — сами аргументы приходят прямо в `input`, без обёртки
 * `{name, id, type, args}`, а id вызова лежит в `config.toolCall.id`.
 */
export type GuardableToolInput = ToolInvocation | RawToolArguments;

/** Минимум, который защите нужно от `config`, чтобы достать id вызова в форме `ON_TOOL_EXECUTE`. */
export interface ConfigWithToolCallId {
  toolCall?: { id?: string };
}

/**
 * Форма инструмента, которую подменяет защита. Конфигурация рантайма и результат
 * проходят насквозь, поэтому их типы задаёт сам инструмент.
 */
export interface GuardableTool<TConfig, TResult> {
  name: string;
  invoke(input: GuardableToolInput, config?: TConfig): Promise<TResult>;
}

function isArgumentsObject(value: ToolArgumentValue | ToolArguments): value is ToolArguments {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Аргументы приходят объектом, но не всегда: потоковый сборщик `@librechat/agents`
 * теряет их у последнего вызова в ходе и отдаёт пустую строку, а часть моделей
 * присылает объект строкой целиком. Строка разбирается, всё остальное считается
 * непришедшим — вызывающая сторона отличит `null` от пустого объекта.
 */
export function normalizeToolArguments(args: RawToolArguments | undefined): ToolArguments | null {
  if (args == null) {
    return null;
  }
  if (typeof args !== 'string') {
    return isArgumentsObject(args) ? args : null;
  }
  const trimmed = args.trim();
  if (trimmed === '') {
    return null;
  }
  try {
    const parsed: ToolArgumentValue | ToolArguments = JSON.parse(trimmed);
    return isArgumentsObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isFilled(value: ToolArgumentValue | undefined): boolean {
  if (value == null) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim() !== '';
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return true;
}

/** Обязательные параметры, которых в аргументах нет или которые пусты. */
export function missingToolArguments(
  args: RawToolArguments | undefined,
  required: readonly string[],
): string[] {
  const normalized = normalizeToolArguments(args);
  if (normalized == null) {
    return [...required];
  }
  return required.filter((name) => !isFilled(normalized[name]));
}

/**
 * Текст адресован модели, а не сотруднику: он должен объяснить, что это сбой передачи,
 * а не отсутствие данных, и потребовать продолжить ход. Молчаливый пустой результат
 * модель воспринимает как завершённую задачу и заканчивает ответ вообще без текста.
 */
export function missingArgumentsMessage(toolName: string, missing: readonly string[]): string {
  const tail =
    missing.length > 0
      ? `Не дошли обязательные параметры: ${missing.join(', ')}. Повтори вызов, явно указав их.`
      : 'Повтори вызов, передав аргументы объектом.';
  return (
    `Аргументы вызова инструмента ${toolName} не дошли — это сбой передачи, а не отсутствие данных. ` +
    `${tail} Если и повтор не сработает, ответь сотруднику текстом: заканчивать ход молча нельзя.`
  );
}

/** `ToolNode` зовёт `invoke` обёрткой `{name, id, type: 'tool_call', args}` — этим форма и отличается от `ON_TOOL_EXECUTE`, где `input` это сами аргументы. */
function isToolCallWrapper(input: GuardableToolInput): input is ToolInvocation {
  return (
    typeof input === 'object' &&
    input !== null &&
    !Array.isArray(input) &&
    (input as ToolInvocation).type === 'tool_call'
  );
}

/** Id вызова: из обёртки `ToolCall`, иначе из `config.toolCall.id` — так его передаёт `ON_TOOL_EXECUTE`. */
function resolveToolCallId(input: GuardableToolInput, config: unknown): string {
  if (isToolCallWrapper(input) && typeof input.id === 'string') {
    return input.id;
  }
  const toolCallId = (config as ConfigWithToolCallId | undefined)?.toolCall?.id;
  return typeof toolCallId === 'string' ? toolCallId : '';
}

/**
 * Проверка обязана стоять до валидации схемы в LangChain, а не внутри обработчика
 * инструмента: при `args: ""` или без обязательного поля `StructuredTool.call`
 * бросает `ToolInputParsingException` ещё до обработчика, вызов не выполняется, и
 * модель получает пустой результат — в проде это ход, закончившийся без единого слова.
 *
 * Разбираемые аргументы чинятся на месте (строка с JSON превращается в объект,
 * отсутствующие — в пустой объект), а неисправимые заменяются инструкцией в виде
 * настоящего `ToolMessage`, а не голой строки: `ToolNode`, получив не-`BaseMessage`,
 * заново сериализует объект целиком вместо того, чтобы прочитать его `content`, а
 * `ON_TOOL_EXECUTE` (`packages/api/src/agents/handlers.ts`) читает `result.content`
 * напрямую и не разворачивает голую строку — один и тот же объект должен устраивать
 * обоих вызывающих.
 *
 * Форма вызова определяет, откуда брать аргументы: `ToolNode` зовёт `invoke` обёрткой
 * `{name, id, type: 'tool_call', args}`, а `ON_TOOL_EXECUTE` — самими аргументами в
 * `input`, с id вызова в `config.toolCall.id`. Гвард, написанный только под первую
 * форму, читал у второй несуществующее `input.args` и считал аргументы потерянными
 * всегда — это и обрывало `knowledge_search` на каждом вызове в проде.
 */
export function guardToolArguments<TConfig, TResult>(
  tool: GuardableTool<TConfig, TResult>,
  required: readonly string[] = [],
): GuardableTool<TConfig, TResult | ToolMessage> {
  if (typeof tool?.invoke !== 'function') {
    throw new Error(
      `Инструмент ${tool?.name ?? 'без имени'} нельзя защитить: у него нет метода invoke`,
    );
  }

  const guarded = tool as GuardableTool<TConfig, TResult | ToolMessage>;
  const invoke = tool.invoke.bind(tool);

  guarded.invoke = async (
    input: GuardableToolInput,
    config?: TConfig,
  ): Promise<TResult | ToolMessage> => {
    const wrapped = isToolCallWrapper(input);
    const rawArgs = wrapped ? input.args : (input as RawToolArguments | undefined);

    const missing = missingToolArguments(rawArgs, required);
    if (missing.length > 0) {
      logger.warn(
        `[tools] Аргументы ${tool.name} не дошли до инструмента: не хватает ${missing.join(', ')}. ` +
          `Пришло: ${JSON.stringify(input) ?? 'undefined'}`,
      );
      return new ToolMessage({
        content: missingArgumentsMessage(tool.name, missing),
        name: tool.name,
        tool_call_id: resolveToolCallId(input, config),
      });
    }

    const normalized = normalizeToolArguments(rawArgs) ?? {};
    const patchedInput: GuardableToolInput = wrapped ? { ...input, args: normalized } : normalized;
    return invoke(patchedInput, config);
  };

  return guarded;
}
