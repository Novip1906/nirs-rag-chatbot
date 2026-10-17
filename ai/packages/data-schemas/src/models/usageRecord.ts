import { Model } from 'mongoose';
import type * as t from '~/types';
import usageRecordSchema from '~/schema/usageRecord';

export function createUsageRecordModel(mongoose: typeof import('mongoose')): Model<t.IUsageRecord> {
  return (
    mongoose.models.UsageRecord || mongoose.model<t.IUsageRecord>('UsageRecord', usageRecordSchema)
  );
}
