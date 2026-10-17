import JSZip from 'jszip';
import { read } from 'xlsx';
import { renderCsv, renderXlsx, sanitizeSheetNames } from './sheet';

describe('sanitizeSheetNames', () => {
  it('убирает запрещённые символы, режет до 31 знака и делает имена уникальными', () => {
    expect(
      sanitizeSheetNames([
        'Итоги: 2026/Q3',
        'итоги: 2026/q3',
        '',
        'ОченьДлинноеНазваниеЛистаКотороеНеВлезает',
        '[Сводка]*',
      ]),
    ).toEqual(['Итоги 2026 Q3', 'итоги 2026 q3 (2)', 'Лист 3', 'ОченьДлинноеНазваниеЛистаКоторо', 'Сводка']);
  });
});

describe('renderXlsx', () => {
  it('сохраняет типы ячеек, заголовки и ширину столбцов', async () => {
    const buffer = renderXlsx([
      {
        name: 'Итоги: 2026/Q3',
        columns: ['Показатель', 'Сумма', 'Флаг', 'Формула'],
        rows: [
          ['Выручка', 1234.5, true, null],
          ['00123', -10, false, '=1+1'],
        ],
      },
    ]);
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    const workbook = read(buffer, { type: 'buffer' });
    expect(workbook.SheetNames).toEqual(['Итоги 2026 Q3']);
    const sheet = workbook.Sheets['Итоги 2026 Q3'];
    expect(sheet['A1']).toMatchObject({ t: 's', v: 'Показатель' });
    expect(sheet['B2']).toMatchObject({ t: 'n', v: 1234.5 });
    expect(sheet['C2']).toMatchObject({ t: 'b', v: true });
    expect(sheet['D2']).toBeUndefined();
    expect(sheet['A3']).toMatchObject({ t: 's', v: '00123' });
    expect(sheet['D3']).toMatchObject({ t: 's', v: '=1+1' });
    expect(sheet['D3'].f).toBeUndefined();
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('xl/worksheets/sheet1.xml')?.async('string');
    expect(xml).toMatch(/<col min="1" max="1" width="[\d.]+" customWidth="1"\/>/);
  });
});

describe('renderCsv', () => {
  it('пишет BOM, точку с запятой, CRLF, десятичную запятую и экранирует поля', () => {
    const buffer = renderCsv({
      name: 'Лист',
      columns: ['Имя', 'Сумма', 'Комментарий'],
      rows: [
        ['Иванов', 1234.5, 'ok'],
        ['Петров; мл.', -10, 'сказал "да"'],
        ['Сидоров', null, 'строка1\nстрока2'],
        ['Флаг', 0, true],
      ],
    });
    expect([...buffer.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(buffer.toString('utf8')).toBe(
      '\ufeffИмя;Сумма;Комментарий\r\nИванов;1234,5;ok\r\n"Петров; мл.";-10;"сказал ""да"""\r\nСидоров;;"строка1\nстрока2"\r\nФлаг;0;ИСТИНА\r\n',
    );
  });

  it('обезвреживает ячейки, которые Excel принял бы за формулу, но не трогает телефоны и числа со знаком', () => {
    const buffer = renderCsv({
      name: 'Лист',
      rows: [['=HYPERLINK("http://x")', '@SUM(A1)', '+7 (999) 123-45-67', '-5%', '-cmd', '+ok']],
    });
    expect(buffer.toString('utf8')).toBe(
      '\ufeff"\'=HYPERLINK(""http://x"")";\'@SUM(A1);+7 (999) 123-45-67;-5%;\'-cmd;\'+ok\r\n',
    );
  });
});
