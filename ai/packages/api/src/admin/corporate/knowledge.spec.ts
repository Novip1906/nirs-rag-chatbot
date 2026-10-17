import { KnowledgeSpaceNotEmptyError } from '@librechat/data-schemas';
import { Types } from 'mongoose';
import type { IKnowledgeDocument, IKnowledgeSpace } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { CorporateKnowledgeDeps } from './knowledge';
import { createCorporateKnowledgeHandlers } from './knowledge';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

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
    filename: 'reglament.pdf',
    source: '',
    owner: '',
    version: '',
    effectiveDate: null,
    status: 'active',
    supersedesId: null,
    embeddingModel: 'baai/bge-m3',
    storagePath: '/app/uploads/knowledge/space/f1.pdf',
    text: 'текст документа',
    bytes: 100,
    mimetype: 'application/pdf',
    embedded: true,
    uploadedBy: new Types.ObjectId(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as IKnowledgeDocument;
}

function mockFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    path: '/tmp/uploads/reglament.pdf',
    originalname: 'reglament.pdf',
    mimetype: 'application/pdf',
    size: 1024,
    ...overrides,
  } as Express.Multer.File;
}

function createReqRes(overrides: {
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  file?: Express.Multer.File;
  caller?: { id?: string; role?: string };
}) {
  const req = {
    params: overrides.params ?? {},
    query: overrides.query ?? {},
    body: overrides.body ?? {},
    file: overrides.file,
    user: {
      _id: overrides.caller?.id ?? new Types.ObjectId().toString(),
      role: overrides.caller?.role ?? 'ADMIN',
    },
  } as unknown as ServerRequest;

  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;

  return { req, res, status, json };
}

function createDeps(overrides: Partial<CorporateKnowledgeDeps> = {}): CorporateKnowledgeDeps {
  return {
    listSpaces: jest.fn().mockResolvedValue([]),
    getSpaceById: jest.fn().mockResolvedValue(mockSpace()),
    createSpace: jest.fn().mockResolvedValue(mockSpace()),
    updateSpace: jest.fn().mockResolvedValue(mockSpace()),
    deleteSpace: jest.fn().mockResolvedValue(true),
    countDocumentsBySpace: jest.fn().mockResolvedValue(new Map()),
    listDocuments: jest.fn().mockResolvedValue([]),
    getDocumentById: jest.fn().mockResolvedValue(mockDocument()),
    createDocument: jest.fn().mockResolvedValue(mockDocument()),
    updateDocument: jest.fn().mockResolvedValue(mockDocument()),
    deleteDocument: jest.fn().mockResolvedValue(true),
    archiveDocument: jest.fn().mockResolvedValue(mockDocument({ status: 'archived' })),
    extractText: jest.fn().mockResolvedValue(DOCUMENT_TEXT),
    embedDocument: jest.fn().mockResolvedValue({ embedded: true }),
    deleteVectors: jest.fn().mockResolvedValue(undefined),
    saveOriginal: jest.fn().mockResolvedValue('/app/uploads/knowledge/space/f1.pdf'),
    removeOriginal: jest.fn().mockResolvedValue(undefined),
    readOriginal: jest.fn().mockResolvedValue(Buffer.from('original bytes')),
    recordUsage: jest.fn().mockResolvedValue(undefined),
    getUserPolicy: jest.fn().mockResolvedValue(null),
    findUsers: jest.fn().mockResolvedValue([]),
    getSpaceOverrides: jest.fn().mockResolvedValue({ allowedSpaces: [], deniedSpaces: [] }),
    ...overrides,
  };
}

const DOCUMENT_TEXT = 'Текст документа. '.repeat(40);

