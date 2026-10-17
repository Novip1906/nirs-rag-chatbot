import { fireEvent, render, screen } from '@testing-library/react';
import { changeLanguageSafely, initializeI18n } from '~/locales/i18n';
import MemoryCreateDialog from '../MemoryCreateDialog';

const mockMutate = jest.fn();
jest.mock('~/data-provider', () => ({
  useCreateMemoryMutation: (options: { onSuccess?: () => void }) => ({
    mutate: (variables: unknown) => {
      mockMutate(variables);
      options.onSuccess?.();
    },
    isLoading: false,
  }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: jest.requireActual('~/hooks/useLocalize').default,
  useHasAccess: () => true,
}));

describe('MemoryCreateDialog', () => {
  beforeAll(async () => {
    await initializeI18n();
  });

  afterEach(async () => {
    await changeLanguageSafely('en');
  });

  it('shows Title and Value fields with no key field', () => {
    render(
      <MemoryCreateDialog open onOpenChange={jest.fn()}>
        <button type="button">{'open'}</button>
      </MemoryCreateDialog>,
    );

    expect(screen.getByLabelText('Title')).toBeInTheDocument();
    expect(screen.getByLabelText('Value')).toBeInTheDocument();
    expect(screen.queryByLabelText('Key')).not.toBeInTheDocument();
    expect(document.getElementById('memory-key')).not.toBeInTheDocument();
  });

  it('submits title and value without a key', () => {
    render(
      <MemoryCreateDialog open onOpenChange={jest.fn()}>
        <button type="button">{'open'}</button>
      </MemoryCreateDialog>,
    );

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Имя пользователя' },
    });
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'Егор' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Memory' }));

    expect(mockMutate).toHaveBeenCalledWith({ title: 'Имя пользователя', value: 'Егор' });
    const [variables] = mockMutate.mock.calls[0];
    expect(variables).not.toHaveProperty('key');
  });

  it('disables the submit button while the title is blank', () => {
    render(
      <MemoryCreateDialog open onOpenChange={jest.fn()}>
        <button type="button">{'open'}</button>
      </MemoryCreateDialog>,
    );

    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'Егор' } });

    expect(screen.getByRole('button', { name: 'Create Memory' })).toBeDisabled();
  });
});
