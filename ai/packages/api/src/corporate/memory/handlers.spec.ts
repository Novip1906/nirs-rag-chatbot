import { Types } from 'mongoose';
import type { Request, Response, NextFunction } from 'express';
import type { MemoryV2HandlerDeps } from './handlers';
import {
  usageDeps,
  completion,
  jsonResponse,
  appConfigWith,
  capturingFetch,
  isolateProviderEnv,
} from './__tests__/helpers/fixtures';
import { createMemoryV2Handlers } from './handlers';
import Tokenizer from '~/utils/tokenizer';

isolateProviderEnv();

beforeAll(async () => {
  await Tokenizer.initEncoding('o200k_base');
}, 60_000);

const userId = new Types.ObjectId().toString();

function createDeps(overrides: Partial<MemoryV2HandlerDeps> = {}) {
  const { fetchImpl } = capturingFetch(jsonResponse(completion('{}')));
  return {
    ...usageDeps(),
    fetchImpl,
    revertMemory: jest.fn().mockResolvedValue({ ok: true }),
    getRecentMemorySnapshots: jest.fn().mockResolvedValue([]),
    getUserMemories: jest.fn().mockResolvedValue([]),
    replacePartitionMemories: jest
      .fn()
      .mockResolvedValue({ ok: true, insertedIds: ['new-1'], appliedAt: new Date() }),
    restorePartitionMemories: jest.fn().mockResolvedValue({ restored: 2 }),
    createMemorySnapshot: jest.fn().mockResolvedValue({ id: 'snap-1' }),
    completeMemorySnapshot: jest.fn().mockResolvedValue(undefined),
    getMemorySnapshot: jest.fn().mockResolvedValue(null),
    deleteMemorySnapshot: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } satisfies MemoryV2HandlerDeps;
}

function call(
  handler: (req: Request, res: Response, next: NextFunction) => unknown,
  body: unknown,
  options: { user?: Record<string, unknown> | null; config?: unknown } = {},
) {
  const json = jest.fn();
  const status = jest.fn();
  const res = { status, json } as unknown as Response;
  status.mockReturnValue(res);
  const req = {
    body,
    user: options.user === null ? undefined : (options.user ?? { id: userId, name: 'Иван' }),
    config:
      options.config === undefined
        ? appConfigWith(undefined, {}, { charLimit: 500 })
        : options.config,
  } as unknown as Request;
  return Promise.resolve(handler(req, res, jest.fn())).then(() => ({ status, json }));
}

describe('createMemoryV2Handlers.revert', () => {
  it('откатывает изменённую запись к прежнему значению с пересчитанными токенами', async () => {
    const deps = createDeps();
    const { revert } = createMemoryV2Handlers(deps);

    const { status, json } = await call(revert, {
      key: 'role',
      agentId: ' ',
      chatProjectId: ' proj-1 ',
      expectedValue: 'Новое значение',
      previous: { value: 'Руководитель отдела продаж', title: 'Роль' },
    });

    expect(deps.revertMemory).toHaveBeenCalledWith({
      userId,
      key: 'role',
      agentId: undefined,
      chatProjectId: 'proj-1',
      expectedValue: 'Новое значение',
      previous: {
        value: 'Руководитель отдела продаж',
        title: 'Роль',
        tokenCount: Tokenizer.getTokenCount('Руководитель отдела продаж', 'o200k_base'),
      },
    });
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ reverted: true });
  });

  it('удаляет запись, созданную ИИ, когда прежнего состояния нет', async () => {
    const deps = createDeps();
    const { revert } = createMemoryV2Handlers(deps);

    await call(revert, { key: 'role', expectedValue: 'Значение', previous: null });

    expect(deps.revertMemory).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'role', previous: null }),
    );
  });

  it.each([
    ['changed', 409],
    ['not_found', 404],
    ['invalid_project', 400],
    [undefined, 500],
  ])('отвечает на отказ %s кодом %i', async (reason, code) => {
    const deps = createDeps({ revertMemory: jest.fn().mockResolvedValue({ ok: false, reason }) });
    const { revert } = createMemoryV2Handlers(deps);

    const { status } = await call(revert, { key: 'role', expectedValue: 'x', previous: null });

    expect(status).toHaveBeenCalledWith(code);
  });

  it.each([
    ['без ключа', { expectedValue: 'x', previous: null }],
    ['без expectedValue', { key: 'role', previous: null }],
    ['без previous', { key: 'role', expectedValue: 'x' }],
    ['previous без value', { key: 'role', expectedValue: 'x', previous: { title: 'Роль' } }],
    ['title не строка', { key: 'role', expectedValue: 'x', previous: { value: 'v', title: 1 } }],
  ])('отклоняет тело %s', async (_label, body) => {
    const deps = createDeps();
    const { revert } = createMemoryV2Handlers(deps);

    const { status } = await call(revert, body);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.revertMemory).not.toHaveBeenCalled();
  });

  it('требует пользователя и отдаёт 500 при сбое базы', async () => {
    const failing = createDeps({ revertMemory: jest.fn().mockRejectedValue(new Error('db')) });
    const { revert } = createMemoryV2Handlers(failing);

    const anonymous = await call(
      revert,
      { key: 'k', expectedValue: 'x', previous: null },
      { user: null },
    );
    const broken = await call(revert, { key: 'k', expectedValue: 'x', previous: null });

    expect(anonymous.status).toHaveBeenCalledWith(401);
    expect(broken.status).toHaveBeenCalledWith(500);
  });
});

