import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createUsageRecordModel } from '../models/usageRecord';
import { createAnalyticsMethods } from './analytics';
import { createUsageMethods, SYSTEM_SCENARIOS } from './usage';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await createUsageRecordModel(mongoose).init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.models.UsageRecord.deleteMany({});
});

describe('Usage methods', () => {
  it('складывает стоимость и считает запросы начиная с указанного момента', async () => {
    const methods = createUsageMethods(mongoose);
    const userId = new mongoose.Types.ObjectId().toString();
    const since = new Date(Date.now() - 60 * 60 * 1000);

    await methods.recordUsage({
      userId,
      model: 'anthropic/claude-haiku-4.5',
      promptTokens: 100,
      completionTokens: 50,
      costUsd: 1.5,
      costSource: 'provider',
    });
    await methods.recordUsage({
      userId,
      model: 'google/gemini-3.5-flash',
      promptTokens: 10,
      completionTokens: 5,
      costUsd: 0.25,
      costSource: 'provider',
    });

    const totals = await methods.getUsageTotals(userId, since);
    expect(totals.requests).toBe(2);
    expect(totals.costUsd).toBeCloseTo(1.75);
  });

  it('не считает записи старше границы окна', async () => {
    const methods = createUsageMethods(mongoose);
    const userId = new mongoose.Types.ObjectId();
    await mongoose.models.UsageRecord.create({
      userId,
      model: 'google/gemini-3.5-flash',
      costUsd: 99,
      createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    });

    const totals = await methods.getUsageTotals(
      userId.toString(),
      new Date(Date.now() - 24 * 60 * 60 * 1000),
    );
    expect(totals.requests).toBe(0);
    expect(totals.costUsd).toBe(0);
  });

  it('возвращает нули, когда расходов нет', async () => {
    const methods = createUsageMethods(mongoose);
    const totals = await methods.getUsageTotals(
      new mongoose.Types.ObjectId().toString(),
      new Date(0),
    );
    expect(totals).toEqual({ costUsd: 0, requests: 0 });
  });

  it('не бросает наружу, если запись расхода не удалась', async () => {
    const methods = createUsageMethods(mongoose);
    await expect(
      methods.recordUsage({
        userId: 'это не ObjectId',
        model: 'google/gemini-3.5-flash',
        promptTokens: 1,
        completionTokens: 1,
        costUsd: 0,
        costSource: 'unknown',
      }),
    ).resolves.toBeUndefined();
  });

  it('бросает на невалидном userId в getUsageTotals, а не молчит нулями', async () => {
    const methods = createUsageMethods(mongoose);
    await expect(methods.getUsageTotals('это не ObjectId', new Date(0))).rejects.toThrow();
  });

  it('не добавляет costSource: unknown в сумму стоимости, даже если она не нулевая', async () => {
    const methods = createUsageMethods(mongoose);
    const userId = new mongoose.Types.ObjectId().toString();
    const since = new Date(Date.now() - 60 * 60 * 1000);

    await methods.recordUsage({
      userId,
      model: 'anthropic/claude-haiku-4.5',
      promptTokens: 10,
      completionTokens: 5,
      costUsd: 10,
      costSource: 'provider',
    });
    /**
     * В проде такого сегодня не бывает (unknown всегда пишется с costUsd: 0), но правило
     * должно держаться само по себе, а не полагаться на этот побочный инвариант вызывающей
     * стороны — иначе оно молча ломается в тот день, когда какой-то путь запишет ненулевую
     * стоимость под unknown.
     */
    await methods.recordUsage({
      userId,
      model: 'google/gemini-3.5-flash',
      promptTokens: 10,
      completionTokens: 5,
      costUsd: 999,
      costSource: 'unknown',
    });

    const totals = await methods.getUsageTotals(userId, since);
    expect(totals.requests).toBe(2);
    expect(totals.costUsd).toBe(10);
  });

  it('лимиты и аналитика сходятся в сумме на одном и том же наборе записей', async () => {
    const usageMethods = createUsageMethods(mongoose);
    const analyticsMethods = createAnalyticsMethods(mongoose);
    const userId = new mongoose.Types.ObjectId().toString();
    const from = new Date(Date.now() - 60 * 60 * 1000);
    const to = new Date(Date.now() + 60 * 60 * 1000);

    await usageMethods.recordUsage({
      userId,
      model: 'anthropic/claude-haiku-4.5',
      promptTokens: 10,
      completionTokens: 5,
      costUsd: 7,
      costSource: 'provider',
    });
    await usageMethods.recordUsage({
      userId,
      model: 'google/gemini-3.5-flash',
      promptTokens: 10,
      completionTokens: 5,
      costUsd: 500,
      costSource: 'unknown',
    });

    const totals = await usageMethods.getUsageTotals(userId, from);
    const [summaryRow] = await analyticsMethods.getSpendSummary({
      from,
      to,
      groupBy: 'user',
      userId,
    });

    expect(totals.costUsd).toBe(summaryRow.costUsd);
    expect(totals.requests).toBe(summaryRow.requests);
  });

  it('не учитывает служебный сценарий title в лимитах, но учитывает message, subagent и запись без сценария', async () => {
    const methods = createUsageMethods(mongoose);
    const userId = new mongoose.Types.ObjectId().toString();
    const since = new Date(Date.now() - 60 * 60 * 1000);

    await methods.recordUsage({
      userId,
      model: 'google/gemini-3.5-flash',
      promptTokens: 1,
      completionTokens: 1,
      costUsd: 5,
      costSource: 'provider',
      scenario: 'title',
    });
    await methods.recordUsage({
      userId,
      model: 'google/gemini-3.5-flash',
      promptTokens: 1,
      completionTokens: 1,
      costUsd: 2,
      costSource: 'provider',
      scenario: 'message',
    });
    await methods.recordUsage({
      userId,
      model: 'google/gemini-3.5-flash',
      promptTokens: 1,
      completionTokens: 1,
      costUsd: 3,
      costSource: 'provider',
      scenario: 'subagent',
    });
    await methods.recordUsage({
      userId,
      model: 'google/gemini-3.5-flash',
      promptTokens: 1,
      completionTokens: 1,
      costUsd: 1,
      costSource: 'provider',
    });

    const totals = await methods.getUsageTotals(userId, since);
    expect(totals.requests).toBe(3);
    expect(totals.costUsd).toBeCloseTo(6);
  });

  it('не учитывает kb_index и kb_query в лимитах сотрудника, но они видны в аналитике по сценарию', async () => {
    const usageMethods = createUsageMethods(mongoose);
    const analyticsMethods = createAnalyticsMethods(mongoose);
    const userId = new mongoose.Types.ObjectId().toString();
    const from = new Date(Date.now() - 60 * 60 * 1000);
    const to = new Date(Date.now() + 60 * 60 * 1000);

    await usageMethods.recordUsage({
      userId,
      model: 'baai/bge-m3',
      promptTokens: 25000,
      completionTokens: 0,
      costUsd: 5,
      costSource: 'provider',
      scenario: 'kb_index',
    });
    await usageMethods.recordUsage({
      userId,
      model: 'baai/bge-m3',
      promptTokens: 10,
      completionTokens: 0,
      costUsd: 3,
      costSource: 'provider',
      scenario: 'kb_query',
    });
    await usageMethods.recordUsage({
      userId,
      model: 'google/gemini-3.5-flash',
      promptTokens: 10,
      completionTokens: 5,
      costUsd: 7,
      costSource: 'provider',
      scenario: 'message',
    });

    const totals = await usageMethods.getUsageTotals(userId, from);
    expect(totals.requests).toBe(1);
    expect(totals.costUsd).toBe(7);

    const summary = await analyticsMethods.getSpendSummary({ from, to, groupBy: 'scenario' });
    expect(summary.find((row) => row.key === 'kb_index')?.costUsd).toBe(5);
    expect(summary.find((row) => row.key === 'kb_query')?.costUsd).toBe(3);
  });

  it('содержит служебные сценарии памяти v2 в SYSTEM_SCENARIOS', () => {
    expect(SYSTEM_SCENARIOS).toEqual([
      'title',
      'kb_index',
      'kb_query',
      'chat_recap',
      'memory_compact',
    ]);
  });

  it('не учитывает chat_recap и memory_compact в лимитах сотрудника, но они видны в аналитике по сценарию', async () => {
    const usageMethods = createUsageMethods(mongoose);
    const analyticsMethods = createAnalyticsMethods(mongoose);
    const userId = new mongoose.Types.ObjectId().toString();
    const from = new Date(Date.now() - 60 * 60 * 1000);
    const to = new Date(Date.now() + 60 * 60 * 1000);

    await usageMethods.recordUsage({
      userId,
      model: 'openai/gpt-5.6-luna',
      promptTokens: 500,
      completionTokens: 50,
      costUsd: 2,
      costSource: 'provider',
      scenario: 'chat_recap',
    });
    await usageMethods.recordUsage({
      userId,
      model: 'openai/gpt-5.6-luna',
      promptTokens: 800,
      completionTokens: 100,
      costUsd: 4,
      costSource: 'provider',
      scenario: 'memory_compact',
    });
    await usageMethods.recordUsage({
      userId,
      model: 'google/gemini-3.5-flash',
      promptTokens: 10,
      completionTokens: 5,
      costUsd: 9,
      costSource: 'provider',
      scenario: 'message',
    });

    const totals = await usageMethods.getUsageTotals(userId, from);
    expect(totals.requests).toBe(1);
    expect(totals.costUsd).toBe(9);

    const summary = await analyticsMethods.getSpendSummary({ from, to, groupBy: 'scenario' });
    expect(summary.find((row) => row.key === 'chat_recap')?.costUsd).toBe(2);
    expect(summary.find((row) => row.key === 'memory_compact')?.costUsd).toBe(4);
  });
});
