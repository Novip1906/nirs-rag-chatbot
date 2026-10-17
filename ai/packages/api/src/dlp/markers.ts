import { RE2JS } from 're2js';
import { DLP_CATEGORIES, type DlpCategory } from './types';

export const MARKER_LABELS: Readonly<Record<DlpCategory, string>> = {
  secrets: 'SECRET',
  payment_card: 'CARD',
  bank_account: 'ACCOUNT',
  ru_inn: 'INN',
  ru_snils: 'SNILS',
  ru_passport: 'PASSPORT',
};

const LABELS = DLP_CATEGORIES.map((category) => MARKER_LABELS[category]).join('|');

export const MARKER_PATTERN: string = `(?i)[\\[\\{\\(]\\s*(${LABELS})\\s*_\\s*(\\d+)\\s*[\\]\\}\\)]`;

export const MAX_MARKER_LENGTH = 32;

const SINGLE_MARKER = RE2JS.compile(`^${MARKER_PATTERN}$`);

export function canonicalMarker(label: string, index: string): string {
  return `[${label.toUpperCase()}_${Number(index)}]`;
}

const LOOKALIKE = RE2JS.compile(MARKER_PATTERN);

export class MarkerTable {
  private readonly byValue = new Map<string, string>();
  private readonly byMarker = new Map<string, string>();
  private readonly counters = new Map<DlpCategory, number>();

  issue(category: DlpCategory, value: string): string {
    const key = `${category} ${value}`;
    const existing = this.byValue.get(key);
    if (existing != null) {
      return existing;
    }
    const next = (this.counters.get(category) ?? 0) + 1;
    this.counters.set(category, next);
    const marker = `[${MARKER_LABELS[category]}_${next}]`;
    this.byValue.set(key, marker);
    this.byMarker.set(marker, value);
    return marker;
  }

  resolve(marker: string): string | undefined {
    const direct = this.byMarker.get(marker);
    if (direct != null) {
      return direct;
    }
    const matcher = SINGLE_MARKER.matcher(marker.trim());
    if (!matcher.matches()) {
      return undefined;
    }
    const label = matcher.group(1);
    const index = matcher.group(2);
    if (label == null || index == null) {
      return undefined;
    }
    return this.byMarker.get(canonicalMarker(label, index));
  }

  get size(): number {
    return this.byMarker.size;
  }

  get markers(): readonly string[] {
    return [...this.byMarker.keys()];
  }
}

export function isEscapedMarkerAt(text: string, start: number): boolean {
  return start > 0 && text[start - 1] === text[start];
}

export function escapeMarkerLookalikes(text: string): string {
  const matcher = LOOKALIKE.matcher(text);
  let result = '';
  let last = 0;
  while (matcher.find()) {
    const start = matcher.start();
    result += text.slice(last, start) + text[start] + text.slice(start, matcher.end());
    last = matcher.end();
  }
  return result + text.slice(last);
}

export function unescapeMarkerLookalikes(text: string): string {
  const matcher = LOOKALIKE.matcher(text);
  let result = '';
  let last = 0;
  while (matcher.find()) {
    const start = matcher.start();
    const from = isEscapedMarkerAt(text, start) ? start - 1 : start;
    result += text.slice(last, from) + text.slice(start, matcher.end());
    last = matcher.end();
  }
  return result + text.slice(last);
}
