import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AnalyticsView from '../AnalyticsView';

const mockUseAdminAnalyticsQuery = jest.fn();
const mockUseAdminActivityQuery = jest.fn();

jest.mock('~/data-provider/Admin', () => ({
  useAdminAnalyticsQuery: (...args: unknown[]) => mockUseAdminAnalyticsQuery(...args),
  useAdminActivityQuery: (...args: unknown[]) => mockUseAdminActivityQuery(...args),
}));

function mockActivity(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    data: {
      activeUsers: 5,
      requests: 42,
      avgRequestsPerUser: 8.4,
      returningUsers: 2,
      avgActiveDaysPerUser: 3.5,
      feedback: { thumbsUp: 7, thumbsDown: 3 },
      ...overrides,
    },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  };
}

/**
 * Everything except the group-by `Select` renders through the real `@librechat/client`
 * primitives. Only `Select` is swapped for a plain, always-expanded stand-in — Radix's
 * open/close and focus choreography isn't relevant here and is awkward to drive in jsdom.
 */
jest.mock('@librechat/client', () => {
  const actual = jest.requireActual('@librechat/client');
  /** `React` (imported above, typed) is out of scope inside a hoisted `jest.mock`
   *  factory — this local, untyped handle covers the runtime calls it needs. */
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

describe('AnalyticsView — scenario grouping', () => {
  beforeEach(() => {
    mockUseAdminActivityQuery.mockReturnValue(mockActivity());
    mockUseAdminAnalyticsQuery.mockReturnValue({
      data: [
        {
          key: 'title',
          label: 'title',
          costUsd: 5,
          requests: 2,
          promptTokens: 10,
          completionTokens: 5,
          unknownCostRequests: 0,
        },
        {
          key: '',
          label: '',
          costUsd: 3,
          requests: 1,
          promptTokens: 4,
          completionTokens: 2,
          unknownCostRequests: 0,
        },
      ],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
  });

  it('offers scenario as a group-by option', () => {
    render(<AnalyticsView />);
    expect(screen.getByRole('button', { name: 'Scenario' })).toBeInTheDocument();
  });

  /**
   * The server groups by the raw `scenario` code (`title`, `''`, ...) — translating
   * that into "Title generation" / "User request" is this view's job, not the API's.
   */
  it('shows human-readable scenario labels once grouped by scenario, not the raw code', async () => {
    const user = userEvent.setup();
    render(<AnalyticsView />);

    await user.click(screen.getByRole('button', { name: 'Scenario' }));

    expect(screen.getAllByText('Title generation').length).toBeGreaterThan(0);
    expect(screen.getAllByText('User request').length).toBeGreaterThan(0);
    expect(screen.queryByText('title')).not.toBeInTheDocument();
  });
});

describe('AnalyticsView — metrics strip', () => {
  beforeEach(() => {
    mockUseAdminAnalyticsQuery.mockReturnValue({
      data: [
        {
          key: 'department',
          label: 'Sales',
          costUsd: 999,
          requests: 123,
          promptTokens: 400,
          completionTokens: 200,
          unknownCostRequests: 0,
        },
      ],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
  });

  it('renders the five metric numbers from the activity query', () => {
    mockUseAdminActivityQuery.mockReturnValue(mockActivity());

    render(<AnalyticsView />);

    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('8.4')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    /**
     * The captions are the only place percentages appear on this strip — assert the
     * literal `%` sign is present, not just the surrounding words, since a caption like
     * "40 of active" (percent silently dropped) would read as an absolute count.
     */
    expect(screen.getByText('40% of active, 3.5 days per person on average')).toBeInTheDocument();
    expect(screen.getByText('70% positive')).toBeInTheDocument();
    expect(screen.getByText(/^40%/)).toBeInTheDocument();
    expect(screen.getByText(/^70%/)).toBeInTheDocument();
  });

  /**
   * On a small pilot, dividing by zero active users must never surface a raw `NaN%`, nor
   * a misleading `0.0` — every metric derived from a per-user average falls back to an
   * em dash instead.
   */
  it('shows dashes instead of NaN or a misleading zero when there are no active users', () => {
    mockUseAdminActivityQuery.mockReturnValue(mockActivity({ activeUsers: 0, returningUsers: 0 }));

    render(<AnalyticsView />);

    expect(screen.getByText('— of active, — days per person on average')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText('8.4')).not.toBeInTheDocument();
    expect(screen.queryByText(/—%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.queryByText('0.0')).not.toBeInTheDocument();
  });

  it('shows an error state for the metrics strip without breaking the rest of the page', () => {
    mockUseAdminActivityQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: jest.fn(),
    });

    render(<AnalyticsView />);

    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getAllByText('Sales').length).toBeGreaterThan(0);
  });

  it('stays visible when the spend table has no rows', () => {
    mockUseAdminActivityQuery.mockReturnValue(mockActivity());
    mockUseAdminAnalyticsQuery.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    render(<AnalyticsView />);

    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('No usage was recorded for the selected period.')).toBeInTheDocument();
  });
});
