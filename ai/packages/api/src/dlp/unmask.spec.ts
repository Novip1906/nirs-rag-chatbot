import { MarkerStreamDecoder, unmaskText } from './unmask';
import { MarkerTable } from './markers';

function tableWithCard(): MarkerTable {
  const table = new MarkerTable();
  table.issue('payment_card', '4111111111111111');
  return table;
}

describe('unmaskText', () => {
  it('разворачивает маркер в исходное значение', () => {
    const result = unmaskText('по карте [CARD_1] лимит', tableWithCard());
    expect(result.text).toBe('по карте 4111111111111111 лимит');
    expect(result.unresolved).toBe(0);
  });

  it('оставляет нераспознанный маркер и считает его', () => {
    const result = unmaskText('по карте [CARD_7] лимит', tableWithCard());
    expect(result.text).toBe('по карте [CARD_7] лимит');
    expect(result.unresolved).toBe(1);
  });

  it('снимает экранирование написанного сотрудником', () => {
    const result = unmaskText('он написал [[CARD_1] сам', tableWithCard());
    expect(result.text).toBe('он написал [CARD_1] сам');
  });

  it('не подставляет значение в экранированный текст сотрудника, записанный строчными', () => {
    const result = unmaskText('он написал [[card_1] сам', tableWithCard());
    expect(result.text).toBe('он написал [card_1] сам');
    expect(result.unresolved).toBe(0);
  });

  it('не подставляет значение в экранированный текст в фигурных скобках', () => {
    const result = unmaskText('он написал {{CARD_1} сам', tableWithCard());
    expect(result.text).toBe('он написал {CARD_1} сам');
    expect(result.unresolved).toBe(0);
  });

  it('не трогает обычный текст', () => {
    expect(unmaskText('массив [1, 2]', tableWithCard()).text).toBe('массив [1, 2]');
  });

  it('разворачивает маркер, искажённый моделью по регистру и пробелам', () => {
    const result = unmaskText('по [ card_1 ] лимит', tableWithCard());
    expect(result.text).toBe('по 4111111111111111 лимит');
    expect(result.unresolved).toBe(0);
  });

  it('разворачивает маркер в фигурных скобках', () => {
    expect(unmaskText('по {CARD_1} лимит', tableWithCard()).text).toBe('по 4111111111111111 лимит');
  });

  it('разворачивает маркер внутри форматирования', () => {
    expect(unmaskText('по `[CARD_1]` лимит', tableWithCard()).text).toBe(
      'по `4111111111111111` лимит',
    );
  });

  it('считает неразвёрнутыми маркеры, которые модель испортила до неузнаваемости', () => {
    const result = unmaskText('по КАРТЕ номер один лимит', tableWithCard());
    expect(result.unresolved).toBe(0);
    expect(result.text).toBe('по КАРТЕ номер один лимит');
  });
});

describe('MarkerStreamDecoder', () => {
  it('собирает маркер, разорванный между чанками', () => {
    const decoder = new MarkerStreamDecoder(tableWithCard());
    const first = decoder.push('по карте [CA');
    const second = decoder.push('RD_1] лимит');
    expect(first + second + decoder.flush()).toBe('по карте 4111111111111111 лимит');
  });

  it('отдаёт текст без задержки, когда маркеров нет', () => {
    const decoder = new MarkerStreamDecoder(tableWithCard());
    expect(decoder.push('обычный текст')).toBe('обычный текст');
  });

  it('не теряет хвост, который так и не стал маркером', () => {
    const decoder = new MarkerStreamDecoder(tableWithCard());
    const out = decoder.push('незакрытая [скобка');
    expect(out + decoder.flush()).toBe('незакрытая [скобка');
  });

  it('отдаёт слишком длинный хвост, не дожидаясь закрытия', () => {
    const decoder = new MarkerStreamDecoder(tableWithCard());
    const long = '[' + 'x'.repeat(60);
    const out = decoder.push(long);
    expect(out + decoder.flush()).toBe(long);
  });

  it('обрабатывает посимвольный поток', () => {
    const decoder = new MarkerStreamDecoder(tableWithCard());
    let out = '';
    for (const char of 'карта [CARD_1]!') {
      out += decoder.push(char);
    }
    expect(out + decoder.flush()).toBe('карта 4111111111111111!');
  });
});
