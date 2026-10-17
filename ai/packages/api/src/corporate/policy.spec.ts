import type { ResolvePolicyDeps } from './policy';

import { resolvePolicy } from './policy';

const emptyLimits = {
  dailyCostUsd: null,
};

function makeDeps(overrides: Partial<ResolvePolicyDeps> = {}): ResolvePolicyDeps {
  return {
    getGlobalSettings: async () => ({
      systemPrompt: 'Глобальный промпт',
      allowedModels: ['google/gemini-3.5-flash-lite'],
      defaultModel: null,
      defaultLimits: { ...emptyLimits, dailyCostUsd: 100 },
    }),
    getUserPolicy: async () => null,
    getDepartmentById: async () => null,
    ...overrides,
  };
}

describe('resolvePolicy', () => {
  it('берёт всё с глобального уровня, когда у пользователя нет политики', async () => {
    const policy = await resolvePolicy(makeDeps(), 'user-1');

    expect(policy.departmentId).toBeNull();
    expect(policy.systemPrompt).toBe('Глобальный промпт');
    expect(policy.allowedModels).toEqual(['google/gemini-3.5-flash-lite']);
    expect(policy.limits.dailyCostUsd).toBe(100);
    expect(policy.blocked).toBe(false);
  });

  it('берёт modelCapabilities с глобального уровня', async () => {
    const deps = makeDeps({
      getGlobalSettings: async () => ({
        systemPrompt: '',
        allowedModels: [],
        defaultModel: null,
        defaultLimits: emptyLimits,
        modelCapabilities: { 'openai/gpt-5.2': { knowledgeBase: false } },
      }),
    });

    const policy = await resolvePolicy(deps, 'user-1');

    expect(policy.modelCapabilities).toEqual({ 'openai/gpt-5.2': { knowledgeBase: false } });
  });

  it('отдаёт пустую карту modelCapabilities, когда глобальные настройки её не задали', async () => {
    const policy = await resolvePolicy(makeDeps(), 'user-1');

    expect(policy.modelCapabilities).toEqual({});
  });

  it('перекрывает лимиты и список моделей отделом, а промпт отдела добавляет к глобальному', async () => {
    const deps = makeDeps({
      getUserPolicy: async () => ({
        departmentId: 'dep-1',
        limits: null,
        allowedModels: null,
        defaultModel: null,
        blocked: false,
      }),
      getDepartmentById: async () => ({
        systemPrompt: 'Промпт юристов',
        allowedModels: ['anthropic/claude-haiku-4.5'],
        defaultModel: null,
        defaultLimits: { ...emptyLimits, dailyCostUsd: 500 },
      }),
    });

    const policy = await resolvePolicy(deps, 'user-1');

    expect(policy.systemPrompt).toBe('Глобальный промпт\n\nПромпт юристов');
    expect(policy.allowedModels).toEqual(['anthropic/claude-haiku-4.5']);
    expect(policy.limits.dailyCostUsd).toBe(500);
  });

  it('пропускает пустой глобальный промпт при склейке, не оставляя пустую строку спереди', async () => {
    const deps = makeDeps({
      getGlobalSettings: async () => ({
        systemPrompt: '',
        allowedModels: ['google/gemini-3.5-flash-lite'],
        defaultModel: null,
        defaultLimits: emptyLimits,
      }),
      getUserPolicy: async () => ({
        departmentId: 'dep-1',
        limits: null,
        allowedModels: null,
        defaultModel: null,
        blocked: false,
      }),
      getDepartmentById: async () => ({
        systemPrompt: 'Промпт юристов',
        allowedModels: [],
        defaultModel: null,
        defaultLimits: emptyLimits,
      }),
    });

    const policy = await resolvePolicy(deps, 'user-1');

    expect(policy.systemPrompt).toBe('Промпт юристов');
  });

  /**
   * Персональный набор действует целиком: в кабинете им управляет один переключатель,
   * и пустое поле рядом с ним означает «без ограничения». Если бы незаполненное поле
   * возвращало лимит отдела, снять его через интерфейс было бы невозможно.
   */
  it('перекрывает лимит отдела персональным значением', async () => {
    const deps = makeDeps({
      getUserPolicy: async () => ({
        departmentId: 'dep-1',
        limits: { dailyCostUsd: 50 },
        allowedModels: null,
        defaultModel: null,
        blocked: false,
      }),
      getDepartmentById: async () => ({
        systemPrompt: '',
        allowedModels: [],
        defaultModel: null,
        defaultLimits: { ...emptyLimits, dailyCostUsd: 500 },
      }),
    });

    const policy = await resolvePolicy(deps, 'user-1');

    expect(policy.limits.dailyCostUsd).toBe(50);
  });

  it('наследует лимит отдела, когда персонального нет', async () => {
    const deps = makeDeps({
      getUserPolicy: async () => ({
        departmentId: 'dep-1',
        limits: null,
        allowedModels: null,
        defaultModel: null,
        blocked: false,
      }),
      getDepartmentById: async () => ({
        systemPrompt: '',
        allowedModels: [],
        defaultModel: null,
        defaultLimits: { ...emptyLimits, dailyCostUsd: 500 },
      }),
    });

    const policy = await resolvePolicy(deps, 'user-1');

    expect(policy.limits.dailyCostUsd).toBe(500);
  });

  it('сужает список моделей персональным перекрытием, а не расширяет', async () => {
    const deps = makeDeps({
      getUserPolicy: async () => ({
        departmentId: 'dep-1',
        limits: null,
        allowedModels: ['google/gemini-3.5-flash'],
        defaultModel: null,
        blocked: false,
      }),
      getDepartmentById: async () => ({
        systemPrompt: '',
        allowedModels: ['anthropic/claude-haiku-4.5', 'google/gemini-3.5-flash'],
        defaultModel: null,
        defaultLimits: emptyLimits,
      }),
    });

    const policy = await resolvePolicy(deps, 'user-1');

    expect(policy.allowedModels).toEqual(['google/gemini-3.5-flash']);
  });

  it('оставляет глобальный промпт, когда у отдела он пустой', async () => {
    const deps = makeDeps({
      getUserPolicy: async () => ({
        departmentId: 'dep-1',
        limits: null,
        allowedModels: null,
        defaultModel: null,
        blocked: false,
      }),
      getDepartmentById: async () => ({
        systemPrompt: '',
        allowedModels: [],
        defaultModel: null,
        defaultLimits: emptyLimits,
      }),
    });

    const policy = await resolvePolicy(deps, 'user-1');

    expect(policy.systemPrompt).toBe('Глобальный промпт');
  });

  it('переносит признак блокировки пользователя', async () => {
    const deps = makeDeps({
      getUserPolicy: async () => ({
        departmentId: null,
        limits: null,
        allowedModels: null,
        defaultModel: null,
        blocked: true,
      }),
    });

    const policy = await resolvePolicy(deps, 'user-1');

    expect(policy.blocked).toBe(true);
  });

  it('обнуляет departmentId, когда отдел не разрешился (отвязан или удалён)', async () => {
    const deps = makeDeps({
      getUserPolicy: async () => ({
        departmentId: 'dep-1',
        limits: null,
        allowedModels: null,
        defaultModel: null,
        blocked: false,
      }),
      getDepartmentById: async () => null,
    });

    const policy = await resolvePolicy(deps, 'user-1');

    expect(policy.departmentId).toBeNull();
    expect(policy.systemPrompt).toBe('Глобальный промпт');
    expect(policy.allowedModels).toEqual(['google/gemini-3.5-flash-lite']);
  });

  it('пустой список моделей у пользователя наследуется дальше, а не запрещает всё', async () => {
    const deps = makeDeps({
      getUserPolicy: async () => ({
        departmentId: 'dep-1',
        limits: null,
        allowedModels: [],
        defaultModel: null,
        blocked: false,
      }),
      getDepartmentById: async () => ({
        systemPrompt: '',
        allowedModels: ['anthropic/claude-haiku-4.5'],
        defaultModel: null,
        defaultLimits: emptyLimits,
      }),
    });

    const policy = await resolvePolicy(deps, 'user-1');

    expect(policy.allowedModels).toEqual(['anthropic/claude-haiku-4.5']);
  });

  it('непустой список моделей у пользователя перекрывает отдел целиком', async () => {
    const deps = makeDeps({
      getUserPolicy: async () => ({
        departmentId: 'dep-1',
        limits: null,
        allowedModels: ['anthropic/claude-haiku-4.5'],
        defaultModel: null,
        blocked: false,
      }),
      getDepartmentById: async () => ({
        systemPrompt: '',
        allowedModels: ['google/gemini-3.5-flash', 'google/gemini-3.5-flash-lite'],
        defaultModel: null,
        defaultLimits: emptyLimits,
      }),
    });

    const policy = await resolvePolicy(deps, 'user-1');

    expect(policy.allowedModels).toEqual(['anthropic/claude-haiku-4.5']);
  });

  it('непустой список моделей у отдела перекрывает глобальный целиком', async () => {
    const deps = makeDeps({
      getUserPolicy: async () => ({
        departmentId: 'dep-1',
        limits: null,
        allowedModels: null,
        defaultModel: null,
        blocked: false,
      }),
      getDepartmentById: async () => ({
        systemPrompt: '',
        allowedModels: ['anthropic/claude-haiku-4.5'],
        defaultModel: null,
        defaultLimits: emptyLimits,
      }),
    });

    const policy = await resolvePolicy(deps, 'user-1');

    expect(policy.allowedModels).toEqual(['anthropic/claude-haiku-4.5']);
  });

  it('пустой список моделей и у пользователя, и у отдела откатывается на глобальный', async () => {
    const deps = makeDeps({
      getUserPolicy: async () => ({
        departmentId: 'dep-1',
        limits: null,
        allowedModels: [],
        defaultModel: null,
        blocked: false,
      }),
      getDepartmentById: async () => ({
        systemPrompt: '',
        allowedModels: [],
        defaultModel: null,
        defaultLimits: emptyLimits,
      }),
    });

    const policy = await resolvePolicy(deps, 'user-1');

    expect(policy.allowedModels).toEqual(['google/gemini-3.5-flash-lite']);
  });

  it('пусто на всех трёх уровнях — валидное состояние «без ограничений», а не запрет', async () => {
    const deps = makeDeps({
      getGlobalSettings: async () => ({
        systemPrompt: 'Глобальный промпт',
        allowedModels: [],
        defaultModel: null,
        defaultLimits: emptyLimits,
      }),
      getUserPolicy: async () => ({
        departmentId: 'dep-1',
        limits: null,
        allowedModels: [],
        defaultModel: null,
        blocked: false,
      }),
      getDepartmentById: async () => ({
        systemPrompt: '',
        allowedModels: [],
        defaultModel: null,
        defaultLimits: emptyLimits,
      }),
    });

    const policy = await resolvePolicy(deps, 'user-1');

    expect(policy.allowedModels).toEqual([]);
    expect(policy.blocked).toBe(false);
  });

  it('применяет глобальные лимиты по умолчанию, когда источник — Mongoose-документ без собственных перечисляемых полей', async () => {
    const proto = {
      dailyCostUsd: 100,
    };
    const mongooseLikeLimits = Object.create(proto) as typeof emptyLimits;
    expect(Object.keys(mongooseLikeLimits)).toHaveLength(0);

    const deps = makeDeps({
      getGlobalSettings: async () => ({
        systemPrompt: 'Глобальный промпт',
        allowedModels: ['google/gemini-3.5-flash-lite'],
        defaultModel: null,
        defaultLimits: mongooseLikeLimits,
      }),
    });

    const policy = await resolvePolicy(deps, 'user-1');

    expect(policy.limits.dailyCostUsd).toBe(100);
  });
});

