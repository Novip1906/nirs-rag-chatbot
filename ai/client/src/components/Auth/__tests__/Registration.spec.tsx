import * as reactRouter from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import * as mockDataProvider from 'librechat-data-provider/react-query';
import type { TStartupConfig } from 'librechat-data-provider';
import * as endpointQueries from '~/data-provider/Endpoints/queries';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender } from '@testing-library/react';
import { RecoilRoot } from 'recoil';
import { act, render, waitFor, screen } from 'test/layout-test-utils';
import * as miscDataProvider from '~/data-provider/Misc/queries';
import * as authMutations from '~/data-provider/Auth/mutations';
import * as authQueries from '~/data-provider/Auth/queries';
import Registration from '~/components/Auth/Registration';
import AuthLayout from '~/components/Auth/AuthLayout';

jest.mock('librechat-data-provider/react-query');

const mockStartupConfig = {
  isFetching: false,
  isLoading: false,
  isError: false,
  data: {
    socialLogins: ['google', 'facebook', 'openid', 'github', 'discord', 'saml'],
    discordLoginEnabled: true,
    facebookLoginEnabled: true,
    githubLoginEnabled: true,
    googleLoginEnabled: true,
    openidLoginEnabled: true,
    openidLabel: 'Test OpenID',
    openidImageUrl: 'http://test-server.com',
    samlLoginEnabled: true,
    samlLabel: 'Test SAML',
    samlImageUrl: 'http://test-server.com',
    registrationEnabled: true,
    socialLoginEnabled: true,
    serverDomain: 'mock-server',
  },
};

const setup = ({
  useGetUserQueryReturnValue = {
    isLoading: false,
    isError: false,
    data: {},
  },
  useRegisterUserMutationReturnValue = {
    isLoading: false,
    isError: false,
    mutate: jest.fn(),
    data: {},
    isSuccess: false,
    error: null as Error | null,
  },
  useRefreshTokenMutationReturnValue = {
    isLoading: false,
    isError: false,
    mutate: jest.fn(),
    data: {
      token: 'mock-token',
      user: {},
    },
  },
  useGetBannerQueryReturnValue = {
    isLoading: false,
    isError: false,
    data: {},
  },
  useGetStartupConfigReturnValue = mockStartupConfig,
} = {}) => {
  const mockUseRegisterUserMutation = jest
    .spyOn(mockDataProvider, 'useRegisterUserMutation')
    //@ts-ignore - we don't need all parameters of the QueryObserverSuccessResult
    .mockReturnValue(useRegisterUserMutationReturnValue);
  const mockUseGetUserQuery = jest
    .spyOn(authQueries, 'useGetUserQuery')
    //@ts-ignore - we don't need all parameters of the QueryObserverSuccessResult
    .mockReturnValue(useGetUserQueryReturnValue);
  const mockUseGetStartupConfig = jest
    .spyOn(endpointQueries, 'useGetStartupConfig')
    //@ts-ignore - we don't need all parameters of the QueryObserverSuccessResult
    .mockReturnValue(useGetStartupConfigReturnValue);
  const mockUseRefreshTokenMutation = jest
    .spyOn(authMutations, 'useRefreshTokenMutation')
    //@ts-ignore - we don't need all parameters of the QueryObserverSuccessResult
    .mockReturnValue(useRefreshTokenMutationReturnValue);
  const mockUseOutletContext = jest.spyOn(reactRouter, 'useOutletContext').mockReturnValue({
    startupConfig: useGetStartupConfigReturnValue.data,
  });
  jest
    .spyOn(miscDataProvider, 'useGetBannerQuery')
    //@ts-ignore - we don't need all parameters of the QueryObserverSuccessResult
    .mockReturnValue(useGetBannerQueryReturnValue);
  const renderResult = render(
    <AuthLayout
      startupConfig={useGetStartupConfigReturnValue.data as TStartupConfig}
      isFetching={useGetStartupConfigReturnValue.isFetching}
      error={null}
      startupConfigError={null}
      header={'Create your account'}
      pathname="register"
    >
      <Registration />
    </AuthLayout>,
  );

  return {
    ...renderResult,
    mockUseGetUserQuery,
    mockUseOutletContext,
    mockUseGetStartupConfig,
    mockUseRegisterUserMutation,
    mockUseRefreshTokenMutation,
  };
};

