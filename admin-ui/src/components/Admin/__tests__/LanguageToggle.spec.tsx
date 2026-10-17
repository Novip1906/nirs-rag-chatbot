import { render, screen, fireEvent } from '@testing-library/react';
import { LocaleProvider } from '~/locales/LocaleProvider';
import LanguageToggle from '../LanguageToggle';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = '';
});

function renderToggle() {
  return render(
    <LocaleProvider>
      <LanguageToggle />
    </LocaleProvider>,
  );
}

describe('LanguageToggle', () => {
  it('offers both languages and starts on Russian', () => {
    renderToggle();

    expect(screen.getByRole('radio', { name: 'Русский' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Английский' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('switches the interface to English and remembers the choice', () => {
    renderToggle();

    fireEvent.click(screen.getByRole('radio', { name: 'Английский' }));

    expect(screen.getByRole('radio', { name: 'English' })).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem('lang')).toBe('en');
  });

  /** Скринридер выбирает голос по `<html lang>` — русский текст английским голосом неразборчив. */
  it('keeps the document language in sync with the choice', () => {
    renderToggle();
    expect(document.documentElement.lang).toBe('ru');

    fireEvent.click(screen.getByRole('radio', { name: 'Английский' }));
    expect(document.documentElement.lang).toBe('en');
  });
});