describe('createCorporateKnowledgeHandlers — пространства', () => {
  it('listSpaces отдаёт число документов и не отдаёт внутренности mongoose', async () => {
    const space = mockSpace({ name: 'Продуктовое' });
    const deps = createDeps({
      listSpaces: jest.fn().mockResolvedValue([space]),
      countDocumentsBySpace: jest.fn().mockResolvedValue(new Map([[space._id.toString(), 3]])),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status, json } = createReqRes({});

    await handlers.listSpaces(req, res);

    expect(status).toHaveBeenCalledWith(200);
    const payload = json.mock.calls[0][0];
    expect(payload.spaces).toEqual([
      {
        id: space._id.toString(),
        name: 'Продуктовое',
        description: '',
        allowedDepartments: [],
        embeddingModel: 'baai/bge-m3',
        enabled: true,
        documentCount: 3,
      },
    ]);
  });

  it('createSpace без имени отвечает 400', async () => {
    const deps = createDeps();
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = createReqRes({ body: { name: '   ' } });

    await handlers.createSpace(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.createSpace).not.toHaveBeenCalled();
  });

  it('createSpace создаёт пространство и отвечает 201', async () => {
    const deps = createDeps();
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = createReqRes({ body: { name: 'Юридическое' } });

    await handlers.createSpace(req, res);

    expect(status).toHaveBeenCalledWith(201);
    expect(deps.createSpace).toHaveBeenCalledWith(expect.objectContaining({ name: 'Юридическое' }));
  });

  it('updateSpace на несуществующем отвечает 404', async () => {
    const deps = createDeps({ updateSpace: jest.fn().mockResolvedValue(null) });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const id = new Types.ObjectId().toString();
    const { req, res, status } = createReqRes({ params: { id }, body: { name: 'X' } });

    await handlers.updateSpace(req, res);

    expect(status).toHaveBeenCalledWith(404);
  });

  it('updateSpace с невалидным id отвечает 400', async () => {
    const deps = createDeps();
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = createReqRes({ params: { id: 'nope' }, body: { name: 'X' } });

    await handlers.updateSpace(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.updateSpace).not.toHaveBeenCalled();
  });

  it('deleteSpace с документами отвечает 409, а не 500', async () => {
    const deps = createDeps({
      deleteSpace: jest.fn().mockRejectedValue(new KnowledgeSpaceNotEmptyError(3)),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const id = new Types.ObjectId().toString();
    const { req, res, status } = createReqRes({ params: { id } });

    await handlers.deleteSpace(req, res);

    expect(status).toHaveBeenCalledWith(409);
  });

  it('deleteSpace на несуществующем отвечает 404', async () => {
    const deps = createDeps({ deleteSpace: jest.fn().mockResolvedValue(false) });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const id = new Types.ObjectId().toString();
    const { req, res, status } = createReqRes({ params: { id } });

    await handlers.deleteSpace(req, res);

    expect(status).toHaveBeenCalledWith(404);
  });

  it('deleteSpace успешно удаляет пустое пространство', async () => {
    const deps = createDeps();
    const handlers = createCorporateKnowledgeHandlers(deps);
    const id = new Types.ObjectId().toString();
    const { req, res, status, json } = createReqRes({ params: { id } });

    await handlers.deleteSpace(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ success: true });
  });
});

describe('createCorporateKnowledgeHandlers — документы, чтение', () => {
  it('listDocuments отдаёт документы пространства без text и storagePath', async () => {
    const doc = mockDocument({ title: 'Приказ' });
    const deps = createDeps({ listDocuments: jest.fn().mockResolvedValue([doc]) });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const spaceId = new Types.ObjectId().toString();
    const { req, res, status, json } = createReqRes({ params: { id: spaceId } });

    await handlers.listDocuments(req, res);

    expect(status).toHaveBeenCalledWith(200);
    const payload = json.mock.calls[0][0];
    expect(payload.documents).toHaveLength(1);
    expect(payload.documents[0]).not.toHaveProperty('text');
    expect(payload.documents[0]).not.toHaveProperty('storagePath');
    expect(payload.documents[0].title).toBe('Приказ');
  });

  it('listDocuments передаёт фильтр по статусу из query', async () => {
    const deps = createDeps();
    const handlers = createCorporateKnowledgeHandlers(deps);
    const spaceId = new Types.ObjectId().toString();
    const { req, res } = createReqRes({ params: { id: spaceId }, query: { status: 'archived' } });

    await handlers.listDocuments(req, res);

    expect(deps.listDocuments).toHaveBeenCalledWith({ spaceId, status: 'archived' });
  });

  it('listDocuments разрешает id загрузивших в имена одним запросом, а не по одному на документ', async () => {
    const uploaderA = new Types.ObjectId();
    const uploaderB = new Types.ObjectId();
    const docA = mockDocument({ title: 'Приказ', uploadedBy: uploaderA });
    const docB = mockDocument({ title: 'Регламент', uploadedBy: uploaderB });
    const deps = createDeps({
      listDocuments: jest.fn().mockResolvedValue([docA, docB]),
      findUsers: jest.fn().mockResolvedValue([
        { _id: uploaderA, name: 'Мария Иванова', email: 'maria@corp.example' },
        { _id: uploaderB, name: '', email: 'bez.imeni@corp.example' },
      ]),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const spaceId = new Types.ObjectId().toString();
    const { req, res, json } = createReqRes({ params: { id: spaceId } });

    await handlers.listDocuments(req, res);

    expect(deps.findUsers).toHaveBeenCalledTimes(1);
    const payload = json.mock.calls[0][0];
    expect(payload.documents[0]).toMatchObject({
      uploadedBy: uploaderA.toString(),
      uploadedByName: 'Мария Иванова',
    });
    /** У сотрудника без имени в системе колонка показывает почту, как на соседних экранах. */
    expect(payload.documents[1]).toMatchObject({
      uploadedBy: uploaderB.toString(),
      uploadedByName: 'bez.imeni@corp.example',
    });
  });

  it('listDocuments оставляет uploadedByName незаполненным, если загрузившего больше нет в системе', async () => {
    const doc = mockDocument({ title: 'Приказ' });
    const deps = createDeps({
      listDocuments: jest.fn().mockResolvedValue([doc]),
      findUsers: jest.fn().mockResolvedValue([]),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const spaceId = new Types.ObjectId().toString();
    const { req, res, json } = createReqRes({ params: { id: spaceId } });

    await handlers.listDocuments(req, res);

    const payload = json.mock.calls[0][0];
    expect(payload.documents[0]).not.toHaveProperty('uploadedByName');
  });
});

describe('createCorporateKnowledgeHandlers — загрузка документа', () => {
  const spaceId = new Types.ObjectId().toString();

  function reqWithFile(overrides: { body?: Record<string, unknown>; file?: Express.Multer.File }) {
    return createReqRes({
      params: { id: spaceId },
      body: { title: 'Регламент', ...overrides.body },
      file: overrides.file ?? mockFile(),
    });
  }

  it('в rag_api уходит entity_id, равный пространству', async () => {
    const deps = createDeps({
      getSpaceById: jest.fn().mockResolvedValue(mockSpace({ _id: new Types.ObjectId(spaceId) })),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res } = reqWithFile({});

    await handlers.uploadDocument(req, res);

    expect(deps.embedDocument).toHaveBeenCalledWith(expect.objectContaining({ entityId: spaceId }));
  });

  it('запись в MongoDB не создаётся, если эмбеддинг упал', async () => {
    const deps = createDeps({ embedDocument: jest.fn().mockRejectedValue(new Error('rag down')) });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = reqWithFile({});

    await handlers.uploadDocument(req, res);

    expect(deps.createDocument).not.toHaveBeenCalled();
    expect(deps.removeOriginal).toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(502);
  });

  it('документ с текстом сверх лимита MongoDB отклоняется до эмбеддинга', async () => {
    const deps = createDeps({ extractText: jest.fn().mockResolvedValue('я'.repeat(16_000_000)) });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = reqWithFile({});

    await handlers.uploadDocument(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.embedDocument).not.toHaveBeenCalled();
  });

  it('документ с нечитаемым текстом отклоняется до эмбеддинга', async () => {
    const deps = createDeps({
      extractText: jest
        .fn()
        .mockResolvedValue('\t\u0000\u0000\u0000\u0000\u0000\u0000\u00001.60.1.7s'),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status, json } = reqWithFile({});

    await handlers.uploadDocument(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ reason: 'unreadable' }));
    expect(deps.embedDocument).not.toHaveBeenCalled();
    expect(deps.createDocument).not.toHaveBeenCalled();
    expect(deps.removeOriginal).toHaveBeenCalled();
  });

  it('документ почти без текста отклоняется до эмбеддинга', async () => {
    const deps = createDeps({ extractText: jest.fn().mockResolvedValue('Приказ № 47-П') });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status, json } = reqWithFile({});

    await handlers.uploadDocument(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ reason: 'too_short' }));
    expect(deps.embedDocument).not.toHaveBeenCalled();
    expect(deps.removeOriginal).toHaveBeenCalled();
  });

  it('перевод строки и табуляция не считаются нечитаемыми', async () => {
    const deps = createDeps({
      extractText: jest.fn().mockResolvedValue('Заголовок\n\tПункт первый.\r\n'.repeat(20)),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res } = reqWithFile({});

    await handlers.uploadDocument(req, res);

    expect(deps.createDocument).toHaveBeenCalled();
  });

  it('в индексацию уходит нормализованный текст, а не исходный файл', async () => {
    const slides = Array.from(
      { length: 30 },
      (_, i) => 'Пункт ' + (i + 1) + ' про электронику',
    ).join('\n\n');
    const deps = createDeps({ extractText: jest.fn().mockResolvedValue(slides) });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res } = reqWithFile({});

    await handlers.uploadDocument(req, res);

    const passed = (deps.embedDocument as jest.Mock).mock.calls[0][0].text as string;
    expect(passed).toBeDefined();
    expect(passed.split('\n\n').length).toBeLessThan(slides.split('\n\n').length / 3);
  });

  it('загрузка новой версии переводит предыдущую в архив', async () => {
    const oldDoc = mockDocument({ spaceId: new Types.ObjectId(spaceId) });
    const deps = createDeps({ getDocumentById: jest.fn().mockResolvedValue(oldDoc) });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res } = reqWithFile({ body: { supersedesId: oldDoc._id.toString() } });

    await handlers.uploadDocument(req, res);

    expect(deps.archiveDocument).toHaveBeenCalledWith(oldDoc._id.toString());
  });

  it('uploadDocument отклоняет опечатку в статусе до создания документа', async () => {
    const deps = createDeps();
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = reqWithFile({ body: { status: 'actve' } });

    await handlers.uploadDocument(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.createDocument).not.toHaveBeenCalled();
    expect(deps.embedDocument).not.toHaveBeenCalled();
  });

  it('uploadDocument отклоняет некорректный supersedesId до создания документа, а не 500 после', async () => {
    const deps = createDeps();
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = reqWithFile({ body: { supersedesId: 'not-an-object-id' } });

    await handlers.uploadDocument(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.getDocumentById).not.toHaveBeenCalled();
    expect(deps.createDocument).not.toHaveBeenCalled();
  });

  it('uploadDocument отказывает главе, если supersedesId ссылается на документ из чужого пространства, и не архивирует его', async () => {
    const departmentId = new Types.ObjectId();
    const ownSpace = mockSpace({
      _id: new Types.ObjectId(spaceId),
      allowedDepartments: [departmentId],
    });
    const foreignDoc = mockDocument({ spaceId: new Types.ObjectId() });
    const deps = createDeps({
      getSpaceById: jest.fn().mockResolvedValue(ownSpace),
      getDocumentById: jest.fn().mockResolvedValue(foreignDoc),
      getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: spaceId },
      body: { title: 'Регламент', supersedesId: foreignDoc._id.toString() },
      file: mockFile(),
      caller: { role: 'HEAD' },
    });

    await handlers.uploadDocument(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.archiveDocument).not.toHaveBeenCalled();
    expect(deps.createDocument).not.toHaveBeenCalled();
  });

  it('неподдерживаемый тип файла отклоняется', async () => {
    const deps = createDeps();
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = reqWithFile({
      file: mockFile({ originalname: 'virus.exe', mimetype: 'application/x-msdownload' }),
    });

    await handlers.uploadDocument(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.saveOriginal).not.toHaveBeenCalled();
  });

  it('индексация пишется системным сценарием kb_index', async () => {
    const deps = createDeps();
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res } = reqWithFile({});

    await handlers.uploadDocument(req, res);

    expect(deps.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ scenario: 'kb_index' }),
    );
  });

  it('без файла отвечает 400', async () => {
    const deps = createDeps();
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = createReqRes({ params: { id: spaceId }, body: { title: 'X' } });

    await handlers.uploadDocument(req, res);

    expect(status).toHaveBeenCalledWith(400);
  });

  it('без названия отвечает 400', async () => {
    const deps = createDeps();
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = reqWithFile({ body: { title: '   ' } });

    await handlers.uploadDocument(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.saveOriginal).not.toHaveBeenCalled();
  });

  it('файл больше 25 МБ отклоняется', async () => {
    const deps = createDeps();
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = reqWithFile({ file: mockFile({ size: 26 * 1024 * 1024 }) });

    await handlers.uploadDocument(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.saveOriginal).not.toHaveBeenCalled();
  });

  it('на несуществующее пространство отвечает 404', async () => {
    const deps = createDeps({ getSpaceById: jest.fn().mockResolvedValue(null) });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = reqWithFile({});

    await handlers.uploadDocument(req, res);

    expect(status).toHaveBeenCalledWith(404);
    expect(deps.saveOriginal).not.toHaveBeenCalled();
  });

  it('успешная загрузка сохраняет оригинал раньше извлечения текста и эмбеддинга', async () => {
    const order: string[] = [];
    const deps = createDeps({
      saveOriginal: jest.fn(async () => {
        order.push('saveOriginal');
        return '/app/uploads/knowledge/space/f1.pdf';
      }),
      extractText: jest.fn(async () => {
        order.push('extractText');
        return DOCUMENT_TEXT;
      }),
      embedDocument: jest.fn(async () => {
        order.push('embedDocument');
        return { embedded: true };
      }),
      createDocument: jest.fn(async (fields) => {
        order.push('createDocument');
        return mockDocument({ title: fields.title });
      }),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = reqWithFile({});

    await handlers.uploadDocument(req, res);

    expect(order).toEqual(['saveOriginal', 'extractText', 'embedDocument', 'createDocument']);
    expect(status).toHaveBeenCalledWith(201);
  });
});

