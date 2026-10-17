import { maskText } from './mask';
import { MarkerTable } from './markers';
import {
  DLP_CATEGORIES,
  type DlpCategory,
  type DlpCategoryMode,
  type DlpDetectOptions,
} from './types';

const modes = (override: Partial<Record<DlpCategory, DlpCategoryMode>> = {}) => ({
  ...(Object.fromEntries(DLP_CATEGORIES.map((c) => [c, 'mask'])) as Record<
    DlpCategory,
    DlpCategoryMode
  >),
  ...override,
});

const options = (override?: Partial<Record<DlpCategory, DlpCategoryMode>>): DlpDetectOptions => ({
  modes: modes(override),
});

describe('maskText', () => {
  it('заменяет найденное значение маркером', () => {
    const result = maskText('карта 4111 1111 1111 1111 тут', new MarkerTable(), options());
    expect(result.text).toBe('карта [CARD_1] тут');
  });

  it('заменяет несколько значений подряд', () => {
    const result = maskText(
      'карты 4111 1111 1111 1111 и 5555 5555 5555 4444',
      new MarkerTable(),
      options(),
    );
    expect(result.text).toBe('карты [CARD_1] и [CARD_2]');
  });

  it('одинаковым значениям в разных местах даёт один маркер', () => {
    const result = maskText(
      '4111111111111111 и снова 4111111111111111',
      new MarkerTable(),
      options(),
    );
    expect(result.text).toBe('[CARD_1] и снова [CARD_1]');
  });

  it('продолжает нумерацию в общей таблице между вызовами', () => {
    const table = new MarkerTable();
    maskText('4111111111111111', table, options());
    const second = maskText('5555555555554444', table, options());
    expect(second.text).toBe('[CARD_2]');
  });

  it('в режиме shadow не меняет текст, но сообщает о находке', () => {
    const result = maskText(
      'карта 4111111111111111',
      new MarkerTable(),
      options({ payment_card: 'shadow' }),
    );
    expect(result.text).toBe('карта 4111111111111111');
    expect(result.findings[0].category).toBe('payment_card');
    expect(result.findings[0].count).toBe(1);
  });

  it('экранирует написанное сотрудником похожее на маркер', () => {
    const result = maskText('он написал [CARD_1] сам', new MarkerTable(), options());
    expect(result.text).toBe('он написал [[CARD_1] сам');
  });

  it('не помещает исходное значение в findings', () => {
    const result = maskText('карта 4111111111111111', new MarkerTable(), options());
    expect(JSON.stringify(result.findings)).not.toContain('4111');
  });

  it('возвращает текст без изменений, когда ничего не найдено', () => {
    const result = maskText('обычный текст', new MarkerTable(), options());
    expect(result.text).toBe('обычный текст');
    expect(result.findings).toEqual([]);
  });
});
