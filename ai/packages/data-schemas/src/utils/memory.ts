import { MEMORY_TITLE_MAX_LENGTH } from 'librechat-data-provider';

const MEMORY_KEY_MAX_LENGTH = 48;
const DEFAULT_MEMORY_KEY = 'memory';
const RESERVED_MEMORY_KEY = 'nothing';
const SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
const MAX_MEMORY_KEY_ATTEMPTS = 100000;

const CYRILLIC_TRANSLITERATION: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

const transliterate = (source: string): string =>
  source
    .toLowerCase()
    .split('')
    .map((char) => CYRILLIC_TRANSLITERATION[char] ?? char)
    .join('');

const bijectiveBase26 = (n: number): string => {
  let value = n;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % SUFFIX_ALPHABET.length;
    result = SUFFIX_ALPHABET[remainder] + result;
    value = Math.floor((value - 1) / SUFFIX_ALPHABET.length);
  }
  return result;
};

const memoryKeySuffix = (attempt: number): string => bijectiveBase26(attempt + 2);

export function slugifyMemoryKey(source: string): string {
  const ascii = transliterate(source).normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const collapsed = ascii.replace(/[^a-z]+/g, '_').replace(/^_+|_+$/g, '');
  const truncated = collapsed.slice(0, MEMORY_KEY_MAX_LENGTH).replace(/_+$/g, '');
  return truncated.length > 0 ? truncated : DEFAULT_MEMORY_KEY;
}

export function resolveMemoryKey(source: string, taken: ReadonlySet<string>): string {
  const base = slugifyMemoryKey(source);
  if (base !== RESERVED_MEMORY_KEY && !taken.has(base)) {
    return base;
  }

  for (let attempt = 0; attempt < MAX_MEMORY_KEY_ATTEMPTS; attempt++) {
    const candidate = `${base}_${memoryKeySuffix(attempt)}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }

  throw new Error('Unable to resolve a unique memory key');
}

export function normalizeMemoryTitle(raw?: string): string | undefined {
  if (raw == null) {
    return undefined;
  }

  const collapsed = raw.trim().replace(/\s+/g, ' ');
  if (collapsed.length === 0) {
    return undefined;
  }

  return collapsed.slice(0, MEMORY_TITLE_MAX_LENGTH);
}
