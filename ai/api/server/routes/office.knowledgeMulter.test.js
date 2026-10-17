const os = require('os');
const fs = require('fs');
const path = require('path');

const mockUploadsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'office-knowledge-multer-'));

jest.mock('~/config/paths', () => ({ uploads: mockUploadsRoot }));

const request = require('supertest');
const express = require('express');
const { knowledgeUpload } = require('./office.knowledgeMulter');

describe('knowledgeUpload — кодировка имени файла', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.post('/upload', knowledgeUpload.single('file'), (req, res) => {
      res.json({ originalname: req.file.originalname });
    });
  });

  afterAll(() => {
    fs.rmSync(mockUploadsRoot, { recursive: true, force: true });
  });

  it('кириллическое имя файла доезжает до req.file.originalname неискажённым', async () => {
    const response = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('test content'), 'ИУ5-42Б Шпакова ЕВ.docx');

    expect(response.status).toBe(200);
    expect(response.body.originalname).toBe('ИУ5-42Б Шпакова ЕВ.docx');
  });

  it('латинское имя файла не меняется', async () => {
    const response = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('test content'), 'report.pdf');

    expect(response.status).toBe(200);
    expect(response.body.originalname).toBe('report.pdf');
  });

  it('латинское имя с диакритикой доезжает неискажённым', async () => {
    const response = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('test content'), 'café résumé.pdf');

    expect(response.status).toBe(200);
    expect(response.body.originalname).toBe('café résumé.pdf');
  });
});
