import type { AppConfig } from '@librechat/data-schemas';
import type { PreToolUseHookInput } from '@librechat/agents';
import type { ImageDbDeps } from './tool';
import {
  IMAGE_NO_USER_REASON,
  isImageApprovalAvailable,
  IMAGE_APPROVAL_DECISIONS,
  createImageApprovalHookFactory,
} from './approval';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

function db(used: number): ImageDbDeps {
  return {
    getGlobalSettings: jest.fn().mockResolvedValue({
      systemPrompt: '',
      allowedModels: [],
      defaultModel: null,
      defaultLimits: { dailyCostUsd: 1 },
    }),
    getUserPolicy: jest.fn().mockResolvedValue(null),
    getDepartmentById: jest.fn().mockResolvedValue(null),
    getUsageTotals: jest.fn().mockResolvedValue({ costUsd: used, requests: 0 }),
    recordUsage: jest.fn(),
  };
}

const appConfig = {
  config: { imageGeneration: { model: 'm', apiKey: 'k', estimatedCostUsd: 0.1 } },
  endpoints: { agents: { toolApproval: { enabled: true } } },
} as unknown as AppConfig;

const input = {
  hook_event_name: 'PreToolUse',
  toolName: 'generate_image',
  toolInput: { prompt: 'Кот' },
  toolUseId: 'call-1',
} as unknown as PreToolUseHookInput;

async function decide(deps: ImageDbDeps, userId?: string) {
  const hook = createImageApprovalHookFactory(deps)({ userId, appConfig });
  if (!hook) {
    throw new Error('хук не построен');
  }
  return hook(input, new AbortController().signal);
}

describe('createImageApprovalHookFactory', () => {
  it('всегда спрашивает сотрудника, когда лимита хватает', async () => {
    await expect(decide(db(0), 'user-1')).resolves.toEqual({
      decision: 'ask',
      allowedDecisions: IMAGE_APPROVAL_DECISIONS,
    });
  });

  it('не показывает карточку, когда остатка не хватает на картинку', async () => {
    const result = await decide(db(0.95), 'user-1');
    expect(result).toMatchObject({ decision: 'deny' });
    expect((result as { reason?: string }).reason).toContain('не хватает на картинку');
  });

  it('без сотрудника отказывает', async () => {
    await expect(decide(db(0))).resolves.toEqual({
      decision: 'deny',
      reason: IMAGE_NO_USER_REASON,
    });
  });

  it('при сбое проверки лимита всё равно спрашивает, а не пропускает молча', async () => {
    const deps = db(0);
    deps.getUsageTotals = jest.fn().mockRejectedValue(new Error('mongo down'));
    await expect(decide(deps, 'user-1')).resolves.toMatchObject({ decision: 'ask' });
  });
});

describe('isImageApprovalAvailable', () => {
  it('доступна только там, где есть подтверждения и экран для них', () => {
    expect(isImageApprovalAvailable(appConfig, true)).toBe(true);
    expect(isImageApprovalAvailable(appConfig, false)).toBe(false);
    expect(isImageApprovalAvailable({} as AppConfig, true)).toBe(false);
  });
});
