import {
  classifyDocumentSize,
  estimatePageCount,
  estimatePdfTokens,
  DEFAULT_DOCUMENT_SIZE_LIMITS,
  PDF_TOKENS_PER_PAGE,
} from './documents';

describe('classifyDocumentSize', () => {
  it('пропускает документ меньше порога предупреждения', () => {
    expect(classifyDocumentSize(1000, DEFAULT_DOCUMENT_SIZE_LIMITS)).toBe('ok');
  });

  it('помечает большим документ ровно на пороге предупреждения', () => {
    expect(classifyDocumentSize(8000, DEFAULT_DOCUMENT_SIZE_LIMITS)).toBe('large');
  });

  it('отклоняет документ ровно на пороге отказа', () => {
    expect(classifyDocumentSize(100000, DEFAULT_DOCUMENT_SIZE_LIMITS)).toBe('too_large');
  });

  /**
   * Пороги задаются админом и могут разойтись. Отказ должен выигрывать у
   * предупреждения, иначе документ, который нельзя принять, будет принят
   * с предупреждением.
   */
  it('отдаёт отказ, когда порог предупреждения выше порога отказа', () => {
    expect(classifyDocumentSize(50, { warnTokens: 100, maxTokens: 10 })).toBe('too_large');
  });

  it('считает пустой документ обычным', () => {
    expect(classifyDocumentSize(0, DEFAULT_DOCUMENT_SIZE_LIMITS)).toBe('ok');
  });
});

describe('estimatePageCount', () => {
  it('переводит токены в страницы для сообщения сотруднику', () => {
    expect(estimatePageCount(7500)).toBe(10);
  });

  it('никогда не отдаёт ноль страниц для непустого документа', () => {
    expect(estimatePageCount(1)).toBe(1);
  });

  it('отдаёт ноль для пустого документа', () => {
    expect(estimatePageCount(0)).toBe(0);
  });
});

describe('estimatePdfTokens', () => {
  /** Провайдер обрабатывает страницу PDF как картинку, а не как текст. */
  it('считает PDF по страницам, а не по знакам', () => {
    expect(estimatePdfTokens(8)).toBe(8 * PDF_TOKENS_PER_PAGE);
  });

  it('отдаёт ноль для документа без страниц', () => {
    expect(estimatePdfTokens(0)).toBe(0);
  });
});
