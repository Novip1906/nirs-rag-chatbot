import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import type {
  LimitRequestResponse,
  PendingLimitRequest,
  UsageMeResponse,
  UsageWindow,
} from '~/data-provider/Usage';

const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock('librechat-data-provider', () => ({
  request: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

jest.mock('@librechat/client', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const react = require('react');
  return {
    Button: react.forwardRef((props: ComponentProps<'button'>, ref: unknown) =>
      react.createElement('button', { ...props, ref }),
    ),
  };
});

jest.mock('recoil', () => ({
  useRecoilValue: () => false,
}));

jest.mock('~/store', () => ({
  __esModule: true,
  default: { anySubmittingSelector: 'anySubmittingSelector' },
}));

const mockHour12 = true;
const mockLanguage = 'en';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, options?: Record<string, string | number>) =>
    options != null ? `${key}:${JSON.stringify(options)}` : key,
  useClockFormat: () => mockHour12,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: mockLanguage } }),
}));

jest.mock('~/utils', () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

import UsageWidget, {
  buildUsageWindows,
  computeWindowPercent,
  formatPendingSince,
  severityFor,
} from '../UsageWidget';

const noLimits: UsageWindow = {
  costUsd: 0,
  requests: 0,
  limits: { costUsd: null },
};

const monthly = { costUsd: 0, requests: 0 };

const renderWidget = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<UsageWidget />, { wrapper });
};

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
});

describe('computeWindowPercent', () => {
  it('returns null when the cost threshold is not set', () => {
    expect(computeWindowPercent(noLimits)).toBeNull();
  });

  it('считает процент по деньгам', () => {
    const usageWindow: UsageWindow = {
      costUsd: 90,
      requests: 10,
      limits: { costUsd: 100 },
    };
    expect(computeWindowPercent(usageWindow)).toBe(90);
  });

  it('treats a zero cost limit as fully exhausted even with zero spend', () => {
    const usageWindow: UsageWindow = {
      costUsd: 0,
      requests: 0,
      limits: { costUsd: 0 },
    };
    expect(computeWindowPercent(usageWindow)).toBe(Infinity);
  });

  it('treats a negative limit as fully exhausted', () => {
    const usageWindow: UsageWindow = {
      costUsd: 0,
      requests: 0,
      limits: { costUsd: -10 },
    };
    expect(computeWindowPercent(usageWindow)).toBe(Infinity);
  });
});

describe('formatPendingSince', () => {
  it('formats a 24-hour clock, without AM/PM, for the ru interface language', () => {
    const localCreatedAt = new Date(2026, 7, 25, 13, 0).toISOString();
    const result = formatPendingSince(localCreatedAt, 'ru', false);
    expect(result).toBe('25.08.2026, 13:00');
  });
});

describe('severityFor', () => {
  it('is normal at or below 80%', () => {
    expect(severityFor(0)).toBe('normal');
    expect(severityFor(80)).toBe('normal');
  });

  it('is warning above 80% and below 100%', () => {
    expect(severityFor(81)).toBe('warning');
    expect(severityFor(99.9)).toBe('warning');
  });

  it('is critical at 100% and above, matching the server block boundary', () => {
    expect(severityFor(100)).toBe('critical');
    expect(severityFor(101)).toBe('critical');
    expect(severityFor(Infinity)).toBe('critical');
  });
});

describe('buildUsageWindows', () => {
  it('returns an empty list when the daily window has no threshold', () => {
    const data: UsageMeResponse = { daily: noLimits, monthly, pendingRequests: [] };
    expect(buildUsageWindows(data)).toEqual([]);
  });

  it('returns the daily window when it has a threshold', () => {
    const data: UsageMeResponse = {
      daily: { costUsd: 80, requests: 30, limits: { costUsd: 100 } },
      monthly,
      pendingRequests: [],
    };
    const windows = buildUsageWindows(data);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toEqual({ kind: 'daily', percent: 80, severity: 'normal' });
  });
});

const exhaustedDaily: UsageWindow = {
  costUsd: 120,
  requests: 0,
  limits: { costUsd: 100 },
};

