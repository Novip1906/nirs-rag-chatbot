import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createDepartmentModel } from '../models/department';
import { createUsageRecordModel } from '../models/usageRecord';
import { createUserModel } from '../models/user';
import { createAnalyticsMethods } from './analytics';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await Promise.all([
    createUsageRecordModel(mongoose).init(),
    createDepartmentModel(mongoose).init(),
    createUserModel(mongoose).init(),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([
    mongoose.models.UsageRecord.deleteMany({}),
    mongoose.models.Department.deleteMany({}),
    mongoose.models.User.deleteMany({}),
  ]);
});

const DAY = 24 * 60 * 60 * 1000;

describe('Analytics methods', () => {
  it('группирует по пользователю и подтягивает имя через $lookup', async () => {
    const methods = createAnalyticsMethods(mongoose);
    const user = await mongoose.models.User.create({
      name: 'Иван Иванов',
      username: 'ivan',
      email: 'ivan@example.com',
    });
    const otherUser = await mongoose.models.User.create({
      name: 'Пётр Петров',
      username: 'petr',
      email: 'petr@example.com',
    });

    await mongoose.models.UsageRecord.create([
      {
        userId: user._id,
        model: 'anthropic/claude-haiku-4.5',
        costUsd: 10,
        costSource: 'provider',
        promptTokens: 100,
        completionTokens: 50,
      },
      {
        userId: user._id,
        model: 'google/gemini-3.5-flash',
        costUsd: 5,
        costSource: 'provider',
        promptTokens: 20,
        completionTokens: 10,
      },
      {
        userId: otherUser._id,
        model: 'anthropic/claude-haiku-4.5',
        costUsd: 1,
        costSource: 'provider',
        promptTokens: 5,
        completionTokens: 5,
      },
    ]);

    const rows = await methods.getSpendSummary({
      from: new Date(Date.now() - DAY),
      to: new Date(Date.now() + DAY),
      groupBy: 'user',
    });

    expect(rows).toHaveLength(2);
    const ivanRow = rows.find((row) => row.key === user._id.toString());
    expect(ivanRow?.label).toBe('Иван Иванов');
    expect(ivanRow?.costUsd).toBeCloseTo(15);
    expect(ivanRow?.requests).toBe(2);
    expect(ivanRow?.promptTokens).toBe(120);
    expect(ivanRow?.completionTokens).toBe(60);
  });

  it('группирует по отделу и подписывает записи без отдела', async () => {
    const methods = createAnalyticsMethods(mongoose);
    const department = await mongoose.models.Department.create({ name: 'Юристы' });
    const userId = new mongoose.Types.ObjectId();

    await mongoose.models.UsageRecord.create([
      {
        userId,
        departmentId: department._id,
        model: 'anthropic/claude-haiku-4.5',
        costUsd: 20,
        costSource: 'provider',
      },
      {
        userId,
        departmentId: null,
        model: 'anthropic/claude-haiku-4.5',
        costUsd: 7,
        costSource: 'provider',
      },
    ]);

    const rows = await methods.getSpendSummary({
      from: new Date(Date.now() - DAY),
      to: new Date(Date.now() + DAY),
      groupBy: 'department',
    });

    expect(rows).toHaveLength(2);
    const departmentRow = rows.find((row) => row.key === department._id.toString());
    const noDepartmentRow = rows.find((row) => row.label === 'Без отдела');
    expect(departmentRow?.label).toBe('Юристы');
    expect(departmentRow?.costUsd).toBe(20);
    expect(noDepartmentRow?.costUsd).toBe(7);
  });

  it('различает расход удалённого отдела и записи без отдела разными подписями', async () => {
    const methods = createAnalyticsMethods(mongoose);
    const userId = new mongoose.Types.ObjectId();
    const deletedDepartmentId = new mongoose.Types.ObjectId();

    await mongoose.models.UsageRecord.create([
      {
        userId,
        departmentId: deletedDepartmentId,
        model: 'anthropic/claude-haiku-4.5',
        costUsd: 50000,
        costSource: 'provider',
      },
      {
        userId,
        departmentId: null,
        model: 'anthropic/claude-haiku-4.5',
        costUsd: 7,
        costSource: 'provider',
      },
    ]);
    /** Отдел никогда не создавался в этом тесте — записи ссылаются на ObjectId, которого
     * в коллекции Department нет, как после реального удаления отдела. */

    const rows = await methods.getSpendSummary({
      from: new Date(Date.now() - DAY),
      to: new Date(Date.now() + DAY),
      groupBy: 'department',
    });

    expect(rows).toHaveLength(2);
    const orphanedRow = rows.find((row) => row.key === deletedDepartmentId.toString());
    const noDepartmentRow = rows.find((row) => row.key === 'none');

    expect(orphanedRow?.costUsd).toBe(50000);
    expect(noDepartmentRow?.costUsd).toBe(7);
    expect(orphanedRow?.label).not.toBe(noDepartmentRow?.label);
    expect(noDepartmentRow?.label).toBe('Без отдела');
  });

  it('группирует по модели', async () => {
    const methods = createAnalyticsMethods(mongoose);
    const userId = new mongoose.Types.ObjectId();

    await mongoose.models.UsageRecord.create([
      { userId, model: 'anthropic/claude-haiku-4.5', costUsd: 3, costSource: 'provider' },
      { userId, model: 'anthropic/claude-haiku-4.5', costUsd: 4, costSource: 'provider' },
      { userId, model: 'google/gemini-3.5-flash', costUsd: 1, costSource: 'provider' },
    ]);

    const rows = await methods.getSpendSummary({
      from: new Date(Date.now() - DAY),
      to: new Date(Date.now() + DAY),
      groupBy: 'model',
    });

    expect(rows).toHaveLength(2);
    const claudeRow = rows.find((row) => row.key === 'anthropic/claude-haiku-4.5');
    expect(claudeRow?.label).toBe('anthropic/claude-haiku-4.5');
    expect(claudeRow?.costUsd).toBe(7);
    expect(claudeRow?.requests).toBe(2);
  });

  it('группирует по дню', async () => {
    const methods = createAnalyticsMethods(mongoose);
    const userId = new mongoose.Types.ObjectId();
    const today = new Date();
    const yesterday = new Date(today.getTime() - DAY);

    await mongoose.models.UsageRecord.create({
      userId,
      model: 'google/gemini-3.5-flash',
      costUsd: 9,
      costSource: 'provider',
      createdAt: yesterday,
    });
    await mongoose.models.UsageRecord.create({
      userId,
      model: 'google/gemini-3.5-flash',
      costUsd: 1,
      costSource: 'provider',
    });

    const rows = await methods.getSpendSummary({
      from: new Date(yesterday.getTime() - DAY),
      to: new Date(today.getTime() + DAY),
      groupBy: 'day',
    });

    expect(rows).toHaveLength(2);
  });

  it('группирует по дню в московской таймзоне, а не в UTC', async () => {
    const methods = createAnalyticsMethods(mongoose);
    const userId = new mongoose.Types.ObjectId();

    /**
     * 23:30 UTC 1 января — это 02:30 МСК 2 января. Если группировка идёт по UTC, запись
     * попадёт в «2026-01-01»; по Москве (как считает assertWithinLimits) — в «2026-01-02».
     */
    await mongoose.models.UsageRecord.create({
      userId,
      model: 'google/gemini-3.5-flash',
      costUsd: 10,
      costSource: 'provider',
      createdAt: new Date('2026-01-01T23:30:00.000Z'),
    });

    const rows = await methods.getSpendSummary({
      from: new Date('2026-01-01T00:00:00.000Z'),
      to: new Date('2026-01-03T00:00:00.000Z'),
      groupBy: 'day',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe('2026-01-02');
  });

  it('не добавляет costSource: unknown в сумму стоимости, но считает такие запросы отдельно', async () => {
    const methods = createAnalyticsMethods(mongoose);
    const userId = new mongoose.Types.ObjectId();

    await mongoose.models.UsageRecord.create([
      { userId, model: 'google/gemini-3.5-flash', costUsd: 5, costSource: 'provider' },
      { userId, model: 'google/gemini-3.5-flash', costUsd: 999, costSource: 'unknown' },
    ]);

    const rows = await methods.getSpendSummary({
      from: new Date(Date.now() - DAY),
      to: new Date(Date.now() + DAY),
      groupBy: 'model',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].costUsd).toBe(5);
    expect(rows[0].requests).toBe(2);
    expect(rows[0].unknownCostRequests).toBe(1);
  });

  it('фильтрует по границам окна from/to', async () => {
    const methods = createAnalyticsMethods(mongoose);
    const userId = new mongoose.Types.ObjectId();

    await mongoose.models.UsageRecord.create({
      userId,
      model: 'google/gemini-3.5-flash',
      costUsd: 42,
      costSource: 'provider',
      createdAt: new Date(Date.now() - 10 * DAY),
    });

    const rows = await methods.getSpendSummary({
      from: new Date(Date.now() - DAY),
      to: new Date(Date.now() + DAY),
      groupBy: 'model',
    });

    expect(rows).toHaveLength(0);
  });

  it('листает записи расхода с пагинацией и общим количеством', async () => {
    const methods = createAnalyticsMethods(mongoose);
    const userId = new mongoose.Types.ObjectId();

    await mongoose.models.UsageRecord.create(
      Array.from({ length: 5 }, (_, i) => ({
        userId,
        model: 'google/gemini-3.5-flash',
        costUsd: i,
        costSource: 'provider' as const,
      })),
    );

    const page = await methods.listUsageRecords({
      from: new Date(Date.now() - DAY),
      to: new Date(Date.now() + DAY),
      groupBy: 'model',
      limit: 2,
      skip: 0,
    });

    expect(page.total).toBe(5);
    expect(page.rows).toHaveLength(2);

    const secondPage = await methods.listUsageRecords({
      from: new Date(Date.now() - DAY),
      to: new Date(Date.now() + DAY),
      groupBy: 'model',
      limit: 2,
      skip: 4,
    });
    expect(secondPage.rows).toHaveLength(1);
  });

  it('listUsageRecords фильтрует по userId', async () => {
    const methods = createAnalyticsMethods(mongoose);
    const userId = new mongoose.Types.ObjectId();
    const otherUserId = new mongoose.Types.ObjectId();

    await mongoose.models.UsageRecord.create([
      { userId, model: 'google/gemini-3.5-flash', costUsd: 1, costSource: 'provider' },
      { userId: otherUserId, model: 'google/gemini-3.5-flash', costUsd: 1, costSource: 'provider' },
    ]);

    const page = await methods.listUsageRecords({
      from: new Date(Date.now() - DAY),
      to: new Date(Date.now() + DAY),
      groupBy: 'model',
      userId: userId.toString(),
      limit: 10,
      skip: 0,
    });

    expect(page.total).toBe(1);
    expect(page.rows[0].userId.toString()).toBe(userId.toString());
  });

  it('группирует по сценарию и относит пустой/старый сценарий к message', async () => {
    const methods = createAnalyticsMethods(mongoose);
    const userId = new mongoose.Types.ObjectId();

    await mongoose.models.UsageRecord.create([
      { userId, model: 'gpt-4', costUsd: 5, costSource: 'provider', scenario: 'title' },
      { userId, model: 'gpt-4', costUsd: 2, costSource: 'provider', scenario: 'message' },
      { userId, model: 'gpt-4', costUsd: 1, costSource: 'provider' },
    ]);

    const rows = await methods.getSpendSummary({
      from: new Date(Date.now() - DAY),
      to: new Date(Date.now() + DAY),
      groupBy: 'scenario',
    });

    expect(rows).toHaveLength(2);
    const titleRow = rows.find((row) => row.key === 'title');
    const messageRow = rows.find((row) => row.key === 'message');
    expect(titleRow?.costUsd).toBe(5);
    expect(messageRow?.costUsd).toBe(3);
    expect(messageRow?.requests).toBe(2);
  });
});

describe('getActivitySummary', () => {
  it('возвращает нули на пустой базе', async () => {
    const methods = createAnalyticsMethods(mongoose);

    const summary = await methods.getActivitySummary({
      from: new Date(Date.now() - DAY),
      to: new Date(Date.now() + DAY),
    });

    expect(summary).toEqual({
      activeUsers: 0,
      requests: 0,
      returningUsers: 0,
      totalActiveDays: 0,
    });
  });

  it('несколько строк расхода с одним messageId считаются за одно обращение', async () => {
    const methods = createAnalyticsMethods(mongoose);
    const userId = new mongoose.Types.ObjectId();
    const messageId = 'msg-1';

    await mongoose.models.UsageRecord.create([
      {
        userId,
        model: 'gpt-4',
        costUsd: 1,
        costSource: 'provider',
        scenario: 'message',
        messageId,
      },
      {
        userId,
        model: 'gpt-4',
        costUsd: 2,
        costSource: 'provider',
        scenario: 'message',
        messageId,
      },
    ]);

    const summary = await methods.getActivitySummary({
      from: new Date(Date.now() - DAY),
      to: new Date(Date.now() + DAY),
    });

    expect(summary.activeUsers).toBe(1);
    expect(summary.requests).toBe(1);
    expect(summary.totalActiveDays).toBe(1);
    expect(summary.returningUsers).toBe(0);
  });

  it('служебные сценарии title/kb_query не увеличивают requests, но день считается активным', async () => {
    const methods = createAnalyticsMethods(mongoose);
    const userId = new mongoose.Types.ObjectId();

    await mongoose.models.UsageRecord.create([
      { userId, model: 'gpt-4', costUsd: 1, costSource: 'provider', scenario: 'title' },
      { userId, model: 'gpt-4', costUsd: 1, costSource: 'provider', scenario: 'kb_query' },
    ]);

    const summary = await methods.getActivitySummary({
      from: new Date(Date.now() - DAY),
      to: new Date(Date.now() + DAY),
    });

    expect(summary.activeUsers).toBe(1);
    expect(summary.requests).toBe(0);
    expect(summary.totalActiveDays).toBe(1);
  });

  it('полностью исключает записи kb_index', async () => {
    const methods = createAnalyticsMethods(mongoose);
    const userId = new mongoose.Types.ObjectId();

    await mongoose.models.UsageRecord.create({
      userId,
      model: 'gpt-4',
      costUsd: 1,
      costSource: 'provider',
      scenario: 'kb_index',
    });

    const summary = await methods.getActivitySummary({
      from: new Date(Date.now() - DAY),
      to: new Date(Date.now() + DAY),
    });

    expect(summary).toEqual({
      activeUsers: 0,
      requests: 0,
      returningUsers: 0,
      totalActiveDays: 0,
    });
  });

  it('пользователь с активностью в двух днях попадает в returningUsers, в одном — нет', async () => {
    const methods = createAnalyticsMethods(mongoose);
    const returningUserId = new mongoose.Types.ObjectId();
    const oneDayUserId = new mongoose.Types.ObjectId();
    const dayA = new Date('2026-03-10T12:00:00.000Z');
    const dayB = new Date('2026-03-11T12:00:00.000Z');

    await mongoose.models.UsageRecord.create([
      {
        userId: returningUserId,
        model: 'gpt-4',
        costUsd: 1,
        costSource: 'provider',
        scenario: 'message',
        messageId: 'a-1',
        createdAt: dayA,
      },
      {
        userId: returningUserId,
        model: 'gpt-4',
        costUsd: 1,
        costSource: 'provider',
        scenario: 'message',
        messageId: 'a-2',
        createdAt: dayB,
      },
      {
        userId: oneDayUserId,
        model: 'gpt-4',
        costUsd: 1,
        costSource: 'provider',
        scenario: 'message',
        messageId: 'b-1',
        createdAt: dayA,
      },
      {
        userId: oneDayUserId,
        model: 'gpt-4',
        costUsd: 1,
        costSource: 'provider',
        scenario: 'message',
        messageId: 'b-2',
        createdAt: dayA,
      },
    ]);

    const summary = await methods.getActivitySummary({
      from: new Date('2026-03-10T00:00:00.000Z'),
      to: new Date('2026-03-12T00:00:00.000Z'),
    });

    expect(summary.activeUsers).toBe(2);
    expect(summary.requests).toBe(4);
    expect(summary.returningUsers).toBe(1);
    expect(summary.totalActiveDays).toBe(3);
  });

  it('запись message без messageId считается за отдельное обращение', async () => {
    const methods = createAnalyticsMethods(mongoose);
    const userId = new mongoose.Types.ObjectId();

    await mongoose.models.UsageRecord.create([
      { userId, model: 'gpt-4', costUsd: 1, costSource: 'provider', scenario: 'message' },
      { userId, model: 'gpt-4', costUsd: 1, costSource: 'provider', scenario: 'message' },
    ]);

    const summary = await methods.getActivitySummary({
      from: new Date(Date.now() - DAY),
      to: new Date(Date.now() + DAY),
    });

    expect(summary.requests).toBe(2);
  });

  it('фильтрует по границам окна: from включительно, to исключительно', async () => {
    const methods = createAnalyticsMethods(mongoose);
    const fromUserId = new mongoose.Types.ObjectId();
    const toUserId = new mongoose.Types.ObjectId();
    const from = new Date('2026-04-01T00:00:00.000Z');
    const to = new Date('2026-04-02T00:00:00.000Z');

    await mongoose.models.UsageRecord.create([
      {
        userId: fromUserId,
        model: 'gpt-4',
        costUsd: 1,
        costSource: 'provider',
        scenario: 'message',
        createdAt: from,
      },
      {
        userId: toUserId,
        model: 'gpt-4',
        costUsd: 1,
        costSource: 'provider',
        scenario: 'message',
        createdAt: to,
      },
    ]);

    const summary = await methods.getActivitySummary({ from, to });

    expect(summary.activeUsers).toBe(1);
    expect(summary.requests).toBe(1);
  });

  /**
   * Журнал расходов показывает запросы сотрудника, а не вызовы модели. За один ответ
   * модель вызывается несколько раз — довызовы из-за инструментов и генерация заголовка
   * чата, — и раньше каждый приезжал отдельной строкой.
   */
  describe('listSpendRequests', () => {
    const WINDOW = {
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-02T00:00:00.000Z'),
    };
    const userId = new mongoose.Types.ObjectId();

    async function seedOneAnswerWithThreeCalls() {
      await mongoose.models.UsageRecord.create([
        {
          userId,
          model: 'google/gemini-3.5-flash',
          messageId: 'answer-1',
          conversationId: 'conv-1',
          scenario: 'message',
          promptTokens: 100,
          completionTokens: 40,
          costUsd: 2,
          costSource: 'provider',
          createdAt: new Date('2026-08-01T10:00:00.000Z'),
        },
        {
          userId,
          model: 'google/gemini-3.5-flash',
          messageId: 'answer-1',
          conversationId: 'conv-1',
          scenario: 'message',
          promptTokens: 300,
          completionTokens: 60,
          costUsd: 3,
          costSource: 'provider',
          createdAt: new Date('2026-08-01T10:00:03.000Z'),
        },
        {
          userId,
          model: 'google/gemini-3.5-flash-lite',
          messageId: 'answer-1',
          conversationId: 'conv-1',
          scenario: 'title',
          promptTokens: 20,
          completionTokens: 10,
          costUsd: 1,
          costSource: 'provider',
          createdAt: new Date('2026-08-01T10:00:05.000Z'),
        },
      ]);
    }

    it('складывает вызовы одного ответа в одну строку', async () => {
      const methods = createAnalyticsMethods(mongoose);
      await seedOneAnswerWithThreeCalls();

      const { rows, total } = await methods.listSpendRequests({ ...WINDOW, limit: 25, skip: 0 });

      expect(total).toBe(1);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        requestKey: 'answer-1',
        messageId: 'answer-1',
        conversationId: 'conv-1',
        callCount: 3,
        promptTokens: 420,
        completionTokens: 110,
        costUsd: 6,
        unknownCostCalls: 0,
      });
      expect(rows[0].models.sort()).toEqual([
        'google/gemini-3.5-flash',
        'google/gemini-3.5-flash-lite',
      ]);
      expect(rows[0].calls).toHaveLength(3);
    });

    it('датирует запрос началом, а не последним вызовом', async () => {
      const methods = createAnalyticsMethods(mongoose);
      await seedOneAnswerWithThreeCalls();

      const { rows } = await methods.listSpendRequests({ ...WINDOW, limit: 25, skip: 0 });

      expect(rows[0].createdAt.toISOString()).toBe('2026-08-01T10:00:00.000Z');
    });

    it('оставляет записи без messageId отдельными строками', async () => {
      const methods = createAnalyticsMethods(mongoose);
      await mongoose.models.UsageRecord.create([
        {
          userId,
          model: 'baai/bge-m3',
          scenario: 'kb_index',
          costUsd: 0,
          costSource: 'unknown',
          createdAt: new Date('2026-08-01T09:00:00.000Z'),
        },
        {
          userId,
          model: 'baai/bge-m3',
          scenario: 'kb_index',
          costUsd: 0,
          costSource: 'unknown',
          createdAt: new Date('2026-08-01T09:00:01.000Z'),
        },
      ]);

      const { rows, total } = await methods.listSpendRequests({ ...WINDOW, limit: 25, skip: 0 });

      expect(total).toBe(2);
      expect(rows.every((row) => row.callCount === 1)).toBe(true);
    });

    /** Иначе отфильтрованные строки перестали бы сходиться с итогом по этой модели. */
    it('при фильтре по модели считает только её вызовы внутри запроса', async () => {
      const methods = createAnalyticsMethods(mongoose);
      await seedOneAnswerWithThreeCalls();

      const { rows, total } = await methods.listSpendRequests({
        ...WINDOW,
        model: 'google/gemini-3.5-flash-lite',
        limit: 25,
        skip: 0,
      });

      expect(total).toBe(1);
      expect(rows[0]).toMatchObject({ callCount: 1, costUsd: 1, promptTokens: 20 });
    });

    it('не считает в стоимость вызовы без цены от провайдера', async () => {
      const methods = createAnalyticsMethods(mongoose);
      await mongoose.models.UsageRecord.create([
        {
          userId,
          model: 'gpt-4',
          messageId: 'answer-2',
          scenario: 'message',
          costUsd: 7,
          costSource: 'provider',
          createdAt: new Date('2026-08-01T11:00:00.000Z'),
        },
        {
          userId,
          model: 'gpt-4',
          messageId: 'answer-2',
          scenario: 'message',
          costUsd: 99,
          costSource: 'unknown',
          createdAt: new Date('2026-08-01T11:00:01.000Z'),
        },
      ]);

      const { rows } = await methods.listSpendRequests({ ...WINDOW, limit: 25, skip: 0 });

      expect(rows[0]).toMatchObject({ costUsd: 7, unknownCostCalls: 1, callCount: 2 });
    });

    it('листает страницы по общему числу запросов, а не вызовов', async () => {
      const methods = createAnalyticsMethods(mongoose);
      await mongoose.models.UsageRecord.create(
        ['a', 'b', 'c'].flatMap((key, index) =>
          [0, 1].map((call) => ({
            userId,
            model: 'gpt-4',
            messageId: key,
            scenario: 'message',
            costUsd: 1,
            costSource: 'provider',
            createdAt: new Date(Date.parse('2026-08-01T12:00:00.000Z') + index * 60000 + call),
          })),
        ),
      );

      const first = await methods.listSpendRequests({ ...WINDOW, limit: 2, skip: 0 });
      const second = await methods.listSpendRequests({ ...WINDOW, limit: 2, skip: 2 });

      expect(first.total).toBe(3);
      expect(first.rows).toHaveLength(2);
      expect(second.rows).toHaveLength(1);
      expect(first.rows.map((row) => row.requestKey)).toEqual(['c', 'b']);
      expect(second.rows.map((row) => row.requestKey)).toEqual(['a']);
    });

    it('отдаёт пустой результат, когда в окне ничего нет', async () => {
      const methods = createAnalyticsMethods(mongoose);

      const { rows, total } = await methods.listSpendRequests({ ...WINDOW, limit: 25, skip: 0 });

      expect(rows).toEqual([]);
      expect(total).toBe(0);
    });
  });
});
