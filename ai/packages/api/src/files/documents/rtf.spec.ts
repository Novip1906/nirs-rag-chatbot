import os from 'os';
import path from 'path';
import * as fs from 'fs';
import { extractRtfText } from './rtf';
import { parseDocument } from './crud';

function rtf(source: string): Buffer {
  return Buffer.from(source, 'latin1');
}

describe('extractRtfText', () => {
  it('декодирует кириллицу из байтов в кодовой странице документа', () => {
    const source =
      '{\\rtf1\\ansi\\ansicpg1251\\deff0{\\fonttbl{\\f0\\fnil\\fcharset204 Calibri;}}' +
      '{\\*\\generator Riched20 10.0;}\\viewkind4\\uc1\\pard\\f0\\fs22' +
      "\\'cf\\'f0\\'e8\\'e2\\'e5\\'f2, \\'ec\\'e8\\'f0!\\par}";
    expect(extractRtfText(rtf(source))).toBe('Привет, мир!');
  });

  it('считает кодовой страницей 1251, если документ её не указал', () => {
    expect(extractRtfText(rtf("{\\rtf1\\ansi \\'cf\\'f0\\'e8}"))).toBe('При');
  });

  it('берёт западную кодовую страницу, когда документ указал её', () => {
    expect(extractRtfText(rtf("{\\rtf1\\ansi\\ansicpg1252 caf\\'e9}"))).toBe('café');
  });

  it('читает символы Юникода и пропускает их замену для старых программ', () => {
    const source = '{\\rtf1\\ansi\\uc1\\u1055?\\u1088?\\u1080?\\u1074?\\u1077?\\u1090?}';
    expect(extractRtfText(rtf(source))).toBe('Привет');
  });

  it('пропускает замену, записанную байтом', () => {
    const source = "{\\rtf1\\ansi\\ansicpg1251\\uc1\\u1055\\'cf\\u1088\\'f0}";
    expect(extractRtfText(rtf(source))).toBe('Пр');
  });

  it('не выводит служебные группы', () => {
    const source =
      '{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}{\\colortbl;\\red255\\green0\\blue0;}' +
      '{\\stylesheet{\\s0 Normal;}}{\\info{\\title Secret title}{\\author Ivan}}' +
      '{\\*\\generator Word}{\\pict\\pngblip 89504e47}Body text\\par}';
    expect(extractRtfText(rtf(source))).toBe('Body text');
  });

  it('переводит абзацы, переносы и табуляцию и раскрывает экранированные знаки', () => {
    const source =
      '{\\rtf1\\ansi First\\par Second\\line Third\\tab cell \\{braces\\} and \\\\backslash\\par}';
    expect(extractRtfText(rtf(source))).toBe('First\nSecond\nThird\tcell {braces} and \\backslash');
  });

  it('разделяет ячейки таблицы табуляцией, а строки — переводом строки', () => {
    const source = '{\\rtf1\\ansi\\trowd\\cellx1000\\cellx2000 A\\cell B\\cell\\row}';
    expect(extractRtfText(rtf(source))).toBe('A\tB');
  });

  it('перепрыгивает двоичные данные картинки, даже если в них есть скобки', () => {
    expect(extractRtfText(rtf('{\\rtf1\\ansi {\\pict\\bin5 AB}CD}After}'))).toBe('After');
  });

  it('не зацикливается на отрицательном \\bin внутри служебной группы', () => {
    const started = Date.now();
    expect(extractRtfText(rtf('{\\rtf1{\\fonttbl\\bin-30 }}After}'))).toBe('After');
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('не зацикливается на отрицательном \\bin в тексте', () => {
    const started = Date.now();
    expect(extractRtfText(rtf('{\\rtf1 abc\\bin-8 def}'))).toBe('abcdef');
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('не выходит за конец файла на \\bin длиннее остатка', () => {
    expect(extractRtfText(rtf('{\\rtf1 abc\\bin999999 def}'))).toBe('abc');
  });

  it('берёт видимый текст поля и пропускает его инструкцию', () => {
    const source =
      '{\\rtf1\\ansi{\\field{\\*\\fldinst {HYPERLINK "https://example.com"}}{\\fldrslt {Link}}}}';
    expect(extractRtfText(rtf(source))).toBe('Link');
  });
});

describe('parseDocument для RTF', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rtf-'));
  });

  afterAll(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it.each(['application/rtf', 'text/rtf'])(
    'разбирает файл с типом %s встроенным разборщиком',
    async (mimetype) => {
      const filePath = path.join(tempDir, 'memo.rtf');
      await fs.promises.writeFile(
        filePath,
        rtf("{\\rtf1\\ansi\\ansicpg1251 \\'cf\\'f0\\'e8\\'e2\\'e5\\'f2\\par}"),
      );
      const file = { originalname: 'memo.rtf', path: filePath, mimetype } as Express.Multer.File;

      const document = await parseDocument({ file });

      expect(document.filepath).toBe('document_parser');
      expect(document.text).toBe('Привет');
    },
  );
});
