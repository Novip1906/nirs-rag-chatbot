import { Types } from 'mongoose';
import type { FilterQuery, Model, PipelineStage } from 'mongoose';
import type { CostSource, IUsageRecord } from '~/types';

export type SpendGroupBy = 'user' | 'department' | 'model' | 'day' | 'scenario';

export interface SpendRow {
  key: string;
  label: string;
  costUsd: number;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  unknownCostRequests: number;
}

/** Everything that narrows the usage rows, without saying how to bucket them. */
export interface SpendFilter {
  from: Date;
  to: Date;
  userId?: string;
  departmentId?: string;
  model?: string;
}

export interface SpendQuery extends SpendFilter {
  groupBy: SpendGroupBy;
}

export interface Pagination {
  limit: number;
  skip: number;
}

export interface ListUsageRecordsResult {
  rows: IUsageRecord[];
  total: number;
}

/** One LLM call inside a single employee request. */
export interface SpendRequestCall {
  model: string;
  scenario: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  costSource: CostSource;
  createdAt: Date;
}

export interface SpendRequestRow {
  requestKey: string;
  userId: Types.ObjectId;
  departmentId?: Types.ObjectId | null;
  conversationId?: string;
  messageId?: string;
  models: string[];
  calls: SpendRequestCall[];
  callCount: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  unknownCostCalls: number;
  createdAt: Date;
}

export interface ListSpendRequestsResult {
  rows: SpendRequestRow[];
  total: number;
}

export interface ActivityQuery {
  from: Date;
  to: Date;
}

export interface ActivitySummary {
  activeUsers: number;
  requests: number;
  returningUsers: number;
  totalActiveDays: number;
}

export interface AnalyticsMethods {
  getSpendSummary: (query: SpendQuery) => Promise<SpendRow[]>;
  listUsageRecords: (
    query: SpendQuery & { limit: number; skip: number },
  ) => Promise<ListUsageRecordsResult>;
  listSpendRequests: (query: SpendFilter & Pagination) => Promise<ListSpendRequestsResult>;
  getActivitySummary: (query: ActivityQuery) => Promise<ActivitySummary>;
}

const NO_DEPARTMENT_LABEL = 'Без отдела';
const DELETED_DEPARTMENT_LABEL = 'Отдел удалён';
/**
 * Records written before `scenario` existed (and any write path that never
 * sets it) store `''`. Grouped under the same label as an explicit
 * `'message'` scenario — a reader can't tell them apart anyway, and an empty
 * key would otherwise show up as its own unlabeled row.
 */
const DEFAULT_SCENARIO_LABEL = 'message';

/**
 * `$dateToString` runs inside MongoDB, not the Node process — the `TZ` env var that
 * makes `assertWithinLimits`' local-midnight/local-month-start math track Moscow has no
 * effect on it. Without an explicit `timezone`, MongoDB buckets by UTC days, so spend
 * from 00:00–03:00 Moscow falls into the previous day here while the same requests count
 * toward *today*'s calendar-window limit — the day chart and the daily limit would be
 * measuring two different "today"s.
 */
const ANALYTICS_TIMEZONE = process.env.TZ ?? 'Europe/Moscow';

type GroupIdExpression =
  | '$userId'
  | '$departmentId'
  | '$model'
  | { $dateToString: { format: string; date: string; timezone: string } }
  | { $cond: [{ $in: [string, Array<string | null>] }, string, string] };

const EMPTY_ACTIVITY_SUMMARY: ActivitySummary = {
  activeUsers: 0,
  requests: 0,
  returningUsers: 0,
  totalActiveDays: 0,
};

function buildActivityMatch(query: ActivityQuery): FilterQuery<IUsageRecord> {
  return {
    createdAt: { $gte: query.from, $lt: query.to },
    scenario: { $ne: 'kb_index' },
  };
}

/**
 * Collapses the several usage rows one answer produces — the tool round trips and the
 * chat-title call — into one key. Same rule `getActivitySummary` counts requests by, so
 * the journal and the analytics page agree on what "a request" is. A row with no
 * `messageId` (knowledge-base indexing) stands alone under its own id.
 */
const REQUEST_KEY_EXPRESSION = {
  /** `$ifNull` first: a *missing* `messageId` is not equal to `null` for `$in`, so
   *  matching against `[null, '']` directly let every unkeyed row collapse into one. */
  $let: {
    vars: { key: { $ifNull: ['$messageId', ''] } },
    in: { $cond: [{ $eq: ['$$key', ''] }, { $toString: '$_id' }, '$$key'] },
  },
};

