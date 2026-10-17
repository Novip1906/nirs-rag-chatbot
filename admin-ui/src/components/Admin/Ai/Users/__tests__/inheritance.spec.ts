import type { AdminDepartment, AdminLimits } from '~/api';
import {
  EMPTY_LIMITS,
  inheritedDefaultModel,
  inheritedLimits,
  inheritedModels,
} from '../inheritance';

const GLOBAL_LIMITS: AdminLimits = {
  dailyCostUsd: 1000,
};

function department(overrides: Partial<AdminDepartment> = {}): AdminDepartment {
  return {
    id: 'dept-legal',
    name: 'Legal',
    systemPrompt: '',
    allowedModels: [],
    defaultModel: null,
    defaultLimits: { ...EMPTY_LIMITS },
    directoryId: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('inheritedLimits', () => {
  it('falls back to the global defaults without a department', () => {
    expect(inheritedLimits(undefined, GLOBAL_LIMITS)).toEqual(GLOBAL_LIMITS);
  });

  /**
   * Набор отдела действует целиком, как и персональный: поле, оставленное пустым на
   * уровне отдела, означает «без ограничения», а не «взять глобальное».
   */
  it('takes the department set as a whole, not field by field', () => {
    const legal = department({ defaultLimits: { ...EMPTY_LIMITS, dailyCostUsd: 200 } });

    expect(inheritedLimits(legal, GLOBAL_LIMITS)).toEqual({
      ...EMPTY_LIMITS,
      dailyCostUsd: 200,
    });
  });

  it('answers with an all-null set when nothing is configured anywhere', () => {
    expect(inheritedLimits(undefined, undefined)).toEqual(EMPTY_LIMITS);
  });
});

describe('inheritedModels', () => {
  it('prefers the department list', () => {
    expect(inheritedModels(department({ allowedModels: ['gpt-4o'] }), ['claude'])).toEqual([
      'gpt-4o',
    ]);
  });

  /** Пустой список — «здесь не настроено», а не «ничего нельзя». */
  it('falls through an empty department list to the global one', () => {
    expect(inheritedModels(department({ allowedModels: [] }), ['claude'])).toEqual(['claude']);
  });

  it('answers with an empty list when nothing is configured', () => {
    expect(inheritedModels(undefined, undefined)).toEqual([]);
  });
});

describe('inheritedDefaultModel', () => {
  it('prefers the department default', () => {
    expect(inheritedDefaultModel(department({ defaultModel: 'gpt-4o' }), 'claude')).toBe('gpt-4o');
  });

  it('falls back to the global default', () => {
    expect(inheritedDefaultModel(department(), 'claude')).toBe('claude');
  });

  it('answers null when neither level sets one', () => {
    expect(inheritedDefaultModel(undefined, undefined)).toBeNull();
  });
});
