import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FeedbackView from '../FeedbackView';

const mockUseAdminFeedbackQuery = jest.fn();
const mockUseAdminModelsQuery = jest.fn();

jest.mock('~/data-provider/Admin', () => ({
  useAdminFeedbackQuery: (...args: unknown[]) => mockUseAdminFeedbackQuery(...args),
  useAdminModelsQuery: (...args: unknown[]) => mockUseAdminModelsQuery(...args),
}));

/**
 * Only `Select` is swapped for a plain, always-expanded stand-in, same as
 * `Analytics/__tests__/AnalyticsView.spec.tsx` — Radix's open/close choreography isn't
 * relevant here and is awkward to drive in jsdom.
 */
jest.mock('@librechat/client', () => {
  const actual = jest.requireActual('@librechat/client');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactRuntime = require('react');
  const SelectContext = ReactRuntime.createContext(
    {} as { onValueChange?: (value: string) => void },
  );
  return {
    ...actual,
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value: string;
      onValueChange: (value: string) => void;
      children: React.ReactNode;
    }) => (
      <SelectContext.Provider value={{ onValueChange }}>
        <div data-current-value={value}>{children}</div>
      </SelectContext.Provider>
    ),
    SelectTrigger: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    SelectValue: () => null,
    SelectContent: ({ children }: React.PropsWithChildren<unknown>) => <div>{children}</div>,
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => {
      const { onValueChange } = ReactRuntime.useContext(SelectContext);
      return (
        <button type="button" onClick={() => onValueChange?.(value)}>
          {children}
        </button>
      );
    },
  };
});

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    messageId: 'msg-1',
    conversationId: 'conv-1',
    userId: 'user-1',
    userName: 'Ivan',
    model: 'gpt-4o',
    rating: 'thumbsUp',
    tag: 'accurate_reliable',
    text: 'Great answer',
    date: new Date().toISOString(),
    ...overrides,
  };
}

describe('FeedbackView', () => {
  beforeEach(() => {
    mockUseAdminModelsQuery.mockReturnValue({
      data: [{ id: 'gpt-4o', label: 'GPT-4o', description: '' }],
    });
  });

  it('shows a loading state', () => {
    mockUseAdminFeedbackQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: jest.fn(),
    });

    render(<FeedbackView />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows an empty state when there are no rows', () => {
    mockUseAdminFeedbackQuery.mockReturnValue({
      data: { rows: [], total: 0 },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    render(<FeedbackView />);

    expect(
      screen.getByText('No ratings were recorded for the selected period.'),
    ).toBeInTheDocument();
  });

  it('shows an error state with a retry action', async () => {
    const refetch = jest.fn();
    mockUseAdminFeedbackQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });

    const user = userEvent.setup();
    render(<FeedbackView />);

    const retryButton = screen.getByRole('button', { name: 'Retry' });
    await user.click(retryButton);

    expect(refetch).toHaveBeenCalled();
  });

  it('renders a feedback row with a human-readable model, tag and rating icon', () => {
    mockUseAdminFeedbackQuery.mockReturnValue({
      data: { rows: [makeRow()], total: 1 },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    render(<FeedbackView />);

    expect(screen.getByText('Ivan')).toBeInTheDocument();
    expect(screen.getByText('GPT-4o')).toBeInTheDocument();
    expect(screen.getByText('Accurate and Reliable')).toBeInTheDocument();
    expect(screen.getByText('Great answer')).toBeInTheDocument();
    expect(screen.getByLabelText('Positive')).toBeInTheDocument();
  });

  /**
   * The comment is the one piece of a feedback row an admin actually needs to read in
   * full — it must wrap onto multiple lines instead of being clipped with an ellipsis
   * that offers no way to see the rest.
   */
  it('lets a long comment wrap instead of truncating it', () => {
    const longComment =
      'This is a long comment describing exactly what was wrong with the answer in enough detail that it would overflow a single table cell line.';
    mockUseAdminFeedbackQuery.mockReturnValue({
      data: { rows: [makeRow({ text: longComment })], total: 1 },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    render(<FeedbackView />);

    const commentCell = screen.getByText(longComment);
    expect(commentCell).toBeInTheDocument();
    expect(commentCell.className).not.toMatch(/\btruncate\b/);
    expect(commentCell.className).toMatch(/whitespace-normal/);
  });

  it('shows a dash for an empty tag and an empty comment', () => {
    mockUseAdminFeedbackQuery.mockReturnValue({
      data: { rows: [makeRow({ tag: '', text: '', rating: 'thumbsDown' })], total: 1 },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    render(<FeedbackView />);

    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByLabelText('Negative')).toBeInTheDocument();
  });

  /**
   * A tag key that no longer exists in `FEEDBACK_TAGS` (renamed or retired) must still
   * show something useful rather than silently dropping the row's reason.
   */
  it('falls back to the raw tag value for an unknown, non-empty tag', () => {
    mockUseAdminFeedbackQuery.mockReturnValue({
      data: { rows: [makeRow({ tag: 'retired_tag' })], total: 1 },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    render(<FeedbackView />);

    expect(screen.getByText('retired_tag')).toBeInTheDocument();
  });

  it('sends the selected rating to the query and resets the page', async () => {
    mockUseAdminFeedbackQuery.mockReturnValue({
      data: { rows: [makeRow()], total: 60 },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    const user = userEvent.setup();
    render(<FeedbackView />);

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: '👍 only' }));

    const lastCallParams = mockUseAdminFeedbackQuery.mock.calls.at(-1)?.[0];
    expect(lastCallParams).toMatchObject({ rating: 'thumbsUp', skip: 0, limit: 25 });
  });

  it('paginates using the page summary and next/prev controls', async () => {
    mockUseAdminFeedbackQuery.mockReturnValue({
      data: { rows: [makeRow()], total: 60 },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    const user = userEvent.setup();
    render(<FeedbackView />);

    expect(screen.getByText('Showing 1–25 of 60')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prev' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Next' }));

    const lastCallParams = mockUseAdminFeedbackQuery.mock.calls.at(-1)?.[0];
    expect(lastCallParams).toMatchObject({ skip: 25 });
  });
});