describe('createCorporateKnowledgeHandlers — updateDocument', () => {
  it('с невалидным id отвечает 400', async () => {
    const deps = createDeps();
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = createReqRes({ params: { id: 'nope' }, body: { title: 'X' } });

    await handlers.updateDocument(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.updateDocument).not.toHaveBeenCalled();
  });

  it('на несуществующем документе отвечает 404', async () => {
    const deps = createDeps({ updateDocument: jest.fn().mockResolvedValue(null) });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const id = new Types.ObjectId().toString();
    const { req, res, status } = createReqRes({ params: { id }, body: { title: 'X' } });

    await handlers.updateDocument(req, res);

    expect(status).toHaveBeenCalledWith(404);
  });

  it('обновляет метаданные и переводит строковую дату в Date', async () => {
    const deps = createDeps();
    const handlers = createCorporateKnowledgeHandlers(deps);
    const id = new Types.ObjectId().toString();
    const { req, res, status } = createReqRes({
      params: { id },
      body: { title: 'Новое название', effectiveDate: '2026-01-15T00:00:00.000Z' },
    });

    await handlers.updateDocument(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(deps.updateDocument).toHaveBeenCalledWith(
      id,
      expect.objectContaining({
        title: 'Новое название',
        effectiveDate: new Date('2026-01-15T00:00:00.000Z'),
      }),
    );
  });

  it('отклоняет опечатку в статусе, а не сохраняет её как есть (findByIdAndUpdate не валидирует enum)', async () => {
    const deps = createDeps();
    const handlers = createCorporateKnowledgeHandlers(deps);
    const id = new Types.ObjectId().toString();
    const { req, res, status } = createReqRes({
      params: { id },
      body: { status: 'actve' },
    });

    await handlers.updateDocument(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.updateDocument).not.toHaveBeenCalled();
  });

  it('отклоняет supersedesId документа из чужого пространства', async () => {
    const spaceId = new Types.ObjectId();
    const doc = mockDocument({ spaceId });
    const foreignDoc = mockDocument({ spaceId: new Types.ObjectId() });
    const deps = createDeps({
      getDocumentById: jest
        .fn()
        .mockImplementation(async (lookupId: string) =>
          lookupId === doc._id.toString() ? doc : foreignDoc,
        ),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: doc._id.toString() },
      body: { supersedesId: foreignDoc._id.toString() },
    });

    await handlers.updateDocument(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.updateDocument).not.toHaveBeenCalled();
  });
});

