import { validateModelCapabilities } from './modelCapabilitiesValidation';

describe('validateModelCapabilities', () => {
  it('accepts a valid map', () => {
    const result = validateModelCapabilities({
      'openai/gpt-5.2': { knowledgeBase: true, webSearch: false },
    });
    expect(result).toEqual({
      ok: true,
      capabilities: { 'openai/gpt-5.2': { knowledgeBase: true, webSearch: false } },
    });
  });

  it('accepts an empty map', () => {
    expect(validateModelCapabilities({})).toEqual({ ok: true, capabilities: {} });
  });

  it('accepts a partial flag set for one model', () => {
    const result = validateModelCapabilities({ 'a/b': { webSearch: false } });
    expect(result).toEqual({ ok: true, capabilities: { 'a/b': { webSearch: false } } });
  });

  it('rejects a payload that is neither a map nor a list', () => {
    expect(validateModelCapabilities('nope').ok).toBe(false);
    expect(validateModelCapabilities(null).ok).toBe(false);
    expect(validateModelCapabilities(42).ok).toBe(false);
  });

  it('rejects a non-object value for a model entry', () => {
    expect(validateModelCapabilities({ 'a/b': true }).ok).toBe(false);
  });

  it('rejects an unknown capability field', () => {
    const result = validateModelCapabilities({ 'a/b': { imageGen: true } });
    expect(result).toEqual({ ok: false, error: 'Unknown capability field: imageGen' });
  });

  it('rejects a non-boolean flag value', () => {
    expect(validateModelCapabilities({ 'a/b': { knowledgeBase: 'yes' } }).ok).toBe(false);
  });

  it('rejects an empty-string model id', () => {
    expect(validateModelCapabilities({ '': { knowledgeBase: true } }).ok).toBe(false);
  });

  it('accepts label and description overrides alongside flags', () => {
    const result = validateModelCapabilities({
      'openai/gpt-5.2': {
        knowledgeBase: true,
        label: 'GPT для отчётов',
        description: 'Быстрая модель для аналитики',
      },
    });
    expect(result).toEqual({
      ok: true,
      capabilities: {
        'openai/gpt-5.2': {
          knowledgeBase: true,
          label: 'GPT для отчётов',
          description: 'Быстрая модель для аналитики',
        },
      },
    });
  });

  it('trims label and description before storing', () => {
    const result = validateModelCapabilities({ 'a/b': { label: '  Моя модель  ' } });
    expect(result).toEqual({ ok: true, capabilities: { 'a/b': { label: 'Моя модель' } } });
  });

  it('drops an empty-string override instead of storing it', () => {
    const result = validateModelCapabilities({ 'a/b': { label: '   ', description: '' } });
    expect(result).toEqual({ ok: true, capabilities: { 'a/b': {} } });
  });

  it('rejects a non-string override value', () => {
    expect(validateModelCapabilities({ 'a/b': { label: 123 } }).ok).toBe(false);
  });

  it('rejects a label longer than 80 characters', () => {
    const result = validateModelCapabilities({ 'a/b': { label: 'x'.repeat(81) } });
    expect(result).toEqual({
      ok: false,
      error: 'Название модели "a/b" не должно превышать 80 символов',
    });
  });

  it('rejects a description longer than 300 characters', () => {
    const result = validateModelCapabilities({ 'a/b': { description: 'x'.repeat(301) } });
    expect(result).toEqual({
      ok: false,
      error: 'Описание модели "a/b" не должно превышать 300 символов',
    });
  });

  it('accepts a label at exactly the 80-character limit', () => {
    const label = 'x'.repeat(80);
    expect(validateModelCapabilities({ 'a/b': { label } })).toEqual({
      ok: true,
      capabilities: { 'a/b': { label } },
    });
  });

  /**
   * Списком приходит настоящая админка: идентификатор модели в ключе объекта не доезжает
   * до сервера — защита от инъекций вырезает из тела запроса ключи с точкой, а она есть
   * почти в каждом идентификаторе модели.
   */
  describe('список записей', () => {
    it('принимает список и собирает из него карту', () => {
      const result = validateModelCapabilities([
        { modelId: 'openai/gpt-5.6-luna', knowledgeBase: true, description: 'Быстрая' },
        { modelId: 'google/gemini-3.7-flash', webSearch: false },
      ]);

      expect(result).toEqual({
        ok: true,
        capabilities: {
          'openai/gpt-5.6-luna': { knowledgeBase: true, description: 'Быстрая' },
          'google/gemini-3.7-flash': { webSearch: false },
        },
      });
    });

    it('не теряет модели с точкой в идентификаторе', () => {
      const result = validateModelCapabilities([
        { modelId: 'openai/gpt-5.6-luna', description: 'A' },
        { modelId: 'anthropic/claude-sonnet-5', description: 'B' },
        { modelId: 'google/gemini-3.7-flash', description: 'C' },
      ]);

      expect(result.ok).toBe(true);
      expect(result.ok === true && Object.keys(result.capabilities)).toEqual([
        'openai/gpt-5.6-luna',
        'anthropic/claude-sonnet-5',
        'google/gemini-3.7-flash',
      ]);
    });

    it('принимает пустой список', () => {
      expect(validateModelCapabilities([])).toEqual({ ok: true, capabilities: {} });
    });

    it('отвергает запись без идентификатора модели', () => {
      const result = validateModelCapabilities([{ knowledgeBase: true }]);

      expect(result.ok).toBe(false);
    });

    it('отвергает список, в котором запись не объект', () => {
      expect(validateModelCapabilities(['openai/gpt-5.6-luna']).ok).toBe(false);
    });
  });
});
