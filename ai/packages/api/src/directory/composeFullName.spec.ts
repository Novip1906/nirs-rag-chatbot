import { composeFullName } from './composeFullName';

describe('composeFullName', () => {
  it('joins first and last name when both are present', () => {
    expect(composeFullName('Ivan', 'Ivanov', 'fallback')).toBe('Ivan Ivanov');
  });

  it('uses only the first name when the last name is missing', () => {
    expect(composeFullName('Ivan', '', 'fallback')).toBe('Ivan');
  });

  it('uses only the last name when the first name is missing', () => {
    expect(composeFullName('', 'Ivanov', 'fallback')).toBe('Ivanov');
  });

  it('falls back when neither name is present', () => {
    expect(composeFullName('', '', 'ivan@example.com')).toBe('ivan@example.com');
    expect(composeFullName(undefined, undefined, 'ivan@example.com')).toBe('ivan@example.com');
  });
});