describe('createCorporateKnowledgeHandlers — deleteDocument', () => {
  it('передаёт в deleteVectors entity_id пространства документа', async () => {
    const spaceId = new Types.ObjectId();
    const doc = mockDocument({ spaceId, file_id: 'f1' });
    const deps = createDeps({ getDocumentById: jest.fn().mockResolvedValue(doc) });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res } = createReqRes({ params: { id: doc._id.toString() } });

    await handlers.deleteDocument(req, res);

    expect(deps.deleteVectors).toHaveBeenCalledWith(
      expect.objectContaining({ fileIds: ['f1'], entityId: spaceId.toString() }),
    );
  });

  it('снимает векторы раньше записи в MongoDB', async () => {
    const order: string[] = [];
    const deps = createDeps({
      deleteVectors: jest.fn(async () => {
        order.push('vectors');
      }),
      deleteDocument: jest.fn(async () => {
        order.push('mongo');
        return true;
      }),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const id = new Types.ObjectId().toString();
    const { req, res } = createReqRes({ params: { id } });

    await handlers.deleteDocument(req, res);

    expect(order).toEqual(['vectors', 'mongo']);
  });

  it('если векторы снять не удалось, запись в MongoDB остаётся', async () => {
    const deps = createDeps({ deleteVectors: jest.fn().mockRejectedValue(new Error('rag down')) });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const id = new Types.ObjectId().toString();
    const { req, res, status } = createReqRes({ params: { id } });

    await handlers.deleteDocument(req, res);

    expect(deps.deleteDocument).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(502);
  });

  it('на несуществующем документе отвечает 404', async () => {
    const deps = createDeps({ getDocumentById: jest.fn().mockResolvedValue(null) });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const id = new Types.ObjectId().toString();
    const { req, res, status } = createReqRes({ params: { id } });

    await handlers.deleteDocument(req, res);

    expect(status).toHaveBeenCalledWith(404);
    expect(deps.deleteVectors).not.toHaveBeenCalled();
  });

  it('с невалидным id отвечает 400', async () => {
    const deps = createDeps();
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = createReqRes({ params: { id: 'nope' } });

    await handlers.deleteDocument(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.deleteVectors).not.toHaveBeenCalled();
  });
});

describe('createCorporateKnowledgeHandlers — reindexSpace', () => {
  it('пропускает документ без сохранённого оригинала, не отменяя переиндексацию пространства', async () => {
    const withoutOriginal = mockDocument({
      file_id: 'f1',
      title: 'Без оригинала',
      storagePath: '',
    });
    const withOriginal = mockDocument({
      file_id: 'f2',
      title: 'С оригиналом',
      storagePath: '/app/uploads/knowledge/s/f2.pdf',
    });
    const deps = createDeps({
      listDocuments: jest.fn().mockResolvedValue([withoutOriginal, withOriginal]),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const id = new Types.ObjectId().toString();
    const { req, res, status, json } = createReqRes({ params: { id } });

    await handlers.reindexSpace(req, res);

    expect(deps.embedDocument).toHaveBeenCalledTimes(1);
    expect(deps.embedDocument).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'f2' }));
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({
      reindexed: 1,
      skipped: [{ title: 'Без оригинала', reason: 'Оригинал документа не сохранён' }],
    });
  });

  it('на несуществующем пространстве отвечает 404', async () => {
    const deps = createDeps({ getSpaceById: jest.fn().mockResolvedValue(null) });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const id = new Types.ObjectId().toString();
    const { req, res, status } = createReqRes({ params: { id } });

    await handlers.reindexSpace(req, res);

    expect(status).toHaveBeenCalledWith(404);
  });

  it('переиндексирует каждый документ: снимает старые векторы и эмбеддит заново с текущей моделью', async () => {
    const doc = mockDocument({ file_id: 'f1', storagePath: '/app/uploads/knowledge/s/f1.pdf' });
    const deps = createDeps({
      getSpaceById: jest.fn().mockResolvedValue(mockSpace({ embeddingModel: 'baai/bge-m3' })),
      listDocuments: jest.fn().mockResolvedValue([doc]),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const id = new Types.ObjectId().toString();
    const { req, res, status, json } = createReqRes({ params: { id } });

    await handlers.reindexSpace(req, res);

    expect(deps.deleteVectors).toHaveBeenCalledWith(
      expect.objectContaining({ fileIds: ['f1'], entityId: id }),
    );
    expect(deps.embedDocument).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'f1', entityId: id, filePath: doc.storagePath }),
    );
    expect(deps.updateDocument).toHaveBeenCalledWith(
      doc._id.toString(),
      expect.objectContaining({ embeddingModel: 'baai/bge-m3' }),
    );
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ reindexed: 1, skipped: [] });
  });

  it('снятие векторов вызывается на каждый документ по одному file_id, а не пачкой', async () => {
    const docA = mockDocument({ file_id: 'a', storagePath: '/app/uploads/knowledge/s/a.pdf' });
    const docB = mockDocument({ file_id: 'b', storagePath: '/app/uploads/knowledge/s/b.pdf' });
    const deps = createDeps({ listDocuments: jest.fn().mockResolvedValue([docA, docB]) });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const id = new Types.ObjectId().toString();
    const { req, res } = createReqRes({ params: { id } });

    await handlers.reindexSpace(req, res);

    expect(deps.deleteVectors).toHaveBeenCalledTimes(2);
    expect(deps.deleteVectors).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ fileIds: ['a'], entityId: id }),
    );
    expect(deps.deleteVectors).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ fileIds: ['b'], entityId: id }),
    );
  });

  it('векторы, которых уже нет у одного документа (снятие резолвится успешно), не блокируют переиндексацию остальных', async () => {
    const docA = mockDocument({ file_id: 'a', storagePath: '/app/uploads/knowledge/s/a.pdf' });
    const docB = mockDocument({ file_id: 'b', storagePath: '/app/uploads/knowledge/s/b.pdf' });
    // rag.ts глотает 404 как успех при верно переданном entity_id — на уровне deps это
    // просто резолвящийся вызов, без исключения, независимо от того, для какого именно
    // документа векторов уже не было.
    const deps = createDeps({ listDocuments: jest.fn().mockResolvedValue([docA, docB]) });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const id = new Types.ObjectId().toString();
    const { req, res, status, json } = createReqRes({ params: { id } });

    await handlers.reindexSpace(req, res);

    expect(deps.embedDocument).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'a' }));
    expect(deps.embedDocument).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'b' }));
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ reindexed: 2, skipped: [] });
  });

  it('падение индексации у одного документа не мешает переиндексации остальных', async () => {
    const docA = mockDocument({
      file_id: 'a',
      title: 'Первый',
      storagePath: '/app/uploads/knowledge/s/a.pdf',
    });
    const docB = mockDocument({
      file_id: 'b',
      title: 'Второй',
      storagePath: '/app/uploads/knowledge/s/b.pdf',
    });
    const deps = createDeps({
      listDocuments: jest.fn().mockResolvedValue([docA, docB]),
      embedDocument: jest
        .fn()
        .mockRejectedValueOnce(new Error('rag_api недоступен'))
        .mockResolvedValueOnce({ embedded: true }),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const id = new Types.ObjectId().toString();
    const { req, res, status, json } = createReqRes({ params: { id } });

    await handlers.reindexSpace(req, res);

    expect(deps.updateDocument).toHaveBeenCalledTimes(1);
    expect(deps.updateDocument).toHaveBeenCalledWith(
      docB._id.toString(),
      expect.objectContaining({ embeddingModel: docB.embeddingModel }),
    );
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({
      reindexed: 1,
      skipped: [{ title: 'Первый', reason: 'Сбой при индексации документа' }],
    });
  });

  /**
   * Регрессия: `s3://knowledge/...` (оригиналы в MinIO) читались обычным `fs`-стримом
   * внутри `rag.ts`, потому что обёртка `embedDocument` в `office.js` теряла поле `text`
   * (см. коммит с правкой office.js) — без него `buildEmbedFileContent` всегда пыталась
   * прочитать `filePath` как локальный файл, даже когда текст документа уже был в базе.
   * На уровне этого хендлера тест бьёт по симптому напрямую: когда `document.text` пуст,
   * хендлер обязан сам получить байты через `deps.readOriginal` (тот же способ чтения,
   * что и остальные пути к объектному хранилищу), а не полагаться на `rag.ts`.
   */
  it('когда у документа нет сохранённого текста, читает оригинал через deps.readOriginal и индексирует его как файл', async () => {
    const doc = mockDocument({
      file_id: 'f1',
      storagePath: 's3://knowledge/space/f1.pdf',
      text: '',
    });
    const deps = createDeps({
      listDocuments: jest.fn().mockResolvedValue([doc]),
      readOriginal: jest.fn().mockResolvedValue(Buffer.from('original pdf bytes')),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const id = new Types.ObjectId().toString();
    const { req, res, status, json } = createReqRes({ params: { id } });

    await handlers.reindexSpace(req, res);

    expect(deps.readOriginal).toHaveBeenCalledWith('s3://knowledge/space/f1.pdf');
    expect(deps.embedDocument).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'f1', text: undefined }),
    );
    const embedCall = (deps.embedDocument as jest.Mock).mock.calls[0][0];
    expect(embedCall.filePath).not.toBe(doc.storagePath);
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ reindexed: 1, skipped: [] });
  });

  it('пропускает документ, если чтение оригинала из хранилища падает, и продолжает с остальными', async () => {
    const docA = mockDocument({
      file_id: 'a',
      title: 'Без текста',
      storagePath: 's3://knowledge/space/a.pdf',
      text: '',
    });
    const docB = mockDocument({
      file_id: 'b',
      title: 'С текстом',
      storagePath: '/app/uploads/knowledge/s/b.pdf',
    });
    const deps = createDeps({
      listDocuments: jest.fn().mockResolvedValue([docA, docB]),
      readOriginal: jest.fn().mockRejectedValue(new Error('ENOENT')),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const id = new Types.ObjectId().toString();
    const { req, res, status, json } = createReqRes({ params: { id } });

    await handlers.reindexSpace(req, res);

    expect(deps.embedDocument).toHaveBeenCalledTimes(1);
    expect(deps.embedDocument).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'b' }));
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({
      reindexed: 1,
      skipped: [{ title: 'Без текста', reason: 'Сбой при чтении оригинала из хранилища' }],
    });
  });
});

