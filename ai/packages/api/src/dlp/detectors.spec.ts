import { detect } from './detectors';
import {
  DLP_CATEGORIES,
  type DlpCategory,
  type DlpCategoryMode,
  type DlpDetectOptions,
} from './types';

const allMask = Object.fromEntries(
  DLP_CATEGORIES.map((c) => [c, 'mask' as DlpCategoryMode]),
) as Record<DlpCategory, DlpCategoryMode>;

const options: DlpDetectOptions = { modes: allMask };

describe('detect', () => {
  it('находит номер карты, прошедший Луна', () => {
    const matches = detect('оплата по карте 4111 1111 1111 1111 прошла', options);
    expect(matches).toHaveLength(1);
    expect(matches[0].category).toBe('payment_card');
    expect(matches[0].value).toBe('4111 1111 1111 1111');
  });

  it('не считает картой номер заказа, не прошедший Луна', () => {
    const matches = detect('заказ 1234567890123456', options);
    expect(matches.filter((m) => m.category === 'payment_card')).toHaveLength(0);
  });

  it('находит ИНН и не находит артикул', () => {
    expect(detect('ИНН 7707083893', options).some((m) => m.category === 'ru_inn')).toBe(true);
    expect(detect('артикул 1234567890', options).some((m) => m.category === 'ru_inn')).toBe(false);
  });

  it('находит СНИЛС в формате с разделителями', () => {
    const matches = detect('СНИЛС 112-233-445 95', options);
    expect(matches.some((m) => m.category === 'ru_snils')).toBe(true);
  });

  it('находит паспорт только рядом с ключевым словом', () => {
    expect(detect('паспорт 4510 123456', options).some((m) => m.category === 'ru_passport')).toBe(
      true,
    );
    expect(detect('в период 4510 123456', options).some((m) => m.category === 'ru_passport')).toBe(
      false,
    );
  });

  it('находит секрет по префиксу', () => {
    const matches = detect('ключ sk_' + 'live_abcdefghijklmnopqrstuvwx', options);
    expect(matches.some((m) => m.category === 'secrets')).toBe(true);
  });

  it('находит секрет по энтропии в паре ключ-значение', () => {
    const matches = detect('api_key=xQ3vB8mZ1pL7nR4tK9wY2sD6fG0hJ5cA', options);
    expect(matches.some((m) => m.category === 'secrets')).toBe(true);
  });

  it('не проверяет категории с режимом off', () => {
    const modes = { ...allMask, payment_card: 'off' as DlpCategoryMode };
    const matches = detect('карта 4111 1111 1111 1111', { ...options, modes });
    expect(matches.filter((m) => m.category === 'payment_card')).toHaveLength(0);
  });

  it('находит значение, записанное полноширинными цифрами, в исходных позициях', () => {
    const fullwidth = '４１１１１１１１１１１１１１１１';
    const source = `карта ${fullwidth}`;
    const matches = detect(source, options);
    expect(matches).toHaveLength(1);
    expect(source.slice(matches[0].start, matches[0].end)).toBe(fullwidth);
  });

  it('возвращает совпадения по возрастанию позиции без пересечений', () => {
    const matches = detect('карта 4111 1111 1111 1111 и ИНН 7707083893', options);
    expect(matches).toHaveLength(2);
    expect(matches[0].start).toBeLessThan(matches[1].start);
    expect(matches[0].end).toBeLessThanOrEqual(matches[1].start);
  });
});
