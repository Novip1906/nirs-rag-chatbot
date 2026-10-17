import { renderMarkdownFile } from './md';

describe('renderMarkdownFile', () => {
  it('убирает хвостовые пробелы в строках и заканчивает файл одним переводом строки', () => {
    const buffer = renderMarkdownFile('Первая строка   \nВторая строка\t\n');
    expect(buffer.toString('utf8')).toBe('Первая строка\nВторая строка\n');
  });

  it('кодирует в UTF-8 без BOM', () => {
    const buffer = renderMarkdownFile('Текст');
    expect(buffer[0]).not.toBe(0xef);
  });

  it('добавляет заголовок первой строкой с пустой строкой перед телом', () => {
    const buffer = renderMarkdownFile('Текст отчёта', 'Отчёт за\nсентябрь');
    expect(buffer.toString('utf8')).toBe('# Отчёт за сентябрь\n\nТекст отчёта\n');
  });

  it('не добавляет заголовок из одних пробелов', () => {
    const buffer = renderMarkdownFile('Текст', '   \n\t  ');
    expect(buffer.toString('utf8')).toBe('Текст\n');
  });

  it('приводит переводы строк CRLF и CR к LF', () => {
    const buffer = renderMarkdownFile('Первая\r\nВторая\rТретья');
    expect(buffer.toString('utf8')).toBe('Первая\nВторая\nТретья\n');
  });
});
