import { render, screen } from '@testing-library/react';
import App from '../App';

/**
 * Regression: `ToastProvider` was never mounted in `App.tsx`, so every `showToast` call
 * across the admin UI (space create/update/delete, document upload, reindex, error
 * toasts — six call sites) silently updated state nothing displayed. `useToastContext`'s
 * default value (`showToast: () => ({})`) meant nothing even threw — it just did nothing.
 * This test renders the real `App` tree (only the page/auth components are stubbed) and
 * proves a toast fired from deep inside actually reaches the screen, so the wiring can't
 * silently regress again.
 */

jest.mock('../pages/LoginPage', () => () => null);
jest.mock('../pages/AuthCallbackPage', () => () => null);

jest.mock('../auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../auth/RequireAuth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../components/Admin/AdminLayout', () => ({
  __esModule: true,
  default: function ToastProbe() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useEffect } = require('react');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useToastContext } = require('@librechat/client');
    const { showToast } = useToastContext();
    useEffect(() => {
      showToast({ message: 'toast wiring check', status: 'success', duration: 100_000 });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <div>admin-layout-stub</div>;
  },
}));

describe('App — toast provider wiring', () => {
  it('mounts ToastProvider so a showToast call from deep in the tree actually renders on screen', async () => {
    window.history.pushState({}, '', '/admin/users');

    render(<App />);

    expect(await screen.findByText('toast wiring check')).toBeInTheDocument();
  });
});
