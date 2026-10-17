import { renderHook } from '@testing-library/react';
import type { TModelSpec } from 'librechat-data-provider';
import useSpecFallback, { resolveFallbackSpec } from '../useSpecFallback';

function makeSpec(name: string, model: string, flags: Partial<TModelSpec> = {}): TModelSpec {
  return {
    name,
    label: name,
    preset: { endpoint: 'polza', model },
    ...flags,
  } as TModelSpec;
}

const haiku = makeSpec('haiku', 'claude-haiku', { default: true });
const flash = makeSpec('flash', 'gemini-flash');
const specs = [flash, haiku];

describe('resolveFallbackSpec', () => {
  it('не трогает беседу, спек которой доступен', () => {
    expect(resolveFallbackSpec(specs, { endpoint: 'polza', spec: 'flash' }, true)).toBeNull();
  });

  it('подставляет дефолт, когда спек беседы недоступен', () => {
    expect(resolveFallbackSpec(specs, { endpoint: 'polza', spec: 'gpt' }, true)).toBe(haiku);
  });

  it('подставляет дефолт по модели беседы без спека при enforce', () => {
    expect(
      resolveFallbackSpec(specs, { endpoint: 'polza', model: 'gemini-flash' }, true),
    ).toBeNull();
    expect(resolveFallbackSpec(specs, { endpoint: 'polza', model: 'gpt-5' }, true)).toBe(haiku);
  });

  it('не судит по модели, когда спеки не обязательны', () => {
    expect(resolveFallbackSpec(specs, { endpoint: 'polza', model: 'gpt-5' }, false)).toBeNull();
  });

  it('обходит стороной агентов и ассистентов', () => {
    expect(resolveFallbackSpec(specs, { endpoint: 'agents', spec: 'gpt' }, true)).toBeNull();
    expect(resolveFallbackSpec(specs, { endpoint: 'assistants', spec: 'gpt' }, true)).toBeNull();
  });

  it('молчит, пока каталог спеков не загружен', () => {
    expect(resolveFallbackSpec([], { endpoint: 'polza', spec: 'gpt' }, true)).toBeNull();
  });

  it('падает на мягкий дефолт, затем на первый спек', () => {
    const soft = makeSpec('soft', 'soft-model', { softDefault: true });
    expect(resolveFallbackSpec([flash, soft], { endpoint: 'polza', spec: 'gpt' }, true)).toBe(soft);
    expect(resolveFallbackSpec([flash], { endpoint: 'polza', spec: 'gpt' }, true)).toBe(flash);
  });
});

describe('useSpecFallback', () => {
  it('применяет дефолт один раз на один недоступный выбор', () => {
    const selectSpec = jest.fn();
    const { rerender } = renderHook(() =>
      useSpecFallback({
        modelSpecs: specs,
        enforced: true,
        selection: { endpoint: 'polza', spec: 'gpt', model: 'gpt-5' },
        selectSpec,
      }),
    );

    rerender();

    expect(selectSpec).toHaveBeenCalledTimes(1);
    expect(selectSpec).toHaveBeenCalledWith(haiku);
  });

  it('ждёт загрузки беседы', () => {
    const selectSpec = jest.fn();
    renderHook(() =>
      useSpecFallback({
        modelSpecs: specs,
        enforced: true,
        selection: { endpoint: null, spec: 'gpt' },
        selectSpec,
      }),
    );

    expect(selectSpec).not.toHaveBeenCalled();
  });
});
