jest.mock('~/models');
jest.mock('./denyRequest', () => jest.fn(async () => undefined));
jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

const denyRequest = require('./denyRequest');
const db = require('~/models');
const checkOfficeLimits = require('./officeLimits');
const { CorporateViolationTypes } = checkOfficeLimits;

const emptyLimits = {
  dailyCostUsd: null,
};

function makeSettings(overrides = {}) {
  return {
    systemPrompt: '',
    allowedModels: ['gpt-4o'],
    defaultLimits: { ...emptyLimits },
    ...overrides,
  };
}

function makeReq(overrides = {}) {
  return {
    user: { id: 'user-1' },
    body: {
      text: 'hello',
      conversationId: 'convo-1',
      messageId: 'msg-1',
      parentMessageId: 'parent-1',
      endpointOption: { model_parameters: { model: 'gpt-4o' } },
    },
    ...overrides,
  };
}

function setupDb({
  settings = makeSettings(),
  userPolicy = null,
  department = null,
  usage = { costUsd: 0, requests: 0 },
  usageImpl,
  getAgentImpl,
} = {}) {
  db.getGlobalSettings = jest.fn().mockResolvedValue(settings);
  db.getUserPolicy = jest.fn().mockResolvedValue(userPolicy);
  db.getDepartmentById = jest.fn().mockResolvedValue(department);
  db.getUsageTotals = usageImpl ?? jest.fn().mockResolvedValue(usage);
  db.getAgent = getAgentImpl ?? jest.fn().mockResolvedValue(null);
}

