import { render, screen, fireEvent } from '@testing-library/react';
import type { TMemoryCompaction, TUndoMemoryCompactionResponse } from 'librechat-data-provider';
import { changeLanguageSafely, initializeI18n } from '~/locales/i18n';
import MemoryCompactionBanner from '../MemoryCompactionBanner';

const mockMutate = jest.fn();
const mockShowToast = jest.fn();

jest.mock('~/data-provider', () => ({
  useUndoMemoryCompactionMutation: () => ({
    mutate: (
      variables: unknown,
      options?: {
        onSuccess?: (data: TUndoMemoryCompactionResponse) => void;
        onError?: (error: Error) => void;
      },
    ) => mockMutate(variables, options),
    isLoading: false,
  }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: jest.requireActual('~/hooks/useLocalize').default,
}));

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

const personalCompaction: TMemoryCompaction = {
  snapshotId: 'snap-personal',
  agentId: null,
  chatProjectId: null,
  before: 10,
  after: 6,
  reason: 'auto',
  createdAt: '2026-09-25T10:00:00.000Z',
};

const projectCompaction: TMemoryCompaction = {
  snapshotId: 'snap-project',
  agentId: null,
  chatProjectId: 'project-1',
  before: 8,
  after: 5,
  reason: 'manual',
  createdAt: '2026-09-25T11:00:00.000Z',
};

describe('MemoryCompactionBanner', () => {
  beforeAll(async () => {
    await initializeI18n();
  });

  beforeEach(() => {
    mockMutate.mockReset();
    mockShowToast.mockReset();
  });

  afterEach(async () => {
    await changeLanguageSafely('en');
  });

  it('renders nothing when there is no matching compaction', () => {
    const { container } = render(<MemoryCompactionBanner compactions={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when compactions exist only for another partition', () => {
    const { container } = render(<MemoryCompactionBanner compactions={[projectCompaction]} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the before/after summary for the matching partition', () => {
    render(<MemoryCompactionBanner compactions={[personalCompaction, projectCompaction]} />);

    expect(screen.getByText('Memory compacted: 10 entries → 6')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo compaction' })).toBeInTheDocument();
  });

  it('filters by the given project partition', () => {
    render(
      <MemoryCompactionBanner
        compactions={[personalCompaction, projectCompaction]}
        chatProjectId="project-1"
      />,
    );

    expect(screen.getByText('Memory compacted: 8 entries → 5')).toBeInTheDocument();
  });

  it('picks the most recently created compaction for the partition', () => {
    const older: TMemoryCompaction = {
      ...personalCompaction,
      snapshotId: 'snap-older',
      before: 20,
      after: 15,
      createdAt: '2026-09-24T00:00:00.000Z',
    };

    render(<MemoryCompactionBanner compactions={[older, personalCompaction]} />);

    expect(screen.getByText('Memory compacted: 10 entries → 6')).toBeInTheDocument();
  });

  it('hides the banner and confirms with a toast after a successful undo', () => {
    mockMutate.mockImplementation((_variables, options) => {
      options?.onSuccess?.({ restored: true, count: 6 });
    });

    const { container } = render(<MemoryCompactionBanner compactions={[personalCompaction]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo compaction' }));

    expect(mockMutate).toHaveBeenCalledWith({ snapshotId: 'snap-personal' }, expect.any(Object));
    expect(mockShowToast).toHaveBeenCalledWith({ message: 'Compaction undone', status: 'success' });
    expect(container.firstChild).toBeNull();
  });

  it('treats a 404 as an already undone compaction', () => {
    mockMutate.mockImplementation((_variables, options) => {
      options?.onError?.(Object.assign(new Error('Not found'), { response: { status: 404 } }));
    });

    const { container } = render(<MemoryCompactionBanner compactions={[personalCompaction]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo compaction' }));

    expect(container.firstChild).toBeNull();
  });

  it('shows an undo error toast when the undo request fails', () => {
    mockMutate.mockImplementation((_variables, options) => {
      options?.onError?.(new Error('network down'));
    });

    render(<MemoryCompactionBanner compactions={[personalCompaction]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo compaction' }));

    expect(mockShowToast).toHaveBeenCalledWith({
      message: "Couldn't undo compaction",
      status: 'error',
    });
    expect(screen.getByRole('button', { name: 'Undo compaction' })).toBeInTheDocument();
  });
});
