import { logger } from '@librechat/data-schemas';
import { isAdminLevelRole } from 'librechat-data-provider';
import type { TFeedbackRating } from 'librechat-data-provider';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { DateRange } from './dateRange';
import type { FeedbackRowInput } from './serialize';
import { resolveDateRange, DATE_RANGE_ERROR } from './dateRange';
import { parseLimit, parseSkip } from './pagination';
import { toAdminFeedbackRow } from './serialize';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const RATING_VALUES: TFeedbackRating[] = ['thumbsUp', 'thumbsDown'];

export interface FeedbackQueryInput extends DateRange {
  rating?: TFeedbackRating;
  limit: number;
  skip: number;
}

export interface CorporateFeedbackDeps {
  listFeedback: (query: FeedbackQueryInput) => Promise<{ rows: FeedbackRowInput[]; total: number }>;
}

function isFeedbackRating(value: unknown): value is TFeedbackRating {
  return typeof value === 'string' && (RATING_VALUES as string[]).includes(value);
}

export function createCorporateFeedbackHandlers(deps: CorporateFeedbackDeps): {
  listFeedback: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  async function listFeedbackHandler(req: ServerRequest, res: Response) {
    try {
      /**
       * `listFeedback` пагинирует на уровне базы (limit/skip и `total` считает
       * запрос), а `FeedbackListQuery` в data-schemas не умеет фильтровать по
       * отделу — фильтрация постфактум в обработчике сломала бы и `total`, и саму
       * страницу (глава мог бы получить пустую страницу при наличии данных дальше).
       * Как и с `getActivity`, закрываем маршрут для главы целиком, а не отдаём
       * общекорпоративный отзыв под видом отдела.
       */
      if (!isAdminLevelRole(req.user?.role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const range = resolveDateRange(req.query);
      if (!range) {
        return res.status(400).json({ error: DATE_RANGE_ERROR });
      }

      const ratingParam = req.query.rating;
      let rating: TFeedbackRating | undefined;
      if (ratingParam !== undefined) {
        if (!isFeedbackRating(ratingParam)) {
          return res.status(400).json({ error: 'rating must be "thumbsUp" or "thumbsDown"' });
        }
        rating = ratingParam;
      }

      const limit = parseLimit(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
      const skip = parseSkip(req.query.skip);

      const { rows, total } = await deps.listFeedback({ ...range, rating, limit, skip });

      return res.status(200).json({ rows: rows.map(toAdminFeedbackRow), total });
    } catch (error) {
      logger.error('[corporateFeedback] listFeedback error:', error);
      return res.status(500).json({ error: 'Failed to load feedback' });
    }
  }

  return { listFeedback: listFeedbackHandler };
}
