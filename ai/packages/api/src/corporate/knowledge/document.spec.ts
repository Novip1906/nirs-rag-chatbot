import fs from 'fs';
import path from 'path';
import { logger } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { KnowledgeSpaceSource } from './access';
import type { KnowledgeDocumentHandlersDeps, KnowledgeDocumentRecord } from './document';
import { createKnowledgeDocumentHandlers } from './document';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const VALID_FILE_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

/** Реальный минимальный .docx — тот же фикстур, что использует `html.spec.ts`. */
const DOCX_FIXTURE = fs.readFileSync(path.join(__dirname, '../../files/documents/sample.docx'));
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function mockDocument(overrides: Partial<KnowledgeDocumentRecord> = {}): KnowledgeDocumentRecord {
  return {
    fileId: VALID_FILE_ID,
    spaceId: 'space-1',
    title: 'Регламент',
    filename: 'reglament.pdf',
    mimetype: 'application/pdf',
    bytes: 1024,
    storagePath: '/app/uploads/knowledge/space-1/f1.pdf',
    text: 'Текст документа, извлечённый при загрузке.',
    ...overrides,
  };
}

const allowedSpace: KnowledgeSpaceSource = {
  id: 'space-1',
  name: 'Пространство',
  allowedDepartments: [],
  enabled: true,
};

function createDeps(
  overrides: Partial<KnowledgeDocumentHandlersDeps> = {},
): KnowledgeDocumentHandlersDeps {
  return {
    findDocumentByFileId: jest.fn().mockResolvedValue(mockDocument()),
    resolveAllowedSpaces: jest.fn().mockResolvedValue([allowedSpace]),
    readOriginal: jest.fn().mockResolvedValue(Buffer.from('содержимое файла')),
    uploadsRoot: '/app/uploads/knowledge',
    ...overrides,
  };
}

function createReqRes(params: Record<string, string>, query: Record<string, string> = {}) {
  const req = {
    params,
    query,
    user: { _id: { toString: () => 'user-1' } },
  } as unknown as ServerRequest;

  const headers: Record<string, string> = {};
  const setHeader = jest.fn((key: string, value: string) => {
    headers[key] = value;
  });
  const json = jest.fn();
  const send = jest.fn();
  const status = jest.fn().mockReturnValue({ json, send });
  const res = { status, setHeader, json, send } as unknown as Response;

  return { req, res, status, json, send, setHeader, headers };
}

describe('createKnowledgeDocumentHandlers — общие проверки доступа', () => {
  it('невалидный fileId отвечает 400 и не идёт в базу', async () => {
    const deps = createDeps();
    const handlers = createKnowledgeDocumentHandlers(deps);
    const { req, res, status, json } = createReqRes({ fileId: 'not-a-uuid' });

    await handlers.getDocumentPreview(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ error: 'Invalid file ID' });
    expect(deps.findDocumentByFileId).not.toHaveBeenCalled();
  });

  it('несуществующий документ отвечает 404', async () => {
    const deps = createDeps({ findDocumentByFileId: jest.fn().mockResolvedValue(null) });
    const handlers = createKnowledgeDocumentHandlers(deps);
    const { req, res, status, json } = createReqRes({ fileId: VALID_FILE_ID });

    await handlers.getDocumentPreview(req, res);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ error: 'Not found' });
  });

  it('документ из недоступного пространства отвечает 403', async () => {
    const deps = createDeps({ resolveAllowedSpaces: jest.fn().mockResolvedValue([]) });
    const handlers = createKnowledgeDocumentHandlers(deps);
    const { req, res, status, json } = createReqRes({ fileId: VALID_FILE_ID });

    await handlers.getDocumentPreview(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: 'Forbidden' });
  });

  it('оригинал, пропавший с диска, отвечает 404, а не 500', async () => {
    const deps = createDeps({
      readOriginal: jest.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
    });
    const handlers = createKnowledgeDocumentHandlers(deps);
    const { req, res, status, json } = createReqRes({ fileId: VALID_FILE_ID });

    await handlers.getDocumentPreview(req, res);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ error: 'Not found' });
  });

  it('статус документа значения не имеет: deps.findDocumentByFileId не фильтрует по статусу, и то, что она отдала — открывается', async () => {
    const archivedDocument = mockDocument({ title: 'Устаревший регламент (архив)' });
    const deps = createDeps({ findDocumentByFileId: jest.fn().mockResolvedValue(archivedDocument) });
    const handlers = createKnowledgeDocumentHandlers(deps);
    const { req, res, status, json } = createReqRes({ fileId: VALID_FILE_ID });

    await handlers.getDocumentPreview(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ title: 'Устаревший регламент (архив)' }));
  });
});

