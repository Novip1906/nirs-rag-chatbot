import { renderHook } from '@testing-library/react';
import type { TModelSpec, TStartupConfig, TTokenConfigMap } from 'librechat-data-provider';

let mockStartupConfig: Partial<TStartupConfig> | undefined;
let mockTokenConfig: TTokenConfigMap | undefined;
let mockConversation: { spec?: string | null } | null = null;

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: jest.fn(() => ({ data: mockStartupConfig })),
  useTokenConfigQuery: jest.fn(() => ({ data: mockTokenConfig })),
}));

jest.mock('~/Providers/ChatContext', () => ({
  useChatContext: jest.fn(() => ({ conversation: mockConversation })),
}));

const makeSpec = (name: string, label: string, preset: TModelSpec['preset']): TModelSpec => ({
  name,
  label,
  preset,
});

describe('useModelSuggestion', () => {
  beforeEach(() => {
    mockStartupConfig = undefined;
    mockTokenConfig = undefined;
    mockConversation = null;
  });

  const loadHook = async () => (await import('../useModelSuggestion')).default;

  it('takes the context straight from preset.maxContextTokens when set', async () => {
    mockStartupConfig = {
      modelSpecs: {
        list: [
          makeSpec('luna', 'Luna', {
            endpoint: 'openAI',
            maxContextTokens: 1000000,
          } as TModelSpec['preset']),
        ],
      },
    } as Partial<TStartupConfig>;
    mockConversation = { spec: 'current' };

    const useModelSuggestion = await loadHook();
    const { result } = renderHook(() => useModelSuggestion(900000));

    expect(result.current?.name).toBe('luna');
  });

  it('falls back to the token config context when the preset has none', async () => {
    mockStartupConfig = {
      modelSpecs: {
        list: [
          makeSpec('luna', 'Luna', {
            endpoint: 'openAI',
            model: 'gpt-5.6-luna',
          } as TModelSpec['preset']),
        ],
      },
    } as Partial<TStartupConfig>;
    mockTokenConfig = { openAI: { 'gpt-5.6-luna': { context: 1050000 } } };
    mockConversation = { spec: 'current' };

    const useModelSuggestion = await loadHook();
    const { result } = renderHook(() => useModelSuggestion(900000));

    expect(result.current?.name).toBe('luna');
  });

  it('normalizes a vertexai preset endpoint to google before the token-config lookup', async () => {
    mockStartupConfig = {
      modelSpecs: {
        list: [
          makeSpec('gemini', 'Gemini', {
            endpoint: 'vertexai',
            model: 'gemini-3-pro',
          } as TModelSpec['preset']),
        ],
      },
    } as Partial<TStartupConfig>;
    mockTokenConfig = { google: { 'gemini-3-pro': { context: 1000000 } } };
    mockConversation = { spec: 'current' };

    const useModelSuggestion = await loadHook();
    const { result } = renderHook(() => useModelSuggestion(900000));

    expect(result.current?.name).toBe('gemini');
  });

  it('never suggests the conversation own spec', async () => {
    mockStartupConfig = {
      modelSpecs: {
        list: [
          makeSpec('current', 'Current', {
            endpoint: 'openAI',
            maxContextTokens: 1000000,
          } as TModelSpec['preset']),
        ],
      },
    } as Partial<TStartupConfig>;
    mockConversation = { spec: 'current' };

    const useModelSuggestion = await loadHook();
    const { result } = renderHook(() => useModelSuggestion(900000));

    expect(result.current).toBeNull();
  });

  it('returns null when no spec has enough context', async () => {
    mockStartupConfig = {
      modelSpecs: {
        list: [
          makeSpec('luna', 'Luna', {
            endpoint: 'openAI',
            maxContextTokens: 1000000,
          } as TModelSpec['preset']),
        ],
      },
    } as Partial<TStartupConfig>;
    mockConversation = { spec: 'current' };

    const useModelSuggestion = await loadHook();
    const { result } = renderHook(() => useModelSuggestion(2000000));

    expect(result.current).toBeNull();
  });
});
