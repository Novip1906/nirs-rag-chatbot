import i18n, { changeLanguageSafely, initializeI18n } from '../i18n';

describe('com_ui_token_count pluralization', () => {
  beforeAll(async () => {
    await initializeI18n();
  });

  afterEach(async () => {
    await changeLanguageSafely('en');
  });

  it('declines the Russian noun for every plural category', async () => {
    await changeLanguageSafely('ru');
    expect(i18n.t('com_ui_token_count', { count: 1 })).toBe('1 токен');
    expect(i18n.t('com_ui_token_count', { count: 2 })).toBe('2 токена');
    expect(i18n.t('com_ui_token_count', { count: 4 })).toBe('4 токена');
    expect(i18n.t('com_ui_token_count', { count: 5 })).toBe('5 токенов');
    expect(i18n.t('com_ui_token_count', { count: 7 })).toBe('7 токенов');
    expect(i18n.t('com_ui_token_count', { count: 11 })).toBe('11 токенов');
    expect(i18n.t('com_ui_token_count', { count: 21 })).toBe('21 токен');
    expect(i18n.t('com_ui_token_count', { count: 22 })).toBe('22 токена');
  });

  it('declines the English noun and groups large counts', async () => {
    await changeLanguageSafely('en');
    expect(i18n.t('com_ui_token_count', { count: 1 })).toBe('1 token');
    expect(i18n.t('com_ui_token_count', { count: 7 })).toBe('7 tokens');
    expect(i18n.t('com_ui_token_count', { count: 1234 })).toBe('1,234 tokens');
  });
});