describe('resolvePolicy defaultModel', () => {
  function makeSettings(allowedModels: string[], defaultModel: string | null) {
    return async () => ({
      systemPrompt: '',
      allowedModels,
      defaultModel,
      defaultLimits: { ...emptyLimits },
    });
  }

  function makeUser(allowedModels: string[] | null, defaultModel: string | null) {
    return async () => ({
      departmentId: null,
      limits: null,
      allowedModels,
      defaultModel,
      blocked: false,
    });
  }

  it('берёт персональный дефолт, когда он входит в эффективный список', async () => {
    const policy = await resolvePolicy(
      {
        getGlobalSettings: makeSettings(['a', 'b'], 'a'),
        getUserPolicy: makeUser(['b', 'c'], 'c'),
        getDepartmentById: async () => null,
      },
      'user-1',
    );

    expect(policy.allowedModels).toEqual(['b', 'c']);
    expect(policy.defaultModel).toBe('c');
  });

  it('падает на первую модель списка, когда дефолт нигде не задан', async () => {
    const policy = await resolvePolicy(
      {
        getGlobalSettings: makeSettings(['a', 'b'], null),
        getUserPolicy: makeUser(['b', 'c'], null),
        getDepartmentById: async () => null,
      },
      'user-1',
    );

    expect(policy.defaultModel).toBe('b');
  });

  it('игнорирует унаследованный дефолт, которого нет в эффективном списке', async () => {
    const policy = await resolvePolicy(
      {
        getGlobalSettings: makeSettings(['a', 'b'], 'a'),
        getUserPolicy: makeUser(['c', 'd'], null),
        getDepartmentById: async () => null,
      },
      'user-1',
    );

    expect(policy.defaultModel).toBe('c');
  });

  it('наследует глобальный дефолт, когда список нигде не переопределён', async () => {
    const policy = await resolvePolicy(
      {
        getGlobalSettings: makeSettings(['a', 'b'], 'b'),
        getUserPolicy: async () => null,
        getDepartmentById: async () => null,
      },
      'user-1',
    );

    expect(policy.defaultModel).toBe('b');
  });

  it('отдаёт null, когда список моделей нигде не ограничен', async () => {
    const policy = await resolvePolicy(
      {
        getGlobalSettings: makeSettings([], null),
        getUserPolicy: async () => null,
        getDepartmentById: async () => null,
      },
      'user-1',
    );

    expect(policy.defaultModel).toBeNull();
  });
});
