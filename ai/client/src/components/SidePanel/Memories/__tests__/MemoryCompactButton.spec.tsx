import { render, screen, fireEvent } from '@testing-library/react';
import type { TCompactMemoriesResponse } from 'librechat-data-provider';
import { changeLanguageSafely, initializeI18n } from '~/locales/i18n';
import MemoryCompactButton from '../MemoryCompactButton';

const mockMutate = jest.fn();
const mockShowToast = jest.fn();
let mockIsLoading = false;
let capturedOptions: {
  onSuccess?: (data: TCompactMemoriesResponse) => void;
  onError?: (error: Error) => void;
} = {};

jest.mock('~/data-provider', () => ({
  useCompactMemoriesMutation: (options: typeof capturedOptions) => {
    capturedOptions = options;
    return {
      mutate: (variables: unknown) => mockMutate(variables),
      isLoading: mockIsLoading,
    };
  },
}));

jest.mock('~/hooks', () => ({
  useLocalize: jest.requireActual('~/hooks/useLocalize').default,
}));

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

describe('MemoryCompactButton', () => {
  beforeAll(async () => {
    await initializeI18n();
  });

  beforeEach(() => {
    mockIsLoading = false;
    mockMutate.mockReset();
    mockShowToast.mockReset();
    capturedOptions = {};
  });

  afterEach(async () => {
    await changeLanguageSafely('en');
  });

  it('requests compaction of the project partition with a project label', () => {
    render(<MemoryCompactButton chatProjectId="project-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Compact project memory' }));

    expect(mockMutate).toHaveBeenCalledWith({ chatProjectId: 'project-1' });
  });

  it('labels the button for personal memory without a project', () => {
    render(<MemoryCompactButton />);

    fireEvent.click(screen.getByRole('button', { name: 'Compact personal memory' }));

    expect(mockMutate).toHaveBeenCalledWith({ chatProjectId: undefined });
  });

  it('shows a success toast with the result when compaction succeeds', () => {
    render(<MemoryCompactButton />);
    capturedOptions.onSuccess?.({
      compacted: true,
      before: 10,
      after: 6,
      beforeTokens: 500,
      afterTokens: 300,
      snapshotId: 'snap-1',
    });

    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'Memory compacted: 10 entries → 6',
      status: 'success',
    });
  });

  it('shows an info toast when there is nothing to compact', () => {
    render(<MemoryCompactButton />);
    capturedOptions.onSuccess?.({
      compacted: false,
      before: 2,
      after: 2,
      beforeTokens: 40,
      afterTokens: 40,
      reason: 'too_few',
    });

    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'Nothing to compact.',
      status: 'info',
    });
  });

  it('shows a try-later toast for other non-compacted reasons', () => {
    render(<MemoryCompactButton />);
    capturedOptions.onSuccess?.({
      compacted: false,
      before: 10,
      after: 10,
      beforeTokens: 500,
      afterTokens: 500,
      reason: 'changed',
    });

    expect(mockShowToast).toHaveBeenCalledWith({
      message: "Couldn't compact memory. Try again later.",
      status: 'error',
    });
  });

  it('reports a busy partition on a 409', () => {
    render(<MemoryCompactButton />);
    capturedOptions.onError?.(Object.assign(new Error('Conflict'), { response: { status: 409 } }));

    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'Memory is already being compacted',
      status: 'error',
    });
  });

  it('reports rate limiting on a 429', () => {
    render(<MemoryCompactButton />);
    capturedOptions.onError?.(Object.assign(new Error('Too many'), { response: { status: 429 } }));

    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'Too many requests. Try again later.',
      status: 'error',
    });
  });

  it('shows an error toast when the request itself fails', () => {
    render(<MemoryCompactButton />);
    capturedOptions.onError?.(new Error('network down'));

    expect(mockShowToast).toHaveBeenCalledWith({
      message: "Couldn't compact memory. Please try again.",
      status: 'error',
    });
  });

  it('disables the button while compaction is in flight', () => {
    mockIsLoading = true;
    render(<MemoryCompactButton />);

    expect(screen.getByRole('button', { name: 'Compact personal memory' })).toBeDisabled();
  });
});
