import type { Model } from 'mongoose';
import type { CostSource, IUsageRecord } from '~/types';
import logger from '~/config/winston';

export interface RecordUsageInput {
  userId: string;
  departmentId?: string | null;
  model: string;
  conversationId?: string;
  messageId?: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  costSource: CostSource;
  scenario?: string;
  imagePrompt?: string;
  imageFileId?: string;
}

export interface UsageTotals {
  costUsd: number;
  requests: number;
}

const ZERO_TOTALS: UsageTotals = { costUsd: 0, requests: 0 };

/**
 * Scenarios that bill against a department/model but never against the
 * employee's own daily/monthly limit — the request wasn't something the
 * employee asked for (e.g. `'title'`: automatic conversation-title
 * generation; `'kb_index'`/`'kb_query'`: knowledge-base embeddings run by an
 * admin's upload or by the model's own search tool call, not something the
 * employee chose to pay for). `'subagent'` deliberately stays out of this
 * list: it's work the employee's own request triggered, so it should still
 * count against them. Single source of truth for `getUsageTotals` below.
 */
export const SYSTEM_SCENARIOS = [
  'title',
  'kb_index',
  'kb_query',
  'chat_recap',
  'memory_compact',
] as const;

export interface UsageMethods {
  recordUsage: (input: RecordUsageInput) => Promise<void>;
  getUsageTotals: (userId: string, since: Date) => Promise<UsageTotals>;
}

export function createUsageMethods(mongoose: typeof import('mongoose')): UsageMethods {
  const usageModel = () => mongoose.models.UsageRecord as Model<IUsageRecord>;

  async function recordUsage(input: RecordUsageInput): Promise<void> {
    try {
      await usageModel().create(input);
    } catch (error) {
      logger.error('[recordUsage] Не удалось записать расход', error);
    }
  }

  /**
   * Excludes `costSource: 'unknown'` records from the cost sum, same rule as
   * `getSpendSummary` in `analytics.ts` — `requests` still counts them. This currently
   * makes no observable difference (every write path forces `costUsd: 0` on an unknown
   * record), but the two must agree on what "spend" means: the day this changes and some
   * path records a nonzero `costUsd` under `costSource: 'unknown'`, a divergent rule here
   * would make limit enforcement and the admin spend view disagree on the same user's
   * usage — one blocking on a number the other never shows.
   */
  async function getUsageTotals(userId: string, since: Date): Promise<UsageTotals> {
    const [totals] = await usageModel().aggregate<UsageTotals>([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          createdAt: { $gte: since },
          scenario: { $nin: [...SYSTEM_SCENARIOS] },
        },
      },
      {
        $group: {
          _id: null,
          costUsd: { $sum: { $cond: [{ $eq: ['$costSource', 'unknown'] }, 0, '$costUsd'] } },
          requests: { $sum: 1 },
        },
      },
      { $project: { _id: 0, costUsd: 1, requests: 1 } },
    ]);

    return totals ?? ZERO_TOTALS;
  }

  return { recordUsage, getUsageTotals };
}
