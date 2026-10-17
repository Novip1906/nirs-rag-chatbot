import { renderHook } from '@testing-library/react';
import { Tools } from 'librechat-data-provider';
import type { TAttachment } from 'librechat-data-provider';
import { useSearchResultsByTurn } from '../useSearchResultsByTurn';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

function knowledgeAttachment(sources: Array<Record<string, unknown>>): TAttachment {
  return {
    type: Tools.file_search,
    [Tools.file_search]: { sources },
    messageId: 'm1',
    toolCallId: `tool-${Math.random()}`,
  } as TAttachment;
}

describe('useSearchResultsByTurn: нумерация документов базы знаний', () => {
  it('документы всех вызовов поиска складываются в один ход', () => {
    const attachments = [
      knowledgeAttachment([
        { fileId: 'lec1', citationIndex: 0, docTitle: 'Лекция 1', fileName: 'lec1.pdf' },
        { fileId: 'lec2', citationIndex: 1, docTitle: 'Лекция 2', fileName: 'lec2.pdf' },
      ]),
      knowledgeAttachment([
        { fileId: 'tickets', citationIndex: 2, docTitle: 'Билеты', fileName: 'tickets.pdf' },
      ]),
    ];
    const { result } = renderHook(() => useSearchResultsByTurn(attachments));

    expect(Object.keys(result.current)).toEqual(['0']);
    expect(result.current['0'].references).toHaveLength(3);
  });

  it('якорь второго вызова указывает на его собственный документ, а не на первый', () => {
    const attachments = [
      knowledgeAttachment([
        { fileId: 'lec1', citationIndex: 0, docTitle: 'Лекция 1', fileName: 'lec1.pdf' },
      ]),
      knowledgeAttachment([
        { fileId: 'tickets', citationIndex: 1, docTitle: 'Билеты', fileName: 'tickets.pdf' },
      ]),
    ];
    const { result } = renderHook(() => useSearchResultsByTurn(attachments));

    const references = result.current['0'].references as unknown as Array<{ fileId: string }>;
    expect(references[0].fileId).toBe('lec1');
    expect(references[1].fileId).toBe('tickets');
  });

  it('документ, найденный дважды, занимает одно место и объединяет страницы', () => {
    const attachments = [
      knowledgeAttachment([
        { fileId: 'tickets', citationIndex: 0, docTitle: 'Билеты', pages: [0], relevance: 0.5 },
        { fileId: 'lec1', citationIndex: 1, docTitle: 'Лекция 1' },
      ]),
      knowledgeAttachment([
        { fileId: 'tickets', citationIndex: 0, docTitle: 'Билеты', pages: [4], relevance: 0.7 },
      ]),
    ];
    const { result } = renderHook(() => useSearchResultsByTurn(attachments));

    const references = result.current['0'].references as unknown as Array<{
      fileId: string;
      pages: number[];
    }>;
    expect(references).toHaveLength(2);
    expect(references[0].pages).toEqual([0, 4]);
  });

  it('пропуск в нумерации остаётся пропуском, чтобы устаревший якорь никуда не указал', () => {
    const attachments = [
      knowledgeAttachment([
        { fileId: 'a', citationIndex: 0, docTitle: 'Первый' },
        { fileId: 'c', citationIndex: 2, docTitle: 'Третий' },
      ]),
    ];
    const { result } = renderHook(() => useSearchResultsByTurn(attachments));

    const references = result.current['0'].references as unknown as Array<
      { fileId?: string } | undefined
    >;
    expect(references).toHaveLength(3);
    expect(references[1]).toBeUndefined();
    expect(references[2]?.fileId).toBe('c');
  });

  it('обычный file_search без нумерации работает по-прежнему', () => {
    const attachments = [
      knowledgeAttachment([{ fileId: 'uploaded', fileName: 'upload.pdf', relevance: 0.9 }]),
    ];
    const { result } = renderHook(() => useSearchResultsByTurn(attachments));

    expect(Object.keys(result.current)).toEqual(['0']);
    expect(result.current['0'].references).toHaveLength(1);
  });
});

