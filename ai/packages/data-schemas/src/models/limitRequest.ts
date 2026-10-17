import { Model } from 'mongoose';
import type * as t from '~/types';
import limitRequestSchema from '~/schema/limitRequest';

export function createLimitRequestModel(
  mongoose: typeof import('mongoose'),
): Model<t.ILimitRequest> {
  return (
    mongoose.models.LimitRequest ||
    mongoose.model<t.ILimitRequest>('LimitRequest', limitRequestSchema)
  );
}