const mockNavigate = jest.fn();
let mockSearch = '';

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  __esModule: true,
  useOutletContext: () => ({
    startupConfig: mockStartupConfig,
  }),
  useNavigate: () => mockNavigate,
  useLocation: () => ({
    search: mockSearch,
    pathname: '/register',
    hash: '',
    state: null,
    key: '',
  }),
}));

describe('закрытая регистрация', () => {
  const closedConfig = {
    ...mockStartupConfig,
    data: { ...mockStartupConfig.data, registrationEnabled: false },
  };

  beforeEach(() => {
    mockNavigate.mockClear();
    mockSearch = '';
  });

  test('без приглашения уводит на страницу входа', () => {
    setup({ useGetStartupConfigReturnValue: closedConfig });
    expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
  });

  test('по ссылке-приглашению показывает сообщение об устаревшей ссылке, а не форму', () => {
    mockSearch = '?token=invite-token';
    const { getByRole, queryByRole } = setup({ useGetStartupConfigReturnValue: closedConfig });
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(queryByRole('form', { name: /Registration form/i })).not.toBeInTheDocument();
    expect(getByRole('link', { name: 'Login' })).toHaveAttribute('href', '/login');
  });

  test('без приглашения адрес вводится вручную', () => {
    const { getByTestId } = setup();
    const email = getByTestId('email') as HTMLInputElement;
    expect(email.value).toBe('');
    expect(email).not.toHaveAttribute('readonly');
  });

  /**
   * Маршрут `/register` живёт под `StartupLayout`, вне `AuthContextProvider` —
   * в отличие от `/login`. Общая тестовая обвязка оборачивает страницу во все
   * провайдеры и потому эту разницу скрывает: обращение к `useAuthContext`
   * проходило в тестах и падало на живой ссылке-приглашении. Здесь страница
   * рендерится ровно с тем окружением, что даёт настоящий маршрут.
   */
  test('устаревшая ссылка рендерится без провайдера авторизации, как на реальном маршруте', () => {
    mockSearch = '?token=invite-token';
    jest
      .spyOn(mockDataProvider, 'useRegisterUserMutation')
      //@ts-ignore - в тесте нужен только mutate
      .mockReturnValue({ isLoading: false, isError: false, mutate: jest.fn(), isSuccess: false });
    jest
      .spyOn(endpointQueries, 'useGetStartupConfig')
      //@ts-ignore - в тесте нужен только data
      .mockReturnValue(closedConfig);
    jest.spyOn(reactRouter, 'useOutletContext').mockReturnValue({
      startupConfig: closedConfig.data,
    });

    const client = new QueryClient();
    const { getByRole } = rtlRender(
      <QueryClientProvider client={client}>
        <RecoilRoot>
          <Registration />
        </RecoilRoot>
      </QueryClientProvider>,
    );

    expect(getByRole('link', { name: 'Login' })).toHaveAttribute('href', '/login');
  });

  test('с выданным сервером токеном впускает сразу, без отсчёта', async () => {
    const { mockUseRegisterUserMutation } = setup({
      useGetStartupConfigReturnValue: closedConfig,
    });

    const options = mockUseRegisterUserMutation.mock.calls[0][0] as {
      onSuccess?: (data: unknown) => void;
    };
    act(() => {
      options.onSuccess?.({
        message: 'ok',
        token: 'fresh-token',
        user: { id: 'u1', email: 'someone@example.com' },
      });
    });

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/c/new', { replace: true }));
  });

  test('без токена сразу не впускает — ждёт подтверждения почты', async () => {
    const { mockUseRegisterUserMutation } = setup({
      useGetStartupConfigReturnValue: closedConfig,
    });

    const options = mockUseRegisterUserMutation.mock.calls[0][0] as {
      onSuccess?: (data: unknown) => void;
    };
    act(() => {
      options.onSuccess?.({ message: 'проверьте почту' });
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mockNavigate).not.toHaveBeenCalledWith('/c/new', { replace: true });
  });

  test('при открытой регистрации не уводит никуда', () => {
    setup();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

test('renders registration form', () => {
  const { getByText, getByTestId, getByRole } = setup();
  expect(getByText(/Create your account/i)).toBeInTheDocument();
  expect(getByRole('textbox', { name: /^Name$/i })).toHaveClass('h-auto');
  expect(getByRole('form', { name: /Registration form/i })).toBeVisible();
  expect(getByRole('textbox', { name: /Email/i })).toBeInTheDocument();
  expect(getByTestId('password')).toBeInTheDocument();
  expect(getByTestId('confirm_password')).toBeInTheDocument();
  expect(getByRole('button', { name: /Submit registration/i })).toBeInTheDocument();
  expect(getByRole('link', { name: 'Login' })).toBeInTheDocument();
  expect(getByRole('link', { name: 'Login' })).toHaveAttribute('href', '/login');
  expect(getByRole('link', { name: /Continue with Google/i })).toBeInTheDocument();
  expect(getByRole('link', { name: /Continue with Google/i })).toHaveAttribute(
    'href',
    'mock-server/oauth/google',
  );
  expect(getByRole('link', { name: /Continue with Facebook/i })).toBeInTheDocument();
  expect(getByRole('link', { name: /Continue with Facebook/i })).toHaveAttribute(
    'href',
    'mock-server/oauth/facebook',
  );
  expect(getByRole('link', { name: /Continue with Github/i })).toBeInTheDocument();
  expect(getByRole('link', { name: /Continue with Github/i })).toHaveAttribute(
    'href',
    'mock-server/oauth/github',
  );
  expect(getByRole('link', { name: /Continue with Discord/i })).toBeInTheDocument();
  expect(getByRole('link', { name: /Continue with Discord/i })).toHaveAttribute(
    'href',
    'mock-server/oauth/discord',
  );
  expect(getByRole('link', { name: /Test SAML/i })).toBeInTheDocument();
  expect(getByRole('link', { name: /Test SAML/i })).toHaveAttribute(
    'href',
    'mock-server/oauth/saml',
  );
});

// test('calls registerUser.mutate on registration', async () => {
//   const mutate = jest.fn();
//   const { getByTestId, getByRole, history } = setup({
//     // @ts-ignore - we don't need all parameters of the QueryObserverResult
//     useLoginUserReturnValue: {
//       isLoading: false,
//       mutate: mutate,
//       isError: false,
//       isSuccess: true,
//     },
//   });

//   await userEvent.type(getByRole('textbox', { name: /^Name$/i }), 'John Doe');
//   await userEvent.type(getByRole('textbox', { name: /Nickname/i }), 'johndoe');
//   await userEvent.type(getByRole('textbox', { name: /Email/i }), 'test@test.com');
//   await userEvent.type(getByTestId('password'), 'password');
//   await userEvent.type(getByTestId('confirm_password'), 'password');
//   await userEvent.click(getByRole('button', { name: /Submit registration/i }));

//   console.log(history);
//   waitFor(() => {
//     // expect(mutate).toHaveBeenCalled();
//     expect(history.location.pathname).toBe('/c/new');
//   });
// });

test('shows validation error messages', async () => {
  const { getByTestId, getAllByRole, getByRole } = setup();
  await userEvent.type(getByRole('textbox', { name: /^Name$/i }), 'J');
  await userEvent.type(getByRole('textbox', { name: /Email/i }), 'test');
  await userEvent.type(getByTestId('password'), 'pass');
  await userEvent.type(getByTestId('confirm_password'), 'password1');
  const alerts = getAllByRole('alert');
  expect(alerts).toHaveLength(5);

  // This first alert is for the theme toggle, which is empty within this test but still picked up by getAllByRole as an alert
  expect(alerts[0]).toHaveTextContent('');

  expect(alerts[1]).toHaveTextContent(/Name must be at least 3 characters/i);
  expect(alerts[2]).toHaveTextContent(/You must enter a valid email address/i);
  expect(alerts[3]).toHaveTextContent(/Password must be at least 8 characters/i);
  expect(alerts[4]).toHaveTextContent(/Passwords do not match/i);
});

test('shows error message when registration fails', async () => {
  const mutate = jest.fn();
  const { getByTestId, getByRole } = setup({
    useRegisterUserMutationReturnValue: {
      isLoading: false,
      isError: true,
      mutate,
      error: new Error('Registration failed'),
      data: {},
      isSuccess: false,
    },
  });

  await userEvent.type(getByRole('textbox', { name: /^Name$/i }), 'John Doe');
  await userEvent.type(getByRole('textbox', { name: /Email/i }), 'test@test.com');
  await userEvent.type(getByTestId('password'), 'password');
  await userEvent.type(getByTestId('confirm_password'), 'password');
  await userEvent.click(getByRole('button', { name: /Submit registration/i }));

  waitFor(() => {
    expect(screen.getByTestId('registration-error')).toBeInTheDocument();
    expect(screen.getByTestId('registration-error')).toHaveTextContent(
      /There was an error attempting to register your account. Please try again. Registration failed/i,
    );
  });
});
