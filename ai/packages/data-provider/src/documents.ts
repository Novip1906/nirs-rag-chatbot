/**
 * Страница А4 сплошного текста — около 2000 знаков, на русском это примерно
 * 750 токенов. Значение нужно только для фразы «около N страниц» в интерфейсе:
 * сотруднику страницы понятнее токенов.
 */
export const TEXT_TOKENS_PER_PAGE = 750;

/**
 * Страница PDF уходит провайдеру картинкой, а не текстом, и стоит фиксированно
 * независимо от того, сколько на ней букв. 258 — величина, которую Gemini
 * назначает одной странице PDF.
 */
export const PDF_TOKENS_PER_PAGE = 258;

export interface DocumentSizeLimits {
  warnTokens: number;
  maxTokens: number;
}

export const DEFAULT_DOCUMENT_SIZE_LIMITS: DocumentSizeLimits = {
  warnTokens: 8000,
  maxTokens: 100000,
};

export type DocumentSizeVerdict = 'ok' | 'large' | 'too_large';

/**
 * Отказ проверяется первым: пороги задаёт админ, и если он выставит порог
 * предупреждения выше порога отказа, документ обязан быть отклонён, а не принят
 * с предупреждением.
 */
export function classifyDocumentSize(
  tokenCount: number,
  limits: DocumentSizeLimits,
): DocumentSizeVerdict {
  if (tokenCount >= limits.maxTokens) {
    return 'too_large';
  }
  if (tokenCount >= limits.warnTokens) {
    return 'large';
  }
  return 'ok';
}

export function estimatePageCount(
  tokenCount: number,
  tokensPerPage: number = TEXT_TOKENS_PER_PAGE,
): number {
  if (tokenCount <= 0) {
    return 0;
  }
  return Math.max(1, Math.round(tokenCount / tokensPerPage));
}

export function estimatePdfTokens(pageCount: number): number {
  return Math.max(0, pageCount) * PDF_TOKENS_PER_PAGE;
}

export interface ProjectDocumentSummary {
  fileId: string;
  title: string;
  tokenCount: number;
  text: string;
  /**
   * Документ без индекса недостижим плотным поиском: `rag_api` о нём не знает,
   * остаётся только лексическая ветка. На раскладку это не влияет, но в карточке
   * такой документ обязан выглядеть иначе — иначе модель считает, что видела весь
   * проект, а сотрудник получает уверенный ответ по половине папки.
   */
  embedded: boolean;
}

export interface ContextBudgets {
  inlineBudget: number;
  headTokens: number;
  headBudget: number;
  cardLimit: number;
}

export interface DocumentHead {
  document: ProjectDocumentSummary;
  text: string;
}

export interface DocumentAllocation {
  inline: ProjectDocumentSummary[];
  heads: DocumentHead[];
  searchable: ProjectDocumentSummary[];
}

export const PROJECT_CONTEXT_BUDGETS: ContextBudgets = {
  inlineBudget: 6000,
  headTokens: 1000,
  headBudget: 3000,
  cardLimit: 30,
};

/**
 * Доля текста, соответствующая заданному числу токенов. Отдельный подсчёт токенов
 * здесь не нужен: у документа уже сохранены и полный текст, и его объём, а значит
 * длину начала можно взять пропорцией — это дешевле и не делает функцию асинхронной.
 */
function headSlice(document: ProjectDocumentSummary, headTokens: number): string {
  if (document.tokenCount <= 0 || document.text === '') {
    return '';
  }
  const share = headTokens / document.tokenCount;
  if (share >= 1) {
    return document.text;
  }
  return document.text.slice(0, Math.max(1, Math.round(document.text.length * share)));
}

/**
 * Порядок от меньшего к большему выбран сознательно: на один и тот же бюджет
 * мелких документов помещается больше, а документ целиком всегда лучше, чем
 * фрагменты из него.
 */
export function allocateDocuments(
  documents: ProjectDocumentSummary[],
  budgets: ContextBudgets,
): DocumentAllocation {
  const ordered = [...documents].sort((left, right) => left.tokenCount - right.tokenCount);

  const inline: ProjectDocumentSummary[] = [];
  const searchable: ProjectDocumentSummary[] = [];
  let inlineSpent = 0;

  for (const document of ordered) {
    if (inlineSpent + document.tokenCount <= budgets.inlineBudget) {
      inline.push(document);
      inlineSpent += document.tokenCount;
      continue;
    }
    searchable.push(document);
  }

  const heads: DocumentHead[] = [];
  let headSpent = 0;

  for (const document of searchable) {
    if (headSpent + budgets.headTokens > budgets.headBudget) {
      break;
    }
    const text = headSlice(document, budgets.headTokens);
    if (text === '') {
      continue;
    }
    heads.push({ document, text });
    headSpent += budgets.headTokens;
  }

  return { inline, heads, searchable };
}

export type DocumentCoverage = 'full' | 'head' | 'search' | 'unindexed';

const COVERAGE_LABELS: Record<DocumentCoverage, string> = {
  full: 'целиком',
  head: 'начало документа и фрагменты по запросу',
  search: 'только фрагменты по запросу',
  unindexed: 'только фрагменты по названию, поиск по тексту недоступен',
};

/**
 * Что именно из документа доходит до модели. Считается из готовой раскладки, а не
 * повторным разбором бюджета: расхождение между карточкой и контекстом было бы хуже
 * отсутствия карточки — модель поверила бы подписи, а не тексту.
 */
export function documentCoverage(
  allocation: DocumentAllocation,
): Map<string, DocumentCoverage> {
  const coverage = new Map<string, DocumentCoverage>();
  for (const document of allocation.inline) {
    coverage.set(document.fileId, 'full');
  }
  const withHead = new Set(allocation.heads.map((head) => head.document.fileId));
  for (const document of allocation.searchable) {
    if (!document.embedded) {
      coverage.set(document.fileId, 'unindexed');
      continue;
    }
    coverage.set(document.fileId, withHead.has(document.fileId) ? 'head' : 'search');
  }
  return coverage;
}

export function buildDocumentCard(
  documents: ProjectDocumentSummary[],
  allocation: DocumentAllocation,
  cardLimit: number,
): string {
  if (documents.length === 0) {
    return '';
  }
  const coverage = documentCoverage(allocation);
  const shown = documents.slice(0, cardLimit);
  const names = shown
    .map((document) => {
      const label = COVERAGE_LABELS[coverage.get(document.fileId) ?? 'search'];
      return `— ${document.title} — ${label}`;
    })
    .join('\n');
  const hidden = documents.length - shown.length;
  const tail = hidden > 0 ? `\n— и ещё документов: ${hidden}` : '';
  const partial = documents.some((document) => coverage.get(document.fileId) !== 'full');
  const notice = partial
    ? '\n\nДокументы, приложенные не целиком, ты видишь не полностью. Если ответ опирается на такой документ, предупреди сотрудника, что просмотрен не весь текст, и назови документы, по которым виден только фрагмент.'
    : '';
  return `К проекту приложены документы:\n${names}${tail}${notice}`;
}