describe('createKnowledgeDocumentHandlers — доверенный корень для storagePath', () => {
  it('storagePath вида s3:// не проверяется на вхождение в uploadsRoot', async () => {
    const doc = mockDocument({ storagePath: 's3://knowledge/space-1/f1.pdf' });
    const deps = createDeps({
      findDocumentByFileId: jest.fn().mockResolvedValue(doc),
      readOriginal: jest.fn().mockResolvedValue(Buffer.from('PDF-BYTES')),
    });
    const handlers = createKnowledgeDocumentHandlers(deps);
    const { req, res, status, send } = createReqRes({ fileId: VALID_FILE_ID });

    await handlers.getDocumentFile(req, res);

    expect(deps.readOriginal).toHaveBeenCalledWith('s3://knowledge/space-1/f1.pdf');
    expect(status).toHaveBeenCalledWith(200);
    expect(send).toHaveBeenCalledWith(Buffer.from('PDF-BYTES'));
  });

  it('дисковый storagePath вне uploadsRoot по-прежнему отвечает 404 и не читает файл', async () => {
    const doc = mockDocument({ storagePath: '/etc/passwd' });
    const deps = createDeps({ findDocumentByFileId: jest.fn().mockResolvedValue(doc) });
    const handlers = createKnowledgeDocumentHandlers(deps);
    const { req, res, status, json } = createReqRes({ fileId: VALID_FILE_ID });

    await handlers.getDocumentFile(req, res);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ error: 'Not found' });
    expect(deps.readOriginal).not.toHaveBeenCalled();
  });
});

