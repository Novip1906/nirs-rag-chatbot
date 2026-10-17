import { logger } from '@librechat/data-schemas';
import { getChatModelClass, Providers } from '@librechat/agents';

/**
 * Роль, которую поток chat-completions подразумевает, но не всегда присылает.
 * Ответ модели в этом протоколе всегда ассистентский — другой роли в нём быть не может.
 */
const ASSISTANT_ROLE = 'assistant';

interface CompletionsChunkConverter {
  _convertCompletionsDeltaToBaseMessageChunk(
    delta: Record<string, unknown>,
    rawResponse: unknown,
    defaultRole?: string,
  ): unknown;
}

type CompletionsConverterPrototype = CompletionsChunkConverter & {
  [ROLE_FIX_APPLIED]?: boolean;
};

const ROLE_FIX_APPLIED = Symbol.for('corporate.streamRoleFixApplied');

/**
 * Достаёт класс, который разбирает чанки потока: `ChatOpenAI` не разбирает их сам,
 * а держит для этого отдельный объект `completions`. Пробный экземпляр создаётся
 * с заведомо нерабочим ключом — наружу он не ходит, нужен только как образец.
 */
function resolveCompletionsPrototype(): CompletionsConverterPrototype | null {
  const ChatModel = getChatModelClass(Providers.OPENAI);
  const probe = new ChatModel({ model: 'probe', apiKey: 'probe' });
  /** Поле защищённое, и читать его иначе, чем в обход системы типов, неоткуда. */
  const converter = Reflect.get(probe, 'completions') as CompletionsChunkConverter | undefined;
  if (
    converter == null ||
    typeof converter._convertCompletionsDeltaToBaseMessageChunk !== 'function'
  ) {
    return null;
  }
  return Object.getPrototypeOf(converter) as CompletionsConverterPrototype;
}

/**
 * Чинит вызовы инструментов у моделей, чей шлюз не присылает `role` в первом чанке потока.
 *
 * Разбор чанка выбирает тип сообщения по роли, а роль берёт из самого чанка либо из
 * запомненной с предыдущего. У первого чанка запоминать нечего, и без роли он
 * становится «сообщением неизвестной роли» — типом, который не переносит вызовы
 * инструментов вообще. Дальше весь ответ склеивается в этот же тип, и аргументы вызова
 * теряются целиком: инструмент получает пустоту либо не запускается, а модель, ничего
 * не добившись, заканчивает ход без единого слова.
 *
 * Вылезло на GPT-5.6 Luna через polza.ai: она рассуждающая, поток начинается с чанков
 * рассуждения, и первый из них приходит без роли примерно в двух случаях из трёх — ровно
 * с той же частотой ломался и поиск по документам, и веб-поиск. Gemini и Claude через тот
 * же шлюз шлют роль сразу и потому не задеты.
 *
 * Правится подстановкой роли по умолчанию, а не подменой самого разбора: другой роли,
 * кроме ассистентской, в ответе модели быть не может, поэтому подстановка не может
 * исказить ни один корректный поток. Прототип правится один раз за процесс — экземпляры
 * клиента создаются внутри библиотеки на каждый запрос, дотянуться до них иначе нельзя.
 */
export function applyMissingStreamRoleFix(): void {
  let prototype: CompletionsConverterPrototype | null;
  try {
    prototype = resolveCompletionsPrototype();
  } catch (error) {
    logger.error('[corporate] Не удалось применить правку роли в потоке:', error);
    return;
  }

  if (prototype == null) {
    logger.warn(
      '[corporate] Правка роли в потоке не применена: разбор чанков устроен иначе, чем ожидалось. ' +
        'Вызовы инструментов у моделей, чей шлюз не шлёт роль в первом чанке, могут не работать.',
    );
    return;
  }

  if (prototype[ROLE_FIX_APPLIED] === true) {
    return;
  }

  const convert = prototype._convertCompletionsDeltaToBaseMessageChunk;
  prototype._convertCompletionsDeltaToBaseMessageChunk = function (
    this: CompletionsChunkConverter,
    delta: Record<string, unknown>,
    rawResponse: unknown,
    defaultRole?: string,
  ): unknown {
    /**
     * Пустая роль опаснее отсутствующей: разбор запоминает её как «роль этого
     * ответа» и подставляет во все следующие чанки, так что одна такая дельта
     * отравляет весь остаток потока. Поэтому пустая вычищается из копии дельты —
     * оригинал принадлежит библиотеке и менять его нельзя.
     */
    const rawRole = delta.role;
    const sanitized =
      typeof rawRole === 'string' && rawRole.trim() === '' ? { ...delta, role: undefined } : delta;
    return convert.call(this, sanitized, rawResponse, defaultRole || ASSISTANT_ROLE);
  };
  prototype[ROLE_FIX_APPLIED] = true;
}
