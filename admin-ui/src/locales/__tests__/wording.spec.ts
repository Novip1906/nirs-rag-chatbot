import fs from 'fs';
import path from 'path';
import ru from '../ru/translation.json';
import en from '../en/translation.json';

const FORBIDDEN_WORD = new RegExp(['key', 'cloak'].join(''), 'i');

const files: Record<string, Record<string, string>> = { ru, en };

describe('translation wording', () => {
  it.each(Object.keys(files))('has no mention of the identity provider product name in %s values', (locale) => {
    const offenders = Object.entries(files[locale])
      .filter(([, value]) => FORBIDDEN_WORD.test(value))
      .map(([key]) => key);

    expect(offenders).toEqual([]);
  });

  it('does not call a person by the full-name abbreviation', () => {
    expect(
      Object.entries(ru)
        .filter(([, value]) => /ФИО/.test(value))
        .map(([key]) => key),
    ).toEqual([]);
    expect(
      Object.entries(en)
        .filter(([, value]) => /full name/i.test(value))
        .map(([key]) => key),
    ).toEqual([]);
  });

  it('has the same keys in ru and en', () => {
    const ruKeys = Object.keys(ru).sort();
    const enKeys = Object.keys(en).sort();

    expect(ruKeys.filter((key) => !(key in en))).toEqual([]);
    expect(enKeys.filter((key) => !(key in ru))).toEqual([]);
  });

  it('has every directory error key from directoryErrors in both files', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../components/Admin/utils/directoryErrors.ts'),
      'utf8',
    );
    const keys = Array.from(
      new Set(source.match(/com_admin_directory_(?:error|field)_[a-z_]+/g) ?? []),
    );

    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(ru).toHaveProperty([key]);
      expect(en).toHaveProperty([key]);
    }
  });
});
