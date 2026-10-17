import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AxiosError } from 'axios';
import { createMemoryRouter, MemoryRouter, Route, Routes, RouterProvider } from 'react-router-dom';
import type { AdminUserListItem, KnowledgeSpaceItem } from '~/api';
import { mockAiUserEditPageLibrechatClient } from 'test/aiUserEditPageClientMock';
import AiUserEditPage from '../AiUserEditPage';
import { adminAccess } from '../../../__fixtures__/access';

const mockUseAdminUserQuery = jest.fn();
const mockUseAdminDepartmentsQuery = jest.fn();
const mockUseAdminSettingsQuery = jest.fn();
const mockUseKnowledgeSpacesQuery = jest.fn();
const mockMutate = jest.fn();
const mockRefetch = jest.fn();
const mockAuthUser = { id: 'admin-1' };
const mockUseAccess = jest.fn();

jest.mock('~/data-provider/Admin', () => ({
  useAdminUserQuery: (id: string | null | undefined) => mockUseAdminUserQuery(id),
  useAdminDepartmentsQuery: () => mockUseAdminDepartmentsQuery(),
  useAdminSettingsQuery: () => mockUseAdminSettingsQuery(),
  useUpdateAdminUserMutation: () => ({ mutate: mockMutate, isLoading: false }),
}));

jest.mock('~/data-provider/Knowledge', () => ({
  useKnowledgeSpacesQuery: () => mockUseKnowledgeSpacesQuery(),
}));

jest.mock('~/components/Admin/utils/modelLabels', () => ({
  useModelLabel: () => (id: string) => id,
  useModelLabelList: () => (ids: string[]) => ids.join(', '),
}));

/**
 * Контролируемая заглушка вместо настоящего Ariakit-стека: наружу торчит ровно то, что
 * проверяют тесты — выбранные модели, дефолт, состояние `disabled` и способ их поменять.
 * Единый `onChange` — как у настоящего `ModelAccessFields` — намеренно, а не пара
 * отдельных сеттеров: `add model` ниже меняет оба поля одним вызовом, и тест
 * «выбор модели одним кликом» проверяет, что `UserEditPage` доносит их до
 * `models.setValue` вместе, а не теряет одно из них.
 */
jest.mock('~/components/Admin/common/ModelAccess', () => ({
  __esModule: true,
  default: ({
    allowedModels,
    defaultModel,
    onChange,
    disabled,
  }: {
    allowedModels: string[];
    defaultModel: string | null;
    onChange: (next: { allowedModels: string[]; defaultModel: string | null }) => void;
    disabled?: boolean;
  }) => (
    <div
      data-testid="model-access-fields"
      data-disabled={disabled === true ? 'true' : 'false'}
      data-models={allowedModels.join(',')}
      data-default={defaultModel ?? ''}
    >
      <button
        type="button"
        onClick={() =>
          onChange({
            allowedModels: [...allowedModels, 'extra-model'],
            defaultModel: defaultModel ?? 'extra-model',
          })
        }
      >
        add model
      </button>
      <button type="button" onClick={() => onChange({ allowedModels: [], defaultModel: null })}>
        clear models
      </button>
    </div>
  ),
}));

jest.mock('~/components/Admin/common/SpacesMultiSelect', () => ({
  __esModule: true,
  default: ({
    selectedValues,
    setSelectedValues,
    label,
    spaces,
  }: {
    selectedValues: string[];
    setSelectedValues: (values: string[]) => void;
    label: string;
    spaces?: KnowledgeSpaceItem[];
  }) => (
    <div
      data-testid="spaces-multiselect"
      data-label={label}
      data-options={(spaces ?? []).map((space) => space.id).join(',')}
      data-selected={selectedValues.join(',')}
    >
      <button type="button" onClick={() => setSelectedValues([...selectedValues, 'space-x'])}>
        {`add to ${label}`}
      </button>
    </div>
  ),
}));