describe('useSearchResultsByTurn: значки в тексте только когда документов несколько', () => {
  it('единственный документ базы знаний не заводит хода — якорям нечего разрешать', () => {
    const attachments = [
      knowledgeAttachment([
        { fileId: 'lec1', citationIndex: 0, docTitle: 'Лекция 1', fileName: 'lec1.pdf' },
      ]),
    ];
    const { result } = renderHook(() => useSearchResultsByTurn(attachments));

    expect(result.current['0']).toBeUndefined();
    expect(Object.keys(result.current)).toEqual([]);
  });

  it('два и более документов заводят ход с расстановкой ссылок по citationIndex', () => {
    const attachments = [
      knowledgeAttachment([
        { fileId: 'a', citationIndex: 0, docTitle: 'Первый' },
        { fileId: 'c', citationIndex: 2, docTitle: 'Третий' },
      ]),
    ];
    const { result } = renderHook(() => useSearchResultsByTurn(attachments));

    const references = result.current['0'].references as unknown as Array<
      { fileId?: string } | undefined
    >;
    expect(references).toHaveLength(3);
    expect(references[0]?.fileId).toBe('a');
    expect(references[1]).toBeUndefined();
    expect(references[2]?.fileId).toBe('c');
  });

  it('подпись ссылки берётся из docTitle документа базы знаний', () => {
    const attachments = [
      knowledgeAttachment([
        { fileId: 'lec1', citationIndex: 0, docTitle: 'Лекция 1', fileName: 'lec1.pdf' },
        { fileId: 'lec2', citationIndex: 1, docTitle: 'Лекция 2', fileName: 'lec2.pdf' },
      ]),
    ];
    const { result } = renderHook(() => useSearchResultsByTurn(attachments));

    const references = result.current['0'].references as unknown as Array<{
      title: string;
      attribution: string;
    }>;
    expect(references[0].title).toBe('Лекция 1');
    expect(references[0].attribution).toBe('Лекция 1');
    expect(references[1].title).toBe('Лекция 2');
    expect(references[1].attribution).toBe('Лекция 2');
  });

  it('у обычного вложения без docTitle подпись по-прежнему из fileName', () => {
    const attachments = [
      knowledgeAttachment([{ fileId: 'uploaded', fileName: 'upload.pdf', relevance: 0.9 }]),
    ];
    const { result } = renderHook(() => useSearchResultsByTurn(attachments));

    const references = result.current['0'].references as unknown as Array<{
      title: string;
      attribution: string;
    }>;
    expect(references[0].title).toBe('upload.pdf');
    expect(references[0].attribution).toBe('upload.pdf');
  });

  it('вложение базы знаний и обычное вложение не путаются: у каждого свой ход', () => {
    const attachments = [
      knowledgeAttachment([
        { fileId: 'lec1', citationIndex: 0, docTitle: 'Лекция 1', fileName: 'lec1.pdf' },
        { fileId: 'lec2', citationIndex: 1, docTitle: 'Лекция 2', fileName: 'lec2.pdf' },
      ]),
      knowledgeAttachment([{ fileId: 'uploaded', fileName: 'upload.pdf', relevance: 0.9 }]),
    ];
    const { result } = renderHook(() => useSearchResultsByTurn(attachments));

    expect(Object.keys(result.current).sort()).toEqual(['0', '1']);

    const knowledgeRefs = result.current['0'].references as unknown as Array<{ fileId: string }>;
    expect(knowledgeRefs).toHaveLength(2);
    expect(knowledgeRefs.map((reference) => reference.fileId)).toEqual(['lec1', 'lec2']);

    const genericRefs = result.current['1'].references as unknown as Array<{ fileId: string }>;
    expect(genericRefs).toHaveLength(1);
    expect(genericRefs[0].fileId).toBe('uploaded');
  });
});
