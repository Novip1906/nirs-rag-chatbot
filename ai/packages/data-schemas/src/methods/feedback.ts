import type { FilterQuery, Model, PipelineStage } from 'mongoose';
import type { IMessage } from '~/types';

export type FeedbackRating = 'thumbsUp' | 'thumbsDown';

export interface FeedbackCounts {
  thumbsUp: number;
  thumbsDown: number;
}

export interface FeedbackRow {
  messageId: string;
  conversationId: string;
  userId: string;
  userName: string;
  model: string;
  rating: FeedbackRating;
  tag: string;
  text: string;
  date: Date;
}

export interface FeedbackQuery {
  from: Date;
  to: Date;
  rating?: FeedbackRating;
}

export interface FeedbackListQuery extends FeedbackQuery {
  limit: number;
  skip: number;
}

export interface ListFeedbackResult {
  rows: FeedbackRow[];
  total: number;
}

export interface FeedbackMethods {
  getFeedbackSummary: (query: FeedbackQuery) => Promise<FeedbackCounts>;
  listFeedback: (query: FeedbackListQuery) => Promise<ListFeedbackResult>;
}

const EMPTY_FEEDBACK_COUNTS: FeedbackCounts = { thumbsUp: 0, thumbsDown: 0 };

function buildFeedbackMatch(query: FeedbackQuery): FilterQuery<IMessage> {
  return {
    updatedAt: { $gte: query.from, $lt: query.to },
    'feedback.rating': query.rating ?? { $in: ['thumbsUp', 'thumbsDown'] },
  };
}

export function createFeedbackMethods(mongoose: typeof import('mongoose')): FeedbackMethods {
  const messageModel = () => mongoose.models.Message as Model<IMessage>;

  async function getFeedbackSummary(query: FeedbackQuery): Promise<FeedbackCounts> {
    const pipeline: PipelineStage[] = [
      { $match: buildFeedbackMatch(query) },
      { $group: { _id: '$feedback.rating', count: { $sum: 1 } } },
    ];
    const rows = await messageModel().aggregate<{ _id: FeedbackRating; count: number }>(pipeline);
    const counts: FeedbackCounts = { ...EMPTY_FEEDBACK_COUNTS };
    for (const row of rows) {
      counts[row._id] = row.count;
    }
    return counts;
  }

  async function listFeedback(query: FeedbackListQuery): Promise<ListFeedbackResult> {
    const match = buildFeedbackMatch(query);
    const pipeline: PipelineStage[] = [
      { $match: match },
      { $sort: { updatedAt: -1 } },
      { $skip: query.skip },
      { $limit: query.limit },
      {
        $addFields: {
          feedbackUserId: {
            $convert: { input: '$user', to: 'objectId', onError: null, onNull: null },
          },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'feedbackUserId',
          foreignField: '_id',
          as: 'userInfo',
        },
      },
      {
        $project: {
          _id: 0,
          messageId: 1,
          conversationId: 1,
          userId: '$user',
          userName: { $ifNull: [{ $first: '$userInfo.name' }, '$user'] },
          model: { $ifNull: ['$model', ''] },
          rating: '$feedback.rating',
          tag: {
            $cond: [{ $eq: [{ $type: '$feedback.tag' }, 'string'] }, '$feedback.tag', ''],
          },
          text: { $ifNull: ['$feedback.text', ''] },
          date: '$updatedAt',
        },
      },
    ];
    const [rows, total] = await Promise.all([
      messageModel().aggregate<FeedbackRow>(pipeline),
      messageModel().countDocuments(match),
    ]);
    return { rows, total };
  }

  return { getFeedbackSummary, listFeedback };
}