describe('checkOfficeLimits', () => {
  let res, next;

  beforeEach(() => {
    res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    next = jest.fn();
    denyRequest.mockClear();
  });

  it('пропускает запрос, когда лимитов нет и модель разрешена', async () => {
    setupDb();
    const req = makeReq();

    await checkOfficeLimits(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(denyRequest).not.toHaveBeenCalled();
  });

  it('отказывает ровно на границе дневного лимита стоимости, с машиночитаемой структурой', async () => {
    setupDb({
      settings: makeSettings({ defaultLimits: { ...emptyLimits, dailyCostUsd: 100 } }),
      usage: { costUsd: 100, requests: 1 },
    });
    const req = makeReq();

    await checkOfficeLimits(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(denyRequest).toHaveBeenCalledTimes(1);
    const body = denyRequest.mock.calls[0][2];
    expect(body).toEqual({
      type: CorporateViolationTypes.LIMIT,
      window: 'daily',
      kind: 'cost',
      used: 100,
      limit: 100,
      resetAt: expect.any(String),
      message: expect.any(String),
    });
    expect(body.message).toMatch(/дневной/);
    expect(body.message).toMatch(/стоимости/);
  });

  it('пропускает, когда расход на 1 меньше границы дневного лимита', async () => {
    setupDb({
      settings: makeSettings({ defaultLimits: { ...emptyLimits, dailyCostUsd: 100 } }),
      usage: { costUsd: 99, requests: 1 },
    });
    const req = makeReq();

    await checkOfficeLimits(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(denyRequest).not.toHaveBeenCalled();
  });

  it('отказывает структурой corporate_check_failed, не пропуская дальше, если resolvePolicy бросает исключение', async () => {
    setupDb();
    db.getGlobalSettings = jest.fn().mockRejectedValue(new Error('Mongo недоступна'));
    const req = makeReq();

    await checkOfficeLimits(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(denyRequest).toHaveBeenCalledTimes(1);
    expect(denyRequest.mock.calls[0][2]).toEqual({
      type: CorporateViolationTypes.CHECK_FAILED,
      message: expect.any(String),
    });
  });

  it('отказывает структурой corporate_check_failed, не пропуская дальше, если getUsageTotals бросает исключение', async () => {
    setupDb({ usageImpl: jest.fn().mockRejectedValue(new Error('Aggregate failed')) });
    const req = makeReq();

    await checkOfficeLimits(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(denyRequest).toHaveBeenCalledTimes(1);
    expect(denyRequest.mock.calls[0][2]).toEqual({
      type: CorporateViolationTypes.CHECK_FAILED,
      message: expect.any(String),
    });
  });

  it('отказывает структурой corporate_model_not_allowed, когда запрошенная модель не входит в allowedModels', async () => {
    setupDb({ settings: makeSettings({ allowedModels: ['gpt-3.5-turbo'] }) });
    const req = makeReq({
      body: {
        ...makeReq().body,
        endpointOption: { model_parameters: { model: 'gpt-4o' } },
      },
    });

    await checkOfficeLimits(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(denyRequest).toHaveBeenCalledTimes(1);
    expect(denyRequest.mock.calls[0][2]).toEqual({
      type: CorporateViolationTypes.MODEL_NOT_ALLOWED,
      model: 'gpt-4o',
      message: expect.any(String),
    });
  });

  it('пропускает любую модель, когда allowedModels пуст (незаданный по умолчанию список — не значит «ничего нельзя»)', async () => {
    setupDb({ settings: makeSettings({ allowedModels: [] }) });
    const req = makeReq({
      body: {
        ...makeReq().body,
        endpointOption: { model_parameters: { model: 'any-model-not-in-any-list' } },
      },
    });

    await checkOfficeLimits(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(denyRequest).not.toHaveBeenCalled();
  });

  it('отказывает структурой corporate_blocked без обращения к расходам, если пользователь заблокирован', async () => {
    const getUsageTotals = jest.fn().mockResolvedValue({ costUsd: 0, requests: 0 });
    setupDb({
      userPolicy: { departmentId: null, limits: null, allowedModels: null, blocked: true },
      usageImpl: getUsageTotals,
    });
    const req = makeReq();

    await checkOfficeLimits(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(denyRequest).toHaveBeenCalledTimes(1);
    expect(denyRequest.mock.calls[0][2]).toEqual({
      type: CorporateViolationTypes.BLOCKED,
      message: expect.any(String),
    });
    expect(getUsageTotals).not.toHaveBeenCalled();
  });

  it('отказывает структурой corporate_check_failed, когда пользователь не определён', async () => {
    setupDb();
    const req = makeReq({ user: null });

    await checkOfficeLimits(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(denyRequest).toHaveBeenCalledTimes(1);
    expect(denyRequest.mock.calls[0][2]).toEqual({
      type: CorporateViolationTypes.CHECK_FAILED,
      message: expect.any(String),
    });
  });

  describe('обход через сохранённого агента (Critical 1)', () => {
    it('отказывает, когда сохранённый agent_id ссылается на запрещённую модель, а model_parameters её вовсе не содержит', async () => {
      setupDb({
        settings: makeSettings({ allowedModels: ['gpt-4o'] }),
        getAgentImpl: jest.fn().mockResolvedValue({ model: 'gpt-5-forbidden' }),
      });
      const req = makeReq({
        body: {
          ...makeReq().body,
          endpointOption: { agent_id: 'agent_real123', model_parameters: {} },
        },
      });

      await checkOfficeLimits(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(db.getAgent).toHaveBeenCalledWith({ id: 'agent_real123' });
      expect(denyRequest.mock.calls[0][2]).toEqual({
        type: CorporateViolationTypes.MODEL_NOT_ALLOWED,
        model: 'gpt-5-forbidden',
        message: expect.any(String),
      });
    });

    it('отказывает, когда рядом с сохранённым agent_id в запросе подставлена разрешённая модель, а в самом агенте запрещённая', async () => {
      setupDb({
        settings: makeSettings({ allowedModels: ['gpt-4o'] }),
        getAgentImpl: jest.fn().mockResolvedValue({ model: 'gpt-5-forbidden' }),
      });
      const req = makeReq({
        body: {
          ...makeReq().body,
          endpointOption: {
            agent_id: 'agent_real123',
            model_parameters: { model: 'gpt-4o' },
          },
        },
      });

      await checkOfficeLimits(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(denyRequest.mock.calls[0][2]).toEqual({
        type: CorporateViolationTypes.MODEL_NOT_ALLOWED,
        model: 'gpt-5-forbidden',
        message: expect.any(String),
      });
    });

    it('пропускает, когда сохранённый агент использует разрешённую модель из своего документа', async () => {
      setupDb({
        settings: makeSettings({ allowedModels: ['gpt-4o'] }),
        getAgentImpl: jest.fn().mockResolvedValue({ model: 'gpt-4o' }),
      });
      const req = makeReq({
        body: {
          ...makeReq().body,
          endpointOption: { agent_id: 'agent_real123', model_parameters: {} },
        },
      });

      await checkOfficeLimits(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(denyRequest).not.toHaveBeenCalled();
    });

    it('падает в model_parameters.model только у настоящего эфемерного агента, не у сохранённого', async () => {
      setupDb({
        settings: makeSettings({ allowedModels: ['gpt-4o'] }),
        getAgentImpl: jest.fn(),
      });
      const req = makeReq();

      await checkOfficeLimits(req, res, next);

      expect(db.getAgent).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('обход через addedConvo (Critical 2)', () => {
    it('отказывает, когда модель addedConvo (без agent_id) не входит в allowedModels', async () => {
      setupDb({ settings: makeSettings({ allowedModels: ['gpt-4o'] }) });
      const req = makeReq({
        body: {
          ...makeReq().body,
          endpointOption: {
            model_parameters: { model: 'gpt-4o' },
            addedConvo: { model: 'gpt-5-forbidden' },
          },
        },
      });

      await checkOfficeLimits(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(denyRequest.mock.calls[0][2]).toEqual({
        type: CorporateViolationTypes.MODEL_NOT_ALLOWED,
        model: 'gpt-5-forbidden',
        message: expect.any(String),
      });
    });

    it('отказывает по запрещённой модели сохранённого addedConvo.agent_id, переиспользуя req.resolvedAddedAgent без повторного похода в базу', async () => {
      const getAgentImpl = jest.fn();
      setupDb({ settings: makeSettings({ allowedModels: ['gpt-4o'] }), getAgentImpl });
      const req = makeReq({
        resolvedAddedAgent: { model: 'gpt-5-forbidden' },
        body: {
          ...makeReq().body,
          endpointOption: {
            model_parameters: { model: 'gpt-4o' },
            addedConvo: { agent_id: 'agent_added123' },
          },
        },
      });

      await checkOfficeLimits(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(getAgentImpl).not.toHaveBeenCalled();
      expect(denyRequest.mock.calls[0][2]).toEqual({
        type: CorporateViolationTypes.MODEL_NOT_ALLOWED,
        model: 'gpt-5-forbidden',
        message: expect.any(String),
      });
    });

    it('отказывает по запрещённой модели сохранённого addedConvo.agent_id, когда req.resolvedAddedAgent не был закэширован (обход прав администратора)', async () => {
      setupDb({
        settings: makeSettings({ allowedModels: ['gpt-4o'] }),
        getAgentImpl: jest.fn().mockResolvedValue({ model: 'gpt-5-forbidden' }),
      });
      const req = makeReq({
        body: {
          ...makeReq().body,
          endpointOption: {
            model_parameters: { model: 'gpt-4o' },
            addedConvo: { agent_id: 'agent_added123' },
          },
        },
      });

      await checkOfficeLimits(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(db.getAgent).toHaveBeenCalledWith({ id: 'agent_added123' });
      expect(denyRequest.mock.calls[0][2]).toEqual({
        type: CorporateViolationTypes.MODEL_NOT_ALLOWED,
        model: 'gpt-5-forbidden',
        message: expect.any(String),
      });
    });

    it('пропускает, когда и основная, и addedConvo модель разрешены', async () => {
      setupDb({ settings: makeSettings({ allowedModels: ['gpt-4o', 'gpt-4o-mini'] }) });
      const req = makeReq({
        body: {
          ...makeReq().body,
          endpointOption: {
            model_parameters: { model: 'gpt-4o' },
            addedConvo: { model: 'gpt-4o-mini' },
          },
        },
      });

      await checkOfficeLimits(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(denyRequest).not.toHaveBeenCalled();
    });
  });

  describe('неопределимая модель (Important 3, пересмотрено вместе с пустым allowedModels)', () => {
    it('отказывает, когда модель не передана вовсе, а allowedModels не пуст', async () => {
      setupDb({ settings: makeSettings({ allowedModels: ['gpt-4o'] }) });
      const req = makeReq({
        body: {
          ...makeReq().body,
          endpointOption: { model_parameters: {} },
        },
      });

      await checkOfficeLimits(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(denyRequest.mock.calls[0][2]).toEqual({
        type: CorporateViolationTypes.MODEL_NOT_ALLOWED,
        model: null,
        message: expect.any(String),
      });
    });

    it('пропускает, когда модель не передана вовсе, а allowedModels пуст (нечего отклонять — ограничения не заданы)', async () => {
      setupDb({ settings: makeSettings({ allowedModels: [] }) });
      const req = makeReq({
        body: {
          ...makeReq().body,
          endpointOption: { model_parameters: {} },
        },
      });

      await checkOfficeLimits(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(denyRequest).not.toHaveBeenCalled();
    });
  });
});
