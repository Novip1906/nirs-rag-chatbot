import { isValidLuhn, isValidIban, isValidInn, isValidSnils } from './checksums';

describe('isValidLuhn', () => {
  it('принимает валидный номер карты', () => {
    expect(isValidLuhn('4111111111111111')).toBe(true);
  });
  it('отвергает номер заказа, не проходящий проверку', () => {
    expect(isValidLuhn('1234567890123456')).toBe(false);
  });
  it('отвергает пустую строку и нецифры', () => {
    expect(isValidLuhn('')).toBe(false);
    expect(isValidLuhn('41111111111111a1')).toBe(false);
  });
});

describe('isValidIban', () => {
  it('принимает валидный IBAN', () => {
    expect(isValidIban('DE89370400440532013000')).toBe(true);
  });
  it('отвергает IBAN с испорченной контрольной суммой', () => {
    expect(isValidIban('DE89370400440532013001')).toBe(false);
  });
});

describe('isValidInn', () => {
  it('принимает валидный ИНН юрлица из 10 знаков', () => {
    expect(isValidInn('7707083893')).toBe(true);
  });
  it('принимает валидный ИНН физлица из 12 знаков', () => {
    expect(isValidInn('500100732259')).toBe(true);
  });
  it('отвергает артикул из 10 цифр', () => {
    expect(isValidInn('1234567890')).toBe(false);
  });
  it('отвергает длину, отличную от 10 и 12', () => {
    expect(isValidInn('12345678901')).toBe(false);
  });
});

describe('isValidSnils', () => {
  it('принимает валидный СНИЛС', () => {
    expect(isValidSnils('11223344595')).toBe(true);
  });
  it('отвергает испорченный СНИЛС', () => {
    expect(isValidSnils('11223344596')).toBe(false);
  });
});
