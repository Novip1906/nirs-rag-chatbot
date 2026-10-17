import { hashValue } from './audit';
import { detect } from './detectors';
import { escapeMarkerLookalikes, type MarkerTable } from './markers';
import type { DlpCategory, DlpDetectOptions } from './types';

export interface DlpMaskResult {
  readonly text: string;
  readonly findings: readonly {
    category: DlpCategory;
    count: number;
    valueHashes: readonly string[];
  }[];
}

export function maskText(
  source: string,
  table: MarkerTable,
  options: DlpDetectOptions,
): DlpMaskResult {
  const escaped = escapeMarkerLookalikes(source);
  const matches = detect(escaped, options);
  if (matches.length === 0) {
    return { text: escaped, findings: [] };
  }

  const hashes = new Map<DlpCategory, Set<string>>();
  const counts = new Map<DlpCategory, number>();
  const markers = new Array<string | undefined>(matches.length);

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    counts.set(match.category, (counts.get(match.category) ?? 0) + 1);
    let bucket = hashes.get(match.category);
    if (bucket == null) {
      bucket = new Set<string>();
      hashes.set(match.category, bucket);
    }
    bucket.add(hashValue(match.value));
    if (options.modes[match.category] !== 'mask') {
      continue;
    }
    markers[i] = table.issue(match.category, match.value);
  }

  let text = escaped;
  for (let i = matches.length - 1; i >= 0; i--) {
    const marker = markers[i];
    if (marker == null) {
      continue;
    }
    const match = matches[i];
    text = text.slice(0, match.start) + marker + text.slice(match.end);
  }

  return {
    text,
    findings: [...counts].map(([category, count]) => ({
      category,
      count,
      valueHashes: [...(hashes.get(category) ?? [])],
    })),
  };
}