describe('createCorporateKnowledgeHandlers — сужение по отделу главы', () => {
  /**
   * `reindexSpace` не входит в перечисленные главе операции над знаниями отдела
   * (см. комментарий над `reindexSpaceHandler`) — в отличие от create/update/delete,
   * которым посвящён отдельный блок ниже («create/update/delete пространств главой»).
   */
  it('reindexSpace главе недоступен', async () => {
    const deps = createDeps();
    const handlers = createCorporateKnowledgeHandlers(deps);
    const id = new Types.ObjectId().toString();
    const caller = { role: 'HEAD' };

    const {
      req: reindexReq,
      res: reindexRes,
      status: reindexStatus,
    } = createReqRes({
      params: { id },
      caller,
    });
    await handlers.reindexSpace(reindexReq, reindexRes);
    expect(reindexStatus).toHaveBeenCalledWith(403);
    expect(deps.getSpaceById).not.toHaveBeenCalled();
  });

  it('listSpaces отдаёт главе только пространства, где её отдел явно указан в allowedDepartments', async () => {
    const departmentId = new Types.ObjectId();
    const ownSpace = mockSpace({ name: 'Своё', allowedDepartments: [departmentId] });
    const otherSpace = mockSpace({ name: 'Чужое', allowedDepartments: [new Types.ObjectId()] });
    const openSpace = mockSpace({ name: 'Для всех', allowedDepartments: [] });
    const deps = createDeps({
      listSpaces: jest.fn().mockResolvedValue([ownSpace, otherSpace, openSpace]),
      getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status, json } = createReqRes({ caller: { role: 'HEAD' } });

    await handlers.listSpaces(req, res);

    expect(status).toHaveBeenCalledWith(200);
    const payload = json.mock.calls[0][0];
    expect(payload.spaces.map((space: { name: string }) => space.name)).toEqual(['Своё']);
  });

  it('listDocuments отказывает главе чужого отдела', async () => {
    const departmentId = new Types.ObjectId();
    const space = mockSpace({ allowedDepartments: [new Types.ObjectId()] });
    const deps = createDeps({
      getSpaceById: jest.fn().mockResolvedValue(space),
      getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: space._id.toString() },
      caller: { role: 'HEAD' },
    });

    await handlers.listDocuments(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(deps.listDocuments).not.toHaveBeenCalled();
  });

  it('listDocuments пускает главу своего отдела', async () => {
    const departmentId = new Types.ObjectId();
    const space = mockSpace({ allowedDepartments: [departmentId] });
    const deps = createDeps({
      getSpaceById: jest.fn().mockResolvedValue(space),
      getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: space._id.toString() },
      caller: { role: 'HEAD' },
    });

    await handlers.listDocuments(req, res);

    expect(status).toHaveBeenCalledWith(200);
  });

  it('uploadDocument отказывает главе чужого отдела до запуска конвейера приёма', async () => {
    const departmentId = new Types.ObjectId();
    const space = mockSpace({ allowedDepartments: [new Types.ObjectId()] });
    const deps = createDeps({
      getSpaceById: jest.fn().mockResolvedValue(space),
      getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: space._id.toString() },
      body: { title: 'Регламент' },
      file: mockFile(),
      caller: { role: 'HEAD' },
    });

    await handlers.uploadDocument(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(deps.embedDocument).not.toHaveBeenCalled();
  });

  it('updateDocument отказывает главе, если документ лежит в пространстве чужого отдела', async () => {
    const departmentId = new Types.ObjectId();
    const spaceId = new Types.ObjectId();
    const doc = mockDocument({ spaceId });
    const space = mockSpace({ _id: spaceId, allowedDepartments: [new Types.ObjectId()] });
    const deps = createDeps({
      getDocumentById: jest.fn().mockResolvedValue(doc),
      getSpaceById: jest.fn().mockResolvedValue(space),
      getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: doc._id.toString() },
      body: { title: 'X' },
      caller: { role: 'HEAD' },
    });

    await handlers.updateDocument(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(deps.updateDocument).not.toHaveBeenCalled();
  });

  it('updateDocument пускает главу своего отдела', async () => {
    const departmentId = new Types.ObjectId();
    const spaceId = new Types.ObjectId();
    const doc = mockDocument({ spaceId });
    const space = mockSpace({ _id: spaceId, allowedDepartments: [departmentId] });
    const deps = createDeps({
      getDocumentById: jest.fn().mockResolvedValue(doc),
      getSpaceById: jest.fn().mockResolvedValue(space),
      getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: doc._id.toString() },
      body: { title: 'X' },
      caller: { role: 'HEAD' },
    });

    await handlers.updateDocument(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(deps.updateDocument).toHaveBeenCalled();
  });

  it('deleteDocument отказывает главе, если документ лежит в пространстве чужого отдела', async () => {
    const departmentId = new Types.ObjectId();
    const spaceId = new Types.ObjectId();
    const doc = mockDocument({ spaceId });
    const space = mockSpace({ _id: spaceId, allowedDepartments: [new Types.ObjectId()] });
    const deps = createDeps({
      getDocumentById: jest.fn().mockResolvedValue(doc),
      getSpaceById: jest.fn().mockResolvedValue(space),
      getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: doc._id.toString() },
      caller: { role: 'HEAD' },
    });

    await handlers.deleteDocument(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(deps.deleteVectors).not.toHaveBeenCalled();
  });

  it('deleteDocument пускает главу своего отдела', async () => {
    const departmentId = new Types.ObjectId();
    const spaceId = new Types.ObjectId();
    const doc = mockDocument({ spaceId });
    const space = mockSpace({ _id: spaceId, allowedDepartments: [departmentId] });
    const deps = createDeps({
      getDocumentById: jest.fn().mockResolvedValue(doc),
      getSpaceById: jest.fn().mockResolvedValue(space),
      getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: doc._id.toString() },
      caller: { role: 'HEAD' },
    });

    await handlers.deleteDocument(req, res);

    expect(status).toHaveBeenCalledWith(200);
  });

  it('сотрудник получает отказ на всех перечисленных маршрутах', async () => {
    const deps = createDeps();
    const handlers = createCorporateKnowledgeHandlers(deps);
    const id = new Types.ObjectId().toString();
    const caller = { role: 'USER' };

    const { req: listReq, res: listRes, status: listStatus } = createReqRes({ caller });
    await handlers.listSpaces(listReq, listRes);
    expect(listStatus).toHaveBeenCalledWith(403);

    const {
      req: docsReq,
      res: docsRes,
      status: docsStatus,
    } = createReqRes({
      params: { id },
      caller,
    });
    await handlers.listDocuments(docsReq, docsRes);
    expect(docsStatus).toHaveBeenCalledWith(403);
  });
});

