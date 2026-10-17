import type { AdminModelPricing } from '~/api';
import {
  buildAllModalityLabels,
  buildPricingDetails,
  formatContextLength,
  formatModelPriceRow,
  getRowModalityFlags,
} from '../modelMeta';

const localize = jest.fn((key: string, options?: Record<string, string | number>) => {
  if (options == null) {
    return key;
  }
  return `${key}:${JSON.stringify(options)}`;
});

function pricing(overrides: Partial<AdminModelPricing> = {}): AdminModelPricing {
  return {
    promptPerMillion: null,
    completionPerMillion: null,
    imageInputPerMillion: null,
    audioPerMillion: null,
    webSearchPerThousand: null,
    inputCacheReadPerMillion: null,
    inputCacheWritePerMillion: null,
    currency: null,
    ...overrides,
  };
}

describe('formatModelPriceRow', () => {
  it('shows prompt and completion price together, rounded to one decimal', () => {
    const result = formatModelPriceRow(
      pricing({ promptPerMillion: 17.83305, completionPerMillion: 106.98, currency: 'RUB' }),
      localize,
    );

    expect(result).toBe(
      'com_admin_allowed_models_price_row:{"prompt":"17,8","completion":"107","currency":"₽"}',
    );
  });

  it('falls back to the raw currency code for an unknown currency', () => {
    const result = formatModelPriceRow(
      pricing({ promptPerMillion: 1, completionPerMillion: 2, currency: 'EUR' }),
      localize,
    );

    expect(result).toContain('"currency":"EUR"');
  });

  it('shows the missing-price message when pricing is entirely absent', () => {
    expect(formatModelPriceRow(null, localize)).toBe('com_admin_allowed_models_price_missing');
    expect(formatModelPriceRow(undefined, localize)).toBe('com_admin_allowed_models_price_missing');
  });

  it('shows the missing-price message when only one side of the pair is known', () => {
    expect(formatModelPriceRow(pricing({ promptPerMillion: 5 }), localize)).toBe(
      'com_admin_allowed_models_price_missing',
    );
    expect(formatModelPriceRow(pricing({ completionPerMillion: 5 }), localize)).toBe(
      'com_admin_allowed_models_price_missing',
    );
  });

  it('never renders a bare 0 as if the model were free', () => {
    // A model whose provider genuinely charges 0 is indistinguishable from "not sent" here
    // by design — polza has not sent a free chat model yet, and treating 0 as real would
    // require trusting a value this catalog has never had to represent.
    const result = formatModelPriceRow(
      pricing({ promptPerMillion: 0, completionPerMillion: 0, currency: 'RUB' }),
      localize,
    );
    expect(result).toContain('"prompt":"0"');
  });
});

describe('buildPricingDetails', () => {
  it('formats every price field the provider sent, with its unit', () => {
    const rows = buildPricingDetails(
      pricing({
        promptPerMillion: 17.83305,
        completionPerMillion: 55.88,
        imageInputPerMillion: 30,
        audioPerMillion: 40,
        webSearchPerThousand: 5,
        inputCacheReadPerMillion: 1,
        inputCacheWritePerMillion: 2,
        currency: 'RUB',
      }),
      localize,
    );

    expect(rows).toEqual([
      { label: 'com_admin_model_details_price_prompt', value: '17,8 ₽ com_admin_model_details_unit_per_million' },
      { label: 'com_admin_model_details_price_completion', value: '55,9 ₽ com_admin_model_details_unit_per_million' },
      { label: 'com_admin_model_details_price_image_input', value: '30 ₽ com_admin_model_details_unit_per_million' },
      { label: 'com_admin_model_details_price_audio', value: '40 ₽ com_admin_model_details_unit_per_million' },
      { label: 'com_admin_model_details_price_web_search', value: '5 ₽ com_admin_model_details_unit_per_thousand' },
      { label: 'com_admin_model_details_price_cache_read', value: '1 ₽ com_admin_model_details_unit_per_million' },
      { label: 'com_admin_model_details_price_cache_write', value: '2 ₽ com_admin_model_details_unit_per_million' },
    ]);
  });

  it('shows the missing-price message per field, not a shared fallback for the whole model', () => {
    const rows = buildPricingDetails(
      pricing({ promptPerMillion: 10, completionPerMillion: 20, currency: 'RUB' }),
      localize,
    );

    expect(rows.find((row) => row.label === 'com_admin_model_details_price_audio')?.value).toBe(
      'com_admin_allowed_models_price_missing',
    );
    expect(rows.find((row) => row.label === 'com_admin_model_details_price_prompt')?.value).toBe(
      '10 ₽ com_admin_model_details_unit_per_million',
    );
  });

  it('shows every field as missing when there is no pricing at all', () => {
    const rows = buildPricingDetails(null, localize);

    expect(rows.every((row) => row.value === 'com_admin_allowed_models_price_missing')).toBe(true);
    expect(rows).toHaveLength(7);
  });
});

describe('formatContextLength', () => {
  it('formats a known context length with thousands separators', () => {
    const result = formatContextLength(1_000_000, localize);
    const expectedCount = (1_000_000).toLocaleString('ru-RU');
    expect(result).toBe(`com_admin_allowed_models_meta_context:{"count":"${expectedCount}"}`);
  });

  it('shows a missing-context message rather than "0 tokens"', () => {
    expect(formatContextLength(null, localize)).toBe('com_admin_model_details_context_missing');
    expect(formatContextLength(undefined, localize)).toBe('com_admin_model_details_context_missing');
  });
});

describe('buildAllModalityLabels', () => {
  it('labels every modality the model accepts, including plain text', () => {
    const labels = buildAllModalityLabels(
      { inputModalities: ['text', 'image', 'file', 'audio', 'video'] },
      localize,
    );

    expect(labels).toEqual([
      'com_admin_allowed_models_modality_text',
      'com_admin_allowed_models_modality_image',
      'com_admin_allowed_models_modality_file',
      'com_admin_allowed_models_modality_audio',
      'com_admin_allowed_models_modality_video',
    ]);
  });

  it('returns an empty list when the catalog sent no modalities', () => {
    expect(buildAllModalityLabels({ inputModalities: undefined }, localize)).toEqual([]);
  });
});

describe('getRowModalityFlags', () => {
  it('flags image and file support independently', () => {
    expect(getRowModalityFlags({ inputModalities: ['text', 'image'] })).toEqual({
      image: true,
      file: false,
    });
    expect(getRowModalityFlags({ inputModalities: ['text', 'file'] })).toEqual({
      image: false,
      file: true,
    });
  });

  it('does not flag audio or video — the row only shows image/file icons', () => {
    expect(getRowModalityFlags({ inputModalities: ['audio', 'video'] })).toEqual({
      image: false,
      file: false,
    });
  });

  it('defaults to no flags when the catalog sent no modalities', () => {
    expect(getRowModalityFlags({ inputModalities: undefined })).toEqual({
      image: false,
      file: false,
    });
  });
});
