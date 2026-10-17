import mammoth from 'mammoth';
import type { DocumentBlock } from './types';
import { renderDocx } from './docx';

const plain = (text: string) => ({ text, bold: false, italic: false });

const blocks: DocumentBlock[] = [
  { kind: 'heading', level: 1, runs: [plain('Квартальный отчёт')] },
  {
    kind: 'paragraph',
    runs: [
      plain('Выручка выросла на '),
      { text: '12%', bold: true, italic: false },
      plain(' за '),
      { text: 'квартал', bold: false, italic: true },
      plain('.'),
    ],
  },
  { kind: 'list', ordered: false, items: [[plain('Москва')], [plain('Казань')]] },
  { kind: 'list', ordered: true, items: [[plain('Первый шаг')], [plain('Второй шаг')]] },
  {
    kind: 'table',
    header: [[plain('Показатель')], [plain('Значение')]],
    rows: [
      [[plain('Выручка')], [plain('100')]],
      [[plain('Расходы')], []],
    ],
  },
  { kind: 'code', text: 'итого = 42\nвывод(итого)' },
];

describe('renderDocx', () => {
  it('собирает DOCX, который читается обратно с кириллицей', async () => {
    const buffer = await renderDocx(blocks, 'Итоги квартала');
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    const { value } = await mammoth.extractRawText({ buffer });
    for (const expected of [
      'Итоги квартала',
      'Квартальный отчёт',
      'Выручка выросла на 12% за квартал.',
      'Казань',
      'Второй шаг',
      'Расходы',
      'итого = 42',
      'вывод(итого)',
    ]) {
      expect(value).toContain(expected);
    }
  });

  it('переносит заголовок, выделение, списки и таблицу в структуру Word', async () => {
    const { value: html } = await mammoth.convertToHtml({ buffer: await renderDocx(blocks) });
    expect(html).toMatch(/<h1>Квартальный отчёт<\/h1>/);
    expect(html).toContain('<strong>12%</strong>');
    expect(html).toContain('<em>квартал</em>');
    expect(html).toMatch(/<ul><li>Москва<\/li><li>Казань<\/li><\/ul>/);
    expect(html).toMatch(/<ol><li>Первый шаг<\/li><li>Второй шаг<\/li><\/ol>/);
    expect(html).toContain('<table>');
    expect(html).toContain('Показатель');
  });
});
