import { RE2JS } from 're2js';
import { isValidIban, isValidInn, isValidLuhn, isValidSnils } from './checksums';
import { shannonEntropy } from './entropy';
import { normalizeForDetection } from './normalize';
import { DLP_CATEGORIES, type DlpCategory, type DlpDetectOptions, type DlpMatch } from './types';

interface Rule {
  readonly category: DlpCategory;
  readonly pattern: string;
  /** Группа, содержащая само значение. 0 — всё совпадение. */
  readonly group: number;
  readonly validate?: (value: string) => boolean;
}

const digitsOnly = (value: string): string => value.replace(/\D/g, '');

const RULES: readonly Rule[] = [
  {
    category: 'secrets',
    pattern: '-----BEGIN [A-Z ]*PRIVATE KEY-----',
    group: 0,
  },
  {
    category: 'secrets',
    pattern: '\\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\\b',
    group: 0,
  },
  { category: 'secrets', pattern: '\\bsk-[A-Za-z0-9_-]{20,}\\b', group: 0 },
  { category: 'secrets', pattern: '\\bAKIA[0-9A-Z]{16}\\b', group: 0 },
  { category: 'secrets', pattern: '(?i)\\bBearer\\s+([A-Za-z0-9._-]{20,})', group: 1 },
  {
    category: 'secrets',
    pattern: '(?i)\\b(?:mongodb|postgres|postgresql|mysql|redis|amqp)(?:\\+srv)?://\\S+',
    group: 0,
  },
  {
    category: 'secrets',
    pattern:
      '(?i)\\b(?:api[_-]?key|access[_-]?token|secret|password|passwd|pwd)\\s*[:=]\\s*["\']?([^\\s"\']{12,})',
    group: 1,
    validate: (value) => shannonEntropy(value) >= 4,
  },
  {
    category: 'payment_card',
    pattern: '\\b\\d(?:[ -]?\\d){12,18}\\b',
    group: 0,
    validate: (value) => isValidLuhn(digitsOnly(value)),
  },
  {
    category: 'bank_account',
    pattern: '\\b[A-Z]{2}\\d{2}[A-Z0-9]{11,30}\\b',
    group: 0,
    validate: isValidIban,
  },
  { category: 'bank_account', pattern: '\\b\\d{20}\\b', group: 0 },
  {
    category: 'ru_snils',
    pattern: '\\b\\d{3}-\\d{3}-\\d{3}[ -]?\\d{2}\\b',
    group: 0,
    validate: (value) => isValidSnils(digitsOnly(value)),
  },
  {
    category: 'ru_snils',
    pattern: '\\b\\d{11}\\b',
    group: 0,
    validate: (value) => isValidSnils(value),
  },
  {
    category: 'ru_inn',
    pattern: '\\b\\d{12}\\b',
    group: 0,
    validate: (value) => isValidInn(value),
  },
  {
    category: 'ru_inn',
    pattern: '\\b\\d{10}\\b',
    group: 0,
    validate: (value) => isValidInn(value),
  },
  {
    category: 'ru_passport',
    pattern: '(?i)(?:паспорт|серия|номер)\\D{0,15}(\\d{2}[ ]?\\d{2}[ ]?\\d{6})\\b',
    group: 1,
  },
];

const COMPILED = new Map<string, RE2JS>();

function compile(pattern: string): RE2JS {
  let compiled = COMPILED.get(pattern);
  if (compiled == null) {
    compiled = RE2JS.compile(pattern);
    COMPILED.set(pattern, compiled);
  }
  return compiled;
}

const CATEGORY_PRIORITY = new Map<DlpCategory, number>(
  DLP_CATEGORIES.map((category, index) => [category, index]),
);

export function detect(source: string, options: DlpDetectOptions): DlpMatch[] {
  const { text, sourceIndex } = normalizeForDetection(source);
  const rules = RULES;
  const found: DlpMatch[] = [];

  for (const rule of rules) {
    if (options.modes[rule.category] === 'off') {
      continue;
    }
    const matcher = compile(rule.pattern).matcher(text);
    while (matcher.find()) {
      const start = matcher.start(rule.group);
      const end = matcher.end(rule.group);
      if (start < 0 || end <= start) {
        continue;
      }
      const value = text.slice(start, end);
      if (rule.validate != null && !rule.validate(value)) {
        continue;
      }
      const sourceStart = sourceIndex[start];
      const sourceEnd = end - 1 < sourceIndex.length ? sourceIndex[end - 1] + 1 : source.length;
      found.push({
        category: rule.category,
        start: sourceStart,
        end: sourceEnd,
        value: source.slice(sourceStart, sourceEnd),
      });
    }
  }

  found.sort((a, b) => {
    if (a.start !== b.start) {
      return a.start - b.start;
    }
    const lengthDiff = b.end - b.start - (a.end - a.start);
    if (lengthDiff !== 0) {
      return lengthDiff;
    }
    return (CATEGORY_PRIORITY.get(a.category) ?? 0) - (CATEGORY_PRIORITY.get(b.category) ?? 0);
  });

  const result: DlpMatch[] = [];
  let lastEnd = -1;
  for (const match of found) {
    if (match.start >= lastEnd) {
      result.push(match);
      lastEnd = match.end;
    }
  }
  return result;
}
