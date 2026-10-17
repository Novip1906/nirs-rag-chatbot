import { Schema } from 'mongoose';
import type { ILimitRequest } from '~/types';

const limitRequestSchema: Schema<ILimitRequest> = new Schema<ILimitRequest>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    window: { type: String, enum: ['daily'], required: true },
    comment: { type: String },
    limitBefore: { type: Number, default: null },
    limitAfter: { type: Number, default: null },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

limitRequestSchema.index({ status: 1, createdAt: -1 });
/**
 * `window` только для дневного лимита теперь имеет одно значение, но остаётся частью
 * составного ключа: индекс уже назван и развёрнут в проде, а переименование в
 * однопольный `{ userId: 1 }` потребовало бы отдельной миграции ради поля, которое
 * и так уникально по факту единственного значения `window`.
 */
limitRequestSchema.index(
  { userId: 1, window: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'pending' },
    name: 'userId_1_window_1_pending_unique',
  },
);

export default limitRequestSchema;
