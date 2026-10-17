import type { Model } from 'mongoose';
import type { ILimitRequest, LimitRequestStatus, LimitWindow } from '~/types';

interface MongoServerError extends Error {
  code?: number;
}

function isDuplicateKeyError(error: unknown): boolean {
  return error instanceof Error && (error as MongoServerError).code === 11000;
}

export interface LimitsMethods {
  createLimitRequest: (
    userId: string,
    window: LimitWindow,
    comment?: string,
    limitBefore?: number | null,
  ) => Promise<ILimitRequest>;
  getPendingLimitRequest: (userId: string, window: LimitWindow) => Promise<ILimitRequest | null>;
  /** The user's pending request, if any, wrapped in an array — kept as a list rather than
   *  a single value so the usage widget doesn't need a separate shape for "none yet". */
  getPendingLimitRequests: (userId: string) => Promise<ILimitRequest[]>;
  getLimitRequestById: (id: string, status?: LimitRequestStatus) => Promise<ILimitRequest | null>;
  listLimitRequests: (status?: LimitRequestStatus) => Promise<ILimitRequest[]>;
  listLimitRequestsByUsers: (userIds: string[]) => Promise<ILimitRequest[]>;
  resolveLimitRequest: (
    id: string,
    status: 'approved' | 'rejected',
    resolvedBy: string,
    limitAfter?: number | null,
  ) => Promise<ILimitRequest | null>;
}

export function createLimitsMethods(mongoose: typeof import('mongoose')): LimitsMethods {
  const limitRequestModel = () => mongoose.models.LimitRequest as Model<ILimitRequest>;

  async function getPendingLimitRequest(
    userId: string,
    window: LimitWindow,
  ): Promise<ILimitRequest | null> {
    return limitRequestModel().findOne({ userId, window, status: 'pending' });
  }

  async function getPendingLimitRequests(userId: string): Promise<ILimitRequest[]> {
    return limitRequestModel().find({ userId, status: 'pending' });
  }

  async function createLimitRequest(
    userId: string,
    window: LimitWindow,
    comment?: string,
    limitBefore?: number | null,
  ): Promise<ILimitRequest> {
    const existing = await getPendingLimitRequest(userId, window);
    if (existing) {
      return existing;
    }
    try {
      return await limitRequestModel().create({
        userId,
        window,
        comment,
        limitBefore: limitBefore ?? null,
        status: 'pending',
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        const raceWinner = await getPendingLimitRequest(userId, window);
        if (raceWinner) {
          return raceWinner;
        }
      }
      throw error;
    }
  }

  /**
   * Одна заявка по id, вместо выгрузки всей очереди ради поиска одной строки в
   * памяти приложения (см. `findRequestInScope` в `packages/api`): на стенде с
   * десятком заявок разница незаметна, а через полгода работы это тысячи документов
   * на каждое одобрение или отклонение. `status`, когда задан, сужает поиск тем же
   * фильтром, что и `listLimitRequests`.
   */
  async function getLimitRequestById(
    id: string,
    status?: LimitRequestStatus,
  ): Promise<ILimitRequest | null> {
    return limitRequestModel().findOne(status ? { _id: id, status } : { _id: id });
  }

  async function listLimitRequests(status?: LimitRequestStatus): Promise<ILimitRequest[]> {
    return limitRequestModel()
      .find(status ? { status } : {})
      .sort({ createdAt: -1 });
  }

  /** Every request ever raised by the given users, newest first — the admin review screen
   *  builds its per-user limit history from this in a single round trip. */
  async function listLimitRequestsByUsers(userIds: string[]): Promise<ILimitRequest[]> {
    const uniqueIds = Array.from(new Set(userIds));
    if (uniqueIds.length === 0) {
      return [];
    }
    return limitRequestModel()
      .find({ userId: { $in: uniqueIds } })
      .sort({ createdAt: -1 });
  }

  /**
   * Conditions the update on `status: 'pending'` so an already-resolved request can't be
   * resolved a second time (e.g. re-approving a rejected request to sneak a limit raise
   * past the admin who rejected it) — matches nothing and returns `null` once the request
   * has left the pending state, the same as a nonexistent id.
   */
  async function resolveLimitRequest(
    id: string,
    status: 'approved' | 'rejected',
    resolvedBy: string,
    limitAfter?: number | null,
  ): Promise<ILimitRequest | null> {
    return limitRequestModel().findOneAndUpdate(
      { _id: id, status: 'pending' },
      {
        $set: {
          status,
          resolvedBy,
          resolvedAt: new Date(),
          limitAfter: status === 'approved' ? (limitAfter ?? null) : null,
        },
      },
      { new: true },
    );
  }

  return {
    createLimitRequest,
    getPendingLimitRequest,
    getPendingLimitRequests,
    getLimitRequestById,
    listLimitRequests,
    listLimitRequestsByUsers,
    resolveLimitRequest,
  };
}
