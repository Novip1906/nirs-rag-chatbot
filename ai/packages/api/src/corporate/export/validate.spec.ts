import { MAX_EXPORT_ROWS, parseExportFileArgs, sanitizeExportFilename } from './validate';
import { ExportFileError } from './types';

type RawArgs = Parameters<typeof parseExportFileArgs>[0];

function rejectionOf(input: RawArgs): string {
  try {
    parseExportFileArgs(input);
  } catch (error) {
    if (error instanceof ExportFileError) {
      return error.message;
    }
    throw error;
  }
  throw new Error('Ожидалась ошибка проверки аргументов');
}

describe('sanitizeExportFilename', () => {
  it.each([
    ['Отчёт за сентябрь.docx', 'pdf', 'Отчёт за сентябрь.pdf'],
    ['../../etc/passwd', 'csv', 'etc passwd.csv'],
    ['отчёт.final.xlsx', 'xlsx', 'отчёт.final.xlsx'],
    ['Отчёт.docx.pdf', 'pdf', 'Отчёт.pdf'],
    ['Отчёт.final', 'docx', 'Отчёт.final.docx'],
    ['Notes 10.Sept', 'pdf', 'Notes 10.Sept.pdf'],
    ['Версия 1.2', 'docx', 'Версия 1.2.docx'],
    ['   ...   ', 'pptx', 'Документ.pptx'],
    ['а\tб\nв', 'csv', 'а б в.csv'],
    ['Счёт\u202Excod.pdf', 'pdf', 'Счётxcod.pdf'],
    ['Итоги\u200B \u2066года\u2069', 'docx', 'Итоги года.docx'],
    ['Заметки.md', 'md', 'Заметки.md'],
    ['Отчёт.docx', 'md', 'Отчёт.md'],
  ] as const)('%s (%s) → %s', (raw, format, expected) => {
    expect(sanitizeExportFilename(raw, format)).toBe(expected);
  });

  it('обрезает имя до 120 символов и добавляет расширение', () => {
    expect(sanitizeExportFilename('x'.repeat(130), 'pdf')).toBe(`${'x'.repeat(120)}.pdf`);
  });

  it('не разрывает символ из двух половин при обрезке', () => {
    expect(sanitizeExportFilename(`${'x'.repeat(119)}😀😀`, 'pdf')).toBe(
      `${'x'.repeat(119)}😀.pdf`,
    );
  });
});

describe('parseExportFileArgs: длинное имя файла', () => {
  it('обрезает имя длиннее 120 символов вместо отказа', () => {
    expect(
      parseExportFileArgs({ format: 'pdf', filename: 'Отчёт'.repeat(30), markdown: 'Текст' }),
    ).toEqual({ format: 'pdf', filename: `${'Отчёт'.repeat(24)}.pdf`, markdown: 'Текст' });
  });
});

