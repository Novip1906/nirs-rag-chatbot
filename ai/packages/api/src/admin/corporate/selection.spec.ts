import { validateModelSelection } from './selection';

const NO_CURRENT = { allowedModels: null, defaultModel: null };

describe('validateModelSelection', () => {
  it('ничего не трогает, когда в теле нет ни списка, ни дефолта', () => {
    const result = validateModelSelection({}, { allowedModels: ['a'], defaultModel: 'a' });
    expect(result).toEqual({ ok: true, fields: {} });
  });

  it('принимает согласованную пару', () => {
    const result = validateModelSelection(
      { allowedModels: ['a', 'b'], defaultModel: 'b' },
      NO_CURRENT,
    );
    expect(result).toEqual({ ok: true, fields: { allowedModels: ['a', 'b'], defaultModel: 'b' } });
  });

  it('требует дефолт, когда список непустой', () => {
    const result = validateModelSelection({ allowedModels: ['a', 'b'] }, NO_CURRENT);
    expect(result).toEqual({
      ok: false,
      error: 'defaultModel is required when allowedModels is not empty',
    });
  });

  it('отклоняет дефолт вне списка', () => {
    const result = validateModelSelection(
      { allowedModels: ['a', 'b'], defaultModel: 'c' },
      NO_CURRENT,
    );
    expect(result).toEqual({ ok: false, error: 'defaultModel must be one of allowedModels' });
  });

  it('проверяет дефолт из тела против списка, лежащего в базе', () => {
    const result = validateModelSelection(
      { defaultModel: 'b' },
      { allowedModels: ['a'], defaultModel: 'a' },
    );
    expect(result).toEqual({ ok: false, error: 'defaultModel must be one of allowedModels' });
  });

  it('проверяет список из тела против дефолта, лежащего в базе', () => {
    const result = validateModelSelection(
      { allowedModels: ['a', 'b'] },
      { allowedModels: ['a', 'b', 'c'], defaultModel: 'c' },
    );
    expect(result).toEqual({ ok: false, error: 'defaultModel must be one of allowedModels' });
  });

  it('очищает дефолт, когда список опустошили', () => {
    const result = validateModelSelection(
      { allowedModels: [] },
      { allowedModels: ['a'], defaultModel: 'a' },
    );
    expect(result).toEqual({ ok: true, fields: { allowedModels: [], defaultModel: null } });
  });

  it('очищает дефолт, когда персональный список сбросили в null', () => {
    const result = validateModelSelection(
      { allowedModels: null },
      { allowedModels: ['a'], defaultModel: 'a' },
    );
    expect(result).toEqual({ ok: true, fields: { allowedModels: null, defaultModel: null } });
  });

  it('трактует пустую строку как отсутствие дефолта', () => {
    const result = validateModelSelection({ allowedModels: ['a'], defaultModel: '' }, NO_CURRENT);
    expect(result).toEqual({
      ok: false,
      error: 'defaultModel is required when allowedModels is not empty',
    });
  });

  it('отклоняет нестроковые элементы списка', () => {
    const result = validateModelSelection(
      { allowedModels: ['a', ''], defaultModel: 'a' },
      NO_CURRENT,
    );
    expect(result).toEqual({
      ok: false,
      error: 'allowedModels must be an array of non-empty strings',
    });
  });
});
