import { fireEvent, render, screen } from '@testing-library/react';
import type { TUserMemory } from 'librechat-data-provider';
import { changeLanguageSafely, initializeI18n } from '~/locales/i18n';
import MemoryEditDialog from '../MemoryEditDialog';

const mockMutate = jest.fn();
jest.mock('~/data-provider', () => ({
  useMemoriesQuery: () => ({ data: undefined }),
  useUpdateMemoryMutation: () => ({ mutate: mockMutate, isLoading: false }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: jest.requireActual('~/hooks/useLocalize').default,
  useHasAccess: () => true,
  useClockFormat: () => false,
}));

const baseMemory: TUserMemory = {
  key: 'favorite_color',
  value: 'blue',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('MemoryEditDialog token count pluralization', () => {
  beforeAll(async () => {
    await initializeI18n();
  });

  afterEach(async () => {
    await changeLanguageSafely('en');
  });

  it('declines the Russian noun for a many-count token total', async () => {
    await changeLanguageSafely('ru');
    render(
      <MemoryEditDialog memory={{ ...baseMemory, tokenCount: 7 }} open onOpenChange={jest.fn()}>
        <button type="button">{'open'}</button>
      </MemoryEditDialog>,
    );
    expect(await screen.findByText('7 токенов')).toBeInTheDocument();
  });

  it('declines the Russian noun for a one-count token total', async () => {
    await changeLanguageSafely('ru');
    render(
      <MemoryEditDialog memory={{ ...baseMemory, tokenCount: 1 }} open onOpenChange={jest.fn()}>
        <button type="button">{'open'}</button>
      </MemoryEditDialog>,
    );
    expect(await screen.findByText('1 токен')).toBeInTheDocument();
  });

  it('shows the English plural for a token total greater than one', async () => {
    render(
      <MemoryEditDialog memory={{ ...baseMemory, tokenCount: 7 }} open onOpenChange={jest.fn()}>
        <button type="button">{'open'}</button>
      </MemoryEditDialog>,
    );
    expect(await screen.findByText('7 tokens')).toBeInTheDocument();
  });
});

describe('MemoryEditDialog date localization', () => {
  const updatedAt = new Date(2026, 0, 15, 23, 31).toISOString();

  beforeAll(async () => {
    await initializeI18n();
  });

  afterEach(async () => {
    await changeLanguageSafely('en');
  });

  it('formats the updated date and time for the ru interface language', async () => {
    await changeLanguageSafely('ru');
    render(
      <MemoryEditDialog
        memory={{ ...baseMemory, updated_at: updatedAt }}
        open
        onOpenChange={jest.fn()}
      >
        <button type="button">{'open'}</button>
      </MemoryEditDialog>,
    );
    expect(await screen.findByText('15 янв. 2026 г., 23:31')).toBeInTheDocument();
  });

  it('formats the updated date and time for the en interface language', async () => {
    render(
      <MemoryEditDialog
        memory={{ ...baseMemory, updated_at: updatedAt }}
        open
        onOpenChange={jest.fn()}
      >
        <button type="button">{'open'}</button>
      </MemoryEditDialog>,
    );
    expect(await screen.findByText('Jan 15, 2026, 23:31')).toBeInTheDocument();
  });
});

describe('MemoryEditDialog title editing', () => {
  beforeAll(async () => {
    await initializeI18n();
  });

  afterEach(async () => {
    await changeLanguageSafely('en');
  });

  it('shows the title field pre-filled and hides the key field', async () => {
    render(
      <MemoryEditDialog
        memory={{ ...baseMemory, title: 'Favorite color' }}
        open
        onOpenChange={jest.fn()}
      >
        <button type="button">{'open'}</button>
      </MemoryEditDialog>,
    );

    expect(screen.queryByLabelText('Key')).not.toBeInTheDocument();
    expect(document.getElementById('memory-key')).not.toBeInTheDocument();
    expect(await screen.findByLabelText('Title')).toHaveValue('Favorite color');
  });

  it('pre-fills the title with the start of the value for an old record without a title', async () => {
    render(
      <MemoryEditDialog
        memory={{ key: 'old_note', value: 'Любит чай', updated_at: '2026-01-01T00:00:00.000Z' }}
        open
        onOpenChange={jest.fn()}
      >
        <button type="button">{'open'}</button>
      </MemoryEditDialog>,
    );

    expect(await screen.findByLabelText('Title')).toHaveValue('Любит чай');
  });

  it('saves the memory under the previous key with the edited title', async () => {
    render(
      <MemoryEditDialog
        memory={{ ...baseMemory, title: 'Old title' }}
        open
        onOpenChange={jest.fn()}
      >
        <button type="button">{'open'}</button>
      </MemoryEditDialog>,
    );

    const titleInput = await screen.findByLabelText('Title');
    fireEvent.change(titleInput, { target: { value: 'New title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    const [variables] = mockMutate.mock.calls[0];
    expect(variables).toMatchObject({ key: 'favorite_color', title: 'New title', value: 'blue' });
    expect(variables.originalKey).toBeUndefined();
  });
});
