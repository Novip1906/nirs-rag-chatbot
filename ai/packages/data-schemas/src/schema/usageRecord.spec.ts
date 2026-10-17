import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createUsageRecordModel } from '../models/usageRecord';

let mongoServer: MongoMemoryServer;

interface ExplainNode {
  stage?: string;
  inputStage?: ExplainNode;
  inputStages?: ExplainNode[];
}

function collectStages(node: ExplainNode | undefined, out: string[] = []): string[] {
  if (!node) {
    return out;
  }
  if (node.stage) {
    out.push(node.stage);
  }
  collectStages(node.inputStage, out);
  for (const child of node.inputStages ?? []) {
    collectStages(child, out);
  }
  return out;
}

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

describe('UsageRecord schema indexes', () => {
  it('использует IXSCAN по createdAt для запроса без фильтра по userId/departmentId/model', async () => {
    const userId = new mongoose.Types.ObjectId();
    /** Composite index prefixes (userId/departmentId/model) can't help a date-only,
     * globally-sorted query — enough rows that a collection scan would be unmistakable
     * in the explain output rather than plausibly "the planner picked COLLSCAN anyway
     * because it's cheap on a tiny collection". */
    await mongoose.models.UsageRecord.insertMany(
      Array.from({ length: 500 }, (_, i) => ({
        userId,
        model: 'google/gemini-3.5-flash',
        costUsd: 1,
        costSource: 'provider',
        createdAt: new Date(Date.now() - i * 60000),
      })),
    );

    const explain = await mongoose.models.UsageRecord.find({
      createdAt: { $gte: new Date(Date.now() - 3600000), $lt: new Date() },
    })
      .sort({ createdAt: -1 })
      .explain('executionStats');

    const winningPlan = (explain as { queryPlanner?: { winningPlan?: ExplainNode } }).queryPlanner
      ?.winningPlan;
    const stages = collectStages(winningPlan);

    expect(stages).toContain('IXSCAN');
    expect(stages).not.toContain('COLLSCAN');
  });
});