describe('createMemoryV2Handlers.compact', () => {
  it('сжимает раздел из тела запроса вручную с лимитом знаков из конфига', async () => {
    const deps = createDeps({
      getUserMemories: jest.fn().mockResolvedValue([
        { key: 'a', value: 'Первая запись', updated_at: new Date() },
        { key: 'b', value: 'Вторая запись', updated_at: new Date() },
      ]),
    });
    const { compact } = createMemoryV2Handlers(deps);

    const { status, json } = await call(compact, { chatProjectId: 'proj-1' });

    expect(deps.getUserMemories).toHaveBeenCalledWith({
      userId,
      agentId: undefined,
      chatProjectId: 'proj-1',
    });
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ compacted: false, reason: 'too_few', before: 2, after: 2 }),
    );
  });

  it('помечает снимок как ручной и передаёт charLimit', async () => {
    const values = ['Первая длинная запись о сотруднике', 'Вторая длинная запись', 'Третья запись'];
    const output = JSON.stringify({ entries: [{ key: 'summary', title: 'Итог', value: 'Итог.' }] });
    const { fetchImpl, calls } = capturingFetch(jsonResponse(completion(output)));
    const deps = createDeps({
      fetchImpl,
      getUserMemories: jest.fn().mockResolvedValue(
        values.map((value, index) => ({
          key: `k_${'x'.repeat(index + 1)}`,
          value,
          updated_at: new Date(),
        })),
      ),
    });
    const { compact } = createMemoryV2Handlers(deps);

    const { json } = await call(compact, {});

    expect(deps.createMemorySnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ userId, reason: 'manual' }),
    );
    expect(JSON.stringify(calls[0].body)).toContain('не больше 500 знаков');
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ compacted: true, before: 3, after: 1, snapshotId: 'snap-1' }),
    );
  });

  it('отвечает 409 busy, пока тот же раздел уже сжимается', async () => {
    const output = JSON.stringify({ entries: [{ key: 'summary', title: 'Итог', value: 'Итог.' }] });
    const pending: Array<() => void> = [];
    const fetchImpl = jest.fn(
      () =>
        new Promise<globalThis.Response>((resolve) => {
          pending.push(() => resolve(jsonResponse(completion(output))));
        }),
    ) as unknown as typeof fetch;
    const deps = createDeps({
      fetchImpl,
      getUserMemories: jest.fn().mockResolvedValue(
        ['Первая длинная запись', 'Вторая длинная запись', 'Третья длинная запись'].map(
          (value, index) => ({
            _id: new Types.ObjectId(),
            key: `k_${'x'.repeat(index + 1)}`,
            value,
            updated_at: new Date(),
          }),
        ),
      ),
    });
    const { compact } = createMemoryV2Handlers(deps);

    const first = call(compact, { agentId: 'agent-busy' });
    const second = await call(compact, { agentId: 'agent-busy' });
    await new Promise((resolve) => setImmediate(resolve));
    pending.splice(0).forEach((resolve) => resolve());

    expect(second.status).toHaveBeenCalledWith(409);
    expect(second.json).toHaveBeenCalledWith(
      expect.objectContaining({ compacted: false, reason: 'busy' }),
    );
    expect((await first).status).toHaveBeenCalledWith(200);
  });

  it('отдаёт 500 при сбое сжатия или без конфигурации', async () => {
    const deps = createDeps({ getUserMemories: jest.fn().mockRejectedValue(new Error('db')) });
    const { compact } = createMemoryV2Handlers(deps);

    const broken = await call(compact, {});
    const noConfig = await call(compact, {}, { config: null });

    expect(broken.status).toHaveBeenCalledWith(500);
    expect(noConfig.status).toHaveBeenCalledWith(500);
  });
});

