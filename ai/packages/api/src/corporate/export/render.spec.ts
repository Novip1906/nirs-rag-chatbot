import type { ExportFileInput } from './types';
import { renderExportFile, withExportTimeout } from './render';
import { ExportFileError, EXPORT_MIME_TYPES } from './types';

const sheet = { name: 'Лист', rows: [['Москва', 1234.5]] };

const cases: [ExportFileInput, string][] = [
  [{ format: 'docx', filename: 'Отчёт.docx', markdown: '# Итоги' }, 'PK'],
  [{ format: 'pdf', filename: 'Отчёт.pdf', markdown: '# Итоги' }, '%PDF'],
  [{ format: 'xlsx', filename: 'Таблица.xlsx', sheets: [sheet] }, 'PK'],
  [{ format: 'csv', filename: 'Таблица.csv', sheets: [sheet] }, '\ufeff'],
  [{ format: 'pptx', filename: 'Слайды.pptx', slides: [{ title: 'Итоги' }] }, 'PK'],
  [{ format: 'md', filename: 'Заметки.md', markdown: '# Итоги' }, '# '],
];

describe('renderExportFile', () => {
  it.each(cases)('собирает файл по заявке №%#', async (input, prefix) => {
    const file = await renderExportFile(input);
    expect(file.filename).toBe(input.filename);
    expect(file.mimeType).toBe(EXPORT_MIME_TYPES[input.format]);
    expect(file.buffer.toString('utf8', 0, 4).startsWith(prefix)).toBe(true);
  });

  it('собирает md с заголовком и таблицей Markdown', async () => {
    const file = await renderExportFile({
      format: 'md',
      filename: 'Итоги.md',
      title: 'Итоги',
      markdown: '| Город | Сумма |\n| --- | --- |\n| Москва | 1234.5 |',
    });
    expect(file.mimeType).toBe('text/markdown');
    expect(file.buffer.toString('utf8')).toBe(
      '# Итоги\n\n| Город | Сумма |\n| --- | --- |\n| Москва | 1234.5 |\n',
    );
  });

  it('отказывает, если файл больше предела', async () => {
    await expect(
      renderExportFile(
        { format: 'csv', filename: 'Таблица.csv', sheets: [sheet] },
        { timeoutMs: 20_000, maxBytes: 10 },
      ),
    ).rejects.toThrow('Файл получился слишком большим');
  });
});

describe('withExportTimeout', () => {
  it('обрывает сборку, которая не уложилась в срок', async () => {
    await expect(
      withExportTimeout(new Promise<Buffer>(() => undefined), 10),
    ).rejects.toBeInstanceOf(ExportFileError);
  });

  it('отдаёт результат, если сборка успела', async () => {
    await expect(withExportTimeout(Promise.resolve(Buffer.from('готово')), 1000)).resolves.toEqual(
      Buffer.from('готово'),
    );
  });
});
