import { renderHook } from '@testing-library/react';
import { useModelLabel, useModelLabelList } from '../modelLabels';

const mockUseAdminModelsQuery = jest.fn();

jest.mock('~/data-provider/Admin', () => ({
  useAdminModelsQuery: (config?: unknown) => mockUseAdminModelsQuery(config),
}));

describe('useModelLabel', () => {
  beforeEach(() => {
    mockUseAdminModelsQuery.mockReturnValue({
      data: [
        { id: 'gpt-4o', label: 'GPT-4o', description: '' },
        { id: 'google/gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite', description: '' },
      ],
    });
  });

  it('returns the catalog label for a model id present in the catalog', () => {
    const { result } = renderHook(() => useModelLabel());
    expect(result.current('gpt-4o')).toBe('GPT-4o');
    expect(result.current('google/gemini-3.5-flash-lite')).toBe('Gemini 3.5 Flash Lite');
  });

  /**
   * A model can be dropped from the config while still referenced by someone's saved
   * policy. Hiding it would leave the admin unable to tell what is actually recorded.
   */
  it('falls back to the raw id for a model missing from the catalog', () => {
    const { result } = renderHook(() => useModelLabel());
    expect(result.current('some-removed-model')).toBe('some-removed-model');
  });
});

describe('useModelLabelList', () => {
  beforeEach(() => {
    mockUseAdminModelsQuery.mockReturnValue({
      data: [
        { id: 'gpt-4o', label: 'GPT-4o', description: '' },
        { id: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet', description: '' },
      ],
    });
  });

  it('joins resolved labels with ", "', () => {
    const { result } = renderHook(() => useModelLabelList());
    expect(result.current(['gpt-4o', 'claude-3-5-sonnet'])).toBe('GPT-4o, Claude 3.5 Sonnet');
  });

  it('mixes resolved labels and raw ids when some models are unknown', () => {
    const { result } = renderHook(() => useModelLabelList());
    expect(result.current(['gpt-4o', 'unknown-model'])).toBe('GPT-4o, unknown-model');
  });

  it('returns an empty string for an empty id list', () => {
    const { result } = renderHook(() => useModelLabelList());
    expect(result.current([])).toBe('');
  });
});

describe('useModelLabel — access gating', () => {
  beforeEach(() => {
    mockUseAdminModelsQuery.mockReset();
    mockUseAdminModelsQuery.mockReturnValue({ data: undefined });
  });

  it('head does not request models', () => {
    const { result } = renderHook(() => useModelLabel(false));
    expect(mockUseAdminModelsQuery).toHaveBeenCalledWith({ enabled: false });
    expect(result.current('gpt-4o')).toBe('gpt-4o');
  });

  it('requests models by default', () => {
    renderHook(() => useModelLabel());
    expect(mockUseAdminModelsQuery).toHaveBeenCalledWith({ enabled: true });
  });
});
