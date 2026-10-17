import { render, screen } from '@testing-library/react';
import App from '../App';
import { request } from '../data-provider/http';

jest.mock('../data-provider/http', () => ({
  apiBaseUrl: () => 'http://ai.test',
  request: { get: jest.fn() },
  rawClient: {},
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
    const { Outlet } = require('react-router-dom');
    return <Outlet />;
  },
}));

function mockProbe(name: string, url: string) {
  return {
    __esModule: true,
    default: function Probe() {
      const { useEffect: effect } = require('react');
      const { request: http } = require('../data-provider/http');
      effect(() => {
        void http.get(url);
      }, []);
      return <div data-testid={name} />;
    },
  };
}

function mockStub(name: string) {
  return { __esModule: true, default: () => <div data-testid={name} /> };
}

jest.mock('../components/Admin/Ai/Users/AiUsersView', () => mockStub('ai-users-view'));
jest.mock('../components/Admin/Employees/EmployeesView', () =>
  mockProbe('employees-view', '/api/admin/v1/employees'),
);
jest.mock('../components/Admin/Employees/EmployeeCreatePage', () =>
  mockProbe('employee-create', '/api/admin/v1/departments'),
);
jest.mock('../components/Admin/Employees/EmployeeEditPage', () =>
  mockProbe('employee-edit', '/api/admin/v1/employees/1'),
);
jest.mock('../components/Admin/Ai/Users/AiUserEditPage', () => mockStub('ai-user-edit'));
jest.mock('../components/Admin/Departments/DepartmentsView', () =>
  mockProbe('departments-view', '/api/admin/v1/departments'),
);
jest.mock('../components/Admin/Departments/DepartmentCreatePage', () =>
  mockProbe('department-create', '/api/admin/v1/departments'),
);
jest.mock('../components/Admin/Departments/DepartmentEditPage', () =>
  mockProbe('department-edit', '/api/admin/v1/departments'),
);
jest.mock('../components/Admin/Ai/Departments/AiDepartmentsView', () => mockStub('ai-departments-view'));
jest.mock('../components/Admin/Ai/Departments/AiDepartmentEditPage', () => mockStub('ai-department-edit'));
jest.mock('../components/Admin/Requests/RequestsView', () => mockStub('requests-view'));
jest.mock('../components/Admin/Prompts/PromptsView', () => mockStub('prompts-view'));
jest.mock('../components/Admin/Knowledge/SpacesView', () => mockStub('spaces-view'));
jest.mock('../components/Admin/Knowledge/SpaceCreatePage', () => mockStub('space-create'));
jest.mock('../components/Admin/Knowledge/SpaceEditPage', () => mockStub('space-edit'));
jest.mock('../components/Admin/Knowledge/SpaceDocumentsPage', () => mockStub('space-documents'));
jest.mock('../components/Admin/Spend/SpendView', () => mockStub('spend-view'));
jest.mock('../components/Admin/Analytics/AnalyticsView', () => mockStub('analytics-view'));
jest.mock('../components/Admin/Feedback/FeedbackView', () => mockStub('feedback-view'));
jest.mock('../components/Admin/Memory/MemoryView', () => mockStub('memory-view'));

const mockGet = request.get as jest.Mock;

describe('department head on general routes', () => {
  beforeEach(() => {
    mockGet.mockImplementation((url: string) => {
      if (url.endsWith('/admin/v1/me')) {
        return Promise.resolve({ employee: null, is_admin: false });
      }
      if (url.endsWith('/me/capabilities')) {
        return Promise.resolve({
          capabilities: ['access:admin', 'read:users'],
          role: 'HEAD',
          departmentId: 'dept-1',
          departmentName: 'Dept',
        });
      }
      return Promise.resolve({});
    });
  });

  it.each([
    '/admin/users',
    '/admin/users/new',
    '/admin/users/employee-1',
    '/admin/departments',
    '/admin/departments/new',
    '/admin/departments/dept-1',
  ])('%s sends no request to the directory service except /me', async (path) => {
    window.history.pushState({}, '', path);

    render(<App />);

    expect(await screen.findByTestId('ai-users-view')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/admin/ai/users');
    const directoryCalls = mockGet.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes('/api/admin/v1'));
    expect(directoryCalls).toEqual(['/api/admin/v1/me']);
  });
});
