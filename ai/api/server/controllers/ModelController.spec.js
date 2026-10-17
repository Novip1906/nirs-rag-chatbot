const mockLoadDefaultModels = jest.fn();
const mockLoadConfigModels = jest.fn();

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: {
    error: jest.fn(),
  },
}));

jest.mock('~/server/services/Config', () => ({
  loadDefaultModels: (...args) => mockLoadDefaultModels(...args),
  loadConfigModels: (...args) => mockLoadConfigModels(...args),
}));

jest.mock('~/models');

const db = require('~/models');
const { loadModels, modelController } = require('./ModelController');

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const emptyLimits = { dailyCostUsd: null };

function setupPolicyDb({ allowedModels = [], userPolicy = null, department = null } = {}) {
  db.getGlobalSettings = jest.fn().mockResolvedValue({
    systemPrompt: '',
    allowedModels,
    defaultLimits: { ...emptyLimits },
  });
  db.getUserPolicy = jest.fn().mockResolvedValue(userPolicy);
  db.getDepartmentById = jest.fn().mockResolvedValue(department);
}

describe('loadModels', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads default and configured models concurrently while preserving custom precedence', async () => {
    const defaultModels = deferred();
    const configuredModels = deferred();
    const req = { user: { id: 'user-1' } };
    mockLoadDefaultModels.mockReturnValue(defaultModels.promise);
    mockLoadConfigModels.mockReturnValue(configuredModels.promise);

    const resultPromise = loadModels(req);

    expect(mockLoadDefaultModels).toHaveBeenCalledWith(req);
    expect(mockLoadConfigModels).toHaveBeenCalledWith(req);

    configuredModels.resolve({
      openAI: ['configured-model'],
      custom: ['custom-model'],
    });
    defaultModels.resolve({
      openAI: ['default-model'],
      anthropic: ['default-anthropic'],
    });

    await expect(resultPromise).resolves.toEqual({
      openAI: ['configured-model'],
      anthropic: ['default-anthropic'],
      custom: ['custom-model'],
    });
  });
});

describe('modelController', () => {
  let res;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadDefaultModels.mockResolvedValue({ openAI: ['gpt-4o', 'gpt-4o-mini'] });
    mockLoadConfigModels.mockResolvedValue({ anthropic: ['claude-opus', 'claude-sonnet'] });
    res = { send: jest.fn(), status: jest.fn().mockReturnThis() };
  });

  it('не фильтрует список моделей, когда allowedModels пуст', async () => {
    setupPolicyDb({ allowedModels: [] });
    const req = { user: { id: 'user-1' } };

    await modelController(req, res);

    expect(res.send).toHaveBeenCalledWith({
      openAI: ['gpt-4o', 'gpt-4o-mini'],
      anthropic: ['claude-opus', 'claude-sonnet'],
    });
  });

  it('оставляет только пересечение с allowedModels, когда список не пуст', async () => {
    setupPolicyDb({ allowedModels: ['gpt-4o', 'claude-opus'] });
    const req = { user: { id: 'user-1' } };

    await modelController(req, res);

    expect(res.send).toHaveBeenCalledWith({
      openAI: ['gpt-4o'],
      anthropic: ['claude-opus'],
    });
  });

  it('не добавляет модель, разрешённую политикой, но отсутствующую в конфигурации', async () => {
    setupPolicyDb({ allowedModels: ['gpt-4o', 'model-not-in-config'] });
    const req = { user: { id: 'user-1' } };

    await modelController(req, res);

    const sent = res.send.mock.calls[0][0];
    expect(sent.openAI).toEqual(['gpt-4o']);
    expect(Object.values(sent).flat()).not.toContain('model-not-in-config');
  });

  it('отдаёт полный список без фильтрации, когда резолюция политики падает', async () => {
    db.getGlobalSettings = jest.fn().mockRejectedValue(new Error('Mongo недоступна'));
    db.getUserPolicy = jest.fn().mockResolvedValue(null);
    db.getDepartmentById = jest.fn().mockResolvedValue(null);
    const req = { user: { id: 'user-1' } };

    await modelController(req, res);

    expect(res.send).toHaveBeenCalledWith({
      openAI: ['gpt-4o', 'gpt-4o-mini'],
      anthropic: ['claude-opus', 'claude-sonnet'],
    });
    expect(res.status).not.toHaveBeenCalled();
  });
});
