import { Types } from 'mongoose';
import type { Response } from 'express';
import type { SpendRequestCall, SpendRequestRow } from '@librechat/data-schemas';
import type { ServerRequest } from '~/types/http';
import type { CorporateSpendDeps } from './spend';
import { createCorporateSpendHandlers } from './spend';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

function createReqRes(
  query: Record<string, string> = {},
  params: Record<string, string> = {},
  caller: { id?: string; role?: string } = {},
) {
  const req = {
    params,
    query,
    body: {},
    user: {
      _id: caller.id ?? new Types.ObjectId().toString(),
      role: caller.role ?? 'ADMIN',
    },
  } as unknown as ServerRequest;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return { req, res, status, json };
}

function createDeps(overrides: Partial<CorporateSpendDeps> = {}): CorporateSpendDeps {
  return {
    listSpendRequests: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    getRequestTranscript: jest.fn().mockResolvedValue(null),
    getRequestImage: jest.fn().mockResolvedValue(null),
    sendImage: jest.fn().mockResolvedValue(true),
    findUsers: jest.fn().mockResolvedValue([]),
    listDepartments: jest.fn().mockResolvedValue([]),
    getUserPolicy: jest.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function call(overrides: Partial<SpendRequestCall> = {}): SpendRequestCall {
  return {
    model: 'google/gemini-3.5-flash',
    scenario: 'message',
    promptTokens: 100,
    completionTokens: 50,
    costUsd: 1,
    costSource: 'provider',
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    ...overrides,
  };
}

function row(overrides: Partial<SpendRequestRow> = {}): SpendRequestRow {
  const calls = overrides.calls ?? [call()];
  return {
    requestKey: 'answer-1',
    userId: new Types.ObjectId(),
    departmentId: null,
    conversationId: 'conv-1',
    messageId: 'answer-1',
    models: calls.map((item) => item.model),
    callCount: calls.length,
    promptTokens: calls.reduce((sum, item) => sum + item.promptTokens, 0),
    completionTokens: calls.reduce((sum, item) => sum + item.completionTokens, 0),
    costUsd: calls.reduce((sum, item) => sum + item.costUsd, 0),
    unknownCostCalls: 0,
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    ...overrides,
    calls,
  };
}

describe('createCorporateSpendHandlers', () => {
  it('defaults to a 30 day window ending now when no range is given', async () => {
    const deps = createDeps();
    const handlers = createCorporateSpendHandlers(deps);
    const { req, res, status } = createReqRes();

    await handlers.listSpend(req, res);

    expect(status).toHaveBeenCalledWith(200);
    const query = (deps.listSpendRequests as jest.Mock).mock.calls[0][0];
    const spanDays = (query.to.getTime() - query.from.getTime()) / (24 * 60 * 60 * 1000);
    expect(spanDays).toBeCloseTo(30, 0);
  });

  it('rejects a range where "from" is after "to"', async () => {
    const deps = createDeps();
    const handlers = createCorporateSpendHandlers(deps);
    const { req, res, status } = createReqRes({
      from: '2026-08-20T00:00:00.000Z',
      to: '2026-08-01T00:00:00.000Z',
    });

    await handlers.listSpend(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.listSpendRequests).not.toHaveBeenCalled();
  });

  it('rejects a malformed userId filter instead of passing it through', async () => {
    const deps = createDeps();
    const handlers = createCorporateSpendHandlers(deps);
    const { req, res, status } = createReqRes({ userId: 'not-an-object-id' });

    await handlers.listSpend(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.listSpendRequests).not.toHaveBeenCalled();
  });

  it('caps an oversized limit at the maximum page size', async () => {
    const deps = createDeps();
    const handlers = createCorporateSpendHandlers(deps);
    const { req, res } = createReqRes({ limit: '99999' });

    await handlers.listSpend(req, res);

    const query = (deps.listSpendRequests as jest.Mock).mock.calls[0][0];
    expect(query.limit).toBe(200);
  });

  it('passes a valid userId filter through unchanged', async () => {
    const userId = new Types.ObjectId().toString();
    const deps = createDeps();
    const handlers = createCorporateSpendHandlers(deps);
    const { req, res, status } = createReqRes({ userId });

    await handlers.listSpend(req, res);

    expect(status).toHaveBeenCalledWith(200);
    const query = (deps.listSpendRequests as jest.Mock).mock.calls[0][0];
    expect(query.userId).toBe(userId);
  });

  it('joins user/department names in one bulk lookup per page, not per row', async () => {
    const userA = new Types.ObjectId();
    const userB = new Types.ObjectId();
    const departmentId = new Types.ObjectId();
    const deps = createDeps({
      listSpendRequests: jest.fn().mockResolvedValue({
        rows: [
          row({ requestKey: 'a', userId: userA, departmentId }),
          row({ requestKey: 'b', userId: userB, departmentId: null }),
        ],
        total: 2,
      }),
      findUsers: jest.fn().mockResolvedValue([
        { _id: userA, name: 'Alice', email: 'alice@example.com' },
        { _id: userB, name: 'Bob', email: 'bob@example.com' },
      ]),
      listDepartments: jest.fn().mockResolvedValue([{ _id: departmentId, name: 'Sales' }]),
    });
    const handlers = createCorporateSpendHandlers(deps);
    const { req, res, json } = createReqRes({});

    await handlers.listSpend(req, res);

    expect(deps.findUsers).toHaveBeenCalledTimes(1);
    expect(deps.listDepartments).toHaveBeenCalledTimes(1);
    const response = json.mock.calls[0][0];
    expect(response.rows[0]).toMatchObject({
      userName: 'Alice',
      departmentName: 'Sales',
    });
    expect(response.rows[1]).toMatchObject({
      userName: 'Bob',
      departmentName: 'Без отдела',
    });
  });

  /**
   * Наименование строки — это то, что выбрал сотрудник. Заголовок чата пишет самая
   * дешёвая модель, и раньше он приезжал отдельной строкой журнала; теперь он внутри
   * запроса и не должен подменять собой модель ответа.
   */
  it('names the request after the model the employee waited on, not the title writer', async () => {
    const deps = createDeps({
      listSpendRequests: jest.fn().mockResolvedValue({
        rows: [
          row({
            calls: [
              call({
                model: 'google/gemini-3.5-flash-lite',
                scenario: 'title',
                costUsd: 5,
                createdAt: new Date('2026-08-01T10:00:02.000Z'),
              }),
              call({ model: 'anthropic/claude-haiku-4.5', scenario: 'message', costUsd: 1 }),
            ],
          }),
        ],
        total: 1,
      }),
    });
    const handlers = createCorporateSpendHandlers(deps);
    const { req, res, json } = createReqRes({});

    await handlers.listSpend(req, res);

    const [request] = json.mock.calls[0][0].rows;
    expect(request.model).toBe('anthropic/claude-haiku-4.5');
    expect(request.scenario).toBe('message');
    expect(request.callCount).toBe(2);
    expect(request.calls.map((item: { scenario: string }) => item.scenario)).toEqual([
      'message',
      'title',
    ]);
  });

  it('falls back to the costliest call when nothing in the request is a message', async () => {
    const deps = createDeps({
      listSpendRequests: jest.fn().mockResolvedValue({
        rows: [
          row({
            calls: [
              call({ model: 'baai/bge-m3', scenario: 'kb_index', costUsd: 0 }),
              call({ model: 'baai/bge-m3-large', scenario: 'kb_index', costUsd: 2 }),
            ],
          }),
        ],
        total: 1,
      }),
    });
    const handlers = createCorporateSpendHandlers(deps);
    const { req, res, json } = createReqRes({});

    await handlers.listSpend(req, res);

    expect(json.mock.calls[0][0].rows[0]).toMatchObject({
      model: 'baai/bge-m3-large',
      scenario: 'kb_index',
    });
  });

  it('treats a blank scenario as an ordinary message', async () => {
    const deps = createDeps({
      listSpendRequests: jest.fn().mockResolvedValue({
        rows: [row({ calls: [call({ scenario: '' })] })],
        total: 1,
      }),
    });
    const handlers = createCorporateSpendHandlers(deps);
    const { req, res, json } = createReqRes({});

    await handlers.listSpend(req, res);

    expect(json.mock.calls[0][0].rows[0].scenario).toBe('message');
  });

  describe('transcript', () => {
    it('returns the question and the answer for one request', async () => {
      const deps = createDeps({
        getRequestTranscript: jest.fn().mockResolvedValue({
          messageId: 'answer-1',
          userId: new Types.ObjectId().toString(),
          conversationId: 'conv-1',
          conversationTitle: 'Тарифы',
          question: 'Какая ставка для маркетплейсов?',
          answer: '2,9 %',
          model: 'google/gemini-3.5-flash',
          askedAt: new Date('2026-08-01T10:00:00.000Z'),
          answeredAt: new Date('2026-08-01T10:00:04.000Z'),
        }),
      });
      const handlers = createCorporateSpendHandlers(deps);
      const { req, res, status, json } = createReqRes({}, { messageId: 'answer-1' });

      await handlers.getTranscript(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(json.mock.calls[0][0].transcript).toMatchObject({
        question: 'Какая ставка для маркетплейсов?',
        answer: '2,9 %',
        conversationTitle: 'Тарифы',
        askedAt: '2026-08-01T10:00:00.000Z',
      });
    });

    it('answers with an empty transcript when the conversation is gone', async () => {
      const deps = createDeps();
      const handlers = createCorporateSpendHandlers(deps);
      const { req, res, status, json } = createReqRes({}, { messageId: 'missing' });

      await handlers.getTranscript(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(json.mock.calls[0][0].transcript).toBeNull();
    });

    it('rejects a request with no message id', async () => {
      const deps = createDeps();
      const handlers = createCorporateSpendHandlers(deps);
      const { req, res, status } = createReqRes({}, {});

      await handlers.getTranscript(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.getRequestTranscript).not.toHaveBeenCalled();
    });

    it('refuses a department head reading a transcript from another department, as if it did not exist', async () => {
      const departmentId = new Types.ObjectId().toString();
      const authorId = new Types.ObjectId().toString();
      const deps = createDeps({
        getRequestTranscript: jest.fn().mockResolvedValue({
          messageId: 'answer-1',
          userId: authorId,
          departmentId: new Types.ObjectId().toString(),
          question: 'Какая ставка для маркетплейсов?',
          answer: '2,9 %',
        }),
        getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
      });
      const handlers = createCorporateSpendHandlers(deps);
      const { req, res, status, json } = createReqRes(
        {},
        { messageId: 'answer-1' },
        { role: 'HEAD' },
      );

      await handlers.getTranscript(req, res);

      expect(status).toHaveBeenCalledWith(404);
      expect(json).toHaveBeenCalledWith({ error: 'Transcript not found' });
    });

    it('answers 404, not 200-with-null, when a department head asks for a message that truly does not exist', async () => {
      const departmentId = new Types.ObjectId().toString();
      const deps = createDeps({
        getRequestTranscript: jest.fn().mockResolvedValue(null),
        getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
      });
      const handlers = createCorporateSpendHandlers(deps);
      const { req, res, status } = createReqRes({}, { messageId: 'missing' }, { role: 'HEAD' });

      await handlers.getTranscript(req, res);

      expect(status).toHaveBeenCalledWith(404);
    });

    it('lets a department head read a transcript authored within their own department', async () => {
      const departmentId = new Types.ObjectId().toString();
      const authorId = new Types.ObjectId().toString();
      const deps = createDeps({
        getRequestTranscript: jest.fn().mockResolvedValue({
          messageId: 'answer-1',
          userId: authorId,
          departmentId,
          question: 'Какая ставка для маркетплейсов?',
          answer: '2,9 %',
        }),
        getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
      });
      const handlers = createCorporateSpendHandlers(deps);
      const { req, res, status, json } = createReqRes(
        {},
        { messageId: 'answer-1' },
        { role: 'HEAD' },
      );

      await handlers.getTranscript(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(json.mock.calls[0][0].transcript).toMatchObject({ answer: '2,9 %' });
    });

    it("scopes by the request's own department snapshot, not the author's current department", async () => {
      // Сотрудник подал запрос из отдела A, затем перешёл в отдел B — снимок в
      // usage-записи остался A, а текущая политика автора теперь указывает B.
      const formerDepartmentId = new Types.ObjectId().toString();
      const currentDepartmentId = new Types.ObjectId().toString();
      const authorId = new Types.ObjectId().toString();
      const transcript = {
        messageId: 'answer-1',
        userId: authorId,
        departmentId: formerDepartmentId,
        question: 'Какая ставка для маркетплейсов?',
        answer: '2,9 %',
      };

      const formerHeadDeps = createDeps({
        getRequestTranscript: jest.fn().mockResolvedValue(transcript),
        getUserPolicy: jest.fn().mockResolvedValue({ departmentId: formerDepartmentId }),
      });
      const formerHeadHandlers = createCorporateSpendHandlers(formerHeadDeps);
      const formerHead = createReqRes({}, { messageId: 'answer-1' }, { role: 'HEAD' });
      await formerHeadHandlers.getTranscript(formerHead.req, formerHead.res);
      expect(formerHead.status).toHaveBeenCalledWith(200);
      expect(formerHead.json.mock.calls[0][0].transcript).toMatchObject({ answer: '2,9 %' });

      const newHeadDeps = createDeps({
        getRequestTranscript: jest.fn().mockResolvedValue(transcript),
        // Текущая политика автора теперь указывает на новый отдел — не должна
        // влиять на решение: сверяется снимок из самой записи расхода.
        getUserPolicy: jest.fn().mockResolvedValue({ departmentId: currentDepartmentId }),
      });
      const newHeadHandlers = createCorporateSpendHandlers(newHeadDeps);
      const newHead = createReqRes({}, { messageId: 'answer-1' }, { role: 'HEAD' });
      await newHeadHandlers.getTranscript(newHead.req, newHead.res);
      expect(newHead.status).toHaveBeenCalledWith(404);
    });
  });

  describe('images', () => {
    it('lists generated images with their prompts in the transcript', async () => {
      const deps = createDeps({
        getRequestTranscript: jest.fn().mockResolvedValue({
          messageId: 'answer-1',
          userId: new Types.ObjectId().toString(),
          departmentId: null,
          question: 'Нарисуй кота',
          answer: 'Готово',
          images: [
            {
              fileId: 'file-1',
              prompt: 'Рыжий кот на подоконнике',
              model: 'openai/gpt-5.4-image-2',
              createdAt: new Date('2026-10-16T10:00:00.000Z'),
            },
          ],
        }),
      });
      const handlers = createCorporateSpendHandlers(deps);
      const { req, res, json } = createReqRes({}, { messageId: 'answer-1' });

      await handlers.getTranscript(req, res);

      expect(json.mock.calls[0][0].transcript.images).toEqual([
        {
          fileId: 'file-1',
          prompt: 'Рыжий кот на подоконнике',
          model: 'openai/gpt-5.4-image-2',
          createdAt: '2026-10-16T10:00:00.000Z',
        },
      ]);
    });

    it('streams an image that belongs to the request', async () => {
      const deps = createDeps({
        getRequestImage: jest.fn().mockResolvedValue({ fileId: 'file-1', departmentId: null }),
      });
      const handlers = createCorporateSpendHandlers(deps);
      const { req, res, status } = createReqRes({}, { messageId: 'answer-1', fileId: 'file-1' });

      await handlers.getImage(req, res);

      expect(deps.getRequestImage).toHaveBeenCalledWith('answer-1', 'file-1');
      expect(deps.sendImage).toHaveBeenCalledWith(req, res, 'file-1');
      expect(status).not.toHaveBeenCalled();
    });

    it('answers 404 for an image that is not part of the request', async () => {
      const deps = createDeps();
      const handlers = createCorporateSpendHandlers(deps);
      const { req, res, status } = createReqRes({}, { messageId: 'answer-1', fileId: 'other' });

      await handlers.getImage(req, res);

      expect(status).toHaveBeenCalledWith(404);
      expect(deps.sendImage).not.toHaveBeenCalled();
    });

    it("hides another department's image from a department head", async () => {
      const deps = createDeps({
        getRequestImage: jest.fn().mockResolvedValue({
          fileId: 'file-1',
          departmentId: new Types.ObjectId().toString(),
        }),
        getUserPolicy: jest.fn().mockResolvedValue({
          departmentId: new Types.ObjectId().toString(),
        }),
      });
      const handlers = createCorporateSpendHandlers(deps);
      const { req, res, status } = createReqRes(
        {},
        { messageId: 'answer-1', fileId: 'file-1' },
        { role: 'HEAD' },
      );

      await handlers.getImage(req, res);

      expect(status).toHaveBeenCalledWith(404);
      expect(deps.sendImage).not.toHaveBeenCalled();
    });

    it('answers 404 when the stored file is gone', async () => {
      const deps = createDeps({
        getRequestImage: jest.fn().mockResolvedValue({ fileId: 'file-1', departmentId: null }),
        sendImage: jest.fn().mockResolvedValue(false),
      });
      const handlers = createCorporateSpendHandlers(deps);
      const { req, res, status } = createReqRes({}, { messageId: 'answer-1', fileId: 'file-1' });

      await handlers.getImage(req, res);

      expect(status).toHaveBeenCalledWith(404);
    });
  });

  describe('department scope', () => {
    it('rejects an employee outright', async () => {
      const deps = createDeps();
      const handlers = createCorporateSpendHandlers(deps);
      const { req, res, status } = createReqRes({}, {}, { role: 'USER' });

      await handlers.listSpend(req, res);

      expect(status).toHaveBeenCalledWith(403);
      expect(deps.listSpendRequests).not.toHaveBeenCalled();
    });

    it('rejects a department head with no department of their own', async () => {
      const deps = createDeps({
        getUserPolicy: jest.fn().mockResolvedValue({ departmentId: null }),
      });
      const handlers = createCorporateSpendHandlers(deps);
      const { req, res, status } = createReqRes({}, {}, { role: 'HEAD' });

      await handlers.listSpend(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.listSpendRequests).not.toHaveBeenCalled();
    });

    it("forces the query to the head's own department even if a different one was requested", async () => {
      const ownDepartmentId = new Types.ObjectId().toString();
      const otherDepartmentId = new Types.ObjectId().toString();
      const deps = createDeps({
        getUserPolicy: jest.fn().mockResolvedValue({ departmentId: ownDepartmentId }),
      });
      const handlers = createCorporateSpendHandlers(deps);
      const { req, res, status } = createReqRes(
        { departmentId: otherDepartmentId },
        {},
        { role: 'HEAD' },
      );

      await handlers.listSpend(req, res);

      expect(status).toHaveBeenCalledWith(200);
      const query = (deps.listSpendRequests as jest.Mock).mock.calls[0][0];
      expect(query.departmentId).toBe(ownDepartmentId);
    });
  });
});
