jest.mock('~/models');
jest.mock('./denyRequest', () => jest.fn(async () => undefined));

const { invalidateBlockedUser } = require('@librechat/api');
const db = require('~/models');
const denyRequest = require('./denyRequest');
const requireUnblocked = require('./requireUnblocked');

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

function makeReq(overrides = {}) {
  return {
    method: 'GET',
    originalUrl: '/api/convos',
    user: { id: 'user-1' },
    ...overrides,
  };
}

describe('requireUnblocked', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invalidateBlockedUser('user-1');
  });

  it('пропускает пользователя без блокировки', async () => {
    db.getUserPolicy.mockResolvedValue({ blocked: false });
    const next = jest.fn();
    const res = makeRes();

    await requireUnblocked(makeReq(), res, next);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBeNull();
  });

  it('закрывает API для заблокированного пользователя', async () => {
    db.getUserPolicy.mockResolvedValue({ blocked: true });
    const next = jest.fn();
    const res = makeRes();

    await requireUnblocked(makeReq(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.type).toBe('corporate_blocked');
  });

  it('оставляет заблокированному чтение собственного профиля', async () => {
    db.getUserPolicy.mockResolvedValue({ blocked: true });
    const next = jest.fn();
    const res = makeRes();

    await requireUnblocked(makeReq({ originalUrl: '/api/user' }), res, next);

    expect(next).toHaveBeenCalled();
  });

  it('оставляет заблокированному выход из аккаунта', async () => {
    db.getUserPolicy.mockResolvedValue({ blocked: true });
    const next = jest.fn();
    const res = makeRes();

    await requireUnblocked(makeReq({ method: 'POST', originalUrl: '/api/auth/logout' }), res, next);

    expect(next).toHaveBeenCalled();
  });

  it('закрывает изменение профиля даже на /api/user', async () => {
    db.getUserPolicy.mockResolvedValue({ blocked: true });
    const next = jest.fn();
    const res = makeRes();

    await requireUnblocked(
      makeReq({ method: 'DELETE', originalUrl: '/api/user/delete' }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('отказывает в ходе диалога сообщением в чате', async () => {
    db.getUserPolicy.mockResolvedValue({ blocked: true });
    const next = jest.fn();
    const res = makeRes();

    await requireUnblocked(
      makeReq({ method: 'POST', originalUrl: '/api/agents/chat/polza' }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBeNull();
    expect(denyRequest).toHaveBeenCalledWith(
      expect.anything(),
      res,
      expect.objectContaining({ type: 'corporate_blocked' }),
    );
  });

  it('не трогает неавторизованный запрос', async () => {
    const next = jest.fn();

    await requireUnblocked(makeReq({ user: undefined }), makeRes(), next);

    expect(next).toHaveBeenCalled();
    expect(db.getUserPolicy).not.toHaveBeenCalled();
  });
});
