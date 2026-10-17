import { randomUUID } from 'crypto';
import type { RenderedFile } from './types';

export const EXPORT_HANDOFF_TTL_MS: number = 10 * 60 * 1000;

interface ParkedExport {
  file: RenderedFile;
  timer: ReturnType<typeof setTimeout>;
}

const parked = new Map<string, ParkedExport>();

export function parkRenderedExport(file: RenderedFile): string {
  const exportId = randomUUID();
  const timer = setTimeout(() => parked.delete(exportId), EXPORT_HANDOFF_TTL_MS);
  timer.unref();
  parked.set(exportId, { file, timer });
  return exportId;
}

export function takeRenderedExport(exportId: string): RenderedFile | undefined {
  const entry = parked.get(exportId);
  if (!entry) {
    return undefined;
  }
  clearTimeout(entry.timer);
  parked.delete(exportId);
  return entry.file;
}
