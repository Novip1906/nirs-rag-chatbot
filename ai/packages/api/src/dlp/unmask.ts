import { RE2JS } from 're2js';
import {
  MARKER_PATTERN,
  MAX_MARKER_LENGTH,
  isEscapedMarkerAt,
  unescapeMarkerLookalikes,
  type MarkerTable,
} from './markers';

const MARKER = RE2JS.compile(MARKER_PATTERN);

export function unmaskText(
  text: string,
  table: MarkerTable,
): { readonly text: string; readonly unresolved: number } {
  let unresolved = 0;
  const matcher = MARKER.matcher(text);
  let result = '';
  let last = 0;
  while (matcher.find()) {
    const marker = text.slice(matcher.start(), matcher.end());
    const escaped = isEscapedMarkerAt(text, matcher.start());
    result += text.slice(last, matcher.start());
    if (escaped) {
      result += marker;
    } else {
      const value = table.resolve(marker);
      if (value == null) {
        unresolved++;
        result += marker;
      } else {
        result += value;
      }
    }
    last = matcher.end();
  }
  result += text.slice(last);
  return { text: unescapeMarkerLookalikes(result), unresolved };
}

export class MarkerStreamDecoder {
  private pending = '';
  private unresolvedCount = 0;

  constructor(private readonly table: MarkerTable) {}

  push(chunk: string): string {
    this.pending += chunk;
    const open = this.pending.lastIndexOf('[');
    let safeEnd = this.pending.length;
    if (open >= 0 && this.pending.indexOf(']', open) < 0) {
      if (this.pending.length - open <= MAX_MARKER_LENGTH) {
        safeEnd = open;
      }
    }
    const ready = this.pending.slice(0, safeEnd);
    this.pending = this.pending.slice(safeEnd);
    return this.decode(ready);
  }

  flush(): string {
    const rest = this.pending;
    this.pending = '';
    return this.decode(rest);
  }

  get unresolved(): number {
    return this.unresolvedCount;
  }

  private decode(text: string): string {
    if (text.length === 0) {
      return '';
    }
    const result = unmaskText(text, this.table);
    this.unresolvedCount += result.unresolved;
    return result.text;
  }
}
