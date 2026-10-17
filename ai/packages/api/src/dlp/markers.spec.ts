import {
  MarkerTable,
  MARKER_LABELS,
  escapeMarkerLookalikes,
  unescapeMarkerLookalikes,
} from './markers';

describe('MarkerTable', () => {
  it('выдаёт маркер по метке категории', () => {
    const table = new MarkerTable();
    expect(table.issue('payment_card', '4111111111111111')).toBe('[CARD_1]');
  });

  it('одинаковому значению выдаёт один маркер', () => {
    const table = new MarkerTable();
    const first = table.issue('payment_card', '4111111111111111');
    const second = table.issue('payment_card', '4111111111111111');
    expect(second).toBe(first);
    expect(table.size).toBe(1);
  });

  it('разным значениям выдаёт разные номера', () => {
    const table = new MarkerTable();
    expect(table.issue('payment_card', '4111111111111111')).toBe('[CARD_1]');
    expect(table.issue('payment_card', '5555555555554444')).toBe('[CARD_2]');
  });

  it('нумерует категории независимо', () => {
    const table = new MarkerTable();
    table.issue('payment_card', '4111111111111111');
    expect(table.issue('ru_inn', '7707083893')).toBe('[INN_1]');
  });

  it('разворачивает маркер обратно в значение', () => {
    const table = new MarkerTable();
    const marker = table.issue('payment_card', '4111111111111111');
    expect(table.resolve(marker)).toBe('4111111111111111');
  });

  it('возвращает undefined для неизвестного маркера', () => {
    expect(new MarkerTable().resolve('[CARD_9]')).toBeUndefined();
  });

  it('разворачивает маркер, записанный в другом регистре', () => {
    const table = new MarkerTable();
    table.issue('payment_card', '4111111111111111');
    expect(table.resolve('[card_1]')).toBe('4111111111111111');
    expect(table.resolve('[Card_1]')).toBe('4111111111111111');
  });

  it('разворачивает маркер с лишними пробелами', () => {
    const table = new MarkerTable();
    table.issue('payment_card', '4111111111111111');
    expect(table.resolve('[ CARD_1 ]')).toBe('4111111111111111');
    expect(table.resolve('[CARD _ 1]')).toBe('4111111111111111');
  });

  it('разворачивает маркер в круглых и фигурных скобках', () => {
    const table = new MarkerTable();
    table.issue('payment_card', '4111111111111111');
    expect(table.resolve('{CARD_1}')).toBe('4111111111111111');
    expect(table.resolve('(CARD_1)')).toBe('4111111111111111');
  });

  it('покрывает метками все категории', () => {
    expect(Object.keys(MARKER_LABELS).length).toBe(6);
  });
});

describe('экранирование', () => {
  it('удваивает скобку перед похожей на маркер последовательностью', () => {
    expect(escapeMarkerLookalikes('текст [CARD_1] тут')).toBe('текст [[CARD_1] тут');
  });

  it('не трогает обычные скобки', () => {
    expect(escapeMarkerLookalikes('массив [1, 2]')).toBe('массив [1, 2]');
  });

  it('экранирует похожее на маркер в любом регистре', () => {
    expect(escapeMarkerLookalikes('текст [card_1] тут')).toBe('текст [[card_1] тут');
  });

  it('экранирует похожее на маркер в фигурных скобках', () => {
    expect(escapeMarkerLookalikes('текст {CARD_1} тут')).toBe('текст {{CARD_1} тут');
  });

  it('обратная операция восстанавливает исходное в любом регистре', () => {
    const source = 'текст [card_1] тут';
    expect(unescapeMarkerLookalikes(escapeMarkerLookalikes(source))).toBe(source);
  });

  it('обратная операция восстанавливает фигурные скобки', () => {
    const source = 'текст {CARD_1} тут';
    expect(unescapeMarkerLookalikes(escapeMarkerLookalikes(source))).toBe(source);
  });

  it('обратная операция восстанавливает исходное', () => {
    const source = 'текст [CARD_1] тут';
    expect(unescapeMarkerLookalikes(escapeMarkerLookalikes(source))).toBe(source);
  });
});
