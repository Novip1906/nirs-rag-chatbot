import type { EffectivePolicy } from './policy';
import type { AssertLimitsDeps } from './limits';
import { assertWithinLimits } from './limits';

const emptyLimits = {
  dailyCostUsd: null,
};

function makePolicy(overrides: Partial<EffectivePolicy> = {}): EffectivePolicy {
  return {
    departmentId: null,
    limits: { ...emptyLimits },
    allowedModels: [],
    defaultModel: null,
    systemPrompt: '',
    blocked: false,
    modelCapabilities: {},
    ...overrides,
  };
}

function makeDeps(overrides: Partial<AssertLimitsDeps> = {}): AssertLimitsDeps {
  return {
    getUsageTotals: async () => ({ costUsd: 0, requests: 0 }),
    resolvePolicy: async () => makePolicy(),
    ...overrides,
  };
}

describe('assertWithinLimits', () => {
  it('разрешает, когда лимитов нет вообще', async () => {
    const verdict = await assertWithinLimits(makeDeps(), 'user-1');
    expect(verdict).toEqual({ allowed: true });
  });

  it('запрещает без обращения к расходам, когда пользователь заблокирован', async () => {
    const getUsageTotals = jest.fn(async () => ({ costUsd: 0, requests: 0 }));
    const deps = makeDeps({
      resolvePolicy: async () => makePolicy({ blocked: true }),
      getUsageTotals,
    });

    const verdict = await assertWithinLimits(deps, 'user-1');

    expect(verdict.allowed).toBe(false);
    expect(getUsageTotals).not.toHaveBeenCalled();
  });

  it('запрещает по дневной стоимости, когда она достигла порога', async () => {
    const deps = makeDeps({
      resolvePolicy: async () => makePolicy({ limits: { ...emptyLimits, dailyCostUsd: 100 } }),
      getUsageTotals: async () => ({ costUsd: 100, requests: 1 }),
    });

    const verdict = await assertWithinLimits(deps, 'user-1');

    expect(verdict.allowed).toBe(false);
    expect(verdict.window).toBe('daily');
    expect(verdict.kind).toBe('cost');
    expect(verdict.used).toBe(100);
    expect(verdict.limit).toBe(100);
    expect(verdict.resetAt).toBeDefined();
  });

  it('не проверяет порог, если он равен null', async () => {
    const deps = makeDeps({
      resolvePolicy: async () => makePolicy({ limits: { ...emptyLimits, dailyCostUsd: null } }),
      getUsageTotals: async () => ({ costUsd: 999999, requests: 999999 }),
    });

    const verdict = await assertWithinLimits(deps, 'user-1');
    expect(verdict.allowed).toBe(true);
  });

  it('не проверяет NaN-порог (повреждённые данные) — считает его отсутствующим', async () => {
    const deps = makeDeps({
      resolvePolicy: async () =>
        makePolicy({ limits: { ...emptyLimits, dailyCostUsd: Number.NaN } }),
      getUsageTotals: async () => ({ costUsd: 5, requests: 999999 }),
    });

    const verdict = await assertWithinLimits(deps, 'user-1');

    /** Порченый dailyCostUsd (limit: NaN → limit: null на проводе, неотличимо от «порога
     *  нет») не должен блокировать сам по себе. */
    expect(verdict).toEqual({ allowed: true });
  });

  it('разрешает, пока расход строго меньше лимита', async () => {
    const deps = makeDeps({
      resolvePolicy: async () => makePolicy({ limits: { ...emptyLimits, dailyCostUsd: 10 } }),
      getUsageTotals: async () => ({ costUsd: 9, requests: 0 }),
    });

    const verdict = await assertWithinLimits(deps, 'user-1');
    expect(verdict.allowed).toBe(true);
  });

  it('передаёт в getUsageTotals начало текущих суток, ровно один раз', async () => {
    const calls: Date[] = [];
    const deps = makeDeps({
      getUsageTotals: async (_userId, since) => {
        calls.push(since);
        return { costUsd: 0, requests: 0 };
      },
    });

    await assertWithinLimits(deps, 'user-1');

    const now = new Date();
    expect(calls).toHaveLength(1);
    expect(calls[0].getDate()).toBe(now.getDate());
    expect(calls[0].getHours()).toBe(0);
    expect(calls[0].getMinutes()).toBe(0);
  });

  it('пробрасывает ошибку resolvePolicy наружу, не разрешая доступ', async () => {
    const deps = makeDeps({
      resolvePolicy: async () => {
        throw new Error('policy service down');
      },
    });

    await expect(assertWithinLimits(deps, 'user-1')).rejects.toThrow('policy service down');
  });

  it('пробрасывает ошибку getUsageTotals наружу, не разрешая доступ', async () => {
    const deps = makeDeps({
      getUsageTotals: async () => {
        throw new Error('usage service down');
      },
    });

    await expect(assertWithinLimits(deps, 'user-1')).rejects.toThrow('usage service down');
  });
});
