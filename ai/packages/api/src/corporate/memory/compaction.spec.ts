import { Types } from 'mongoose';
import type {
  IMemoryEntryLean,
  IMemorySnapshotLean,
  CreateMemorySnapshotParams,
  CompleteMemorySnapshotParams,
  ReplacePartitionMemoriesParams,
  ReplacePartitionMemoriesResult,
  RestorePartitionMemoriesParams,
} from '@librechat/data-schemas';
import type { CompactionDeps, CompactionRequest } from './compaction';
import {
  endpoint,
  usageDeps,
  completion,
  jsonResponse,
  appConfigWith,
  capturingFetch,
  isolateProviderEnv,
} from './__tests__/helpers/fixtures';
import {
  restoreMemorySnapshot,
  compactMemoryPartition,
  COMPACTION_SYSTEM_PROMPT,
  autoCompactMemoryPartition,
} from './compaction';
import Tokenizer from '~/utils/tokenizer';

isolateProviderEnv();

beforeAll(async () => {
  await Tokenizer.initEncoding('o200k_base');
}, 60_000);

let userId = new Types.ObjectId().toString();

beforeEach(() => {
  userId = new Types.ObjectId().toString();
});

function entry(key: string, value: string, day: number, title?: string): IMemoryEntryLean {
  return {
    _id: new Types.ObjectId(),
    userId: new Types.ObjectId(userId),
    key,
    value,
    ...(title ? { title } : {}),
    tokenCount: 0,
    updated_at: new Date(Date.UTC(2026, 8, day)),
  };
}

function storedEntries(): IMemoryEntryLean[] {
  return [
    entry('role', 'Сотрудник работает руководителем отдела продаж в компании Corporate.', 3, 'Роль'),
    entry('client_romashka', 'Клиент ООО «Ромашка» платит по тарифу 1,8% с оборота.', 1),
    entry(
      'romashka_terms',
      'Для ООО «Ромашка» действует тариф 1,8% с оборота, договор продлевается до 31.12.2026.',
      2,
      'Условия Ромашки',
    ),
    entry('reply_style', 'Сотрудник просит отвечать коротко и по делу, без вступлений.', 4),
  ];
}

const compactedOutput = {
  entries: [
    {
      key: 'role',
      title: 'Роль',
      value: 'Руководитель отдела продаж Corporate; отвечать коротко, без вступлений.',
    },
    {
      key: 'romashka_terms',
      title: '  Условия   Ромашки ',
      value: 'ООО «Ромашка»: тариф 1,8% с оборота, договор до 31.12.2026.',
    },
  ],
};

function createStore(initial: IMemoryEntryLean[], fetchImpl: typeof fetch) {
  let entries = [...initial];
  const snapshots = new Map<string, IMemorySnapshotLean>();
  const deps = {
    ...usageDeps(),
    fetchImpl,
    getUserMemories: jest.fn(async () => entries),
    replacePartitionMemories: jest.fn(
      async (p: ReplacePartitionMemoriesParams): Promise<ReplacePartitionMemoriesResult> => {
        const expectedIds = new Set(p.expected.map((e) => e._id.toString()));
        const same =
          expectedIds.size === entries.length &&
          entries.every((e) => expectedIds.has(e._id.toString()));
        if (!same) {
          return { ok: false, reason: 'changed' };
        }
        const appliedAt = new Date();
        entries = p.entries.map((next) => ({
          _id: new Types.ObjectId(),
          userId: new Types.ObjectId(userId),
          ...next,
          ...(p.agentId ? { agentId: p.agentId } : {}),
          ...(p.chatProjectId ? { chatProjectId: p.chatProjectId } : {}),
          updated_at: appliedAt,
        }));
        return { ok: true, insertedIds: entries.map((e) => e._id.toString()), appliedAt };
      },
    ),
    restorePartitionMemories: jest.fn(async (p: RestorePartitionMemoriesParams) => {
      const kept = entries.filter((e) => !p.compactedIds.includes(e._id.toString()));
      const keptKeys = new Set(kept.map((e) => e.key));
      const restored = p.entries
        .filter((e) => !keptKeys.has(e.key))
        .map((e) => ({ _id: new Types.ObjectId(), userId: new Types.ObjectId(userId), ...e }));
      entries = [...kept, ...restored];
      return { restored: restored.length };
    }),
    createMemorySnapshot: jest.fn(async (p: CreateMemorySnapshotParams) => {
      const id = new Types.ObjectId();
      snapshots.set(id.toString(), {
        _id: id,
        userId: new Types.ObjectId(userId),
        agentId: p.agentId ?? null,
        chatProjectId: p.chatProjectId ?? null,
        entries: p.entries,
        reason: p.reason,
        before: p.entries.length,
        after: null,
        createdAt: new Date(),
      });
      return { id: id.toString() };
    }),
    completeMemorySnapshot: jest.fn(async (p: CompleteMemorySnapshotParams) => {
      const snapshot = snapshots.get(p.snapshotId);
      if (snapshot) {
        snapshot.after = p.after;
        snapshot.appliedAt = p.appliedAt;
        snapshot.compactedIds = p.compactedIds;
      }
    }),
    getMemorySnapshot: jest.fn(
      async (p: { snapshotId: string }) => snapshots.get(p.snapshotId) ?? null,
    ),
    deleteMemorySnapshot: jest.fn(async (p: { snapshotId: string }) => {
      snapshots.delete(p.snapshotId);
    }),
  } satisfies CompactionDeps;
  return {
    deps,
    snapshots,
    current: () => entries,
    write: (next: IMemoryEntryLean) => {
      entries = [...entries, next];
    },
  };
}