function buildMatch(query: SpendFilter): FilterQuery<IUsageRecord> {
  const match: FilterQuery<IUsageRecord> = { createdAt: { $gte: query.from, $lt: query.to } };
  if (query.userId) {
    match.userId = new Types.ObjectId(query.userId);
  }
  if (query.departmentId) {
    match.departmentId = new Types.ObjectId(query.departmentId);
  }
  if (query.model) {
    match.model = query.model;
  }
  return match;
}

function groupIdExpression(groupBy: SpendGroupBy): GroupIdExpression {
  switch (groupBy) {
    case 'user':
      return '$userId';
    case 'department':
      return '$departmentId';
    case 'model':
      return '$model';
    case 'day':
      return {
        $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: ANALYTICS_TIMEZONE },
      };
    case 'scenario':
      return {
        $cond: [{ $in: ['$scenario', [null, '']] }, DEFAULT_SCENARIO_LABEL, '$scenario'],
      };
  }
}

const SPEND_ACCUMULATORS = {
  costUsd: { $sum: { $cond: [{ $eq: ['$costSource', 'unknown'] }, 0, '$costUsd'] } },
  requests: { $sum: 1 },
  promptTokens: { $sum: '$promptTokens' },
  completionTokens: { $sum: '$completionTokens' },
  unknownCostRequests: { $sum: { $cond: [{ $eq: ['$costSource', 'unknown'] }, 1, 0] } },
};

const PASSTHROUGH_PROJECT_FIELDS = {
  costUsd: 1,
  requests: 1,
  promptTokens: 1,
  completionTokens: 1,
  unknownCostRequests: 1,
} as const;

function buildLabelStages(groupBy: SpendGroupBy): PipelineStage[] {
  if (groupBy === 'user') {
    return [
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'userInfo' } },
      {
        $project: {
          _id: 0,
          key: { $toString: '$_id' },
          label: { $ifNull: [{ $first: '$userInfo.name' }, { $toString: '$_id' }] },
          ...PASSTHROUGH_PROJECT_FIELDS,
        },
      },
    ];
  }
  if (groupBy === 'department') {
    return [
      {
        $lookup: {
          from: 'departments',
          localField: '_id',
          foreignField: '_id',
          as: 'departmentInfo',
        },
      },
      {
        $project: {
          _id: 0,
          key: { $ifNull: [{ $toString: '$_id' }, 'none'] },
          /**
           * A real (non-null) `departmentId` whose `$lookup` found nothing means the
           * department was deleted after these records were written — distinct from a
           * record that never had a department. Both used to fall back to the same
           * `NO_DEPARTMENT_LABEL`, producing two identically-labeled "Без отдела" rows
           * with different keys that a reader couldn't tell apart or reconcile.
           */
          label: {
            $cond: [
              { $eq: ['$_id', null] },
              NO_DEPARTMENT_LABEL,
              { $ifNull: [{ $first: '$departmentInfo.name' }, DELETED_DEPARTMENT_LABEL] },
            ],
          },
          ...PASSTHROUGH_PROJECT_FIELDS,
        },
      },
    ];
  }
  return [
    {
      $project: {
        _id: 0,
        key: '$_id',
        label: '$_id',
        ...PASSTHROUGH_PROJECT_FIELDS,
      },
    },
  ];
}

