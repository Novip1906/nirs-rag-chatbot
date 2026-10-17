import { normalizeForDetection } from './normalize';

const NBSP = '\u00A0';
const FULLWIDTH_4111 = '４１１１';

describe('normalizeForDetection', () => {
  it('приводит полноширинные цифры к ASCII', () => {
    const result = normalizeForDetection(FULLWIDTH_4111);
    expect(result.text).toBe('4111');
  });

  it('заменяет неразрывные пробелы на обычные', () => {
    const result = normalizeForDetection(`4111${NBSP}1111`);
    expect(result.text).toBe('4111 1111');
  });

  it('сохраняет карту смещений в исходную строку', () => {
    const source = `N ${FULLWIDTH_4111}`;
    const result = normalizeForDetection(source);
    const position = result.text.indexOf('4111');
    expect(source[result.sourceIndex[position]]).toBe('４');
  });

  it('на строке без изменений даёт тождественную карту', () => {
    const result = normalizeForDetection('4111 1111');
    expect(result.text).toBe('4111 1111');
    expect(result.sourceIndex).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('возвращает пустой результат для пустой строки', () => {
    const result = normalizeForDetection('');
    expect(result.text).toBe('');
    expect(result.sourceIndex).toEqual([]);
  });
});
