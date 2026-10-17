import { ContentTypes } from 'librechat-data-provider';
import { render, screen } from '@testing-library/react';
import { changeLanguageSafely, initializeI18n } from '~/locales/i18n';
import Summary from '../Summary';

const content = [{ type: ContentTypes.TEXT as const, text: 'summarized text' }];

describe('Summary token count pluralization', () => {
  beforeAll(async () => {
    await initializeI18n();
  });

  afterEach(async () => {
    await changeLanguageSafely('en');
  });

  it('declines the Russian noun for a many-count token total', async () => {
    await changeLanguageSafely('ru');
    render(<Summary content={content} tokenCount={7} />);
    expect(await screen.findByText('7 токенов')).toBeInTheDocument();
  });

  it('declines the Russian noun for a one-count token total', async () => {
    await changeLanguageSafely('ru');
    render(<Summary content={content} tokenCount={1} />);
    expect(await screen.findByText('1 токен')).toBeInTheDocument();
  });

  it('shows the English plural for a token total greater than one', async () => {
    render(<Summary content={content} tokenCount={7} />);
    expect(await screen.findByText('7 tokens')).toBeInTheDocument();
  });
});
