import { Model } from 'mongoose';
import type { IMemorySnapshot } from '~/types/memory';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import memorySnapshotSchema from '~/schema/memorySnapshot';

export function createMemorySnapshotModel(
  mongoose: typeof import('mongoose'),
): Model<IMemorySnapshot> {
  applyTenantIsolation(memorySnapshotSchema);
  return (
    mongoose.models.MemorySnapshot ||
    mongoose.model<IMemorySnapshot>('MemorySnapshot', memorySnapshotSchema)
  );
}