jest.mock('~/components/Admin/common/LimitsFields', () => ({
  __esModule: true,
  default: ({
    value,
    onChange,
    disabled,
  }: {
    value: { dailyCostUsd: number | null };
    onChange: (next: unknown) => void;
    disabled?: boolean;
  }) => (
    <div
      data-testid="limits-fields"
      data-disabled={disabled === true ? 'true' : 'false'}
      data-daily={value.dailyCostUsd ?? ''}
    >
      <button type="button" onClick={() => onChange({ ...value, dailyCostUsd: 42 })}>
        set daily 42
      </button>
    </div>
  ),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, string>) =>
    values?.name != null ? `${key}:${values.name}` : key,
  useAuthContext: () => ({ user: mockAuthUser }),
  useAccess: () => mockUseAccess(),
}));

jest.mock('@librechat/client', () => mockAiUserEditPageLibrechatClient());

const USER: AdminUserListItem = {
  id: 'mongo-1',
  employeeId: 'emp-1',
  openidId: 'sub-1',
  name: 'Ivan Ivanov',
  email: 'ivan@example.com',
  position: 'Lawyer',
  role: 'USER',
  departmentId: 'dept-1',
  departmentName: 'Legal',
  limits: { dailyCostUsd: null },
  limitsOverride: null,
  allowedModels: [],
  allowedModelsOverride: null,
  defaultModel: null,
  defaultModelOverride: null,
  blocked: false,
  canUploadKnowledge: false,
  spendToday: { costUsd: 0, requests: 0 },
  spendMonth: { costUsd: 0, requests: 0 },
};

const DEPARTMENT = {
  id: 'dept-1',
  name: 'Legal',
  systemPrompt: '',
  allowedModels: ['dept-model'],
  defaultModel: 'dept-model',
  defaultLimits: { dailyCostUsd: 200 },
  directoryId: 'dept-1',
  createdAt: '',
  updatedAt: '',
};

function space(overrides: Partial<KnowledgeSpaceItem> = {}): KnowledgeSpaceItem {
  return {
    id: 'space-1',
    name: 'Space',
    description: '',
    allowedDepartments: [],
    embeddingModel: 'baai/bge-m3',
    enabled: true,
    documentCount: 0,
    ...overrides,
  };
}

function mockUser(user: AdminUserListItem, dataUpdatedAt = 1) {
  mockUseAdminUserQuery.mockReturnValue({
    data: user,
    dataUpdatedAt,
    isLoading: false,
    isError: false,
    refetch: mockRefetch,
  });
}

