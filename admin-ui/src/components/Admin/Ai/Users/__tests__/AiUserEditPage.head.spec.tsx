import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { AdminUserListItem, KnowledgeSpaceItem } from '~/api';
import { mockAiUserEditPageLibrechatClient } from 'test/aiUserEditPageClientMock';
import AiUserEditPage from '../AiUserEditPage';
import { headAccess } from '../../../__fixtures__/access';

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
  useAdminDepartmentsQuery: (config: unknown) => mockUseAdminDepartmentsQuery(config),
  useAdminSettingsQuery: (config: unknown) => mockUseAdminSettingsQuery(config),
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
    disabled,
  }: {
    selectedValues: string[];
    setSelectedValues: (values: string[]) => void;
    label: string;
    spaces?: KnowledgeSpaceItem[];
    disabled?: boolean;
  }) => (
    <div
      data-testid="spaces-multiselect"
      data-label={label}
      data-options={(spaces ?? []).map((space) => space.id).join(',')}
      data-selected={selectedValues.join(',')}
      data-disabled={disabled === true ? 'true' : 'false'}
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
  name: 'Ivan',
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

function renderPage(capabilities?: string[]) {
  mockUseAccess.mockReturnValue(
    headAccess(capabilities != null ? { aiCapabilities: new Set(capabilities) } : {}),
  );
  mockUseAdminUserQuery.mockReturnValue({
    data: USER,
    isLoading: false,
    isError: false,
    refetch: mockRefetch,
  });
  render(
    <RouterProvider
      router={createMemoryRouter(
        [
          { path: '/admin/ai/users/:id', element: <AiUserEditPage /> },
          { path: '/admin/ai/users', element: <div data-testid="users-list" /> },
        ],
        { initialEntries: ['/admin/ai/users/emp-1'] },
      )}
    />,
  );
}

beforeEach(() => {
  mockAuthUser.id = 'admin-1';
  mockUseAdminDepartmentsQuery.mockReturnValue({ data: undefined });
  mockUseAdminSettingsQuery.mockReturnValue({ data: undefined });
  mockUseKnowledgeSpacesQuery.mockReturnValue({ data: [] });
  mockMutate.mockReset();
});

describe('AiUserEditPage — head of department', () => {
  it('head does not see role field', () => {
    renderPage();

    expect(screen.queryByLabelText('com_admin_users_field_role')).not.toBeInTheDocument();
    expect(screen.queryByText('com_admin_ai_users_role_hint')).not.toBeInTheDocument();
  });

  it('shows only upload right and knowledge spaces', () => {
    renderPage();

    expect(screen.getByLabelText('com_admin_users_edit_upload')).toBeInTheDocument();
    expect(screen.getAllByTestId('spaces-multiselect').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('model-access-fields')).not.toBeInTheDocument();
    expect(screen.queryByTestId('limits-fields')).not.toBeInTheDocument();
  });

  it('shows the read-only identity without the general settings link', () => {
    renderPage();

    expect(screen.getByText('Lawyer')).toBeInTheDocument();
    expect(screen.getByText('Legal')).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'com_admin_ai_users_general_link' }),
    ).not.toBeInTheDocument();
  });

  it('does not ask for departments or settings the head cannot read', () => {
    renderPage();

    expect(mockUseAdminDepartmentsQuery).toHaveBeenCalledWith({ enabled: false });
    expect(mockUseAdminSettingsQuery).toHaveBeenCalledWith({ enabled: false });
  });

  it('saving the upload right sends only that field', () => {
    renderPage();

    fireEvent.click(screen.getByLabelText('com_admin_users_edit_upload'));
    fireEvent.click(screen.getByText('com_admin_action_save'));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate.mock.calls[0][0].payload).toEqual({ canUploadKnowledge: true });
  });

  it('without manage:department_members shows neither upload nor spaces', () => {
    renderPage(['access:admin', 'read:users']);

    expect(screen.queryByLabelText('com_admin_users_edit_upload')).not.toBeInTheDocument();
    expect(screen.queryByTestId('spaces-multiselect')).not.toBeInTheDocument();
  });

  it('disables the head own card and explains why', () => {
    mockAuthUser.id = 'sub-1';
    renderPage();

    expect(screen.getByLabelText('com_admin_users_edit_upload')).toBeDisabled();
    screen.getAllByTestId('spaces-multiselect').forEach((node) => {
      expect(node).toHaveAttribute('data-disabled', 'true');
    });
    expect(screen.getByText('com_admin_ai_users_own_card_hint')).toBeInTheDocument();
    expect(screen.getByText('com_admin_action_save')).toBeDisabled();
  });

  it('keeps another employee card editable for a head', () => {
    renderPage();

    expect(screen.getByLabelText('com_admin_users_edit_upload')).toBeEnabled();
    expect(screen.queryByText('com_admin_ai_users_own_card_hint')).not.toBeInTheDocument();
  });
});
