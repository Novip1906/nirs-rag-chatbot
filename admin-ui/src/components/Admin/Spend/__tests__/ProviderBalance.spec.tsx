import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminProviderBalance } from '~/api';
import ProviderBalance from '../ProviderBalance';

const mockUseAdminProviderBalanceQuery = jest.fn();

jest.mock('~/data-provider/Admin', () => ({
  useAdminProviderBalanceQuery: (...args: unknown[]) => mockUseAdminProviderBalanceQuery(...args),
}));

function mockBalance(balance: AdminProviderBalance | undefined, refetch = jest.fn()) {
  mockUseAdminProviderBalanceQuery.mockReturnValue({
    data: balance,
    isFetching: false,
    refetch,
  });
  return refetch;
}

const checkedAt = '2026-08-27T19:46:27.545Z';

describe('ProviderBalance', () => {
  afterEach(() => {
    mockUseAdminProviderBalanceQuery.mockReset();
  });

  it('shows the balance in rubles with the provider host', () => {
    mockBalance({ provider: 'polza.ai', status: 'ok', amountUsd: 261.83761077, checkedAt });

    render(<ProviderBalance />);

    expect(screen.getByText('polza.ai', { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/261/)).toBeInTheDocument();
  });

  it('renders nothing while the balance is loading', () => {
    mockBalance(undefined);

    const { container } = render(<ProviderBalance />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when no provider key is configured', () => {
    mockBalance({ provider: '', status: 'not_configured', amountUsd: null, checkedAt });

    const { container } = render(<ProviderBalance />);

    expect(container).toBeEmptyDOMElement();
  });

  it('says so when the provider could not be reached', () => {
    mockBalance({ provider: 'polza.ai', status: 'unavailable', amountUsd: null, checkedAt });

    render(<ProviderBalance />);

    expect(screen.getByText('Could not be fetched')).toBeInTheDocument();
  });

  it('refetches on demand', async () => {
    const refetch = mockBalance({
      provider: 'polza.ai',
      status: 'ok',
      amountUsd: 100,
      checkedAt,
    });

    render(<ProviderBalance />);
    await userEvent.click(screen.getByRole('button'));

    expect(refetch).toHaveBeenCalled();
  });
});
