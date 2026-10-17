import { Types } from 'mongoose';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { ProjectDocumentDeps } from './handlers';
import { createProjectDocumentHandlers, MAX_DOCUMENTS_PER_PROJECT } from './handlers';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const owner = new Types.ObjectId().toString();
const projectId = new Types.ObjectId().toString();

function createReqRes(params: Record<string, string> = {}, file?: Express.Multer.File) {
  const req = {
    params,
    query: {},
    body: { title: 'Регламент' },
    file,
    user: { id: owner },
  } as unknown as ServerRequest;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return { req, res, status, json };
}

function multerFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    originalname: 'reglament.docx',
    mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    path: '/tmp/upload-1',
    size: 2048,
    ...overrides,
  } as Express.Multer.File;
}

function createDeps(overrides: Partial<ProjectDocumentDeps> = {}): ProjectDocumentDeps {
  return {
    getChatProject: jest.fn().mockResolvedValue({ _id: projectId }),
    listProjectDocuments: jest.fn().mockResolvedValue([]),
    getProjectDocument: jest.fn().mockResolvedValue({
      owner,
      projectId: new Types.ObjectId(projectId),
      entityId: `proj_${projectId}`,
      file_id: 'doc-1',
      title: 'Регламент',
      filename: 'reglament.docx',
      mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: 2048,
      text: 'Порядок согласования расходов. '.repeat(30),
      tokenCount: 120,
      embedded: true,
      storagePath: '/uploads/knowledge/projects/p/doc.docx',
      status: 'active',
    }),
    countProjectDocuments: jest.fn().mockResolvedValue(0),
    sumProjectDocumentBytes: jest.fn().mockResolvedValue(0),
    createProjectDocument: jest.fn().mockImplementation(async (input) => input),
    markProjectDocumentEmbedded: jest.fn().mockResolvedValue(null),
    deleteProjectDocument: jest.fn().mockResolvedValue(null),
    extractText: jest.fn().mockResolvedValue('Порядок согласования расходов. '.repeat(30)),
    embedDocument: jest.fn().mockResolvedValue({ embedded: true }),
    deleteVectors: jest.fn().mockResolvedValue(undefined),
    saveOriginal: jest.fn().mockResolvedValue('/uploads/knowledge/projects/p/doc.docx'),
    removeOriginal: jest.fn().mockResolvedValue(undefined),
    countTokens: jest.fn().mockResolvedValue(120),
    recordUsage: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('uploadDocument', () => {
  it('индексирует документ и записывает его в проект', async () => {
    const deps = createDeps();
    const handlers = createProjectDocumentHandlers(deps);
    const { req, res, status } = createReqRes({ id: projectId }, multerFile());

    await handlers.uploadDocument(req, res);

    expect(status).toHaveBeenCalledWith(201);
    expect(deps.embedDocument).toHaveBeenCalledTimes(1);
    const created = (deps.createProjectDocument as jest.Mock).mock.calls[0][0];
    expect(created.owner).toBe(owner);
    expect(created.entityId).toBe(`proj_${projectId}`);
    expect(created.embedded).toBe(true);
  });

  /** Проекты персональные: чужой проект не должен даже подтверждать своё существование. */
  it('отказывает в загрузке в чужой проект', async () => {
    const deps = createDeps({ getChatProject: jest.fn().mockResolvedValue(null) });
    const handlers = createProjectDocumentHandlers(deps);
    const { req, res, status } = createReqRes({ id: projectId }, multerFile());

    await handlers.uploadDocument(req, res);

    expect(status).toHaveBeenCalledWith(404);
    expect(deps.embedDocument).not.toHaveBeenCalled();
  });

  /**
   * Скан индексировать нечем: текстового слоя нет, в pgvector лечь нечему,
   * поиск даст ноль. Отказываем при загрузке, а не молча кладём пустой документ.
   */
  it('отклоняет скан без текстового слоя', async () => {
    const deps = createDeps({ extractText: jest.fn().mockResolvedValue('  ') });
    const handlers = createProjectDocumentHandlers(deps);
    const { req, res, status, json } = createReqRes({ id: projectId }, multerFile());

    await handlers.uploadDocument(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(json.mock.calls[0][0].error).toMatch(/скан|распозна/i);
    expect(deps.embedDocument).not.toHaveBeenCalled();
  });

  /**
   * У `.txt`/`.md`/`.csv` текст — это и есть файл, извлекать нечего: короткий
   * документ здесь не «похож на скан», просто короткий. Регресс: раньше любая
   * причина отказа (`too_short` и `unreadable`) отвечала одной и той же формулировкой
   * про скан — и короткая, но настоящая служебная записка отклонялась с советом
   * «распознайте текст», хотя распознавать было нечего.
   */
  it('короткую, но настоящую .md-записку отклоняет формулировкой про длину, а не про скан', async () => {
    const deps = createDeps({ extractText: jest.fn().mockResolvedValue('Короткая записка.') });
    const handlers = createProjectDocumentHandlers(deps);
    const { req, res, status, json } = createReqRes(
      { id: projectId },
      multerFile({ originalname: 'записка.md', mimetype: 'text/markdown' }),
    );

    await handlers.uploadDocument(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(json.mock.calls[0][0]).toEqual({
      error: 'Документ слишком короткий для индексации: нужно не меньше 20 символов текста.',
      reason: 'too_short',
    });
    expect(json.mock.calls[0][0].error).not.toMatch(/скан/i);
    expect(deps.embedDocument).not.toHaveBeenCalled();
  });

  it('принимает .txt-документ короче старого порога в 200 символов, но длиннее нового', async () => {
    const shortButValid = 'Не забыть: 1) молоко 2) хлеб 3) сахар';
    const deps = createDeps({ extractText: jest.fn().mockResolvedValue(shortButValid) });
    const handlers = createProjectDocumentHandlers(deps);
    const { req, res, status } = createReqRes(
      { id: projectId },
      multerFile({ originalname: 'список.txt', mimetype: 'text/plain' }),
    );

    await handlers.uploadDocument(req, res);

    expect(status).toHaveBeenCalledWith(201);
    expect(deps.embedDocument).toHaveBeenCalledTimes(1);
  });

  /** Оригинал уже лежит на диске к моменту падения — иначе PVC засорится мусором. */
  it('убирает оригинал с диска, если индексация упала', async () => {
    const deps = createDeps({
      embedDocument: jest.fn().mockRejectedValue(new Error('rag_api недоступен')),
    });
    const handlers = createProjectDocumentHandlers(deps);
    const { req, res, status } = createReqRes({ id: projectId }, multerFile());

    await handlers.uploadDocument(req, res);

    expect(status).toHaveBeenCalledWith(502);
    expect(deps.removeOriginal).toHaveBeenCalledWith('/uploads/knowledge/projects/p/doc.docx');
    expect(deps.createProjectDocument).not.toHaveBeenCalled();
  });

  it('не пускает документ сверх лимита на проект', async () => {
    const deps = createDeps({
      countProjectDocuments: jest.fn().mockResolvedValue(MAX_DOCUMENTS_PER_PROJECT),
    });
    const handlers = createProjectDocumentHandlers(deps);
    const { req, res, status } = createReqRes({ id: projectId }, multerFile());

    await handlers.uploadDocument(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.saveOriginal).not.toHaveBeenCalled();
  });

  /** Квота проверяется до записи на диск, иначе место уже занято. */
  it('не пускает документ сверх общей квоты сотрудника', async () => {
    const deps = createDeps({
      sumProjectDocumentBytes: jest.fn().mockResolvedValue(200 * 1024 * 1024),
    });
    const handlers = createProjectDocumentHandlers(deps);
    const { req, res, status } = createReqRes({ id: projectId }, multerFile());

    await handlers.uploadDocument(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.saveOriginal).not.toHaveBeenCalled();
  });

  it('требует файл и название', async () => {
    const handlers = createProjectDocumentHandlers(createDeps());
    const withoutFile = createReqRes({ id: projectId });

    await handlers.uploadDocument(withoutFile.req, withoutFile.res);

    expect(withoutFile.status).toHaveBeenCalledWith(400);
  });

  it('пишет расход на индексацию', async () => {
    const deps = createDeps();
    const handlers = createProjectDocumentHandlers(deps);
    const { req, res } = createReqRes({ id: projectId }, multerFile());

    await handlers.uploadDocument(req, res);

    expect((deps.recordUsage as jest.Mock).mock.calls[0][0].scenario).toBe('doc_index');
  });

  /**
   * `.zip` и `.exe` rag_api разобрать нечем: он вернёт мусор или 502, а оригинал уже
   * займёт квоту сотрудника. Тип проверяется до записи на диск, как в базе знаний.
   */
  it.each([
    ['архив', 'archive.zip', 'application/zip'],
    ['исполняемый файл', 'setup.exe', 'application/octet-stream'],
    ['подменённый MIME', 'reglament.docx', 'application/zip'],
  ])('отклоняет неподдерживаемый файл: %s', async (_label, originalname, mimetype) => {
    const deps = createDeps();
    const handlers = createProjectDocumentHandlers(deps);
    const { req, res, status } = createReqRes(
      { id: projectId },
      multerFile({ originalname, mimetype }),
    );

    await handlers.uploadDocument(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.saveOriginal).not.toHaveBeenCalled();
    expect(deps.extractText).not.toHaveBeenCalled();
  });

  it('принимает офисный файл, присланный как application/octet-stream', async () => {
    const deps = createDeps();
    const handlers = createProjectDocumentHandlers(deps);
    const { req, res, status } = createReqRes(
      { id: projectId },
      multerFile({ mimetype: 'application/octet-stream' }),
    );

    await handlers.uploadDocument(req, res);

    expect(status).toHaveBeenCalledWith(201);
  });

  /**
   * Векторы уже в pgvector, записи в Mongo не будет — снять их потом некому:
   * `purgeProjectDocuments` идёт по записям Mongo и такой документ не найдёт.
   */
  it('снимает векторы, если запись в Mongo упала после эмбеддинга', async () => {
    const deps = createDeps({
      createProjectDocument: jest.fn().mockRejectedValue(new Error('BSONObjectTooLarge')),
    });
    const handlers = createProjectDocumentHandlers(deps);
    const { req, res, status } = createReqRes({ id: projectId }, multerFile());

    await handlers.uploadDocument(req, res);

    expect(status).toHaveBeenCalledWith(500);
    expect(deps.deleteVectors).toHaveBeenCalledWith({
      fileIds: [(deps.embedDocument as jest.Mock).mock.calls[0][0].fileId],
      entityId: `proj_${projectId}`,
      userId: owner,
    });
    expect(deps.removeOriginal).toHaveBeenCalledWith('/uploads/knowledge/projects/p/doc.docx');
  });

  it('снимает векторы, если подсчёт токенов упал после эмбеддинга', async () => {
    const deps = createDeps({
      countTokens: jest.fn().mockRejectedValue(new Error('токенизатор недоступен')),
    });
    const handlers = createProjectDocumentHandlers(deps);
    const { req, res, status } = createReqRes({ id: projectId }, multerFile());

    await handlers.uploadDocument(req, res);

    expect(status).toHaveBeenCalledWith(500);
    expect(deps.deleteVectors).toHaveBeenCalledTimes(1);
    expect(deps.createProjectDocument).not.toHaveBeenCalled();
  });

  /**
   * `multer({ dest })` пишет файл до входа в обработчик и сам чистит его только при
   * ошибке разбора. Без явного удаления сотня отклонённых загрузок по 25 МБ
   * переполняет PVC, причём квота этих файлов не считает.
   */
  const uploadOutcomes: Array<[string, Partial<ProjectDocumentDeps>, Express.Multer.File]> = [
    ['успехе', {}, multerFile()],
    [
      'отказе по типу файла',
      {},
      multerFile({ originalname: 'a.zip', mimetype: 'application/zip' }),
    ],
    [
      'отказе по лимиту документов',
      { countProjectDocuments: jest.fn().mockResolvedValue(MAX_DOCUMENTS_PER_PROJECT) },
      multerFile(),
    ],
    [
      'падении эмбеддинга',
      { embedDocument: jest.fn().mockRejectedValue(new Error('rag_api недоступен')) },
      multerFile(),
    ],
  ];

  it.each(uploadOutcomes)(
    'удаляет временный файл multer при %s',
    async (_label, overrides, file) => {
      const deps = createDeps(overrides);
      const handlers = createProjectDocumentHandlers(deps);
      const { req, res } = createReqRes({ id: projectId }, file);

      await handlers.uploadDocument(req, res);

      expect(deps.removeOriginal).toHaveBeenCalledWith('/tmp/upload-1');
    },
  );

  it('не роняет загрузку, если временный файл удалить не удалось', async () => {
    const deps = createDeps({
      removeOriginal: jest.fn().mockRejectedValue(new Error('EACCES')),
    });
    const handlers = createProjectDocumentHandlers(deps);
    const { req, res, status } = createReqRes({ id: projectId }, multerFile());

    await handlers.uploadDocument(req, res);

    expect(status).toHaveBeenCalledWith(201);
  });
});

describe('deleteDocument', () => {
  /** Порядок обязателен: после удаления записи `file_id` для снятия векторов негде взять. */
  it('снимает векторы до удаления записи', async () => {
    const order: string[] = [];
    const deps = createDeps({
      deleteProjectDocument: jest.fn().mockImplementation(async () => {
        order.push('mongo');
        return null;
      }),
      deleteVectors: jest.fn().mockImplementation(async () => {
        order.push('vectors');
      }),
      listProjectDocuments: jest.fn().mockResolvedValue([]),
    });
    const handlers = createProjectDocumentHandlers(deps);
    const { req, res } = createReqRes({ fileId: 'doc-1' });

    await handlers.deleteDocument(req, res);

    expect(order).toEqual(['vectors', 'mongo']);
  });

  it('отказывает, когда документа нет или он чужой', async () => {
    const deps = createDeps({ deleteProjectDocument: jest.fn().mockResolvedValue(null) });
    const handlers = createProjectDocumentHandlers(deps);
    const { req, res, status } = createReqRes({ fileId: 'doc-1' });

    await handlers.deleteDocument(req, res);

    expect(status).toHaveBeenCalledWith(404);
  });
});

describe('listDocuments', () => {
  it('отдаёт документы проекта без текста и пути на диске', async () => {
    const deps = createDeps({
      listProjectDocuments: jest.fn().mockResolvedValue([
        {
          file_id: 'doc-1',
          title: 'Регламент',
          filename: 'r.docx',
          mimetype: 'application/msword',
          bytes: 100,
          tokenCount: 50,
          storagePath: '/uploads/secret/path.docx',
          text: 'секретное тело документа',
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
        },
      ]),
    });
    const handlers = createProjectDocumentHandlers(deps);
    const { req, res, json } = createReqRes({ id: projectId });

    await handlers.listDocuments(req, res);

    const [document] = json.mock.calls[0][0].documents;
    expect(document.title).toBe('Регламент');
    expect(document.storagePath).toBeUndefined();
    expect(document.text).toBeUndefined();
  });
});

describe('uploadDocument: документ, который не удалось проиндексировать', () => {
  /**
   * Документ без индекса всё ещё полезен: он попадает в контекст целиком, пока
   * влезает в бюджет, и находится лексическим поиском. Отказывать в загрузке
   * из-за этого нельзя, но и принимать молча — тоже: ровно так пять договоров
   * Марии пролежали в проекте невидимыми для поиска.
   */
  it('сохраняет документ с погашенным флагом, а не теряет его', async () => {
    const deps = createDeps({ embedDocument: jest.fn().mockResolvedValue({ embedded: false }) });
    const handlers = createProjectDocumentHandlers(deps);
    const { req, res, status, json } = createReqRes({ id: projectId }, multerFile());

    await handlers.uploadDocument(req, res);

    expect(status).toHaveBeenCalledWith(201);
    expect(deps.createProjectDocument).toHaveBeenCalledWith(
      expect.objectContaining({ embedded: false }),
    );
    expect(json.mock.calls[0][0].document.embedded).toBe(false);
  });

  it('пишет в журнал ошибку, а не проходит мимо', async () => {
    const { logger } = jest.requireMock('@librechat/data-schemas');
    logger.error.mockClear();
    const deps = createDeps({ embedDocument: jest.fn().mockResolvedValue({ embedded: false }) });
    const handlers = createProjectDocumentHandlers(deps);
    const { req, res } = createReqRes({ id: projectId }, multerFile());

    await handlers.uploadDocument(req, res);

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('не проиндексирован'),
      expect.objectContaining({ fileId: expect.any(String) }),
    );
  });
});

describe('reindexDocument', () => {
  function unindexed(overrides: Record<string, unknown> = {}) {
    return {
      owner,
      projectId: new Types.ObjectId(projectId),
      entityId: `proj_${projectId}`,
      file_id: 'doc-1',
      title: 'Договор',
      filename: 'dogovor.docx',
      mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: 2048,
      text: 'Предмет договора. '.repeat(50),
      tokenCount: 6291,
      embedded: false,
      storagePath: '/uploads/knowledge/projects/p/doc.docx',
      status: 'active',
      ...overrides,
    };
  }

  it('переиндексирует документ из сохранённого текста и поднимает флаг', async () => {
    const deps = createDeps({
      getProjectDocument: jest.fn().mockResolvedValue(unindexed()),
      embedDocument: jest.fn().mockResolvedValue({ embedded: true }),
      markProjectDocumentEmbedded: jest.fn().mockResolvedValue(unindexed({ embedded: true })),
    });
    const handlers = createProjectDocumentHandlers(deps);
    const { req, res, status, json } = createReqRes({ fileId: 'doc-1' });

    await handlers.reindexDocument(req, res);

    expect(deps.embedDocument).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'doc-1', entityId: `proj_${projectId}` }),
    );
    expect(deps.markProjectDocumentEmbedded).toHaveBeenCalledWith(owner, 'doc-1', true);
    expect(status).toHaveBeenCalledWith(200);
    expect(json.mock.calls[0][0].document.embedded).toBe(true);
  });

  /**
   * Повторная укладка тех же векторов удвоила бы каждый фрагмент в выдаче поиска,
   * поэтому старые снимаются до новой попытки.
   */
  it('снимает прежние векторы перед повторной укладкой', async () => {
    const order: string[] = [];
    const deps = createDeps({
      getProjectDocument: jest.fn().mockResolvedValue(unindexed()),
      deleteVectors: jest.fn().mockImplementation(async () => {
        order.push('delete');
      }),
      embedDocument: jest.fn().mockImplementation(async () => {
        order.push('embed');
        return { embedded: true };
      }),
      markProjectDocumentEmbedded: jest.fn().mockResolvedValue(unindexed({ embedded: true })),
    });
    const handlers = createProjectDocumentHandlers(deps);
    const { req, res } = createReqRes({ fileId: 'doc-1' });

    await handlers.reindexDocument(req, res);

    expect(order).toEqual(['delete', 'embed']);
  });

  it('отвечает 502, когда индексация снова не удалась', async () => {
    const deps = createDeps({
      getProjectDocument: jest.fn().mockResolvedValue(unindexed()),
      embedDocument: jest.fn().mockResolvedValue({ embedded: false }),
      markProjectDocumentEmbedded: jest.fn().mockResolvedValue(unindexed()),
    });
    const handlers = createProjectDocumentHandlers(deps);
    const { req, res, status } = createReqRes({ fileId: 'doc-1' });

    await handlers.reindexDocument(req, res);

    expect(status).toHaveBeenCalledWith(502);
    expect(deps.markProjectDocumentEmbedded).toHaveBeenCalledWith(owner, 'doc-1', false);
  });

  it('отвечает 404 на чужой или удалённый документ', async () => {
    const deps = createDeps({ getProjectDocument: jest.fn().mockResolvedValue(null) });
    const handlers = createProjectDocumentHandlers(deps);
    const { req, res, status } = createReqRes({ fileId: 'doc-1' });

    await handlers.reindexDocument(req, res);

    expect(status).toHaveBeenCalledWith(404);
    expect(deps.embedDocument).not.toHaveBeenCalled();
  });
});