describe('UsageWidget', () => {
  it('renders nothing when the API has no threshold at all', async () => {
    const response: UsageMeResponse = { daily: noLimits, monthly, pendingRequests: [] };
    mockGet.mockResolvedValue(response);

    const { container } = renderWidget();

    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('renders nothing while the request fails', async () => {
    mockGet.mockRejectedValue(new Error('network down'));

    const { container } = renderWidget();

    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('показывает расход по деньгам и красит его как предупреждение выше 80%', async () => {
    const response: UsageMeResponse = {
      daily: { costUsd: 90, requests: 30, limits: { costUsd: 100 } },
      monthly,
      pendingRequests: [],
    };
    mockGet.mockResolvedValue(response);

    renderWidget();

    const trigger = await screen.findByTestId('usage-widget-trigger');
    expect(trigger.className).toContain('text-status-warning');

    fireEvent.click(trigger);

    expect(await screen.findByText('90%')).toBeInTheDocument();
  });

  /** Расход сотруднику показывается только долей от лимита: суммы в долларах ему ничего
   *  не говорят, распоряжается ими админ. */
  it('не показывает сотруднику денежные суммы, только процент', async () => {
    const response: UsageMeResponse = {
      daily: { costUsd: 0.22, requests: 30, limits: { costUsd: 0.02 } },
      monthly,
      pendingRequests: [],
    };
    mockGet.mockResolvedValue(response);

    renderWidget();

    const trigger = await screen.findByTestId('usage-widget-trigger');
    fireEvent.click(trigger);

    expect(await screen.findByText('999%')).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it('shows the request button when the window is exhausted and no request is open for it', async () => {
    const response: UsageMeResponse = { daily: exhaustedDaily, monthly, pendingRequests: [] };
    mockGet.mockResolvedValue(response);

    renderWidget();

    const trigger = await screen.findByTestId('usage-widget-trigger');
    fireEvent.click(trigger);

    expect(await screen.findByText('com_usage_request_increase')).toBeInTheDocument();
    expect(screen.queryByTestId('usage-pending-daily')).not.toBeInTheDocument();
  });

  it('shows the pending status instead of the button when a request is already open', async () => {
    const pendingRequest: PendingLimitRequest = {
      id: 'req-1',
      window: 'daily',
      createdAt: '2026-08-25T10:00:00.000Z',
    };
    const response: UsageMeResponse = {
      daily: exhaustedDaily,
      monthly,
      pendingRequests: [pendingRequest],
    };
    mockGet.mockResolvedValue(response);

    renderWidget();

    const trigger = await screen.findByTestId('usage-widget-trigger');
    fireEvent.click(trigger);

    expect(await screen.findByTestId('usage-pending-daily')).toBeInTheDocument();
    expect(screen.queryByText('com_usage_request_increase')).not.toBeInTheDocument();
  });

  it('shows a zero daily limit as fully exhausted and critical, not as 0% in the normal color', async () => {
    const response: UsageMeResponse = {
      daily: { costUsd: 0, requests: 0, limits: { costUsd: 0 } },
      monthly,
      pendingRequests: [],
    };
    mockGet.mockResolvedValue(response);

    renderWidget();

    const trigger = await screen.findByTestId('usage-widget-trigger');
    expect(trigger.className).toContain('text-status-error');
    expect(trigger.className).not.toContain('text-text-secondary');

    fireEvent.click(trigger);

    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(await screen.findByText('com_usage_request_increase')).toBeInTheDocument();
  });

  it('never shows a rounded-up 100% while the exhausted button is still hidden', async () => {
    const response: UsageMeResponse = {
      daily: { costUsd: 99.6, requests: 0, limits: { costUsd: 100 } },
      monthly,
      pendingRequests: [],
    };
    mockGet.mockResolvedValue(response);

    renderWidget();

    const trigger = await screen.findByTestId('usage-widget-trigger');
    fireEvent.click(trigger);

    expect(await screen.findByText('99%')).toBeInTheDocument();
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
    expect(screen.queryByText('com_usage_request_increase')).not.toBeInTheDocument();
  });

  it('shows the button exactly when it reaches the displayed 100%', async () => {
    const response: UsageMeResponse = {
      daily: { costUsd: 100, requests: 0, limits: { costUsd: 100 } },
      monthly,
      pendingRequests: [],
    };
    mockGet.mockResolvedValue(response);

    renderWidget();

    const trigger = await screen.findByTestId('usage-widget-trigger');
    fireEvent.click(trigger);

    expect(await screen.findByText('100%')).toBeInTheDocument();
    expect(await screen.findByText('com_usage_request_increase')).toBeInTheDocument();
  });

  it('requests a limit increase, and reflects the server-confirmed pending state on refetch', async () => {
    const initialResponse: UsageMeResponse = {
      daily: exhaustedDaily,
      monthly,
      pendingRequests: [],
    };
    const afterRequestResponse: UsageMeResponse = {
      ...initialResponse,
      pendingRequests: [{ id: 'req-1', window: 'daily', createdAt: '2026-08-25T10:00:00.000Z' }],
    };
    mockGet.mockResolvedValueOnce(initialResponse).mockResolvedValue(afterRequestResponse);
    const postResponse: LimitRequestResponse = {
      request: {
        id: 'req-1',
        userId: 'user-1',
        window: 'daily',
        status: 'pending',
        resolvedBy: null,
        resolvedAt: null,
        createdAt: '2026-08-25T10:00:00.000Z',
      },
    };
    mockPost.mockResolvedValue(postResponse);

    renderWidget();

    const trigger = await screen.findByTestId('usage-widget-trigger');
    fireEvent.click(trigger);

    const requestButton = await screen.findByText('com_usage_request_increase');
    await act(async () => {
      fireEvent.click(requestButton);
    });

    expect(mockPost).toHaveBeenCalledWith('/api/office/usage/request-limit', { window: 'daily' });
    expect(await screen.findByTestId('usage-pending-daily')).toBeInTheDocument();
    expect(screen.queryByText('com_usage_request_increase')).not.toBeInTheDocument();
  });
});
