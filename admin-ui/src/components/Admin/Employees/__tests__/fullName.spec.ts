import { fullName } from '../fullName';

describe('fullName', () => {
  it('puts the first name before the last name', () => {
    expect(fullName({ first_name: 'Ivan', last_name: 'Petrov' })).toBe('Ivan Petrov');
  });

  it('trims surrounding whitespace in both parts', () => {
    expect(fullName({ first_name: '  Ivan ', last_name: ' Petrov  ' })).toBe('Ivan Petrov');
  });

  it('returns only the first name when the last name is empty', () => {
    expect(fullName({ first_name: 'Ivan', last_name: '' })).toBe('Ivan');
    expect(fullName({ first_name: 'Ivan', last_name: '   ' })).toBe('Ivan');
  });

  it('returns only the last name when the first name is empty', () => {
    expect(fullName({ first_name: '', last_name: 'Petrov' })).toBe('Petrov');
  });
});
