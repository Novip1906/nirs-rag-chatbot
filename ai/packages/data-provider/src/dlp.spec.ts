import { dlpConfigSchema, DEFAULT_DLP_CONFIG } from './dlp';

describe('dlpConfigSchema', () => {
  it('заполняет значения по умолчанию для пустого объекта', () => {
    const parsed = dlpConfigSchema.parse({});
    expect(parsed.enabled).toBe(false);
    expect(parsed.maskEmbeddings).toBe(true);
    expect(parsed.categories.payment_card).toBe('mask');
    expect(parsed.categories.ru_inn).toBe('mask');
  });

  it('принимает частичное переопределение категорий', () => {
    const parsed = dlpConfigSchema.parse({ enabled: true, categories: { ru_snils: 'shadow' } });
    expect(parsed.categories.ru_snils).toBe('shadow');
    expect(parsed.categories.payment_card).toBe('mask');
  });

  it('отвергает неизвестный режим', () => {
    expect(() => dlpConfigSchema.parse({ categories: { payment_card: 'block' } })).toThrow();
  });

  it('отвергает неизвестную категорию', () => {
    expect(() => dlpConfigSchema.parse({ categories: { unknown: 'mask' } })).toThrow();
  });

  it('DEFAULT_DLP_CONFIG совпадает с разбором пустого объекта', () => {
    expect(DEFAULT_DLP_CONFIG).toEqual(dlpConfigSchema.parse({}));
  });
});