describe('createCorporateKnowledgeHandlers — create/update/delete пространств главой', () => {
  it('createSpace позволяет главе создать пространство своего отдела без явного allowedDepartments', async () => {
    const departmentId = new Types.ObjectId();
    const deps = createDeps({ getUserPolicy: jest.fn().mockResolvedValue({ departmentId }) });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = createReqRes({
      body: { name: 'Отдел продаж: регламенты' },
      caller: { role: 'HEAD' },
    });

    await handlers.createSpace(req, res);

    expect(status).toHaveBeenCalledWith(201);
    expect(deps.createSpace).toHaveBeenCalledWith(
      expect.objectContaining({ allowedDepartments: [departmentId.toString()] }),
    );
  });

  it('createSpace отклоняет попытку главы сделать пространство общедоступным', async () => {
    const departmentId = new Types.ObjectId();
    const deps = createDeps({ getUserPolicy: jest.fn().mockResolvedValue({ departmentId }) });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = createReqRes({
      body: { name: 'X', allowedDepartments: [] },
      caller: { role: 'HEAD' },
    });

    await handlers.createSpace(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.createSpace).not.toHaveBeenCalled();
  });

  it('createSpace отклоняет попытку главы создать пространство для чужого отдела', async () => {
    const departmentId = new Types.ObjectId();
    const otherDepartmentId = new Types.ObjectId();
    const deps = createDeps({ getUserPolicy: jest.fn().mockResolvedValue({ departmentId }) });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = createReqRes({
      body: { name: 'X', allowedDepartments: [otherDepartmentId.toString()] },
      caller: { role: 'HEAD' },
    });

    await handlers.createSpace(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.createSpace).not.toHaveBeenCalled();
  });

  it('createSpace отклоняет попытку главы расширить пространство на другой отдел вдобавок к своему', async () => {
    const departmentId = new Types.ObjectId();
    const otherDepartmentId = new Types.ObjectId();
    const deps = createDeps({ getUserPolicy: jest.fn().mockResolvedValue({ departmentId }) });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = createReqRes({
      body: {
        name: 'X',
        allowedDepartments: [departmentId.toString(), otherDepartmentId.toString()],
      },
      caller: { role: 'HEAD' },
    });

    await handlers.createSpace(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.createSpace).not.toHaveBeenCalled();
  });

  it('createSpace у админа по-прежнему без ограничений на отделы', async () => {
    const deptA = new Types.ObjectId().toString();
    const deptB = new Types.ObjectId().toString();
    const deps = createDeps();
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = createReqRes({
      body: { name: 'Общее', allowedDepartments: [deptA, deptB] },
    });

    await handlers.createSpace(req, res);

    expect(status).toHaveBeenCalledWith(201);
    expect(deps.createSpace).toHaveBeenCalledWith(
      expect.objectContaining({ allowedDepartments: [deptA, deptB] }),
    );
  });

  it('updateSpace позволяет главе редактировать пространство своего отдела', async () => {
    const departmentId = new Types.ObjectId();
    const space = mockSpace({ allowedDepartments: [departmentId] });
    const deps = createDeps({
      getSpaceById: jest.fn().mockResolvedValue(space),
      getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: space._id.toString() },
      body: { name: 'Новое имя' },
      caller: { role: 'HEAD' },
    });

    await handlers.updateSpace(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(deps.updateSpace).toHaveBeenCalledWith(
      space._id.toString(),
      expect.objectContaining({ name: 'Новое имя' }),
    );
  });

  it('updateSpace отказывает главе чужого отдела', async () => {
    const departmentId = new Types.ObjectId();
    const space = mockSpace({ allowedDepartments: [new Types.ObjectId()] });
    const deps = createDeps({
      getSpaceById: jest.fn().mockResolvedValue(space),
      getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: space._id.toString() },
      body: { name: 'Новое имя' },
      caller: { role: 'HEAD' },
    });

    await handlers.updateSpace(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(deps.updateSpace).not.toHaveBeenCalled();
  });

  it('updateSpace отказывает главе в редактировании общедоступного пространства', async () => {
    const departmentId = new Types.ObjectId();
    const space = mockSpace({ allowedDepartments: [] });
    const deps = createDeps({
      getSpaceById: jest.fn().mockResolvedValue(space),
      getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: space._id.toString() },
      body: { name: 'Новое имя' },
      caller: { role: 'HEAD' },
    });

    await handlers.updateSpace(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(deps.updateSpace).not.toHaveBeenCalled();
  });

  it('updateSpace отказывает главе, пытающейся расширить allowedDepartments своего пространства', async () => {
    const departmentId = new Types.ObjectId();
    const otherDepartmentId = new Types.ObjectId();
    const space = mockSpace({ allowedDepartments: [departmentId] });
    const deps = createDeps({
      getSpaceById: jest.fn().mockResolvedValue(space),
      getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: space._id.toString() },
      body: { allowedDepartments: [departmentId.toString(), otherDepartmentId.toString()] },
      caller: { role: 'HEAD' },
    });

    await handlers.updateSpace(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.updateSpace).not.toHaveBeenCalled();
  });

  it('updateSpace отказывает главе, пытающейся сделать своё пространство общедоступным', async () => {
    const departmentId = new Types.ObjectId();
    const space = mockSpace({ allowedDepartments: [departmentId] });
    const deps = createDeps({
      getSpaceById: jest.fn().mockResolvedValue(space),
      getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: space._id.toString() },
      body: { allowedDepartments: [] },
      caller: { role: 'HEAD' },
    });

    await handlers.updateSpace(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.updateSpace).not.toHaveBeenCalled();
  });

  it('updateSpace у админа не ограничен по отделам', async () => {
    const deptA = new Types.ObjectId().toString();
    const deptB = new Types.ObjectId().toString();
    const space = mockSpace();
    const deps = createDeps({ getSpaceById: jest.fn().mockResolvedValue(space) });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: space._id.toString() },
      body: { allowedDepartments: [deptA, deptB] },
    });

    await handlers.updateSpace(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(deps.updateSpace).toHaveBeenCalledWith(
      space._id.toString(),
      expect.objectContaining({ allowedDepartments: [deptA, deptB] }),
    );
  });

  it('deleteSpace позволяет главе удалить пустое пространство своего отдела', async () => {
    const departmentId = new Types.ObjectId();
    const space = mockSpace({ allowedDepartments: [departmentId] });
    const deps = createDeps({
      getSpaceById: jest.fn().mockResolvedValue(space),
      getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: space._id.toString() },
      caller: { role: 'HEAD' },
    });

    await handlers.deleteSpace(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(deps.deleteSpace).toHaveBeenCalledWith(space._id.toString());
  });

  it('deleteSpace отказывает главе чужого отдела', async () => {
    const departmentId = new Types.ObjectId();
    const space = mockSpace({ allowedDepartments: [new Types.ObjectId()] });
    const deps = createDeps({
      getSpaceById: jest.fn().mockResolvedValue(space),
      getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: space._id.toString() },
      caller: { role: 'HEAD' },
    });

    await handlers.deleteSpace(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(deps.deleteSpace).not.toHaveBeenCalled();
  });

  it('deleteSpace отказывает главе в удалении общедоступного пространства', async () => {
    const departmentId = new Types.ObjectId();
    const space = mockSpace({ allowedDepartments: [] });
    const deps = createDeps({
      getSpaceById: jest.fn().mockResolvedValue(space),
      getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: space._id.toString() },
      caller: { role: 'HEAD' },
    });

    await handlers.deleteSpace(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(deps.deleteSpace).not.toHaveBeenCalled();
  });
});