describe('parseExportFileArgs', () => {
  it('нормализует документ: имя, расширение и заголовок', () => {
    expect(
      parseExportFileArgs({
        format: 'docx',
        filename: 'Отчёт.docx',
        title: '  Итоги  ',
        markdown: '# Итоги',
      }),
    ).toEqual({ format: 'docx', filename: 'Отчёт.docx', title: 'Итоги', markdown: '# Итоги' });
  });

  it('принимает null в необязательных полях', () => {
    expect(
      parseExportFileArgs({
        format: 'pdf',
        filename: 'Отчёт',
        title: null,
        markdown: 'Текст',
        sheets: null,
      }),
    ).toEqual({ format: 'pdf', filename: 'Отчёт.pdf', markdown: 'Текст' });
  });

  it('оставляет числа в таблице числами и отбрасывает пустые заголовки', () => {
    expect(
      parseExportFileArgs({
        format: 'xlsx',
        filename: 'Продажи',
        sheets: [
          {
            name: 'Итоги',
            columns: ['Город', 'Сумма'],
            rows: [
              ['Москва', 1234.5],
              ['Казань', null],
            ],
          },
          { name: 'Сырые', columns: [], rows: [['00123', true]] },
        ],
      }),
    ).toEqual({
      format: 'xlsx',
      filename: 'Продажи.xlsx',
      sheets: [
        {
          name: 'Итоги',
          columns: ['Город', 'Сумма'],
          rows: [
            ['Москва', 1234.5],
            ['Казань', null],
          ],
        },
        { name: 'Сырые', rows: [['00123', true]] },
      ],
    });
  });

  it('нормализует слайды: пустые пункты и заметки не попадают в результат', () => {
    expect(
      parseExportFileArgs({
        format: 'pptx',
        filename: 'Презентация',
        slides: [
          { title: ' План ', bullets: [], notes: '' },
          {
            title: 'Цифры',
            table: { columns: ['Квартал', 'Выручка'], rows: [['Q3', 120]] },
            notes: 'Сказать про рост',
          },
        ],
      }),
    ).toEqual({
      format: 'pptx',
      filename: 'Презентация.pptx',
      slides: [
        { title: 'План' },
        {
          title: 'Цифры',
          table: { columns: ['Квартал', 'Выручка'], rows: [['Q3', 120]] },
          notes: 'Сказать про рост',
        },
      ],
    });
  });

  it('требует markdown для Word и объясняет, как исправить', () => {
    expect(rejectionOf({ format: 'docx', filename: 'Отчёт' })).toBe(
      'Аргументы export_file не прошли проверку: markdown: для формата docx нужен markdown с содержимым документа. Исправь аргументы и вызови инструмент снова.',
    );
  });

  it('называет допустимые форматы', () => {
    expect(rejectionOf({ format: 'rtf', filename: 'Отчёт', markdown: 'x' })).toContain(
      'format: должен быть одним из: docx, pdf, xlsx, csv, pptx, md',
    );
  });

  it('принимает md как документ: заголовок обрезается, имя получает .md', () => {
    expect(
      parseExportFileArgs({
        format: 'md',
        filename: 'Заметки',
        title: '  Итоги  ',
        markdown: '# Итоги',
      }),
    ).toEqual({ format: 'md', filename: 'Заметки.md', title: 'Итоги', markdown: '# Итоги' });
  });

  it('требует markdown для md', () => {
    expect(rejectionOf({ format: 'md', filename: 'Заметки' })).toBe(
      'Аргументы export_file не прошли проверку: markdown: для формата md нужен markdown с содержимым документа. Исправь аргументы и вызови инструмент снова.',
    );
  });

  it('требует имя файла', () => {
    expect(rejectionOf({ format: 'csv', sheets: [{ name: 'Лист', rows: [['a']] }] })).toContain(
      'filename: не указано имя файла',
    );
  });

  it('указывает на ячейку неверного типа', () => {
    expect(
      rejectionOf({
        format: 'xlsx',
        filename: 'Т',
        sheets: [{ name: 'Лист', rows: [['a'], ['b', 1, { сумма: 5 }]] }],
      }),
    ).toContain('sheets[0].rows[1][2]: ячейка должна быть строкой, числом, true/false или null');
  });

  it('требует хотя бы один лист для CSV', () => {
    expect(rejectionOf({ format: 'csv', filename: 'Т', sheets: [] })).toContain(
      'sheets: для формата csv нужен sheets — таблица берётся из первого листа',
    );
  });

  it('отклоняет пустой лист', () => {
    expect(
      rejectionOf({ format: 'xlsx', filename: 'Т', sheets: [{ name: 'Лист', rows: [] }] }),
    ).toContain('sheets[0].rows: лист пустой');
  });

  it(`не пропускает больше ${MAX_EXPORT_ROWS} строк`, () => {
    const rows = Array.from({ length: MAX_EXPORT_ROWS + 1 }, (_, index) => [index]);
    expect(
      rejectionOf({ format: 'csv', filename: 'Т', sheets: [{ name: 'Лист', rows }] }),
    ).toContain(`в таблицах ${MAX_EXPORT_ROWS + 1} строк`);
  });

  it('не даёт совместить пункты и таблицу на одном слайде', () => {
    expect(
      rejectionOf({
        format: 'pptx',
        filename: 'Т',
        slides: [{ title: 'Итоги', bullets: ['a'], table: { columns: ['x'], rows: [[1]] } }],
      }),
    ).toContain('slides[0]: на слайде либо bullets, либо table');
  });

  it('объясняет, что аргументы должны быть объектом', () => {
    expect(rejectionOf('export')).toContain('аргументы должны быть объектом');
  });
});
