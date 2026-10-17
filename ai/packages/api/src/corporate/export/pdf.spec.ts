import path from 'path';
import { spawnSync } from 'child_process';
import type { DocumentBlock } from './types';
import { parseMarkdownBlocks } from './markdown';
import { renderPdf, resolveFontsDir } from './pdf';

const EXTRACT_TEXT_SCRIPT = [
  'const chunks = [];',
  'for await (const chunk of process.stdin) chunks.push(chunk);',
  "const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');",
  'const pdf = await getDocument({ data: new Uint8Array(Buffer.concat(chunks)), verbosity: 0 }).promise;',
  "let text = '';",
  'for (let index = 1; index <= pdf.numPages; index++) {',
  '  const page = await pdf.getPage(index);',
  '  const content = await page.getTextContent();',
  "  text += content.items.map((item) => ('str' in item ? item.str : '')).join(' ') + '\\n';",
  '}',
  'process.stdout.write(text);',
].join('\n');

function extractPdfText(buffer: Buffer): string {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', EXTRACT_TEXT_SCRIPT], {
    input: buffer,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`pdfjs не разобрал PDF: ${result.stderr}`);
  }
  return result.stdout.replace(/\s+/g, '');
}

const plain = (text: string) => ({ text, bold: false, italic: false });

const blocks: DocumentBlock[] = [
  { kind: 'heading', level: 1, runs: [plain('Квартальный отчёт')] },
  {
    kind: 'paragraph',
    runs: [
      plain('Выручка выросла на '),
      { text: 'двенадцать процентов', bold: true, italic: false },
      plain(' за '),
      { text: 'квартал', bold: false, italic: true },
    ],
  },
  { kind: 'list', ordered: false, items: [[plain('Москва')], [plain('Казань')]] },
  { kind: 'list', ordered: true, items: [[plain('Первый шаг')]] },
  {
    kind: 'table',
    header: [[plain('Показатель')], [plain('Значение')]],
    rows: [[[plain('Расходы')], []]],
  },
  { kind: 'code', text: 'итого = 42' },
];

describe('resolveFontsDir', () => {
  it('находит шрифты в packages/api/assets/fonts, поднимаясь от исходников', () => {
    expect(resolveFontsDir()).toBe(path.resolve(__dirname, '..', '..', '..', 'assets', 'fonts'));
  });

  it('возвращает undefined, если выше по дереву шрифтов нет', () => {
    expect(resolveFontsDir(path.parse(__dirname).root)).toBeUndefined();
  });
});

describe('renderPdf', () => {
  it('собирает PDF, из которого читается кириллица', async () => {
    const buffer = await renderPdf(blocks, 'Итоги квартала');
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    const text = extractPdfText(buffer);
    for (const expected of [
      'Итогиквартала',
      'Квартальныйотчёт',
      'Выручкавыросланадвенадцатьпроцентовзаквартал',
      'Москва',
      'Казань',
      'Первыйшаг',
      'Показатель',
      'Расходы',
      'итого=42',
    ]) {
      expect(text).toContain(expected);
    }
  });

  it('заменяет стрелки и галочки, которых нет в шрифте, выбрасывает эмодзи и сохраняет ₽ и №', async () => {
    const markdown = [
      '# Итоги → план',
      '',
      'Статус ✓ готово 😀, цена 100 ₽, счёт № 5 ≤ 7 «ок»',
      '',
      '- Сделано ✔',
      '',
      '| Статус | Сумма |',
      '| --- | --- |',
      '| ✗ отменён | 200 ₽ |',
      '',
      '```',
      'a ⇒ b ↔ c',
      '```',
    ].join('\n');

    const buffer = await renderPdf(await parseMarkdownBlocks(markdown), 'Сводка ← итог');
    const text = extractPdfText(buffer);

    for (const expected of [
      'Сводка<-итог',
      'Итоги->план',
      'Статус+готово,цена100₽,счёт№5≤7«ок»',
      'Сделано+',
      'xотменён',
      '200₽',
      'a=>b<->c',
    ]) {
      expect(text).toContain(expected);
    }
    for (const missing of ['😀', '→', '✓', '✔', '✗', '⇒']) {
      expect(text).not.toContain(missing);
    }
  });
});
