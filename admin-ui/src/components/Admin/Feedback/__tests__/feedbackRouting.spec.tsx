import React from 'react';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import FeedbackView from '../FeedbackView';

const mockUseAdminFeedbackQuery = jest.fn();
const mockUseAdminModelsQuery = jest.fn();

jest.mock('~/data-provider/Admin', () => ({
  useAdminFeedbackQuery: (...args: unknown[]) => mockUseAdminFeedbackQuery(...args),
  useAdminModelsQuery: (...args: unknown[]) => mockUseAdminModelsQuery(...args),
}));

/**
 * Mirrors `Admin/Users/__tests__/adminUserRouting.spec.tsx` and
 * `Admin/Knowledge/__tests__/knowledgeRouting.spec.tsx`: render the real page component
 * behind the exact route path declared in `~/routes/index.tsx` for `/admin/feedback`.
 */
function renderFeedbackRouter() {
  const router = createMemoryRouter([{ path: '/admin/feedback', element: <FeedbackView /> }], {
    initialEntries: ['/admin/feedback'],
  });
  render(<RouterProvider router={router} />);
}

describe('admin feedback route', () => {
  beforeEach(() => {
    mockUseAdminModelsQuery.mockReturnValue({ data: [] });
    mockUseAdminFeedbackQuery.mockReturnValue({
      data: { rows: [], total: 0 },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
  });

  it('"/admin/feedback" renders the feedback page', () => {
    renderFeedbackRouter();

    expect(screen.getByRole('heading', { level: 1, name: 'Feedback' })).toBeInTheDocument();
    expect(
      screen.getByText('Ratings employees gave to answers over the selected period.'),
    ).toBeInTheDocument();
  });
});