describe('createMemoryV2Handlers.undoCompaction', () => {
  it('восстанавливает снимок и сообщает число записей', async () => {
    const appliedAt = new Date();
    const deps = createDeps({
      getMemorySnapshot: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        agentId: null,
        chatProjectId: 'proj-1',
        appliedAt,
        compactedIds: ['new-a'],
        entries: [
          { key: 'a', value: 'A', tokenCount: 1, updated_at: new Date() },
          { key: 'b', value: 'B', title: 'Бэ', tokenCount: 1, updated_at: new Date() },
        ],
      }),
    });
    const { undoCompaction } = createMemoryV2Handlers(deps);

    const { status, json } = await call(undoCompaction, { snapshotId: 'snap-1' });

    expect(deps.getMemorySnapshot).toHaveBeenCalledWith({ userId, snapshotId: 'snap-1' });
    expect(deps.restorePartitionMemories).toHaveBeenCalledWith({
      userId,
      agentId: undefined,
      chatProjectId: 'proj-1',
      compactedIds: ['new-a'],
      appliedAt,
      entries: [
        { key: 'a', value: 'A', tokenCount: 1, updated_at: expect.any(Date) },
        { key: 'b', value: 'B', title: 'Бэ', tokenCount: 1, updated_at: expect.any(Date) },
      ],
    });
    expect(deps.deleteMemorySnapshot).toHaveBeenCalledWith({ userId, snapshotId: 'snap-1' });
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ restored: true, count: 2 });
  });

  it('отвечает 404 на чужой или устаревший снимок и 400 без идентификатора', async () => {
    const deps = createDeps();
    const { undoCompaction } = createMemoryV2Handlers(deps);

    const missing = await call(undoCompaction, { snapshotId: 'snap-1' });
    const empty = await call(undoCompaction, {});

    expect(missing.status).toHaveBeenCalledWith(404);
    expect(empty.status).toHaveBeenCalledWith(400);
  });
});

describe('createMemoryV2Handlers.listCompactions', () => {
  it('отдаёт сжатия за последние сутки с датой строкой', async () => {
    const createdAt = new Date('2026-09-25T08:00:00Z');
    const getRecentMemorySnapshots = jest.fn().mockResolvedValue([
      {
        snapshotId: 'snap-1',
        agentId: null,
        chatProjectId: 'proj-1',
        before: 9,
        after: 4,
        reason: 'auto',
        createdAt,
      },
    ]);
    const deps = createDeps({ getRecentMemorySnapshots });
    const { listCompactions } = createMemoryV2Handlers(deps);
    const startedAt = Date.now();

    const compactions = await listCompactions(userId);

    const [{ since }] = getRecentMemorySnapshots.mock.calls[0] as [{ since: Date }];
    expect(startedAt - since.getTime()).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 1000);
    expect(startedAt - since.getTime()).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 1000);
    expect(compactions).toEqual([
      {
        snapshotId: 'snap-1',
        agentId: null,
        chatProjectId: 'proj-1',
        before: 9,
        after: 4,
        reason: 'auto',
        createdAt: createdAt.toISOString(),
      },
    ]);
  });

  it('при сбое чтения отдаёт пустой список', async () => {
    const deps = createDeps({
      getRecentMemorySnapshots: jest.fn().mockRejectedValue(new Error('db')),
    });

    await expect(createMemoryV2Handlers(deps).listCompactions(userId)).resolves.toEqual([]);
  });
});