function request(overrides: Partial<CompactionRequest> = {}): CompactionRequest {
  return {
    appConfig: appConfigWith(),
    userId,
    userName: 'Иван',
    reason: 'manual',
    charLimit: 2000,
    ...overrides,
  };
}

function tokens(values: string[]): number {
  return values.reduce((sum, value) => sum + Tokenizer.getTokenCount(value, 'o200k_base'), 0);
}

function compactedFetch() {
  return capturingFetch(jsonResponse(completion(JSON.stringify(compactedOutput))));
}

function deferredFetch() {
  const pending: Array<() => void> = [];
  const fetchImpl = jest.fn(
    () =>
      new Promise<Response>((resolve) => {
        pending.push(() => resolve(jsonResponse(completion(JSON.stringify(compactedOutput)))));
      }),
  ) as unknown as typeof fetch;
  return { fetchImpl, answer: () => pending.splice(0).forEach((resolve) => resolve()) };
}

describe('compactMemoryPartition', () => {
  it('заменяет раздел сжатым списком, сохранив снимок и записав расход', async () => {
    const stored = storedEntries();
    const { fetchImpl, calls } = capturingFetch(
      jsonResponse(completion(JSON.stringify(compactedOutput), { cost: 0.002 })),
    );
    const { deps, snapshots, current } = createStore(stored, fetchImpl);

    const outcome = await compactMemoryPartition(
      deps,
      request({ chatProjectId: 'proj-1', reason: 'auto' }),
    );

    const afterTokens = tokens(compactedOutput.entries.map((e) => e.value));
    expect(outcome).toEqual({
      compacted: true,
      before: 4,
      after: 2,
      beforeTokens: tokens(stored.map((e) => e.value)),
      afterTokens,
      snapshotId: expect.any(String),
    });
    expect(deps.getUserMemories).toHaveBeenCalledWith({
      userId,
      agentId: undefined,
      chatProjectId: 'proj-1',
    });

    expect(calls[0].body.response_format).toEqual({ type: 'json_object' });
    const [system, user] = calls[0].body.messages as Array<{ content: string }>;
    expect(system.content).toBe(COMPACTION_SYSTEM_PROMPT);
    const sentKeys = (
      JSON.parse(user.content.split('\n\n')[0]) as {
        entries: Array<{ key: string; updated: string }>;
      }
    ).entries;
    expect(sentKeys.map((e) => e.key)).toEqual([
      'client_romashka',
      'romashka_terms',
      'role',
      'reply_style',
    ]);
    expect(sentKeys[0].updated).toBe('2026-09-01');
    expect(user.content).toContain('не больше 2000 знаков');

    const snapshot = snapshots.get(outcome.snapshotId!)!;
    expect(snapshot).toMatchObject({
      reason: 'auto',
      chatProjectId: 'proj-1',
      before: 4,
      after: 2,
    });
    expect(snapshot.entries.map((e) => e.key)).toEqual(sentKeys.map((e) => e.key));
    expect(snapshot.compactedIds).toEqual(current().map((e) => e._id.toString()));
    expect(snapshot.appliedAt).toBeInstanceOf(Date);
    expect(deps.createMemorySnapshot.mock.invocationCallOrder[0]).toBeLessThan(
      deps.replacePartitionMemories.mock.invocationCallOrder[0],
    );

    expect(deps.replacePartitionMemories).toHaveBeenCalledWith({
      userId,
      agentId: undefined,
      chatProjectId: 'proj-1',
      expected: stored.map((e) => ({ _id: e._id, updated_at: e.updated_at })),
      entries: [
        {
          key: 'role',
          title: 'Роль',
          value: compactedOutput.entries[0].value,
          tokenCount: Tokenizer.getTokenCount(compactedOutput.entries[0].value, 'o200k_base'),
        },
        {
          key: 'romashka_terms',
          title: 'Условия Ромашки',
          value: compactedOutput.entries[1].value,
          tokenCount: Tokenizer.getTokenCount(compactedOutput.entries[1].value, 'o200k_base'),
        },
      ],
    });
    expect(current()).toHaveLength(2);
    expect(deps.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ userId, scenario: 'memory_compact', costUsd: 0.002 }),
    );
  });

  it('принимает ответ в обёртке ```json', async () => {
    const fenced = '```json\n' + JSON.stringify(compactedOutput) + '\n```';
    const { fetchImpl } = capturingFetch(jsonResponse(completion(fenced)));
    const { deps } = createStore(storedEntries(), fetchImpl);

    const outcome = await compactMemoryPartition(deps, request());

    expect(outcome.compacted).toBe(true);
  });

  it('не зовёт модель, если записей меньше трёх', async () => {
    const stored = storedEntries().slice(0, 2);
    const { fetchImpl } = capturingFetch(jsonResponse(completion('{}')));
    const { deps } = createStore(stored, fetchImpl);

    const outcome = await compactMemoryPartition(deps, request());

    expect(outcome).toEqual({
      compacted: false,
      reason: 'too_few',
      before: 2,
      after: 2,
      beforeTokens: tokens(stored.map((e) => e.value)),
      afterTokens: tokens(stored.map((e) => e.value)),
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('без модели для служебных вызовов возвращает no_model', async () => {
    const { fetchImpl } = capturingFetch(jsonResponse(completion('{}')));
    const { deps } = createStore(storedEntries(), fetchImpl);

    const outcome = await compactMemoryPartition(
      deps,
      request({ appConfig: appConfigWith([endpoint('OpenRouter', { titleModel: undefined })]) }),
    );

    expect(outcome).toMatchObject({ compacted: false, reason: 'no_model', before: 4, after: 4 });
    expect(deps.recordUsage).not.toHaveBeenCalled();
  });

  it.each([
    ['не JSON', 'просто текст'],
    ['пустой список', JSON.stringify({ entries: [] })],
    ['нет entries', JSON.stringify({ items: compactedOutput.entries })],
    ['пустое значение', JSON.stringify({ entries: [{ key: 'role', value: '   ' }] })],
    [
      'слишком длинное значение',
      JSON.stringify({ entries: [{ key: 'role', value: 'я'.repeat(2001) }] }),
    ],
    ['запись не объект', JSON.stringify({ entries: ['role'] })],
    [
      'записей больше, чем было',
      JSON.stringify({
        entries: ['a', 'b', 'c', 'd', 'e'].map((key) => ({ key, value: 'Кратко.' })),
      }),
    ],
  ])('отклоняет ответ модели (%s) и ничего не меняет', async (_label, output) => {
    const { fetchImpl } = capturingFetch(jsonResponse(completion(output)));
    const { deps, current } = createStore(storedEntries(), fetchImpl);

    const outcome = await compactMemoryPartition(deps, request());

    expect(outcome).toMatchObject({ compacted: false, reason: 'invalid', before: 4, after: 4 });
    expect(deps.createMemorySnapshot).not.toHaveBeenCalled();
    expect(deps.replacePartitionMemories).not.toHaveBeenCalled();
    expect(current()).toHaveLength(4);
    expect(deps.recordUsage).toHaveBeenCalledTimes(1);
  });

  it('исправляет ключи модели вместо того, чтобы браковать сжатие', async () => {
    const output = {
      entries: [
        { key: 'Project 2026', value: 'Проект.' },
        { key: 'project', value: 'Ещё проект.' },
        { key: 'project', value: 'И ещё.' },
        { key: 'роль', value: 'Роль.' },
      ],
    };
    const { fetchImpl } = capturingFetch(jsonResponse(completion(JSON.stringify(output))));
    const { deps, current } = createStore(storedEntries(), fetchImpl);

    const outcome = await compactMemoryPartition(deps, request());

    expect(outcome.compacted).toBe(true);
    expect(current().map((e) => e.key)).toEqual(['project', 'project_b', 'project_c', 'note']);
  });

  it('заменяет ключ nothing и пустой ключ на note с суффиксами', async () => {
    const output = {
      entries: [
        { key: 'nothing', value: 'Первое.' },
        { key: '___', value: 'Второе.' },
        { value: 'Третье.' },
      ],
    };
    const { fetchImpl } = capturingFetch(jsonResponse(completion(JSON.stringify(output))));
    const { deps, current } = createStore(storedEntries(), fetchImpl);

    await compactMemoryPartition(deps, request());

    expect(current().map((e) => e.key)).toEqual(['note', 'note_b', 'note_c']);
  });

  it('не заменяет раздел, если сжатый текст не короче исходного', async () => {
    const stored = storedEntries();
    const bigger = {
      entries: stored.map((e) => ({ key: e.key, title: 'Запись', value: `${e.value} ${e.value}` })),
    };
    const { fetchImpl } = capturingFetch(jsonResponse(completion(JSON.stringify(bigger))));
    const { deps } = createStore(stored, fetchImpl);

    const outcome = await compactMemoryPartition(deps, request());

    expect(outcome).toMatchObject({ compacted: false, reason: 'not_smaller' });
    expect(deps.replacePartitionMemories).not.toHaveBeenCalled();
  });

  it('записывает расход обрезанного ответа и считает попытку неудачной', async () => {
    const { fetchImpl } = capturingFetch(
      jsonResponse(completion('{"entries":[{"key":"ro', { cost: 0.01 }, 'length')),
    );
    const { deps, current } = createStore(storedEntries(), fetchImpl);

    const outcome = await compactMemoryPartition(deps, request());

    expect(outcome).toMatchObject({ compacted: false, reason: 'invalid' });
    expect(deps.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ scenario: 'memory_compact', costUsd: 0.01 }),
    );
    expect(current()).toHaveLength(4);
  });

  it('пробрасывает сбой модели, ничего не меняя', async () => {
    const { fetchImpl } = capturingFetch(jsonResponse({}, 503));
    const { deps } = createStore(storedEntries(), fetchImpl);

    await expect(compactMemoryPartition(deps, request())).rejects.toThrow(/503/);
    expect(deps.replacePartitionMemories).not.toHaveBeenCalled();
  });

  it('не трогает раздел и удаляет снимок, если раздел изменился за время сжатия', async () => {
    const { fetchImpl, answer } = deferredFetch();
    const { deps, snapshots, current, write } = createStore(storedEntries(), fetchImpl);

    const pending = compactMemoryPartition(deps, request());
    await new Promise((resolve) => setImmediate(resolve));
    write(entry('deadline', 'Дедлайн по договору — 30.09.', 25));
    answer();
    const outcome = await pending;

    expect(outcome).toMatchObject({ compacted: false, reason: 'changed', before: 4, after: 4 });
    expect(outcome.snapshotId).toBeUndefined();
    expect(current()).toHaveLength(5);
    expect(snapshots.size).toBe(0);
    expect(deps.completeMemorySnapshot).not.toHaveBeenCalled();
  });

  it('при сбое замены удаляет снимок и сообщает об ошибке', async () => {
    const { fetchImpl } = compactedFetch();
    const { deps, snapshots } = createStore(storedEntries(), fetchImpl);
    deps.replacePartitionMemories.mockRejectedValueOnce(new Error('insert failed'));

    await expect(compactMemoryPartition(deps, request())).rejects.toThrow('insert failed');

    expect(snapshots.size).toBe(0);
    expect(deps.completeMemorySnapshot).not.toHaveBeenCalled();
  });

  it('не запускает второе сжатие того же раздела, пока идёт первое', async () => {
    const { fetchImpl, answer } = deferredFetch();
    const { deps } = createStore(storedEntries(), fetchImpl);

    const first = compactMemoryPartition(deps, request({ reason: 'auto' }));
    const second = await compactMemoryPartition(deps, request());
    const otherPartition = compactMemoryPartition(deps, request({ chatProjectId: 'proj-1' }));
    await new Promise((resolve) => setImmediate(resolve));
    answer();

    expect(second).toMatchObject({ compacted: false, reason: 'busy' });
    await expect(first).resolves.toMatchObject({ compacted: true });
    await expect(otherPartition).resolves.not.toMatchObject({ reason: 'busy' });
    const third = await compactMemoryPartition(deps, request());
    expect(third.reason).toBe('too_few');
  });
});