describe('createCorporateKnowledgeHandlers — персональный запрет deniedSpaces', () => {
  it('uploadDocument отказывает главе с персональным запретом на пространство собственного отдела', async () => {
    const departmentId = new Types.ObjectId();
    const space = mockSpace({ allowedDepartments: [departmentId] });
    const deps = createDeps({
      getSpaceById: jest.fn().mockResolvedValue(space),
      getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
      getSpaceOverrides: jest
        .fn()
        .mockResolvedValue({ allowedSpaces: [], deniedSpaces: [space._id.toString()] }),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: space._id.toString() },
      body: { title: 'Регламент' },
      file: mockFile(),
      caller: { role: 'HEAD' },
    });

    await handlers.uploadDocument(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(deps.embedDocument).not.toHaveBeenCalled();
  });

  it('updateDocument отказывает главе с персональным запретом на пространство документа собственного отдела', async () => {
    const departmentId = new Types.ObjectId();
    const spaceId = new Types.ObjectId();
    const doc = mockDocument({ spaceId });
    const space = mockSpace({ _id: spaceId, allowedDepartments: [departmentId] });
    const deps = createDeps({
      getDocumentById: jest.fn().mockResolvedValue(doc),
      getSpaceById: jest.fn().mockResolvedValue(space),
      getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
      getSpaceOverrides: jest
        .fn()
        .mockResolvedValue({ allowedSpaces: [], deniedSpaces: [spaceId.toString()] }),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: doc._id.toString() },
      body: { title: 'X' },
      caller: { role: 'HEAD' },
    });

    await handlers.updateDocument(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(deps.updateDocument).not.toHaveBeenCalled();
  });

  it('deleteDocument отказывает главе с персональным запретом на пространство документа собственного отдела', async () => {
    const departmentId = new Types.ObjectId();
    const spaceId = new Types.ObjectId();
    const doc = mockDocument({ spaceId });
    const space = mockSpace({ _id: spaceId, allowedDepartments: [departmentId] });
    const deps = createDeps({
      getDocumentById: jest.fn().mockResolvedValue(doc),
      getSpaceById: jest.fn().mockResolvedValue(space),
      getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
      getSpaceOverrides: jest
        .fn()
        .mockResolvedValue({ allowedSpaces: [], deniedSpaces: [spaceId.toString()] }),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: doc._id.toString() },
      caller: { role: 'HEAD' },
    });

    await handlers.deleteDocument(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(deps.deleteVectors).not.toHaveBeenCalled();
  });

  it('uploadDocument отказывает даже админ-уровневой роли с персональным запретом на пространство — запрет сильнее роли', async () => {
    const space = mockSpace();
    const deps = createDeps({
      getSpaceById: jest.fn().mockResolvedValue(space),
      getSpaceOverrides: jest
        .fn()
        .mockResolvedValue({ allowedSpaces: [], deniedSpaces: [space._id.toString()] }),
    });
    const handlers = createCorporateKnowledgeHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: space._id.toString() },
      body: { title: 'Регламент' },
      file: mockFile(),
    });

    await handlers.uploadDocument(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(deps.embedDocument).not.toHaveBeenCalled();
  });
});
