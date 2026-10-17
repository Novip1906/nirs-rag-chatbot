import {
  allocateDocuments,
  buildDocumentCard,
  documentCoverage,
  PROJECT_CONTEXT_BUDGETS,
} from './budget';
import type { ProjectDocumentSummary } from './budget';

function doc(
  fileId: string,
  tokenCount: number,
  title = fileId,
  embedded = true,
): ProjectDocumentSummary {
  return { fileId, title, tokenCount, text: 'x'.repeat(tokenCount * 2), embedded };
}

const budgets = { inlineBudget: 1000, headTokens: 100, headBudget: 250, cardLimit: 3 };

describe('allocateDocuments', () => {
  it('кладёт целиком всё, что помещается в бюджет', () => {
    const result = allocateDocuments([doc('a', 300), doc('b', 400)], budgets);

    expect(result.inline.map((d) => d.fileId)).toEqual(['a', 'b']);
    expect(result.searchable).toEqual([]);
    expect(result.heads).toEqual([]);
  });

  /** Мелкие документы важнее набить целиком: их влезет больше на тот же бюджет. */
  it('набивает от меньшего к большему', () => {
    const result = allocateDocuments([doc('big', 900), doc('small', 200)], budgets);

    expect(result.inline.map((d) => d.fileId)).toEqual(['small']);
    expect(result.searchable.map((d) => d.fileId)).toEqual(['big']);
  });

  it('не режет документ пополам — не влезающий уходит в поиск целиком', () => {
    const result = allocateDocuments([doc('huge', 5000)], budgets);

    expect(result.inline).toEqual([]);
    expect(result.searchable.map((d) => d.fileId)).toEqual(['huge']);
  });

  it('отдаёт начало документам, ушедшим в поиск', () => {
    const result = allocateDocuments([doc('huge', 5000)], budgets);

    expect(result.heads).toHaveLength(1);
    expect(result.heads[0].document.fileId).toBe('huge');
    expect(result.heads[0].text.length).toBeGreaterThan(0);
    expect(result.heads[0].text.length).toBeLessThan(result.heads[0].document.text.length);
  });

  /** Начала тоже стоят денег: их суммарный объём ограничен отдельно. */
  it('перестаёт раздавать начала, когда исчерпан их бюджет', () => {
    const result = allocateDocuments(
      [doc('a', 5000), doc('b', 5000), doc('c', 5000), doc('d', 5000)],
      budgets,
    );

    expect(result.searchable).toHaveLength(4);
    expect(result.heads).toHaveLength(2);
  });

  it('переживает документ с нулевым объёмом', () => {
    const result = allocateDocuments(
      [{ fileId: 'z', title: 'z', tokenCount: 0, text: '', embedded: true }],
      budgets,
    );

    expect(result.inline.map((d) => d.fileId)).toEqual(['z']);
  });

  it('возвращает пустую раскладку без документов', () => {
    expect(allocateDocuments([], budgets)).toEqual({ inline: [], heads: [], searchable: [] });
  });

  it('значения по умолчанию совпадают со спецификацией', () => {
    expect(PROJECT_CONTEXT_BUDGETS).toEqual({
      inlineBudget: 6000,
      headTokens: 1000,
      headBudget: 3000,
      cardLimit: 30,
    });
  });
});

describe('documentCoverage', () => {
  it('различает целиком, начало и только поиск', () => {
    const documents = [doc('a', 200), doc('b', 900), doc('c', 950), doc('d', 980)];
    const coverage = documentCoverage(allocateDocuments(documents, budgets));

    expect(coverage.get('a')).toBe('full');
    expect(coverage.get('b')).toBe('head');
    expect(coverage.get('c')).toBe('head');
    expect(coverage.get('d')).toBe('search');
  });

  /**
   * Непроиндексированный документ недостижим плотным поиском, и молчать об этом
   * нельзя: модель иначе отвечает так, будто видела весь проект.
   */
  it('отдельно помечает документ без индекса', () => {
    const documents = [doc('a', 200), doc('big', 5000, 'Договор', false)];
    const coverage = documentCoverage(allocateDocuments(documents, budgets));

    expect(coverage.get('big')).toBe('unindexed');
  });

  /** Влезший целиком документ виден модели независимо от индекса. */
  it('не помечает как непроиндексированный то, что ушло в контекст целиком', () => {
    const coverage = documentCoverage(allocateDocuments([doc('a', 200, 'a', false)], budgets));

    expect(coverage.get('a')).toBe('full');
  });
});

describe('buildDocumentCard', () => {
  it('перечисляет названия документов', () => {
    const documents = [doc('a', 10, 'Регламент'), doc('b', 10, 'Тарифы')];
    const card = buildDocumentCard(documents, allocateDocuments(documents, budgets), 3);

    expect(card).toContain('Регламент');
    expect(card).toContain('Тарифы');
  });

  it('помечает, что именно видно модели по каждому документу', () => {
    const documents = [doc('a', 200, 'Регламент'), doc('b', 950, 'Договор')];
    const card = buildDocumentCard(documents, allocateDocuments(documents, budgets), 3);

    expect(card).toMatch(/Регламент — целиком/);
    expect(card).toMatch(/Договор — /);
    expect(card).not.toMatch(/Договор — целиком/);
  });

  /** Без этой строки модель отвечает по фрагментам с уверенностью полного текста. */
  it('требует предупредить сотрудника, когда документ виден не полностью', () => {
    const documents = [doc('a', 200, 'Регламент'), doc('b', 950, 'Договор')];
    const card = buildDocumentCard(documents, allocateDocuments(documents, budgets), 3);

    expect(card).toContain('предупреди');
  });

  it('не добавляет предупреждение, когда все документы в контексте целиком', () => {
    const documents = [doc('a', 200, 'Регламент')];
    const card = buildDocumentCard(documents, allocateDocuments(documents, budgets), 3);

    expect(card).not.toContain('предупреди');
  });

  /** Карточка на сотне документов сама начинает стоить заметных денег. */
  it('режет длинный список и говорит, сколько осталось за кадром', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((id) => doc(id, 10, `Документ ${id}`));

    const card = buildDocumentCard(many, allocateDocuments(many, budgets), 3);

    expect(card).toContain('Документ a');
    expect(card).not.toContain('Документ e');
    expect(card).toContain('2');
  });

  it('отдаёт пустую строку без документов', () => {
    expect(buildDocumentCard([], allocateDocuments([], budgets), 3)).toBe('');
  });
});
