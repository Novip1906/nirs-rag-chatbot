import { normalizeMemoryTitle, resolveMemoryKey, slugifyMemoryKey } from './memory';

describe('slugifyMemoryKey', () => {
  it('transliterates Cyrillic and joins words with underscores', () => {
    expect(slugifyMemoryKey('Имя пользователя')).toBe('imya_polzovatelya');
  });

  it('lowercases already-latin text', () => {
    expect(slugifyMemoryKey('Preferred name')).toBe('preferred_name');
  });

  it('maps digraphs like щ and ё', () => {
    expect(slugifyMemoryKey('Щука и ёж')).toBe('shchuka_i_ezh');
  });

  it('strips diacritics and drops trailing digits', () => {
    expect(slugifyMemoryKey('Café 2026!')).toBe('cafe');
  });

  it('trims leading and trailing separators', () => {
    expect(slugifyMemoryKey('--Часовой пояс--')).toBe('chasovoy_poyas');
  });

  it('falls back to memory when nothing latin survives', () => {
    expect(slugifyMemoryKey('🙂 123')).toBe('memory');
  });

  it('truncates to 48 characters without a trailing underscore', () => {
    const source = `${'a'.repeat(47)} ${'b'.repeat(10)}`;
    const slug = slugifyMemoryKey(source);
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug.endsWith('_')).toBe(false);
    expect(slug).toBe('a'.repeat(47));
  });
});

describe('resolveMemoryKey', () => {
  it('returns the free slug as-is', () => {
    expect(resolveMemoryKey('Город', new Set())).toBe('gorod');
  });

  it('appends a letter suffix on collision', () => {
    expect(resolveMemoryKey('Город', new Set(['gorod']))).toBe('gorod_b');
  });

  it('moves to a two-letter suffix once b through z are taken', () => {
    const letters = 'bcdefghijklmnopqrstuvwxyz'.split('');
    const taken = new Set(['gorod', ...letters.map((letter) => `gorod_${letter}`)]);
    expect(resolveMemoryKey('Город', taken)).toBe('gorod_aa');
  });

  it('never returns the reserved word "nothing" bare', () => {
    expect(resolveMemoryKey('Nothing', new Set())).toBe('nothing_b');
  });
});

describe('normalizeMemoryTitle', () => {
  it('trims edges and collapses internal whitespace', () => {
    expect(normalizeMemoryTitle('  Имя   пользователя ')).toBe('Имя пользователя');
  });

  it('turns empty or whitespace-only input into undefined', () => {
    expect(normalizeMemoryTitle('')).toBeUndefined();
    expect(normalizeMemoryTitle('   ')).toBeUndefined();
    expect(normalizeMemoryTitle(undefined)).toBeUndefined();
  });

  it('truncates to 120 characters', () => {
    const source = 'x'.repeat(200);
    expect(normalizeMemoryTitle(source)).toBe('x'.repeat(120));
  });
});
