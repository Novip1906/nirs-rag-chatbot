const express = require('express');
const request = require('supertest');

jest.mock('~/server/middleware/requireJwtAuth', () =>
  jest.fn((req, res, next) => {
    if (req.headers.authorization !== 'Bearer ok') {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    req.user = { id: 'user-1' };
    return next();
  }),
);

jest.mock('~/models', () => ({
  listChatProjects: jest.fn(),
  createChatProject: jest.fn(),
  getChatProject: jest.fn().mockResolvedValue({ _id: 'project-1' }),
  updateChatProject: jest.fn(),
  deleteChatProject: jest.fn(),
  assignConversationToProject: jest.fn(),
  listProjectDocuments: jest.fn().mockResolvedValue([]),
  getProjectDocument: jest.fn().mockResolvedValue(null),
  countProjectDocuments: jest.fn().mockResolvedValue(0),
  sumProjectDocumentBytes: jest.fn().mockResolvedValue(0),
  createProjectDocument: jest.fn(),
  deleteProjectDocument: jest.fn().mockResolvedValue(null),
  recordUsage: jest.fn(),
}));

jest.mock('@librechat/api', () => {
  const actual = jest.requireActual('@librechat/api');
  return {
    ...actual,
    extractText: jest.fn(),
    embedDocument: jest.fn(),
    deleteDocuments: jest.fn().mockResolvedValue(undefined),
    saveOriginalToDisk: jest.fn(),
    removeOriginalFromDisk: jest.fn(),
  };
});

describe('projects document routes', () => {
  let app;

  beforeAll(() => {
    const router = require('~/server/routes/projects');
    app = express();
    app.use(express.json());
    app.use('/api/projects', router);
  });

  it('GET /api/projects/:id/documents без токена отвечает 401', async () => {
    const response = await request(app).get('/api/projects/project-1/documents');

    expect(response.status).toBe(401);
  });

  /** Ошибка multer обязана дойти до клиента как JSON, а не как HTML-страница Express. */
  it('POST с файлом больше 25 МБ отвечает 400 с JSON', async () => {
    const oversized = Buffer.alloc(25 * 1024 * 1024 + 1, 'a');

    const response = await request(app)
      .post('/api/projects/project-1/documents')
      .set('Authorization', 'Bearer ok')
      .field('title', 'Регламент')
      .attach('file', oversized, 'reglament.docx');

    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toMatch(/json/);
    expect(response.body.error).toBeDefined();
  });

  it('DELETE чужого документа отвечает 404', async () => {
    const response = await request(app)
      .delete('/api/projects/documents/doc-1')
      .set('Authorization', 'Bearer ok');

    expect(response.status).toBe(404);
  });
});
