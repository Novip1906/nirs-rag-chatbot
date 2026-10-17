import { Types } from 'mongoose';
import {
  ingestDocument,
  extractedTextProblem,
  describeExtractedTextProblem,
  MIN_PLAIN_TEXT_LENGTH,
} from './ingest';
import type { IKnowledgeDocument, IKnowledgeSpace } from '@librechat/data-schemas';
import type { IngestDeps, IngestInput } from './ingest';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const DOCUMENT_TEXT = 'Текст документа. '.repeat(40);

function mockSpace(overrides: Partial<IKnowledgeSpace> = {}): IKnowledgeSpace {
  return {
    _id: new Types.ObjectId(),
    name: 'Корпоративные стандарты',
    description: '',
    allowedDepartments: [],
    embeddingModel: 'baai/bge-m3',
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as IKnowledgeSpace;
}

function mockDocument(overrides: Partial<IKnowledgeDocument> = {}): IKnowledgeDocument {
  return {
    _id: new Types.ObjectId(),
    spaceId: new Types.ObjectId(),
    file_id: 'f1',
    title: 'Регламент',
    filename: 'file-1.pdf',
    source: '',
    owner: '',
    version: '',
    effectiveDate: null,
    status: 'active',
    supersedesId: null,
    embeddingModel: 'baai/bge-m3',
    storagePath: 's3://knowledge/space-1/file-1.pdf',
    text: DOCUMENT_TEXT,
    bytes: 1024,
    mimetype: 'application/pdf',
    embedded: true,
    uploadedBy: new Types.ObjectId(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as IKnowledgeDocument;
}

function buildDeps(overrides: Partial<IngestDeps> = {}): IngestDeps {
  return {
    getSpaceById: jest.fn().mockResolvedValue(mockSpace()),
    saveOriginal: jest.fn().mockResolvedValue('s3://knowledge/space-1/file-1.pdf'),
    removeOriginal: jest.fn().mockResolvedValue(undefined),
    extractText: jest.fn().mockResolvedValue(DOCUMENT_TEXT),
    embedDocument: jest.fn().mockResolvedValue({ embedded: true }),
    createDocument: jest.fn().mockResolvedValue(mockDocument()),
    archiveDocument: jest.fn().mockResolvedValue(mockDocument({ status: 'archived' })),
    recordUsage: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function buildInput(overrides: Partial<IngestInput['fields']> = {}): IngestInput {
  return {
    spaceId: 'space-1',
    userId: 'user-1',
    file: {
      path: '/tmp/uploads/file-1.pdf',
      originalname: 'file-1.pdf',
      mimetype: 'application/pdf',
      size: 1024,
    },
    fields: {
      title: 'Регламент',
      ...overrides,
    },
  };
}

describe('ingestDocument', () => {
  it('успешная загрузка возвращает созданный документ', async () => {
    const document = mockDocument();
    const deps = buildDeps({ createDocument: jest.fn().mockResolvedValue(document) });

    const result = await ingestDocument(deps, buildInput());

    expect(result).toEqual({ ok: true, document });
  });

  it('на несуществующее пространство отвечает 404 и не трогает файл', async () => {
    const deps = buildDeps({ getSpaceById: jest.fn().mockResolvedValue(null) });

    const result = await ingestDocument(deps, buildInput());

    expect(result).toEqual({ ok: false, status: 404, error: 'Space not found' });
    expect(deps.saveOriginal).not.toHaveBeenCalled();
  });

  it('удаляет сохранённый оригинал, если индексация не удалась: иначе файл остаётся в хранилище навсегда', async () => {
    const removeOriginal = jest.fn().mockResolvedValue(undefined);
    const deps = buildDeps({
      embedDocument: jest.fn().mockRejectedValue(new Error('rag down')),
      removeOriginal,
    });

    const result = await ingestDocument(deps, buildInput());

    expect(result).toEqual({ ok: false, status: 502, error: 'Failed to index document' });
    expect(removeOriginal).toHaveBeenCalledWith('s3://knowledge/space-1/file-1.pdf');
    expect(deps.createDocument).not.toHaveBeenCalled();
  });

  it('не помечает документ проиндексированным, если rag_api ответил 200, но не подтвердил запись фрагментов', async () => {
    const createDocument = jest.fn().mockResolvedValue(mockDocument({ embedded: false }));
    const deps = buildDeps({
      embedDocument: jest.fn().mockResolvedValue({ embedded: false }),
      createDocument,
    });

    const result = await ingestDocument(deps, buildInput());

    expect(result.ok).toBe(true);
    expect(createDocument).toHaveBeenCalledWith(expect.objectContaining({ embedded: false }));
  });

  it('архивирует заменяемый документ после создания нового, а не до', async () => {
    const calls: string[] = [];
    const deps = buildDeps({
      createDocument: jest.fn(async (fields) => {
        calls.push('create');
        return mockDocument({ title: fields.title });
      }),
      archiveDocument: jest.fn(async () => {
        calls.push('archive');
        return null;
      }),
    });

    await ingestDocument(deps, buildInput({ supersedesId: 'old-doc' }));

    expect(calls).toEqual(['create', 'archive']);
  });

  it('короткий .md-документ отклоняется формулировкой про длину, а не про скан', async () => {
    const shortText = 'Записка.';
    const removeOriginal = jest.fn().mockResolvedValue(undefined);
    const deps = buildDeps({ extractText: jest.fn().mockResolvedValue(shortText), removeOriginal });

    const input = buildInput();
    input.file.originalname = 'записка.md';
    input.file.path = '/tmp/uploads/записка.md';
    input.file.mimetype = 'text/markdown';

    const result = await ingestDocument(deps, input);

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: `Документ слишком короткий для индексации: нужно не меньше ${MIN_PLAIN_TEXT_LENGTH} символов текста.`,
      reason: 'too_short',
    });
    expect(removeOriginal).toHaveBeenCalled();
    expect(deps.embedDocument).not.toHaveBeenCalled();
  });
});

/**
 * Регресс: короткий `.pdf`/`.docx` (реальный скан или нечитаемый парсер) должен
 * по-прежнему отклоняться формулировкой про скан и порогом в 200 символов —
 * снижение порога касается только простых текстовых форматов, где текст — это
 * сам файл, а не результат распознавания.
 */
describe('extractedTextProblem / describeExtractedTextProblem', () => {
  it('не трогает порог и формулировку для PDF/DOCX/PPTX', () => {
    const shortText = 'Приказ № 47-П';
    expect(extractedTextProblem(shortText, 'reglament.pdf')).toBe('too_short');
    expect(describeExtractedTextProblem('too_short', 'reglament.pdf')).toBe(
      'В документе почти нет текста. Возможно, это скан или файл с изображениями — распознайте текст и загрузите снова.',
    );
  });

  it('снижает порог и меняет формулировку для .txt/.md/.csv', () => {
    const shortButValidText = 'Не забыть: 1) молоко 2) хлеб 3) сахар';
    expect(shortButValidText.length).toBeGreaterThanOrEqual(MIN_PLAIN_TEXT_LENGTH);
    expect(shortButValidText.length).toBeLessThan(200);

    expect(extractedTextProblem(shortButValidText, 'список.txt')).toBeNull();
    expect(extractedTextProblem('коротко', 'список.txt')).toBe('too_short');
    expect(describeExtractedTextProblem('too_short', 'список.txt')).toBe(
      `Документ слишком короткий для индексации: нужно не меньше ${MIN_PLAIN_TEXT_LENGTH} символов текста.`,
    );
  });

  it('unreadable для простого текстового формата остаётся формулировкой про повреждённый файл, а не про скан', () => {
    const garbage = '\t       1.60.1.7s';
    expect(extractedTextProblem(garbage, 'заметка.csv')).toBe('unreadable');
    expect(describeExtractedTextProblem('unreadable', 'заметка.csv')).toBe(
      'Не удалось прочитать текст документа: файл повреждён или сохранён в неподдерживаемом формате. Пересохраните его и загрузите снова.',
    );
  });
});
