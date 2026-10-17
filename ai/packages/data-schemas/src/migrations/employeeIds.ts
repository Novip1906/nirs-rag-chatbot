import { randomUUID } from 'node:crypto';
import type { Connection } from 'mongoose';

const MIGRATION_BATCH_SIZE = 500;

export interface EmployeeIdMigrationResult {
  scanned: number;
  updated: number;
}

export async function backfillEmployeeIds(
  connection: Connection,
  options: { dryRun?: boolean } = {},
): Promise<EmployeeIdMigrationResult> {
  const users = connection.collection('users');
  const cursor = users.find(
    { employeeId: { $exists: false } },
    { projection: { _id: 1 }, readPreference: 'primary' },
  );

  let scanned = 0;
  let updated = 0;
  let batch: Array<{ updateOne: { filter: { _id: unknown }; update: { $set: { employeeId: string } } } }> = [];

  for await (const row of cursor) {
    scanned += 1;
    if (options.dryRun) {
      continue;
    }
    batch.push({
      updateOne: { filter: { _id: row._id }, update: { $set: { employeeId: randomUUID() } } },
    });
    if (batch.length >= MIGRATION_BATCH_SIZE) {
      const result = await users.bulkWrite(batch);
      updated += result.modifiedCount;
      batch = [];
    }
  }

  if (batch.length > 0) {
    const result = await users.bulkWrite(batch);
    updated += result.modifiedCount;
  }

  return { scanned, updated };
}
