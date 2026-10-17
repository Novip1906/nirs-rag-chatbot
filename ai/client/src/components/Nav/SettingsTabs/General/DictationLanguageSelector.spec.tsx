import { render, fireEvent, waitFor } from '@testing-library/react';
import DictationLanguageSelector from './DictationLanguageSelector';
import en from '~/locales/en/translation.json';
import ru from '~/locales/ru/translation.json';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

describe('DictationLanguageSelector', () => {
  beforeEach(() => {
    localStorage.clear();
    global.ResizeObserver = class MockedResizeObserver {
      observe = jest.fn();
      unobserve = jest.fn();
      disconnect = jest.fn();
    } as unknown as typeof ResizeObserver;
  });

  it('renders with Русский selected by default', () => {
    const { getByText, getByTestId } = render(<DictationLanguageSelector />);

    expect(getByText('com_nav_dictation_language')).toBeInTheDocument();
    expect(getByTestId('dictation-language-selector')).toHaveTextContent(
      'com_nav_dictation_language_ru',
    );
  });

  it('persists English selection to the dictationLanguage atom', async () => {
    const { getByTestId, getByText } = render(<DictationLanguageSelector />);

    fireEvent.click(getByTestId('dictation-language-selector'));
    fireEvent.click(getByText('com_nav_dictation_language_en'));

    await waitFor(() => {
      expect(getByTestId('dictation-language-selector')).toHaveTextContent(
        'com_nav_dictation_language_en',
      );
    });
    expect(JSON.parse(localStorage.getItem('dictationLanguage') ?? '""')).toBe('en');
  });

  it('shows Русский when the stored value is unknown', () => {
    localStorage.setItem('dictationLanguage', JSON.stringify('de'));

    const { getByTestId } = render(<DictationLanguageSelector />);

    expect(getByTestId('dictation-language-selector')).toHaveTextContent(
      'com_nav_dictation_language_ru',
    );
  });
});

describe('decision 12: dictation language options are self-names in both interface languages', () => {
  it('keeps identical self-names for com_nav_dictation_language_ru across en and ru locales', () => {
    expect(en.com_nav_dictation_language_ru).toBe('Русский');
    expect(ru.com_nav_dictation_language_ru).toBe('Русский');
  });

  it('keeps identical self-names for com_nav_dictation_language_en across en and ru locales', () => {
    expect(en.com_nav_dictation_language_en).toBe('English');
    expect(ru.com_nav_dictation_language_en).toBe('English');
  });
});