describe('autoCompactMemoryPartition', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('после любой попытки делает паузу 6 часов, ручное сжатие паузу не соблюдает', async () => {
    const now = Date.UTC(2026, 8, 25, 9);
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    const { fetchImpl } = capturingFetch(jsonResponse(completion('просто текст')));
    const { deps } = createStore(storedEntries(), fetchImpl);
    const { reason: _reason, ...auto } = request();

    await expect(autoCompactMemoryPartition(deps, auto)).resolves.toMatchObject({
      reason: 'invalid',
    });
    clock.mockReturnValue(now + 5 * 60 * 60 * 1000);
    await expect(autoCompactMemoryPartition(deps, auto)).resolves.toBeNull();
    await expect(compactMemoryPartition(deps, request())).resolves.toMatchObject({
      reason: 'invalid',
    });
    await expect(
      autoCompactMemoryPartition(deps, { ...auto, chatProjectId: 'proj-1' }),
    ).resolves.not.toBeNull();
    clock.mockReturnValue(now + 11 * 60 * 60 * 1000 + 1);
    await expect(autoCompactMemoryPartition(deps, auto)).resolves.toMatchObject({
      reason: 'invalid',
    });
    expect(deps.createMemorySnapshot.mock.calls.every(([p]) => p.reason === 'auto')).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('сохраняет снимок с причиной auto', async () => {
    const { fetchImpl } = compactedFetch();
    const { deps, snapshots } = createStore(storedEntries(), fetchImpl);
    const { reason: _reason, ...auto } = request();

    const outcome = await autoCompactMemoryPartition(deps, auto);

    expect(outcome?.compacted).toBe(true);
    expect(snapshots.get(outcome!.snapshotId!)?.reason).toBe('auto');
  });
});

describe('restoreMemorySnapshot', () => {
  it('возвращает сжатые записи из снимка, не трогая записанное после сжатия', async () => {
    const stored = storedEntries();
    const { fetchImpl } = compactedFetch();
    const { deps, snapshots, current, write } = createStore(stored, fetchImpl);
    const outcome = await compactMemoryPartition(deps, request({ agentId: 'agent-1' }));
    const snapshot = snapshots.get(outcome.snapshotId!)!;
    write(entry('phone', 'Телефон Иванова +7 900 000-00-00.', 26));

    const restored = await restoreMemorySnapshot(deps, {
      userId,
      snapshotId: outcome.snapshotId!,
    });

    expect(restored).toEqual({ restored: true, count: 4 });
    expect(deps.restorePartitionMemories).toHaveBeenCalledWith({
      userId,
      agentId: 'agent-1',
      chatProjectId: undefined,
      compactedIds: snapshot.compactedIds,
      appliedAt: snapshot.appliedAt,
      entries: snapshot.entries,
    });
    expect(
      current()
        .map((e) => e.key)
        .sort(),
    ).toEqual([...stored.map((e) => e.key), 'phone'].sort());
    expect(snapshots.size).toBe(0);
  });

  it('сообщает, что снимка нет', async () => {
    const { fetchImpl } = capturingFetch(jsonResponse(completion('{}')));
    const { deps } = createStore(storedEntries(), fetchImpl);

    const restored = await restoreMemorySnapshot(deps, {
      userId,
      snapshotId: new Types.ObjectId().toString(),
    });

    expect(restored).toEqual({ restored: false, count: 0 });
    expect(deps.restorePartitionMemories).not.toHaveBeenCalled();
  });

  it('при двойной отмене восстанавливает раздел один раз', async () => {
    const { fetchImpl } = compactedFetch();
    const { deps } = createStore(storedEntries(), fetchImpl);
    const outcome = await compactMemoryPartition(deps, request());
    const undo = { userId, snapshotId: outcome.snapshotId! };

    const results = await Promise.all([
      restoreMemorySnapshot(deps, undo),
      restoreMemorySnapshot(deps, undo),
    ]);

    expect(results).toEqual([
      { restored: true, count: 4 },
      { restored: false, count: 0 },
    ]);
    expect(deps.restorePartitionMemories).toHaveBeenCalledTimes(1);
  });
});