export function createAnalyticsMethods(mongoose: typeof import('mongoose')): AnalyticsMethods {
  const usageRecordModel = () => mongoose.models.UsageRecord as Model<IUsageRecord>;

  async function getSpendSummary(query: SpendQuery): Promise<SpendRow[]> {
    const pipeline: PipelineStage[] = [
      { $match: buildMatch(query) },
      { $group: { _id: groupIdExpression(query.groupBy), ...SPEND_ACCUMULATORS } },
      ...buildLabelStages(query.groupBy),
      { $sort: { costUsd: -1, key: 1 } },
    ];
    return usageRecordModel().aggregate<SpendRow>(pipeline);
  }

  /**
   * The spend journal, one row per employee request rather than per LLM call. The filter
   * is applied to the calls first: narrowing by model leaves a row holding only that
   * model's share of the request, so the visible rows always add up to the filtered total.
   */
  async function listSpendRequests(
    query: SpendFilter & Pagination,
  ): Promise<ListSpendRequestsResult> {
    const pipeline: PipelineStage[] = [
      { $match: buildMatch(query) },
      {
        $group: {
          _id: REQUEST_KEY_EXPRESSION,
          userId: { $first: '$userId' },
          departmentId: { $first: '$departmentId' },
          conversationId: { $first: '$conversationId' },
          messageId: { $first: '$messageId' },
          models: { $addToSet: '$model' },
          calls: {
            $push: {
              model: '$model',
              scenario: '$scenario',
              promptTokens: '$promptTokens',
              completionTokens: '$completionTokens',
              costUsd: '$costUsd',
              costSource: '$costSource',
              createdAt: '$createdAt',
            },
          },
          callCount: { $sum: 1 },
          promptTokens: { $sum: '$promptTokens' },
          completionTokens: { $sum: '$completionTokens' },
          costUsd: { $sum: { $cond: [{ $eq: ['$costSource', 'unknown'] }, 0, '$costUsd'] } },
          unknownCostCalls: { $sum: { $cond: [{ $eq: ['$costSource', 'unknown'] }, 1, 0] } },
          /** When the request started — the first call. The answer message itself is
           *  written at the end, so its own timestamp would lag the employee's ask. */
          createdAt: { $min: '$createdAt' },
        },
      },
      {
        $facet: {
          rows: [
            { $sort: { createdAt: -1, _id: 1 } },
            { $skip: query.skip },
            { $limit: query.limit },
          ],
          total: [{ $count: 'value' }],
        },
      },
    ];

    type FacetResult = {
      rows: Array<Omit<SpendRequestRow, 'requestKey'> & { _id: string }>;
      total: Array<{ value: number }>;
    };
    const [result] = await usageRecordModel().aggregate<FacetResult>(pipeline);
    const rows = (result?.rows ?? []).map(({ _id, ...row }) => ({ ...row, requestKey: _id }));
    return { rows, total: result?.total?.[0]?.value ?? 0 };
  }

  async function listUsageRecords(
    query: SpendQuery & { limit: number; skip: number },
  ): Promise<ListUsageRecordsResult> {
    const match = buildMatch(query);
    const [rows, total] = await Promise.all([
      usageRecordModel().find(match).sort({ createdAt: -1 }).skip(query.skip).limit(query.limit),
      usageRecordModel().countDocuments(match),
    ]);
    return { rows, total };
  }

  /**
   * `requestKey` collapses the several usage rows one assistant answer can produce (a tool
   * call, then the final generation) down to one countable request, keyed by `messageId`.
   * Only `scenario: 'message'` rows count toward `requests` at all — `title`/`subagent`/
   * `reasoning`/`kb_query` are internal calls inside one answer, not separate employee asks.
   * A `message` row with no `messageId` still counts as its own request, via `_id`.
   */
  async function getActivitySummary(query: ActivityQuery): Promise<ActivitySummary> {
    const pipeline: PipelineStage[] = [
      { $match: buildActivityMatch(query) },
      {
        $addFields: {
          activityDay: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$createdAt',
              timezone: ANALYTICS_TIMEZONE,
            },
          },
          requestKey: {
            $cond: [
              { $eq: ['$scenario', 'message'] },
              { $ifNull: ['$messageId', { $toString: '$_id' }] },
              null,
            ],
          },
        },
      },
      {
        $group: {
          _id: { userId: '$userId', day: '$activityDay' },
          requestKeys: { $addToSet: '$requestKey' },
        },
      },
      {
        $group: {
          _id: '$_id.userId',
          activeDays: { $sum: 1 },
          requestKeySets: { $push: '$requestKeys' },
        },
      },
      {
        $addFields: {
          requests: {
            $size: {
              $setDifference: [
                {
                  $reduce: {
                    input: '$requestKeySets',
                    initialValue: [],
                    in: { $setUnion: ['$$value', '$$this'] },
                  },
                },
                [null],
              ],
            },
          },
        },
      },
      {
        $group: {
          _id: null,
          activeUsers: { $sum: 1 },
          requests: { $sum: '$requests' },
          returningUsers: { $sum: { $cond: [{ $gte: ['$activeDays', 2] }, 1, 0] } },
          totalActiveDays: { $sum: '$activeDays' },
        },
      },
      {
        $project: {
          _id: 0,
          activeUsers: 1,
          requests: 1,
          returningUsers: 1,
          totalActiveDays: 1,
        },
      },
    ];
    const [result] = await usageRecordModel().aggregate<ActivitySummary>(pipeline);
    return result ?? EMPTY_ACTIVITY_SUMMARY;
  }

  return { getSpendSummary, listUsageRecords, listSpendRequests, getActivitySummary };
}
