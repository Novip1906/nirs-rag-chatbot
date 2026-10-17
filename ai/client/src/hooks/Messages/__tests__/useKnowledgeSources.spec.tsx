import { renderHook } from '@testing-library/react';
import { Tools } from 'librechat-data-provider';
import type { TAttachment } from 'librechat-data-provider';
import { useKnowledgeSources } from '../useKnowledgeSources';

function knowledgeAttachment(sources: Array<Record<string, unknown>>): TAttachment {
  return {
    type: Tools.file_search,
    [Tools.file_search]: { sources },
    messageId: 'message-1',
    toolCallId: 'tool-call-1',
  } as TAttachment;
}

describe('useKnowledgeSources', () => {
  test('returns not-searched for no attachments', () => {
    const { result } = renderHook(() => useKnowledgeSources(undefined));
    expect(result.current).toEqual({ searched: false, documents: [] });
  });

  test('ignores attachments that are not file_search', () => {
    const attachments = [{ type: Tools.memory } as TAttachment];
    const { result } = renderHook(() => useKnowledgeSources(attachments));
    expect(result.current).toEqual({ searched: false, documents: [] });
  });

  test('ignores an ordinary file_search attachment whose sources lack docTitle', () => {
    const attachments = [
      knowledgeAttachment([{ fileId: 'f1', fileName: 'report.pdf', relevance: 0.9 }]),
    ];
    const { result } = renderHook(() => useKnowledgeSources(attachments));
    expect(result.current).toEqual({ searched: false, documents: [] });
  });

  test('marks a knowledge_search zero-hit attachment (empty sources) as searched', () => {
    const attachments = [knowledgeAttachment([])];
    const { result } = renderHook(() => useKnowledgeSources(attachments));
    expect(result.current).toEqual({ searched: true, documents: [] });
  });

  test('maps a knowledge document source to its display fields', () => {
    const attachments = [
      knowledgeAttachment([
        {
          fileId: 'f1',
          fileName: 'raw-filename.txt',
          docTitle: 'Положение об отпусках',
          spaceName: 'Кадры',
          version: '2.0',
          effectiveDate: '2026-03-14T00:00:00.000Z',
        },
      ]),
    ];
    const { result } = renderHook(() => useKnowledgeSources(attachments));
    expect(result.current.searched).toBe(true);
    expect(result.current.documents).toEqual([
      {
        fileId: 'f1',
        title: 'Положение об отпусках',
        spaceName: 'Кадры',
        version: '2.0',
        effectiveDate: '2026-03-14T00:00:00.000Z',
      },
    ]);
  });

  test('falls back to the filename when docTitle is empty', () => {
    const attachments = [
      knowledgeAttachment([{ fileId: 'f1', fileName: 'raw-filename.txt', docTitle: '' }]),
    ];
    const { result } = renderHook(() => useKnowledgeSources(attachments));
    expect(result.current.documents[0].title).toBe('raw-filename.txt');
  });

  test('omits unfilled optional fields instead of empty strings', () => {
    const attachments = [
      knowledgeAttachment([{ fileId: 'f1', docTitle: 'Регламент', fileName: 'a.txt' }]),
    ];
    const { result } = renderHook(() => useKnowledgeSources(attachments));
    const [document] = result.current.documents;
    expect(document.spaceName).toBeUndefined();
    expect(document.version).toBeUndefined();
    expect(document.effectiveDate).toBeUndefined();
  });

  test('collapses multiple fragments of the same document into one row', () => {
    const attachments = [
      knowledgeAttachment([
        { fileId: 'f1', docTitle: 'Регламент', fileName: 'a.txt', version: '1.0' },
        { fileId: 'f1', docTitle: 'Регламент', fileName: 'a.txt', version: '1.0' },
        { fileId: 'f2', docTitle: 'Другой документ', fileName: 'b.txt' },
      ]),
    ];
    const { result } = renderHook(() => useKnowledgeSources(attachments));
    expect(result.current.documents).toHaveLength(2);
    expect(result.current.documents.map((d) => d.fileId)).toEqual(['f1', 'f2']);
  });

  test('ignores a plain file_search attachment alongside a real knowledge attachment', () => {
    const attachments = [
      knowledgeAttachment([{ fileId: 'plain1', fileName: 'uploaded.pdf', relevance: 0.8 }]),
      knowledgeAttachment([{ fileId: 'kb1', docTitle: 'Регламент', fileName: 'kb.txt' }]),
    ];
    const { result } = renderHook(() => useKnowledgeSources(attachments));
    expect(result.current.searched).toBe(true);
    expect(result.current.documents).toEqual([
      {
        fileId: 'kb1',
        title: 'Регламент',
        spaceName: undefined,
        version: undefined,
        effectiveDate: undefined,
      },
    ]);
  });
});
