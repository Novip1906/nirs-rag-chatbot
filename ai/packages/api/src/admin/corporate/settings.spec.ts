import type { ICorporateSettings } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { CorporateSettingsDeps } from './settings';
import { createCorporateSettingsHandlers } from './settings';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const NO_LIMITS = {
  dailyCostUsd: null,
};

function mockSettings(overrides: Partial<ICorporateSettings> = {}): ICorporateSettings {
  return {
    systemPrompt: 'You are a helpful assistant.',
    allowedModels: ['gpt-4'],
    defaultModel: 'gpt-4',
    defaultLimits: NO_LIMITS,
    modelCapabilities: {},
    ...overrides,
  } as ICorporateSettings;
}

function createReqRes(body: Record<string, unknown> = {}, caller: { role?: string } = {}) {
  const req = {
    params: {},
    query: {},
    body,
    user: { _id: 'admin-1', role: caller.role ?? 'ADMIN' },
  } as unknown as ServerRequest;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return { req, res, status, json };
}

function createDeps(overrides: Partial<CorporateSettingsDeps> = {}): CorporateSettingsDeps {
  return {
    getGlobalSettings: jest.fn().mockResolvedValue(mockSettings()),
    updateGlobalSettings: jest.fn().mockResolvedValue(mockSettings()),
    ...overrides,
  };
}

describe('createCorporateSettingsHandlers', () => {
  it('returns the global settings', async () => {
    const deps = createDeps({
      getGlobalSettings: jest.fn().mockResolvedValue(mockSettings({ systemPrompt: 'Hello' })),
    });
    const handlers = createCorporateSettingsHandlers(deps);
    const { req, res, status, json } = createReqRes();

    await handlers.getSettings(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(json.mock.calls[0][0].settings.systemPrompt).toBe('Hello');
  });

  it('forwards only the fields present in the request body when updating', async () => {
    const deps = createDeps();
    const handlers = createCorporateSettingsHandlers(deps);
    const { req, res, status } = createReqRes({ systemPrompt: 'New prompt' });

    await handlers.updateSettings(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(deps.updateGlobalSettings).toHaveBeenCalledWith({ systemPrompt: 'New prompt' });
  });

  it('rejects a negative default limit instead of writing it to the database', async () => {
    const deps = createDeps();
    const handlers = createCorporateSettingsHandlers(deps);
    const { req, res, status } = createReqRes({ defaultLimits: { dailyCostUsd: -100 } });

    await handlers.updateSettings(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.updateGlobalSettings).not.toHaveBeenCalled();
  });

  it('rejects an unknown limit key', async () => {
    const deps = createDeps();
    const handlers = createCorporateSettingsHandlers(deps);
    const { req, res, status } = createReqRes({ defaultLimits: { yearlyCostUsd: 100 } });

    await handlers.updateSettings(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.updateGlobalSettings).not.toHaveBeenCalled();
  });

  it('forwards a valid modelCapabilities map', async () => {
    const deps = createDeps();
    const handlers = createCorporateSettingsHandlers(deps);
    const { req, res, status } = createReqRes({
      modelCapabilities: { 'openai/gpt-5.2': { knowledgeBase: false } },
    });

    await handlers.updateSettings(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(deps.updateGlobalSettings).toHaveBeenCalledWith({
      modelCapabilities: { 'openai/gpt-5.2': { knowledgeBase: false } },
    });
  });

  it('rejects an unknown modelCapabilities field instead of writing it to the database', async () => {
    const deps = createDeps();
    const handlers = createCorporateSettingsHandlers(deps);
    const { req, res, status } = createReqRes({
      modelCapabilities: { 'openai/gpt-5.2': { imageGen: true } },
    });

    await handlers.updateSettings(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.updateGlobalSettings).not.toHaveBeenCalled();
  });
});

describe('createCorporateSettingsHandlers defaultModel', () => {
  it('отклоняет дефолт вне списка', async () => {
    const deps = createDeps();
    const handlers = createCorporateSettingsHandlers(deps);
    const { req, res, status, json } = createReqRes({
      allowedModels: ['a', 'b'],
      defaultModel: 'c',
    });

    await handlers.updateSettings(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ error: 'defaultModel must be one of allowedModels' });
    expect(deps.updateGlobalSettings).not.toHaveBeenCalled();
  });

  it('сверяет дефолт из тела со списком, лежащим в базе', async () => {
    const deps = createDeps();
    const handlers = createCorporateSettingsHandlers(deps);
    const { req, res, status } = createReqRes({ defaultModel: 'claude-haiku' });

    await handlers.updateSettings(req, res);

    expect(status).toHaveBeenCalledWith(400);
  });

  it('сохраняет согласованную пару', async () => {
    const deps = createDeps();
    const handlers = createCorporateSettingsHandlers(deps);
    const { req, res } = createReqRes({ allowedModels: ['a', 'b'], defaultModel: 'b' });

    await handlers.updateSettings(req, res);

    expect(deps.updateGlobalSettings).toHaveBeenCalledWith(
      expect.objectContaining({ allowedModels: ['a', 'b'], defaultModel: 'b' }),
    );
  });

  it('чистит дефолт, когда список опустошили', async () => {
    const deps = createDeps();
    const handlers = createCorporateSettingsHandlers(deps);
    const { req, res } = createReqRes({ allowedModels: [] });

    await handlers.updateSettings(req, res);

    expect(deps.updateGlobalSettings).toHaveBeenCalledWith(
      expect.objectContaining({ defaultModel: null }),
    );
  });
});

describe('createCorporateSettingsHandlers department scope', () => {
  /**
   * Глобальные настройки не принадлежат отделу — их закрывают целиком для
   * не-админ-уровневых ролей, а не сужают.
   */
  it('rejects a department head outright on read', async () => {
    const deps = createDeps();
    const handlers = createCorporateSettingsHandlers(deps);
    const { req, res, status } = createReqRes({}, { role: 'HEAD' });

    await handlers.getSettings(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(deps.getGlobalSettings).not.toHaveBeenCalled();
  });

  it('rejects a department head outright on write', async () => {
    const deps = createDeps();
    const handlers = createCorporateSettingsHandlers(deps);
    const { req, res, status } = createReqRes({ systemPrompt: 'New' }, { role: 'HEAD' });

    await handlers.updateSettings(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(deps.updateGlobalSettings).not.toHaveBeenCalled();
  });

  it('rejects an employee outright', async () => {
    const deps = createDeps();
    const handlers = createCorporateSettingsHandlers(deps);
    const { req, res, status } = createReqRes({}, { role: 'USER' });

    await handlers.getSettings(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(deps.getGlobalSettings).not.toHaveBeenCalled();
  });
});
