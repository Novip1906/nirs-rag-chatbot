import { parseLimit, parseSkip } from './pagination';

describe('parseLimit', () => {
  it('returns the default limit when the value is missing', () => {
    expect(parseLimit(undefined, 25, 100)).toBe(25);
  });

  it('returns the default limit for a non-numeric string', () => {
    expect(parseLimit('abc', 25, 100)).toBe(25);
  });

  it('returns the default limit for a non-string value', () => {
    expect(parseLimit(['50'], 25, 100)).toBe(25);
  });

  it('passes through a value within range', () => {
    expect(parseLimit('40', 25, 100)).toBe(40);
  });

  it('clamps a value above the maximum', () => {
    expect(parseLimit('500', 25, 100)).toBe(100);
  });

  it('clamps a value below 1', () => {
    expect(parseLimit('0', 25, 100)).toBe(1);
    expect(parseLimit('-5', 25, 100)).toBe(1);
  });

  it('applies caller-specific bounds independently', () => {
    expect(parseLimit('150', 50, 200)).toBe(150);
    expect(parseLimit('150', 25, 100)).toBe(100);
  });
});

describe('parseSkip', () => {
  it('defaults to 0 when the value is missing', () => {
    expect(parseSkip(undefined)).toBe(0);
  });

  it('defaults to 0 for a non-numeric string', () => {
    expect(parseSkip('abc')).toBe(0);
  });

  it('defaults to 0 for a non-string value', () => {
    expect(parseSkip(['10'])).toBe(0);
  });

  it('clamps a negative value to 0', () => {
    expect(parseSkip('-1')).toBe(0);
  });

  it('passes through a positive value', () => {
    expect(parseSkip('10')).toBe(10);
  });
});
