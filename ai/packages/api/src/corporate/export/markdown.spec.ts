import { parseMarkdownBlocks } from './markdown';

const plain = (text: string) => ({ text, bold: false, italic: false });

describe('parseMarkdownBlocks', () => {
  it('сводит заголовки к трём уровням', async () => {
    expect(await parseMarkdownBlocks('# Отчёт\n\n## Раздел\n\n#### Мелкий')).toEqual([
      { kind: 'heading', level: 1, runs: [plain('Отчёт')] },
      { kind: 'heading', level: 2, runs: [plain('Раздел')] },
      { kind: 'heading', level: 3, runs: [plain('Мелкий')] },
    ]);
  });

  it('разбивает абзац на фрагменты с жирным и курсивом', async () => {
    expect(await parseMarkdownBlocks('Текст с **жирным**, *курсивом* и ***обоими***.')).toEqual([
      {
        kind: 'paragraph',
        runs: [
          plain('Текст с '),
          { text: 'жирным', bold: true, italic: false },
          plain(', '),
          { text: 'курсивом', bold: false, italic: true },
          plain(' и '),
          { text: 'обоими', bold: true, italic: true },
          plain('.'),
        ],
      },
    ]);
  });

  it('разворачивает вложенные пункты в плоский список', async () => {
    expect(
      await parseMarkdownBlocks('1. Первый\n2. Второй\n   - вложенный\n\n- пункт А\n- пункт Б'),
    ).toEqual([
      {
        kind: 'list',
        ordered: true,
        items: [[plain('Первый')], [plain('Второй')], [plain('вложенный')]],
      },
      { kind: 'list', ordered: false, items: [[plain('пункт А')], [plain('пункт Б')]] },
    ]);
  });

  it('переносит таблицу с заголовком и пустыми ячейками', async () => {
    expect(
      await parseMarkdownBlocks(
        '| Показатель | Значение |\n|---|---|\n| Выручка | **100** |\n| Расходы |',
      ),
    ).toEqual([
      {
        kind: 'table',
        header: [[plain('Показатель')], [plain('Значение')]],
        rows: [
          [[plain('Выручка')], [{ text: '100', bold: true, italic: false }]],
          [[plain('Расходы')], []],
        ],
      },
    ]);
  });

  it('сохраняет блок кода как есть', async () => {
    expect(await parseMarkdownBlocks('```\nconst a = 1;\n  b();\n```')).toEqual([
      { kind: 'code', text: 'const a = 1;\n  b();' },
    ]);
  });

  it('разворачивает цитату, переносы, ссылки и сущности, а линию и HTML отбрасывает', async () => {
    expect(
      await parseMarkdownBlocks(
        '> Цитата\n\nСтрока один\nСтрока два\n\n[сайт](https://example.com) и https://ya.ru, A &amp; B, `код`\n\n---\n\n<div>x</div>',
      ),
    ).toEqual([
      { kind: 'paragraph', runs: [plain('Цитата')] },
      { kind: 'paragraph', runs: [plain('Строка один\nСтрока два')] },
      { kind: 'paragraph', runs: [plain('сайт (https://example.com) и https://ya.ru, A & B, код')] },
    ]);
  });
});
