import { Types } from 'mongoose';
import type { CorporatePolicyMethods } from './deps';
import {
  toResolvePolicyDeps,
  resolveDepartmentId,
  resolveSystemPrompt,
  toResolveModelSpecFn,
} from './deps';

const NO_LIMITS = {
  dailyCostUsd: null,
};

describe('toResolvePolicyDeps', () => {
  it('приводит departmentId к строке и подставляет пустые значения для необязательных полей', async () => {
    const departmentId = new Types.ObjectId();
    const deps = toResolvePolicyDeps({
      getGlobalSettings: async () => ({
        systemPrompt: 'global prompt',
        allowedModels: ['gpt'],
        defaultModel: null,
        defaultLimits: {
          dailyCostUsd: null,
        },
      }),
      getUserPolicy: async () => ({
        departmentId,
        limits: null,
        allowedModels: null,
        defaultModel: null,
        blocked: false,
      }),
      getDepartmentById: async () => ({
        systemPrompt: undefined,
        allowedModels: ['claude'],
        defaultModel: null,
        defaultLimits: {
          dailyCostUsd: 10,
        },
      }),
    });

    const userPolicy = await deps.getUserPolicy('user-1');
    expect(userPolicy?.departmentId).toBe(departmentId.toString());
    expect(typeof userPolicy?.departmentId).toBe('string');

    const department = await deps.getDepartmentById(departmentId.toString());
    expect(department?.systemPrompt).toBe('');
    expect(department?.allowedModels).toEqual(['claude']);
  });

  it('прокидывает modelCapabilities с глобальных настроек и подставляет {} без него', async () => {
    const withCapabilities = toResolvePolicyDeps({
      getGlobalSettings: async () => ({
        systemPrompt: '',
        allowedModels: [],
        defaultModel: null,
        defaultLimits: {
          dailyCostUsd: null,
        },
        modelCapabilities: { 'a/b': { webSearch: false } },
      }),
      getUserPolicy: async () => null,
      getDepartmentById: async () => null,
    });
    expect((await withCapabilities.getGlobalSettings()).modelCapabilities).toEqual({
      'a/b': { webSearch: false },
    });

    const withoutCapabilities = toResolvePolicyDeps({
      getGlobalSettings: async () => ({
        systemPrompt: '',
        allowedModels: [],
        defaultModel: null,
        defaultLimits: {
          dailyCostUsd: null,
        },
      }),
      getUserPolicy: async () => null,
      getDepartmentById: async () => null,
    });
    expect((await withoutCapabilities.getGlobalSettings()).modelCapabilities).toEqual({});
  });

  it('возвращает null, когда пользователь или отдел не найдены', async () => {
    const deps = toResolvePolicyDeps({
      getGlobalSettings: async () => ({
        systemPrompt: '',
        allowedModels: [],
        defaultModel: null,
        defaultLimits: {
          dailyCostUsd: null,
        },
      }),
      getUserPolicy: async () => null,
      getDepartmentById: async () => null,
    });

    expect(await deps.getUserPolicy('user-1')).toBeNull();
    expect(await deps.getDepartmentById('dep-1')).toBeNull();
  });
});

describe('resolveDepartmentId', () => {
  const departmentId = new Types.ObjectId();

  const methods: CorporatePolicyMethods = {
    getGlobalSettings: async () => ({
      systemPrompt: '',
      allowedModels: [],
      defaultModel: null,
      defaultLimits: NO_LIMITS,
    }),
    getUserPolicy: async () => ({
      departmentId,
      limits: null,
      allowedModels: null,
      defaultModel: null,
      blocked: false,
    }),
    getDepartmentById: async () => ({
      systemPrompt: '',
      allowedModels: [],
      defaultModel: null,
      defaultLimits: NO_LIMITS,
    }),
  };

  it('returns null without calling anything when userId is missing', async () => {
    const getUserPolicy = jest.fn(methods.getUserPolicy);
    expect(await resolveDepartmentId({ ...methods, getUserPolicy }, undefined)).toBeNull();
    expect(await resolveDepartmentId({ ...methods, getUserPolicy }, null)).toBeNull();
    expect(getUserPolicy).not.toHaveBeenCalled();
  });

  it('resolves the department id from the policy', async () => {
    expect(await resolveDepartmentId(methods, 'user-1')).toBe(departmentId.toString());
  });

  it('falls back to null (does not throw) when the policy lookup fails', async () => {
    const failing: CorporatePolicyMethods = {
      ...methods,
      getUserPolicy: async () => {
        throw new Error('mongo down');
      },
    };
    await expect(resolveDepartmentId(failing, 'user-1')).resolves.toBeNull();
  });
});

