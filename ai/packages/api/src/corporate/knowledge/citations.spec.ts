import {
  buildKnowledgeSearchContext,
  buildKnowledgeSearchRequiredContext,
  DocumentCitationIndex,
  knowledgeAnchor,
} from './citations';

/**
 * Дословная копия `STANDALONE_PATTERN` из `client/src/utils/citations.ts`.
 * Клиент — другой пакет, импортировать его отсюда нельзя, но контракт между
 * тем, что выдаёт сервер, и тем, что разбирает клиент, проверять надо. Если
 * клиентское выражение изменят, эти тесты продолжат проверять старое — поэтому
 * копия и помечена как копия.
 */
const CLIENT_STANDALONE_PATTERN =
  /(?:\\ue202|)turn(\d+)(search|image|news|video|ref|file)(\d+)/g;

describe('knowledgeAnchor', () => {
  it('собирает якорь в том виде, который разбирает клиент', () => {
    expect(knowledgeAnchor(0)).toBe('\\ue202turn0file0');
    expect(knowledgeAnchor(7)).toBe('\\ue202turn0file7');
  });

  it('якорь распознаётся регулярным выражением клиента', () => {
    const matches = [...`Факт.${knowledgeAnchor(3)}`.matchAll(CLIENT_STANDALONE_PATTERN)];
    expect(matches).toHaveLength(1);
    expect(matches[0][1]).toBe('0');
    expect(matches[0][2]).toBe('file');
    expect(matches[0][3]).toBe('3');
  });

  it('в якоре литеральная запись, а не сам символ U+E202', () => {
    expect(knowledgeAnchor(0).startsWith('\\ue202')).toBe(true);
    expect(knowledgeAnchor(0).includes('\uE202')).toBe(false);
  });
});

describe('DocumentCitationIndex', () => {
  it('нумерует документы подряд с нуля', () => {
    const index = new DocumentCitationIndex();
    expect(index.indexFor('doc-a')).toBe(0);
    expect(index.indexFor('doc-b')).toBe(1);
    expect(index.indexFor('doc-c')).toBe(2);
  });

  it('один документ получает один номер, сколько бы раз его ни спрашивали', () => {
    const index = new DocumentCitationIndex();
    expect(index.indexFor('doc-a')).toBe(0);
    expect(index.indexFor('doc-b')).toBe(1);
    expect(index.indexFor('doc-a')).toBe(0);
    expect(index.indexFor('doc-b')).toBe(1);
    expect(index.size).toBe(2);
  });

  it('номер сохраняется между вызовами поиска в одном ответе', () => {
    const index = new DocumentCitationIndex();
    const first = ['лекция', 'билеты'].map((fileId) => index.indexFor(fileId));
    const second = ['билеты', 'регламент'].map((fileId) => index.indexFor(fileId));
    expect(first).toEqual([0, 1]);
    expect(second).toEqual([1, 2]);
  });

  it('у разных ответов нумерация независимая', () => {
    expect(new DocumentCitationIndex().indexFor('doc-a')).toBe(0);
    expect(new DocumentCitationIndex().indexFor('doc-z')).toBe(0);
  });
});

describe('buildKnowledgeSearchContext', () => {
  it('содержит образец якоря, пригодный для копирования', () => {
    expect(buildKnowledgeSearchContext()).toContain('\\ue202turn0file0');
  });

  it('запрещает ставить якорь у фактов не из документов', () => {
    expect(buildKnowledgeSearchContext()).toContain('якорь не ставь');
  });

  it('требует якорь хотя бы один раз на документ, а не на каждый факт', () => {
    const text = buildKnowledgeSearchContext();
    expect(text).toContain('хотя бы один раз');
    expect(text).not.toContain('Каждый факт');
  });

  it('запрещает повторять один и тот же якорь подряд', () => {
    expect(buildKnowledgeSearchContext()).toContain('Не повторяй один и тот же якорь подряд');
  });

  it('примеры из инструкции разбираются регулярным выражением клиента', () => {
    const matches = [...buildKnowledgeSearchContext().matchAll(CLIENT_STANDALONE_PATTERN)];
    expect(matches.length).toBeGreaterThanOrEqual(3);
    expect(matches.every((match) => match[2] === 'file')).toBe(true);
  });
});

describe('buildKnowledgeSearchRequiredContext', () => {
  it('требует вызвать поиск прежде, чем отвечать', () => {
    expect(buildKnowledgeSearchRequiredContext()).toContain('обязательно вызови');
  });

  it('запрещает подменять пустой результат поиска общими знаниями', () => {
    const text = buildKnowledgeSearchRequiredContext();
    expect(text).toContain('в документах компании этой информации нет');
    expect(text).toContain('не продолжай ответ по своим общим знаниям');
  });

  it('включает те же правила цитирования, что и обычный контекст', () => {
    const text = buildKnowledgeSearchRequiredContext();
    expect(text).toContain('\\ue202turn0fileN');
    expect(text).toContain('якорь не ставь');
    expect(text).toContain('хотя бы один раз');
    expect(text).toContain('Не повторяй один и тот же якорь подряд');
  });

  it('примеры из инструкции разбираются регулярным выражением клиента', () => {
    const matches = [
      ...buildKnowledgeSearchRequiredContext().matchAll(CLIENT_STANDALONE_PATTERN),
    ];
    expect(matches.length).toBeGreaterThanOrEqual(3);
    expect(matches.every((match) => match[2] === 'file')).toBe(true);
  });
});
