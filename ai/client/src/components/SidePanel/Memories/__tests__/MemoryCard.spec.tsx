import { render, screen } from '@testing-library/react';
import type { TUserMemory } from 'librechat-data-provider';
import { changeLanguageSafely, initializeI18n } from '~/locales/i18n';
import MemoryCard from '../MemoryCard';

const baseMemory: TUserMemory = {
  key: 'favorite_color',
  value: 'blue',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('MemoryCard token count pluralization', () => {
  beforeAll(async () => {
    await initializeI18n();
  });

  afterEach(async () => {
    await changeLanguageSafely('en');
  });

  it('declines the Russian noun for a many-count token total', async () => {
    await changeLanguageSafely('ru');
    render(<MemoryCard memory={{ ...baseMemory, tokenCount: 7 }} hasUpdateAccess={false} />);
    expect(await screen.findByText('7 токенов')).toBeInTheDocument();
  });

  it('declines the Russian noun for a one-count token total', async () => {
    await changeLanguageSafely('ru');
    render(<MemoryCard memory={{ ...baseMemory, tokenCount: 1 }} hasUpdateAccess={false} />);
    expect(await screen.findByText('1 токен')).toBeInTheDocument();
  });

  it('declines the Russian noun for a few-count token total', async () => {
    await changeLanguageSafely('ru');
    render(<MemoryCard memory={{ ...baseMemory, tokenCount: 22 }} hasUpdateAccess={false} />);
    expect(await screen.findByText('22 токена')).toBeInTheDocument();
  });

  it('shows the English plural for a token total greater than one', async () => {
    render(<MemoryCard memory={{ ...baseMemory, tokenCount: 7 }} hasUpdateAccess={false} />);
    expect(await screen.findByText('7 tokens')).toBeInTheDocument();
  });
});

describe('MemoryCard date localization', () => {
  const updatedAt = new Date(2026, 0, 15, 10, 0).toISOString();

  beforeAll(async () => {
    await initializeI18n();
  });

  afterEach(async () => {
    await changeLanguageSafely('en');
  });

  it('formats the updated date for the ru interface language', async () => {
    await changeLanguageSafely('ru');
    render(
      <MemoryCard memory={{ ...baseMemory, updated_at: updatedAt }} hasUpdateAccess={false} />,
    );
    expect(await screen.findByText('15 янв. 2026 г.')).toBeInTheDocument();
  });

  it('formats the updated date for the en interface language', async () => {
    render(
      <MemoryCard memory={{ ...baseMemory, updated_at: updatedAt }} hasUpdateAccess={false} />,
    );
    expect(await screen.findByText('Jan 15, 2026')).toBeInTheDocument();
  });
});

describe('MemoryCard display title', () => {
  const titledMemory: TUserMemory = { ...baseMemory, key: 'user_name', value: 'Egor' };

  beforeAll(async () => {
    await initializeI18n();
  });

  afterEach(async () => {
    await changeLanguageSafely('en');
  });

  it('shows the saved title and hides the raw key', () => {
    render(
      <MemoryCard
        memory={{ ...titledMemory, title: 'Имя пользователя' }}
        hasUpdateAccess={false}
      />,
    );

    expect(screen.getByText('Имя пользователя')).toBeInTheDocument();
    expect(screen.queryByText('user_name')).not.toBeInTheDocument();
  });

  it('falls back to the start of the value for an old record without a title', () => {
    render(<MemoryCard memory={titledMemory} hasUpdateAccess={false} />);

    expect(screen.getAllByText('Egor')).toHaveLength(2);
    expect(screen.queryByText('user_name')).not.toBeInTheDocument();
  });
});
