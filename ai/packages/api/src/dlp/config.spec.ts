import { resolveDlpConfig, warnDlpAuditMissing } from './config';

jest.mock('@librechat/data-schemas', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));

describe('resolveDlpConfig', () => {
  it('без секции даёт undefined — DLP просто выключен', () => {
    expect(resolveDlpConfig(undefined)).toBeUndefined();
    expect(resolveDlpConfig(null as unknown as undefined)).toBeUndefined();
  });

  it('достраивает умолчания: администратор пишет одну строку, категории появляются все', () => {
    const resolved = resolveDlpConfig({ enabled: true } as never);

    expect(resolved?.enabled).toBe(true);
    expect(resolved?.maskEmbeddings).toBe(true);
    expect(resolved?.categories).toEqual({
      secrets: 'mask',
      payment_card: 'mask',
      bank_account: 'mask',
      ru_inn: 'mask',
      ru_snils: 'mask',
      ru_passport: 'mask',
    });
  });

  it('частично заданные категории дополняются, а заданные сохраняются', () => {
    const resolved = resolveDlpConfig({
      enabled: true,
      categories: { ru_passport: 'off', payment_card: 'shadow' },
    } as never);

    expect(resolved?.categories.ru_passport).toBe('off');
    expect(resolved?.categories.payment_card).toBe('shadow');
    expect(resolved?.categories.secrets).toBe('mask');
  });

  it('выключенный DLP остаётся выключенным, а не подтягивается умолчанием', () => {
    expect(resolveDlpConfig({ enabled: false } as never)?.enabled).toBe(false);
  });

  it('пустая секция считается выключенной', () => {
    expect(resolveDlpConfig({} as never)?.enabled).toBe(false);
  });

  it('непригодная секция выключает маскирование, а не пропускает его молча', () => {
    expect(resolveDlpConfig({ enabled: 'да' } as never)).toBeUndefined();
    expect(resolveDlpConfig({ categories: { payment_card: 'вырезать' } } as never)).toBeUndefined();
  });

  it('незнакомая категория — ошибка настройки, а не игнорируемое поле', () => {
    expect(resolveDlpConfig({ enabled: true, categories: { email: 'mask' } } as never)).toBeUndefined();
  });
});

describe('warnDlpAuditMissing', () => {
  it('шумит, когда DLP настроен, а журнала аудита нет', () => {
    expect(warnDlpAuditMissing(false, true)).toBe(true);
  });

  it('молчит, когда всё на месте', () => {
    expect(warnDlpAuditMissing(true, true)).toBe(false);
  });

  it('молчит, когда DLP не настроен — это не поломка, а выключенная возможность', () => {
    expect(warnDlpAuditMissing(false, false)).toBe(false);
    expect(warnDlpAuditMissing(true, false)).toBe(false);
  });
});