describe('resolveSystemPrompt', () => {
  const departmentId = new Types.ObjectId();

  const methods: CorporatePolicyMethods = {
    getGlobalSettings: async () => ({
      systemPrompt: 'Глобальный промпт',
      allowedModels: [],
      defaultModel: null,
      defaultLimits: NO_LIMITS,
    }),
    getUserPolicy: async () => ({
      departmentId,
      limits: null,
      allowedModels: null,
      defaultModel: null,
      blocked: false,
    }),
    getDepartmentById: async () => ({
      systemPrompt: 'Промпт отдела',
      allowedModels: [],
      defaultModel: null,
      defaultLimits: NO_LIMITS,
    }),
  };

  it('returns "" without calling anything when userId is missing', async () => {
    const getUserPolicy = jest.fn(methods.getUserPolicy);
    expect(await resolveSystemPrompt({ ...methods, getUserPolicy }, undefined)).toBe('');
    expect(await resolveSystemPrompt({ ...methods, getUserPolicy }, null)).toBe('');
    expect(getUserPolicy).not.toHaveBeenCalled();
  });

  it('resolves the merged global + department prompt from the policy', async () => {
    expect(await resolveSystemPrompt(methods, 'user-1')).toBe(
      'Глобальный промпт\n\nПромпт отдела',
    );
  });

  it('falls back to "" (does not throw) when the policy lookup fails', async () => {
    const failing: CorporatePolicyMethods = {
      ...methods,
      getUserPolicy: async () => {
        throw new Error('mongo down');
      },
    };
    await expect(resolveSystemPrompt(failing, 'user-1')).resolves.toBe('');
  });
});

describe('toResolveModelSpecFn', () => {
  const methods: CorporatePolicyMethods = {
    getGlobalSettings: async () => ({
      systemPrompt: '',
      allowedModels: ['anthropic/claude-3-haiku'],
      defaultModel: null,
      defaultLimits: NO_LIMITS,
    }),
    getUserPolicy: async () => null,
    getDepartmentById: async () => null,
  };

  it('находит синтетический спек модели, разрешённой политикой, но без именной записи', async () => {
    const resolveModelSpec = toResolveModelSpecFn(methods, async () => [
      {
        id: 'anthropic/claude-3-haiku',
        label: 'Claude 3 Haiku',
        description: '',
        vendor: 'anthropic',
      },
    ]);

    const spec = await resolveModelSpec('user-1', [], 'anthropic/claude-3-haiku');
    expect(spec).toMatchObject({
      name: 'anthropic/claude-3-haiku',
      preset: { model: 'anthropic/claude-3-haiku' },
    });
  });

  it('возвращает null, когда модель политикой не разрешена', async () => {
    const resolveModelSpec = toResolveModelSpecFn(methods, async () => [
      { id: 'anthropic/claude-sonnet-5', label: 'Sonnet', description: '', vendor: 'anthropic' },
    ]);

    expect(await resolveModelSpec('user-1', [], 'anthropic/claude-sonnet-5')).toBeNull();
  });

  it('не бросает, а возвращает null при ошибке резолва политики', async () => {
    const failing: CorporatePolicyMethods = {
      ...methods,
      getGlobalSettings: async () => {
        throw new Error('mongo down');
      },
    };
    const resolveModelSpec = toResolveModelSpecFn(failing);
    await expect(resolveModelSpec('user-1', [], 'anthropic/claude-3-haiku')).resolves.toBeNull();
  });
});
