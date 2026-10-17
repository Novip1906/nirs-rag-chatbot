import { shannonEntropy } from './entropy';

describe('shannonEntropy', () => {
  it('даёт ноль для строки из одного символа', () => {
    expect(shannonEntropy('aaaaaaaa')).toBe(0);
  });
  it('даёт высокое значение для случайного токена', () => {
    expect(shannonEntropy('xQ3vB8mZ1pL7nR4tK9wY2sD6fG0hJ5cA')).toBeGreaterThan(4);
  });
  it('даёт низкое значение для обычного слова', () => {
    expect(shannonEntropy('договорподряда')).toBeLessThan(4);
  });
  it('даёт ноль для пустой строки', () => {
    expect(shannonEntropy('')).toBe(0);
  });
});
