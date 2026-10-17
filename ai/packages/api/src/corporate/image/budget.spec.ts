import type { EffectivePolicy } from '~/corporate/policy';
import type { ImageBudgetDeps } from './budget';
import { checkImageBudget, IMAGE_BLOCKED_REASON } from './budget';

function policy(overrides: Partial<EffectivePolicy> = {}): EffectivePolicy {
  return {
    departmentId: null,
    limits: { dailyCostUsd: 1 },
    allowedModels: [],
    defaultModel: null,
    systemPrompt: '',
    blocked: false,
    modelCapabilities: {},
    ...overrides,
  };
}

function deps(used: number, effective: EffectivePolicy = policy()): ImageBudgetDeps {
  return {
    resolvePolicy: jest.fn().mockResolvedValue(effective),
    getUsageTotals: jest.fn().mockResolvedValue({ costUsd: used, requests: 0 }),
  };
}

const NOW = new Date('2026-10-16T12:00:00.000Z');

describe('checkImageBudget', () => {
  it('пускает, когда остатка хватает на картинку', async () => {
    await expect(checkImageBudget(deps(0.5), 'user-1', 0.2, NOW)).resolves.toEqual({
      allowed: true,
    });
  });

  it('не пускает, когда на картинку не хватает остатка, и говорит именно об этом', async () => {
    const verdict = await checkImageBudget(deps(0.9), 'user-1', 0.2, NOW);
    expect(verdict.allowed).toBe(false);
    expect(verdict.allowed === false && verdict.reason).toContain('не хватает на картинку');
  });

  it('не пускает, когда лимит уже исчерпан, даже без оценки цены', async () => {
    const verdict = await checkImageBudget(deps(1), 'user-1', undefined, NOW);
    expect(verdict.allowed).toBe(false);
    expect(verdict.allowed === false && verdict.reason).toContain('Дневной лимит');
  });

  it('не называет суммы в причине отказа', async () => {
    const verdict = await checkImageBudget(deps(5), 'user-1', 0.2, NOW);
    expect(verdict.allowed === false && verdict.reason).not.toMatch(/\$|USD|0\.2|5/);
  });

  it('пускает без лимита', async () => {
    const budget = deps(100, policy({ limits: { dailyCostUsd: null } }));
    await expect(checkImageBudget(budget, 'user-1', 0.2, NOW)).resolves.toEqual({
      allowed: true,
    });
    expect(budget.getUsageTotals).not.toHaveBeenCalled();
  });

  it('не пускает заблокированного сотрудника', async () => {
    await expect(
      checkImageBudget(deps(0, policy({ blocked: true })), 'user-1', 0.2, NOW),
    ).resolves.toEqual({ allowed: false, reason: IMAGE_BLOCKED_REASON });
  });
});
