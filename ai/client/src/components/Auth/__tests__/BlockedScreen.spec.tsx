import userEvent from '@testing-library/user-event';
import { render, screen } from 'test/layout-test-utils';
import BlockedScreen from '~/components/Auth/BlockedScreen';

const mockLogout = jest.fn();
const mockUser = { email: 'blocked@example.com' };

jest.mock('~/hooks/AuthContext', () => ({
  ...jest.requireActual('~/hooks/AuthContext'),
  useAuthContext: () => ({ user: mockUser, logout: mockLogout }),
}));

describe('BlockedScreen', () => {
  beforeEach(() => {
    mockLogout.mockClear();
  });

  it('объясняет блокировку и показывает учётную запись', () => {
    render(<BlockedScreen />);
    expect(screen.getByRole('alert')).toBeVisible();
    expect(screen.getByText('Account blocked')).toBeVisible();
    expect(screen.getByText('blocked@example.com')).toBeVisible();
  });

  it('даёт выйти из аккаунта', async () => {
    render(<BlockedScreen />);
    await userEvent.click(screen.getByRole('button', { name: /log out/i }));
    expect(mockLogout).toHaveBeenCalled();
  });
});