describe('createKnowledgeDocumentHandlers — getDocumentPreview: выбор kind', () => {
  it('PDF отдаётся с kind pdf, без html и text в ответе', async () => {
    const deps = createDeps({ findDocumentByFileId: jest.fn().mockResolvedValue(mockDocument()) });
    const handlers = createKnowledgeDocumentHandlers(deps);
    const { req, res, status, json } = createReqRes({ fileId: VALID_FILE_ID });

    await handlers.getDocumentPreview(req, res);

    expect(status).toHaveBeenCalledWith(200);
    const payload = json.mock.calls[0][0];
    expect(payload.kind).toBe('pdf');
    expect(payload.html).toBeUndefined();
    expect(payload.text).toBeUndefined();
  });

  it('.docx конвертируется в самодостаточный HTML', async () => {
    const doc = mockDocument({ filename: 'reglament.docx', mimetype: DOCX_MIME });
    const deps = createDeps({
      findDocumentByFileId: jest.fn().mockResolvedValue(doc),
      readOriginal: jest.fn().mockResolvedValue(DOCX_FIXTURE),
    });
    const handlers = createKnowledgeDocumentHandlers(deps);
    const { req, res, status, json } = createReqRes({ fileId: VALID_FILE_ID });

    await handlers.getDocumentPreview(req, res);

    expect(status).toHaveBeenCalledWith(200);
    const payload = json.mock.calls[0][0];
    expect(payload.kind).toBe('html');
    expect(typeof payload.html).toBe('string');
    expect(payload.html).toContain('<html');
    expect(payload.text).toBeUndefined();
  });

  it('падение конвертации в HTML откатывается в kind text, а не роняет запрос', async () => {
    const doc = mockDocument({
      filename: 'reglament.docx',
      mimetype: DOCX_MIME,
      text: 'Резервный текст документа.',
    });
    const deps = createDeps({
      findDocumentByFileId: jest.fn().mockResolvedValue(doc),
      readOriginal: jest.fn().mockResolvedValue(Buffer.from('это не docx, а мусор')),
    });
    const handlers = createKnowledgeDocumentHandlers(deps);
    const { req, res, status, json } = createReqRes({ fileId: VALID_FILE_ID });

    await handlers.getDocumentPreview(req, res);

    expect(status).toHaveBeenCalledWith(200);
    const payload = json.mock.calls[0][0];
    expect(payload.kind).toBe('text');
    expect(payload.text).toBe('Резервный текст документа.');
    expect(payload.html).toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('формат без HTML-продюсера (обычный .txt) сразу отдаёт kind text', async () => {
    const doc = mockDocument({ filename: 'note.txt', mimetype: 'text/plain', text: 'Просто текст.' });
    const deps = createDeps({ findDocumentByFileId: jest.fn().mockResolvedValue(doc) });
    const handlers = createKnowledgeDocumentHandlers(deps);
    const { req, res, status, json } = createReqRes({ fileId: VALID_FILE_ID });

    await handlers.getDocumentPreview(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(json.mock.calls[0][0]).toMatchObject({ kind: 'text', text: 'Просто текст.' });
  });
});

describe('createKnowledgeDocumentHandlers — getDocumentFile', () => {
  it('отдаёт бинарное тело с заголовком inline по умолчанию', async () => {
    const deps = createDeps({ readOriginal: jest.fn().mockResolvedValue(Buffer.from('PDF-BYTES')) });
    const handlers = createKnowledgeDocumentHandlers(deps);
    const { req, res, status, send, headers } = createReqRes({ fileId: VALID_FILE_ID });

    await handlers.getDocumentFile(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(send).toHaveBeenCalledWith(Buffer.from('PDF-BYTES'));
    expect(headers['Content-Type']).toBe('application/pdf');
    expect(headers['Content-Disposition']).toMatch(/^inline;/);
  });

  it('?download=1 отдаёт заголовок attachment вместо inline', async () => {
    const deps = createDeps();
    const handlers = createKnowledgeDocumentHandlers(deps);
    const { req, res, headers } = createReqRes({ fileId: VALID_FILE_ID }, { download: '1' });

    await handlers.getDocumentFile(req, res);

    expect(headers['Content-Disposition']).toMatch(/^attachment;/);
  });

  it('кириллическое имя файла кодируется корректно в filename*', async () => {
    const doc = mockDocument({ filename: 'Регламент отпусков.pdf' });
    const deps = createDeps({ findDocumentByFileId: jest.fn().mockResolvedValue(doc) });
    const handlers = createKnowledgeDocumentHandlers(deps);
    const { req, res, headers } = createReqRes({ fileId: VALID_FILE_ID });

    await handlers.getDocumentFile(req, res);

    const expected = encodeURIComponent('Регламент отпусков.pdf');
    expect(headers['Content-Disposition']).toBe(`inline; filename*=UTF-8''${expected}`);
  });

  it('невалидный fileId отвечает 400', async () => {
    const deps = createDeps();
    const handlers = createKnowledgeDocumentHandlers(deps);
    const { req, res, status, json } = createReqRes({ fileId: 'nope' });

    await handlers.getDocumentFile(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ error: 'Invalid file ID' });
  });

  it('документ из недоступного пространства отвечает 403', async () => {
    const deps = createDeps({ resolveAllowedSpaces: jest.fn().mockResolvedValue([]) });
    const handlers = createKnowledgeDocumentHandlers(deps);
    const { req, res, status, json } = createReqRes({ fileId: VALID_FILE_ID });

    await handlers.getDocumentFile(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: 'Forbidden' });
  });
});

describe('createKnowledgeDocumentHandlers — запрос без пользователя', () => {
  it('отказывает, не спрашивая права: пустой userId открыл бы пространства без ограничения по отделам', async () => {
    const deps = createDeps();
    const handlers = createKnowledgeDocumentHandlers(deps);
    const { res, status, json } = createReqRes({ fileId: VALID_FILE_ID });
    const req = { params: { fileId: VALID_FILE_ID }, query: {} } as unknown as ServerRequest;

    await handlers.getDocumentPreview(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: 'Forbidden' });
    expect(deps.resolveAllowedSpaces).not.toHaveBeenCalled();
  });
});
