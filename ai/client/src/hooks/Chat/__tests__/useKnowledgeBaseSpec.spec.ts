import { renderHook } from '@testing-library/react';
import type { TConversation, TStartupConfig, TModelSpec } from 'librechat-data-provider';
import useKnowledgeBaseSpec from '../useKnowledgeBaseSpec';

let mockConversation: Partial<TConversation> | null;
let mockStartupConfig: Partial<TStartupConfig> | undefined;

jest.mock('~/Providers', () => ({
  useChatContext: () => ({ conversation: mockConversation }),
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: mockStartupConfig }),
}));

function buildStartupConfig(specs: Array<Pick<TModelSpec, 'name'> & Partial<TModelSpec>>) {
  const list: TModelSpec[] = specs.map((spec) => ({
    label: spec.name,
    preset: {},
    ...spec,
  }));
  return {
    modelSpecs: { list, enforce: false, prioritize: false },
  } as Partial<TStartupConfig>;
}

describe('useKnowledgeBaseSpec', () => {
  beforeEach(() => {
    mockConversation = null;
    mockStartupConfig = undefined;
  });

  it('returns false when no spec is active on the conversation', () => {
    mockConversation = { spec: null };
    mockStartupConfig = buildStartupConfig([{ name: 'gemini-flash-lite', knowledgeBase: true }]);

    const { result } = renderHook(() => useKnowledgeBaseSpec());
    expect(result.current).toBe(false);
  });

  it('returns false when the active spec has no knowledge base', () => {
    mockConversation = { spec: 'gemini-flash-lite' };
    mockStartupConfig = buildStartupConfig([{ name: 'gemini-flash-lite' }]);

    const { result } = renderHook(() => useKnowledgeBaseSpec());
    expect(result.current).toBe(false);
  });

  it('returns true when the active spec has knowledgeBase enabled', () => {
    mockConversation = { spec: 'corporate-assistant' };
    mockStartupConfig = buildStartupConfig([{ name: 'corporate-assistant', knowledgeBase: true }]);

    const { result } = renderHook(() => useKnowledgeBaseSpec());
    expect(result.current).toBe(true);
  });

  it('returns false when startup config has not loaded yet', () => {
    mockConversation = { spec: 'corporate-assistant' };
    mockStartupConfig = undefined;

    const { result } = renderHook(() => useKnowledgeBaseSpec());
    expect(result.current).toBe(false);
  });
});