function renderPage(user: AdminUserListItem = USER) {
  mockUser(user);
  const router = createMemoryRouter(
    [
      { path: '/admin/ai/users/:id', element: <AiUserEditPage /> },
      { path: '/admin/ai/users', element: <div data-testid="users-list" /> },
    ],
    { initialEntries: ['/admin/ai/users/emp-1'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

function modelFields() {
  return screen.getByTestId('model-access-fields');
}

function limitFields() {
  return screen.getByTestId('limits-fields');
}

function spacesFor(label: string) {
  return screen
    .getAllByTestId('spaces-multiselect')
    .find((node) => node.getAttribute('data-label') === label) as HTMLElement;
}

function savedPayload() {
  return mockMutate.mock.calls[0][0].payload;
}

beforeEach(() => {
  mockUseAdminDepartmentsQuery.mockReturnValue({ data: [DEPARTMENT] });
  mockUseAdminSettingsQuery.mockReturnValue({ data: undefined });
  mockUseKnowledgeSpacesQuery.mockReturnValue({ data: [] });
  mockMutate.mockReset();
  mockAuthUser.id = 'admin-1';
  mockUseAccess.mockReturnValue(adminAccess());
});

describe('AiUserEditPage', () => {
  it('reads the id from the route and renders the form', () => {
    renderPage();

    expect(mockUseAdminUserQuery).toHaveBeenCalledWith('emp-1');
    expect(screen.getByTestId('model-access-fields')).toBeInTheDocument();
  });

  it('shows read-only identity', () => {
    renderPage();

    expect(screen.getAllByText('Ivan Ivanov').length).toBeGreaterThan(0);
    expect(screen.getByText('Lawyer')).toBeInTheDocument();
    expect(screen.getByText('Legal')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'com_admin_ai_users_general_link' })).toHaveAttribute(
      'href',
      '/admin/users/emp-1',
    );
    expect(screen.queryByLabelText('com_admin_users_field_name')).not.toBeInTheDocument();
  });

  it('shows dashes for an empty position and department', () => {
    renderPage({ ...USER, position: '', departmentId: null, departmentName: null });

    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('shows a loading state while the user query is pending', () => {
    mockUseAdminUserQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: mockRefetch,
    });
    render(
      <RouterProvider
        router={createMemoryRouter([{ path: '/admin/ai/users/:id', element: <AiUserEditPage /> }], {
          initialEntries: ['/admin/ai/users/emp-1'],
        })}
      />,
    );

    expect(screen.getByText('com_admin_loading')).toBeInTheDocument();
  });

  const renderFailedQuery = (status: number) => {
    const error = new AxiosError('failed');
    error.response = { status, data: {}, statusText: '', headers: {}, config: {} as never };
    mockUseAdminUserQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error,
      refetch: mockRefetch,
    });
    render(
      <RouterProvider
        router={createMemoryRouter([{ path: '/admin/ai/users/:id', element: <AiUserEditPage /> }], {
          initialEntries: ['/admin/ai/users/emp-1'],
        })}
      />,
    );
  };

  it('picks up fresh limits while untouched and keeps edits afterwards', () => {
    const withLimit = (dailyCostUsd: number) => ({
      ...USER,
      limitsOverride: { dailyCostUsd },
    });
    mockUser(withLimit(10), 1);
    const page = () => (
      <MemoryRouter initialEntries={['/admin/ai/users/emp-1']}>
        <Routes>
          <Route path="/admin/ai/users/:id" element={<AiUserEditPage />} />
        </Routes>
      </MemoryRouter>
    );
    const view = render(page());
    expect(limitFields()).toHaveAttribute('data-daily', '10');

    mockUser(withLimit(20), 2);
    view.rerender(page());
    expect(limitFields()).toHaveAttribute('data-daily', '20');

    fireEvent.click(screen.getByText('set daily 42'));
    mockUser(withLimit(30), 3);
    view.rerender(page());
    expect(limitFields()).toHaveAttribute('data-daily', '42');
  });

  it('shows the pending text with a refresh button on 404', () => {
    mockRefetch.mockReset();
    renderFailedQuery(404);

    expect(screen.getByText('com_admin_ai_users_pending')).toBeInTheDocument();
    fireEvent.click(screen.getByText('com_admin_ai_users_refresh'));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('shows no access without retry on 403', () => {
    renderFailedQuery(403);

    expect(screen.getByText('com_admin_ai_users_forbidden')).toBeInTheDocument();
    expect(screen.queryByText('com_admin_retry')).not.toBeInTheDocument();
  });

  it('shows a retry for other load errors', () => {
    renderFailedQuery(500);

    expect(screen.getByText('com_admin_retry')).toBeInTheDocument();
  });

  it('navigates back to the ai users list after a successful save', async () => {
    mockMutate.mockImplementation((_payload, options?: { onSuccess?: () => void }) =>
      options?.onSuccess?.(),
    );

    const router = renderPage();
    fireEvent.click(screen.getByLabelText('com_admin_users_edit_upload'));
    fireEvent.click(screen.getByText('com_admin_action_save'));

    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/ai/users'));
  });

  it('has no block, delete or password controls', () => {
    renderPage();

    expect(screen.queryByLabelText('com_admin_users_edit_blocked')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('com_admin_users_field_department')).not.toBeInTheDocument();
    expect(screen.queryByText(/delete/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/reset_password/i)).not.toBeInTheDocument();
  });
});

describe('AiUserEditPage — role', () => {
  it('shows the role as text with a hint', () => {
    renderPage({ ...USER, role: 'HEAD' });

    expect(screen.getByText('com_admin_role_head')).toBeInTheDocument();
    expect(screen.getByText('com_admin_ai_users_role_hint')).toBeInTheDocument();
  });

  it('shows administrator as the role of an admin', () => {
    renderPage({ ...USER, role: 'ADMIN' });

    expect(screen.getByText('com_admin_role_admin')).toBeInTheDocument();
  });

  it('has no role control', () => {
    renderPage();

    expect(screen.queryByLabelText('com_admin_users_field_role')).not.toBeInTheDocument();
    expect(screen.getByText('com_admin_users_field_role')).toBeInTheDocument();
  });

  it('saving sends only the policy', () => {
    renderPage();

    fireEvent.click(screen.getByLabelText('com_admin_users_edit_upload'));
    fireEvent.click(screen.getByText('com_admin_action_save'));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(savedPayload()).toEqual({ canUploadKnowledge: true });
  });
});

describe('AiUserEditPage — inherited preview', () => {
  it('shows the department values in disabled fields while the switches are off', () => {
    renderPage();

    expect(modelFields().getAttribute('data-disabled')).toBe('true');
    expect(modelFields().getAttribute('data-models')).toBe('dept-model');
    expect(limitFields().getAttribute('data-disabled')).toBe('true');
    expect(limitFields().getAttribute('data-daily')).toBe('200');
  });

  it('keeps the same values and enables the fields on the first switch-on', () => {
    renderPage();

    fireEvent.click(screen.getByLabelText('com_admin_users_edit_limits_override'));

    expect(limitFields().getAttribute('data-disabled')).toBe('false');
    expect(limitFields().getAttribute('data-daily')).toBe('200');
  });

  it('brings an edit back after the switch is toggled off and on again', () => {
    renderPage();
    const toggle = screen.getByLabelText('com_admin_users_edit_limits_override');

    fireEvent.click(toggle);
    fireEvent.click(screen.getByText('set daily 42'));
    expect(limitFields().getAttribute('data-daily')).toBe('42');

    fireEvent.click(toggle);
    expect(limitFields().getAttribute('data-daily')).toBe('200');

    fireEvent.click(toggle);
    expect(limitFields().getAttribute('data-daily')).toBe('42');
  });

  it('shows the saved personal values when the user already has an override', () => {
    renderPage({
      ...USER,
      allowedModelsOverride: ['personal-model'],
      defaultModelOverride: 'personal-model',
    });

    expect(modelFields().getAttribute('data-disabled')).toBe('false');
    expect(modelFields().getAttribute('data-models')).toBe('personal-model');
  });

  it('sends null for a section switched back to inherited', () => {
    renderPage({
      ...USER,
      allowedModelsOverride: ['personal-model'],
      defaultModelOverride: 'personal-model',
    });

    fireEvent.click(screen.getByLabelText('com_admin_users_edit_models_override'));
    fireEvent.click(screen.getByText('com_admin_action_save'));

    expect(savedPayload().allowedModels).toBeNull();
    expect(savedPayload().defaultModel).toBeNull();
  });

  it('saves limits and models overrides', () => {
    renderPage();

    fireEvent.click(screen.getByLabelText('com_admin_users_edit_models_override'));
    fireEvent.click(screen.getByText('add model'));
    fireEvent.click(screen.getByLabelText('com_admin_users_edit_limits_override'));
    fireEvent.click(screen.getByText('set daily 42'));
    fireEvent.click(screen.getByText('com_admin_action_save'));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate.mock.calls[0][0].id).toBe('emp-1');
    expect(savedPayload().allowedModels).toEqual(['dept-model', 'extra-model']);
    expect(savedPayload().defaultModel).toBe('dept-model');
    expect(savedPayload().limits).toEqual({ dailyCostUsd: 42 });
    expect(savedPayload()).not.toHaveProperty('departmentId');
    expect(savedPayload()).not.toHaveProperty('blocked');
  });

  it('does not send a request when nothing was touched', () => {
    const router = renderPage();

    fireEvent.click(screen.getByText('com_admin_action_save'));

    expect(mockMutate).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe('/admin/ai/users');
  });

  it('refuses to save an empty personal model list', () => {
    renderPage();

    fireEvent.click(screen.getByLabelText('com_admin_users_edit_models_override'));
    fireEvent.click(screen.getByText('clear models'));
    fireEvent.click(screen.getByText('com_admin_action_save'));

    expect(mockMutate).not.toHaveBeenCalled();
    expect(screen.getByText('com_admin_users_edit_models_required')).toBeInTheDocument();
  });

  it('picking a model in one click sets both the list and the default', () => {
    renderPage();

    fireEvent.click(screen.getByLabelText('com_admin_users_edit_models_override'));
    fireEvent.click(screen.getByText('add model'));

    expect(modelFields()).toHaveAttribute('data-models', 'dept-model,extra-model');
    expect(modelFields()).toHaveAttribute('data-default', 'dept-model');

    fireEvent.click(screen.getByText('clear models'));

    expect(modelFields()).toHaveAttribute('data-models', '');
    expect(modelFields()).toHaveAttribute('data-default', '');
  });
});

describe('AiUserEditPage — knowledge', () => {
  it('disables the upload switch and shows a hint when the employee has no department', () => {
    renderPage({ ...USER, departmentId: null, departmentName: null });

    expect(screen.getByLabelText('com_admin_users_edit_upload')).toBeDisabled();
    expect(screen.getByText('com_admin_ai_users_department_required_hint')).toBeInTheDocument();
  });

  it('sends the upload change only when touched', () => {
    renderPage();
    const upload = screen.getByLabelText('com_admin_users_edit_upload');
    expect(upload).not.toBeDisabled();

    fireEvent.click(upload);
    fireEvent.click(screen.getByText('com_admin_action_save'));

    expect(savedPayload().canUploadKnowledge).toBe(true);
  });

  it('never offers the same space in both lists', () => {
    mockUseKnowledgeSpacesQuery.mockReturnValue({
      data: [
        space({ id: 'space-dept', allowedDepartments: ['dept-1'] }),
        space({ id: 'space-other', allowedDepartments: ['dept-2'] }),
      ],
    });
    renderPage();

    expect(
      spacesFor('com_admin_users_edit_spaces_allowed_label').getAttribute('data-options'),
    ).toBe('space-other');
    expect(spacesFor('com_admin_users_edit_spaces_denied_label').getAttribute('data-options')).toBe(
      'space-dept',
    );
  });

  it('does not send space fields until that section is touched', () => {
    renderPage({ ...USER, allowedSpaces: ['space-other'] });

    fireEvent.click(screen.getByLabelText('com_admin_users_edit_upload'));
    fireEvent.click(screen.getByText('com_admin_action_save'));

    expect(savedPayload()).not.toHaveProperty('allowedSpaces');
  });

  it('sends the edited list once the admin changes it', () => {
    renderPage({ ...USER, allowedSpaces: ['space-other'] });

    fireEvent.click(screen.getByText('add to com_admin_users_edit_spaces_allowed_label'));
    fireEvent.click(screen.getByText('com_admin_action_save'));

    expect(savedPayload().allowedSpaces).toEqual(['space-other', 'space-x']);
  });
});

describe('AiUserEditPage — save errors', () => {
  it('shows the server text when saving fails', () => {
    mockMutate.mockImplementation((_payload, options?: { onError?: (error: unknown) => void }) =>
      options?.onError?.({
        isAxiosError: true,
        response: { status: 502, data: { error: 'upstream timeout' } },
      }),
    );
    renderPage();

    fireEvent.click(screen.getByLabelText('com_admin_users_edit_upload'));
    fireEvent.click(screen.getByText('com_admin_action_save'));

    expect(screen.getByText('upstream timeout')).toBeInTheDocument();
  });
});
