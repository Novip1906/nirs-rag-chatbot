import path from 'path';
import * as fs from 'fs';
import JSZip from 'jszip';
import WordExtractor from 'word-extractor';
import { extractDocText } from './doc';
import { parseDocument } from './crud';

const fixture = path.join(__dirname, 'sample.doc');
const docxFixture = path.join(__dirname, 'sample.docx');

describe('extractDocText', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('достаёт кириллицу из документа Word 97', async () => {
    const text = await extractDocText(await fs.promises.readFile(fixture));

    expect(text).toContain('Привет, мир');
  });

  it('читает RTF, который браузер прислал под типом Word', async () => {
    const rtf = Buffer.from("{\\rtf1\\ansi\\ansicpg1251 \\'cf\\'f0\\'e8\\'e2\\'e5\\'f2}", 'latin1');

    await expect(extractDocText(rtf)).resolves.toBe('Привет');
  });

  it('читает DOCX, присланный под типом Word 97, разборщиком DOCX', async () => {
    const extract = jest.spyOn(WordExtractor.prototype, 'extract');

    const text = await extractDocText(await fs.promises.readFile(docxFixture), 'report.doc');

    expect(text).toContain('This is a sample DOCX file.');
    expect(extract).not.toHaveBeenCalled();
  });

  it('отклоняет zip-бомбу, присланную под типом Word 97, до разбора', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', 'x'.repeat(26 * 1024 * 1024));
    const bomb = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    await expect(extractDocText(bomb, 'bomb.doc')).rejects.toThrow(/per-entry decompressed cap/);
  });

  it('падает на байтах, которые не Word и не RTF', async () => {
    await expect(extractDocText(Buffer.from('not a word document'))).rejects.toThrow();
  });
});

describe('parseDocument для DOC', () => {
  it('разбирает application/msword встроенным разборщиком', async () => {
    const file = {
      originalname: 'sample.doc',
      path: fixture,
      mimetype: 'application/msword',
    } as Express.Multer.File;

    const document = await parseDocument({ file });

    expect(document.filepath).toBe('document_parser');
    expect(document.text).toContain('Привет, мир');
  });

  it('разбирает DOCX с расширением .doc встроенным разборщиком DOCX', async () => {
    const file = {
      originalname: 'report.doc',
      path: docxFixture,
      mimetype: 'application/msword',
    } as Express.Multer.File;

    const document = await parseDocument({ file });

    expect(document.text).toContain('This is a sample DOCX file.');
  });
});
