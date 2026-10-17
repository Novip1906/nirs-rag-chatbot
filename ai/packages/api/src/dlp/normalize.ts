export interface NormalizedText {
  readonly text: string;
  readonly sourceIndex: readonly number[];
}

const SPACE_LIKE = new Set(['\u00A0', '\u2002', '\u2003', '\u2007', '\u2009', '\u200A', '\u202F']);

export function normalizeForDetection(source: string): NormalizedText {
  let text = '';
  const sourceIndex: number[] = [];
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const replaced = SPACE_LIKE.has(char) ? ' ' : char.normalize('NFKC');
    for (const produced of replaced) {
      text += produced;
      sourceIndex.push(i);
    }
  }
  return { text, sourceIndex };
}
