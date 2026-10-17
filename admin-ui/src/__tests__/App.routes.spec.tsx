import { render, screen } from '@testing-library/react';
import App from '../App';
import { adminAccess, headAccess } from '../components/Admin/__fixtures__/access';

const mockUseAccess = jest.fn();

jest.mock('../hooks/useAccess', () => ({
  useAccess: () => mockUseAccess(),
}));

jest.mock('../pages/LoginPage', () => () => null);
jest.mock('../pages/AuthCallbackPage', () => () => null);

jest.mock('../auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuthContext: () => ({ logout: () => undefined }),
}));

jest.mock('../auth/RequireAuth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../components/Admin/AdminLayout', () => ({
  __esModule: true,
  default: function LayoutStub() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Outlet } = require('react-router-dom');
    return <Outlet />;
  },
}));

const stub = (name: string) => ({ __esModule: true, default: () => <div data-testid={name} /> });

jest.mock('../components/Admin/Ai/Users/AiUsersView', () => stub('users-view'));
jest.mock('../components/Admin/Employees/EmployeesView', () => stub('employees-view'));
jest.mock('../components/Admin/Employees/EmployeeCreatePage', () => stub('employee-create'));
jest.mock('../components/Admin/Employees/EmployeeEditPage', () => stub('employee-edit'));
jest.mock('../components/Admin/Ai/Users/AiUserEditPage', () => stub('user-edit'));
jest.mock('../components/Admin/Departments/DepartmentsView', () => stub('departments-view'));
jest.mock('../components/Admin/Departments/DepartmentCreatePage', () => stub('department-create'));
jest.mock('../components/Admin/Departments/DepartmentEditPage', () => stub('department-edit'));
jest.mock('../components/Admin/Ai/Departments/AiDepartmentsView', () => stub('ai-departments-view'));
jest.mock('../components/Admin/Ai/Departments/AiDepartmentEditPage', () => stub('ai-department-edit'));
jest.mock('../components/Admin/Requests/RequestsView', () => stub('requests-view'));
jest.mock('../components/Admin/Prompts/PromptsView', () => stub('prompts-view'));
jest.mock('../components/Admin/Knowledge/SpacesView', () => stub('spaces-view'));
jest.mock('../components/Admin/Knowledge/SpaceCreatePage', () => stub('space-create'));
jest.mock('../components/Admin/Knowledge/SpaceEditPage', () => stub('space-edit'));
jest.mock('../components/Admin/Knowledge/SpaceDocumentsPage', () => stub('space-documents'));
jest.mock('../components/Admin/Spend/SpendView', () => stub('spend-view'));
jest.mock('../components/Admin/Analytics/AnalyticsView', () => stub('analytics-view'));
jest.mock('../components/Admin/Feedback/FeedbackView', () => stub('feedback-view'));
jest.mock('../components/Admin/Memory/MemoryView', () => stub('memory-view'));

function visit(path: string): void {
  window.history.pushState({}, '', path);
  render(<App />);
}

describe('App routes', () => {
  beforeEach(() => {
    mockUseAccess.mockReturnValue(adminAccess());
  });

  it('head is redirected from general routes', async () => {
    mockUseAccess.mockReturnValue(headAccess());

    visit('/admin/users');

    expect(await screen.findByTestId('users-view')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/admin/ai/users');
  });

  it('serves the employee routes to an admin', async () => {
    visit('/admin/users');
    expect(await screen.findByTestId('employees-view')).toBeInTheDocument();
  });

  it('serves employee creation before the dynamic id route', async () => {
    visit('/admin/users/new');
    expect(await screen.findByTestId('employee-create')).toBeInTheDocument();
  });

  it('serves the employee card to an admin', async () => {
    visit('/admin/users/employee-1');
    expect(await screen.findByTestId('employee-edit')).toBeInTheDocument();
  });

  it('head is redirected from general departments and creation routes', async () => {
    mockUseAccess.mockReturnValue(headAccess());

    visit('/admin/departments/new');

    await screen.findByTestId('users-view');
    expect(screen.queryByTestId('department-create')).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/admin/ai/users');
  });

  it('index redirects admin to users and head to ai users', async () => {
    visit('/admin');
    await screen.findByTestId('employees-view');
    expect(window.location.pathname).toBe('/admin/users');
  });

  it('index redirects head to ai users', async () => {
    mockUseAccess.mockReturnValue(headAccess());

    visit('/admin');

    await screen.findByTestId('users-view');
    expect(window.location.pathname).toBe('/admin/ai/users');
  });

  it('unknown admin paths follow the same redirect', async () => {
    mockUseAccess.mockReturnValue(headAccess());

    visit('/admin/unknown');

    await screen.findByTestId('users-view');
    expect(window.location.pathname).toBe('/admin/ai/users');
  });

  it('head is redirected from ai departments', async () => {
    mockUseAccess.mockReturnValue(headAccess());

    visit('/admin/ai/departments/dept-1');

    await screen.findByTestId('users-view');
    expect(window.location.pathname).toBe('/admin/ai/users');
  });

  it('serves the ai routes to a head', async () => {
    mockUseAccess.mockReturnValue(headAccess());

    visit('/admin/ai/users/employee-1');

    expect(await screen.findByTestId('user-edit')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/admin/ai/users/employee-1');
  });

  it('serves the ai department routes to an admin', async () => {
    visit('/admin/ai/departments/dept-1');

    expect(await screen.findByTestId('ai-department-edit')).toBeInTheDocument();
  });

  it('serves the ai departments list to an admin', async () => {
    visit('/admin/ai/departments');

    expect(await screen.findByTestId('ai-departments-view')).toBeInTheDocument();
  });

  it('serves the general department card to an admin', async () => {
    visit('/admin/departments/dept-1');

    expect(await screen.findByTestId('department-edit')).toBeInTheDocument();
  });

  it('serves general routes to an admin', async () => {
    visit('/admin/departments');

    expect(await screen.findByTestId('departments-view')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/admin/departments');
  });
});
