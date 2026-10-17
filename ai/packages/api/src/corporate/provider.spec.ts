import type { TSpecsConfig } from 'librechat-data-provider';
import {
  AI_PROVIDERS,
  convertToUsd,
  getRubPerUsd,
  getActiveProvider,
  findProviderByBaseUrl,
  applyActiveAiEndpoint,
  DEFAULT_RUB_PER_USD,
  findProviderByEndpointName,
  ACTIVE_ENDPOINT_PLACEHOLDER,
} from './provider';

const ENV_KEYS = ['AI_PROVIDER', 'RUB_PER_USD', 'AI_BASE_URL', 'OPENROUTER_BASE_URL'] as const;

describe('реестр провайдеров', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  describe('getActiveProvider', () => {
    it('без AI_PROVIDER остаётся на openrouter', () => {
      expect(getActiveProvider().id).toBe('openrouter');
    });

    it('выбирает polza и не зависит от регистра и пробелов', () => {
      process.env.AI_PROVIDER = '  Polza ';
      expect(getActiveProvider().id).toBe('polza');
      expect(getActiveProvider().endpointName).toBe('Corporate AI');
    });

    it('на неизвестном значении откатывается к openrouter, а не падает', () => {
      process.env.AI_PROVIDER = 'togetherai';
      expect(getActiveProvider().id).toBe('openrouter');
    });
  });

  describe('getRubPerUsd', () => {
    it('берёт курс по умолчанию, когда переменной нет', () => {
      expect(getRubPerUsd()).toBe(DEFAULT_RUB_PER_USD);
    });

    it('берёт курс из переменной', () => {
      process.env.RUB_PER_USD = '90.5';
      expect(getRubPerUsd()).toBe(90.5);
    });

    it.each(['не число', '0', '-10'])('игнорирует негодное значение %p', (value) => {
      process.env.RUB_PER_USD = value;
      expect(getRubPerUsd()).toBe(DEFAULT_RUB_PER_USD);
    });
  });

  describe('convertToUsd', () => {
    it('оставляет доллары как есть', () => {
      expect(convertToUsd(1.25, 'USD')).toBe(1.25);
    });

    it('делит рубли на курс', () => {
      process.env.RUB_PER_USD = '80';
      expect(convertToUsd(160, 'RUB')).toBe(2);
    });
  });

  describe('findProviderByBaseUrl', () => {
    beforeEach(() => {
      process.env.AI_BASE_URL = 'https://polza.ai/api/v1';
      process.env.OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
    });

    it('находит провайдера, не спотыкаясь о хвостовой слэш', () => {
      expect(findProviderByBaseUrl('https://polza.ai/api/v1/')?.id).toBe('polza');
      expect(findProviderByBaseUrl('https://openrouter.ai/api/v1')?.id).toBe('openrouter');
    });

    it('возвращает undefined для чужого адреса', () => {
      expect(findProviderByBaseUrl('https://api.together.xyz/v1')).toBeUndefined();
    });

    it('не считает своим адрес провайдера, чья переменная не задана', () => {
      delete process.env.AI_BASE_URL;
      expect(findProviderByBaseUrl('https://polza.ai/api/v1')).toBeUndefined();
    });
  });

  describe('findProviderByEndpointName', () => {
    it('находит провайдера по имени эндпоинта из librechat.yaml', () => {
      expect(findProviderByEndpointName('Corporate AI')?.id).toBe('polza');
      expect(findProviderByEndpointName('OpenRouter')?.id).toBe('openrouter');
      expect(findProviderByEndpointName('Unknown')).toBeUndefined();
    });
  });

  describe('applyActiveAiEndpoint', () => {
    function makeSpecs(): TSpecsConfig {
      return {
        list: [
          {
            name: 'flash',
            label: 'Flash',
            preset: { endpoint: ACTIVE_ENDPOINT_PLACEHOLDER, model: 'google/gemini-3.5-flash' },
          },
          {
            name: 'legacy',
            label: 'Legacy',
            preset: { endpoint: 'OpenRouter', model: 'openai/gpt-5.2' },
          },
        ],
      } as TSpecsConfig;
    }

    it('подставляет эндпоинт активного провайдера вместо метки', () => {
      process.env.AI_PROVIDER = 'polza';
      const specs = applyActiveAiEndpoint(makeSpecs());
      expect(specs?.list[0].preset.endpoint).toBe('Corporate AI');
    });

    it('не трогает спеки с явно заданным эндпоинтом', () => {
      process.env.AI_PROVIDER = 'polza';
      const specs = applyActiveAiEndpoint(makeSpecs());
      expect(specs?.list[1].preset.endpoint).toBe('OpenRouter');
    });

    it('переживает отсутствие спек', () => {
      expect(applyActiveAiEndpoint(undefined)).toBeUndefined();
      expect(applyActiveAiEndpoint(null)).toBeNull();
    });
  });

  it('каждый провайдер объявляет своё имя эндпоинта и переменные окружения', () => {
    const endpointNames = Object.values(AI_PROVIDERS).map((provider) => provider.endpointName);
    expect(new Set(endpointNames).size).toBe(endpointNames.length);
    for (const provider of Object.values(AI_PROVIDERS)) {
      expect(provider.baseUrlEnv).toBeTruthy();
      expect(provider.apiKeyEnv).toBeTruthy();
      expect(provider.usageCostFields.length).toBeGreaterThan(0);
    }
  });

  describe('parseBalance', () => {
    it('openrouter: остаток — разница между кредитами и тратой', () => {
      expect(
        AI_PROVIDERS.openrouter.parseBalance({
          data: { total_credits: 25, total_usage: 4.5 },
        }),
      ).toBe(20.5);
    });

    it('openrouter: без числовых итогов остатка нет', () => {
      expect(AI_PROVIDERS.openrouter.parseBalance({ data: { total_credits: 25 } })).toBeNull();
      expect(AI_PROVIDERS.openrouter.parseBalance({ amount: 10 })).toBeNull();
    });

    it('polza: остаток берётся из amount, в том числе строкой', () => {
      expect(AI_PROVIDERS.polza.parseBalance({ amount: '251.06936125' })).toBeCloseTo(251.06936125);
      expect(AI_PROVIDERS.polza.parseBalance({ reservedAmount: '0' })).toBeNull();
      expect(AI_PROVIDERS.polza.parseBalance(null)).toBeNull();
    });
  });
});
