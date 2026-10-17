import { render, screen } from '@testing-library/react';
import { Toast } from '../Toast';
import { NotificationSeverity } from '../../common';

const mockUseToast = jest.fn();

jest.mock('../../hooks/useToast', () => ({
  __esModule: true,
  default: () => mockUseToast(),
}));

describe('Toast', () => {
  it('renders nothing when the toast is closed', () => {
    mockUseToast.mockReturnValue({
      toast: { open: false, message: '', severity: NotificationSeverity.SUCCESS, showIcon: true },
    });

    const { container } = render(<Toast />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows the message when the toast is open', () => {
    mockUseToast.mockReturnValue({
      toast: {
        open: true,
        message: 'Переиндексировано: 8, пропущено: 0',
        severity: NotificationSeverity.SUCCESS,
        showIcon: true,
      },
    });

    render(<Toast />);

    expect(screen.getByText('Переиндексировано: 8, пропущено: 0')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('hides the icon when showIcon is false', () => {
    mockUseToast.mockReturnValue({
      toast: { open: true, message: 'no icon here', severity: NotificationSeverity.INFO, showIcon: false },
    });

    const { container } = render(<Toast />);

    expect(container.querySelector('svg')).not.toBeInTheDocument();
  });

  it('applies distinct styling per severity, so an error does not look like a success', () => {
    mockUseToast.mockReturnValue({
      toast: { open: true, message: 'failed', severity: NotificationSeverity.ERROR, showIcon: true },
    });
    const { container: errorContainer } = render(<Toast />);
    const errorClass = errorContainer.querySelector('[role="status"] > div')?.className;

    mockUseToast.mockReturnValue({
      toast: { open: true, message: 'ok', severity: NotificationSeverity.SUCCESS, showIcon: true },
    });
    const { container: successContainer } = render(<Toast />);
    const successClass = successContainer.querySelector('[role="status"] > div')?.className;

    expect(errorClass).toContain('status-error');
    expect(successClass).toContain('status-success');
    expect(errorClass).not.toBe(successClass);
  });
});
