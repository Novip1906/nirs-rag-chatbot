import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { MemoryArtifact } from 'librechat-data-provider';
import MemoryUndoButton from '../MemoryUndoButton';

const mockMutateAsync = jest.fn();
const mockShowToast = jest.fn();
let mockHasAccess = true;

jest.mock('~/data-provider', () => ({
  useRevertMemoryMutation: () => ({ mutateAsync: mockMutateAsync }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useHasAccess: () => mockHasAccess,
}));

jest.mock('@librechat/client', () => ({
  useToastContext: () => ({ showToast: mockShowToast }),
}));

const updateArtifact = (overrides: Partial<MemoryArtifact> = {}): MemoryArtifact => ({
  type: 'update',
  key: 'context',
  value: 'new value',
  previous: { value: 'old value', title: 'Old title' },
  ...overrides,
});

describe('MemoryUndoButton', () => {
  beforeEach(() => {
    mockHasAccess = true;
    mockMutateAsync.mockReset();
    mockShowToast.mockReset();
  });

  it('renders nothing without update access', () => {
    mockHasAccess = false;
    render(<MemoryUndoButton artifacts={[updateArtifact()]} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('reverts a single artifact and lands on the reverted state', async () => {
    mockMutateAsync.mockResolvedValueOnce({ reverted: true });
    const artifact = updateArtifact();

    render(<MemoryUndoButton artifacts={[artifact]} />);

    expect(screen.getByText('com_ui_memory_undo')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(screen.getByText('com_ui_memory_undone')).toBeInTheDocument());

    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    expect(mockMutateAsync).toHaveBeenCalledWith({
      key: 'context',
      agentId: undefined,
      chatProjectId: undefined,
      expectedValue: 'new value',
      previous: { value: 'old value', title: 'Old title' },
    });
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('reverts a created record (previous: null) by deleting it', async () => {
    mockMutateAsync.mockResolvedValueOnce({ reverted: true });
    const artifact = updateArtifact({ value: 'brand new', previous: null });

    render(<MemoryUndoButton artifacts={[artifact]} />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ expectedValue: 'brand new', previous: null }),
    );
  });

  it('reverts multiple artifacts in reverse order', async () => {
    mockMutateAsync.mockResolvedValue({ reverted: true });
    const first = updateArtifact({ key: 'first', value: 'first-new' });
    const second = updateArtifact({ key: 'second', value: 'second-new' });

    render(<MemoryUndoButton artifacts={[first, second]} />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(2));
    expect(mockMutateAsync.mock.calls[0][0]).toMatchObject({ key: 'second' });
    expect(mockMutateAsync.mock.calls[1][0]).toMatchObject({ key: 'first' });
  });

  it('settles on the conflict state without a toast on a 409', async () => {
    const conflictError = Object.assign(new Error('Conflict'), {
      response: { status: 409 },
    });
    mockMutateAsync.mockRejectedValueOnce(conflictError);

    render(<MemoryUndoButton artifacts={[updateArtifact()]} />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() =>
      expect(screen.getByText('com_ui_memory_undo_conflict')).toBeInTheDocument(),
    );
    expect(screen.getByRole('button')).toBeDisabled();
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('treats a 404 as already undone', async () => {
    const notFound = Object.assign(new Error('Not found'), { response: { status: 404 } });
    mockMutateAsync.mockRejectedValueOnce(notFound);

    render(<MemoryUndoButton artifacts={[updateArtifact({ previous: null })]} />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(screen.getByText('com_ui_memory_undone')).toBeInTheDocument());
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('keeps reverting the remaining artifacts after one fails', async () => {
    mockMutateAsync
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ reverted: true });
    const first = updateArtifact({ key: 'first', value: 'first-new' });
    const second = updateArtifact({ key: 'second', value: 'second-new' });

    render(<MemoryUndoButton artifacts={[first, second]} />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith({
        message: 'com_ui_memory_undo_error',
        status: 'error',
      }),
    );
    expect(screen.getByRole('button')).not.toBeDisabled();
  });

  it('shows a generic error toast for a non-conflict failure', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('network down'));

    render(<MemoryUndoButton artifacts={[updateArtifact()]} />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith({
        message: 'com_ui_memory_undo_error',
        status: 'error',
      }),
    );
    expect(screen.getByText('com_ui_memory_undo')).toBeInTheDocument();
  });

  it('ignores a second click while a revert is already in flight', async () => {
    let resolveMutation: (value: { reverted: true }) => void = () => {};
    mockMutateAsync.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveMutation = resolve;
      }),
    );

    render(<MemoryUndoButton artifacts={[updateArtifact()]} />);
    const button = screen.getByRole('button');
    fireEvent.click(button);
    fireEvent.click(button);

    resolveMutation({ reverted: true });
    await waitFor(() => expect(screen.getByText('com_ui_memory_undone')).toBeInTheDocument());

    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
  });
});
