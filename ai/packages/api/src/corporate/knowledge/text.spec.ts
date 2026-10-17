import { MIN_PARAGRAPH_LENGTH, normalizeForIndexing } from './text';

const sentence = 'Настоящий регламент устанавливает порядок направления работников в командировки. ';

describe('normalizeForIndexing', () => {
  it('склеивает короткие строки, разделённые пустыми, в один абзац', () => {
    const source = ['Заголовок раздела', '', 'Первый пункт', '', 'Второй пункт'].join('\n');
    expect(normalizeForIndexing(source)).toBe('Заголовок раздела Первый пункт Второй пункт');
  });

  it('завершает абзац на пустой строке, когда накоплено достаточно', () => {
    const long = sentence.repeat(6).trim();
    const result = normalizeForIndexing(`${long}\n\nСледующий раздел`);
    const paragraphs = result.split('\n\n');
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].length).toBeGreaterThanOrEqual(MIN_PARAGRAPH_LENGTH);
    expect(paragraphs[1]).toBe('Следующий раздел');
  });

  it('переносы внутри предложения не разрывают текст', () => {
    const source = 'Работник обязан\nсогласовать поездку\nс руководителем.';
    expect(normalizeForIndexing(source)).toBe('Работник обязан согласовать поездку с руководителем.');
  });

  it('схлопывает повторяющиеся пробелы и табуляции', () => {
    expect(normalizeForIndexing('Приказ\t\t№  47-П   о   расходах')).toBe(
      'Приказ № 47-П о расходах',
    );
  });

  it('не оставляет пустых абзацев на подряд идущих пустых строках', () => {
    const long = sentence.repeat(6).trim();
    const result = normalizeForIndexing(`${long}\n\n\n\n${long}`);
    expect(result.split('\n\n').every((p) => p.trim().length > 0)).toBe(true);
  });

  it('короткий документ остаётся одним абзацем и не теряется', () => {
    expect(normalizeForIndexing('Пароль от переговорной: 4821.')).toBe(
      'Пароль от переговорной: 4821.',
    );
  });

  it('пустой текст даёт пустую строку', () => {
    expect(normalizeForIndexing('')).toBe('');
    expect(normalizeForIndexing('\n\n   \n')).toBe('');
  });

  it('сокращает число фрагментов на реальной форме презентационного PDF', () => {
    const slides = Array.from({ length: 40 }, (_, i) => `Пункт ${i + 1} про электронику`).join(
      '\n\n',
    );
    const before = slides.split('\n\n').length;
    const after = normalizeForIndexing(slides).split('\n\n').length;
    expect(before).toBe(40);
    expect(after).toBeLessThan(before / 3);
  });
});
