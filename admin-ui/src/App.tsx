import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toast, ToastProvider } from '@librechat/client';
import { LocaleProvider } from './locales/LocaleProvider';
import { ThemeProvider } from './theme/ThemeProvider';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth } from './auth/RequireAuth';
import LoginPage from './pages/LoginPage';
import AuthCallbackPage from './pages/AuthCallbackPage';
import AdminLayout from './components/Admin/AdminLayout';
import AdminHome from './components/Admin/AdminHome';
import RequireAdmin from './components/Admin/RequireAdmin';
import EmployeesView from './components/Admin/Employees/EmployeesView';
import EmployeeCreatePage from './components/Admin/Employees/EmployeeCreatePage';
import EmployeeEditPage from './components/Admin/Employees/EmployeeEditPage';
import AiUsersView from './components/Admin/Ai/Users/AiUsersView';
import AiUserEditPage from './components/Admin/Ai/Users/AiUserEditPage';
import DepartmentsView from './components/Admin/Departments/DepartmentsView';
import DepartmentCreatePage from './components/Admin/Departments/DepartmentCreatePage';
import DepartmentEditPage from './components/Admin/Departments/DepartmentEditPage';
import AiDepartmentsView from './components/Admin/Ai/Departments/AiDepartmentsView';
import AiDepartmentEditPage from './components/Admin/Ai/Departments/AiDepartmentEditPage';
import RequestsView from './components/Admin/Requests/RequestsView';
import PromptsView from './components/Admin/Prompts/PromptsView';
import SpacesView from './components/Admin/Knowledge/SpacesView';
import SpaceCreatePage from './components/Admin/Knowledge/SpaceCreatePage';
import SpaceEditPage from './components/Admin/Knowledge/SpaceEditPage';
import SpaceDocumentsPage from './components/Admin/Knowledge/SpaceDocumentsPage';
import SpendView from './components/Admin/Spend/SpendView';
import AnalyticsView from './components/Admin/Analytics/AnalyticsView';
import FeedbackView from './components/Admin/Feedback/FeedbackView';
import MemoryView from './components/Admin/Memory/MemoryView';

const queryClient = new QueryClient();

function App(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <LocaleProvider>
          <ToastProvider>
            <BrowserRouter>
              <AuthProvider>
                <Routes>
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/auth/openid/callback" element={<AuthCallbackPage />} />
                  <Route
                    path="/admin"
                    element={
                      <RequireAuth>
                        <AdminLayout />
                      </RequireAuth>
                    }
                  >
                    <Route index element={<AdminHome />} />
                    <Route element={<RequireAdmin />}>
                      <Route path="users" element={<EmployeesView />} />
                      <Route path="users/new" element={<EmployeeCreatePage />} />
                      <Route path="users/:id" element={<EmployeeEditPage />} />
                      <Route path="departments" element={<DepartmentsView />} />
                      <Route path="departments/new" element={<DepartmentCreatePage />} />
                      <Route path="departments/:id" element={<DepartmentEditPage />} />
                      <Route path="ai/departments" element={<AiDepartmentsView />} />
                      <Route path="ai/departments/:id" element={<AiDepartmentEditPage />} />
                    </Route>
                    <Route path="ai/users" element={<AiUsersView />} />
                    <Route path="ai/users/:id" element={<AiUserEditPage />} />
                    <Route path="requests" element={<RequestsView />} />
                    <Route path="prompts" element={<PromptsView />} />
                    <Route path="knowledge" element={<SpacesView />} />
                    <Route path="knowledge/new" element={<SpaceCreatePage />} />
                    <Route path="knowledge/:id/edit" element={<SpaceEditPage />} />
                    <Route path="knowledge/:id" element={<SpaceDocumentsPage />} />
                    <Route path="spend" element={<SpendView />} />
                    <Route path="analytics" element={<AnalyticsView />} />
                    <Route path="feedback" element={<FeedbackView />} />
                    <Route path="memory" element={<MemoryView />} />
                    <Route path="*" element={<AdminHome />} />
                  </Route>
                  <Route path="*" element={<Navigate to="/admin" replace={true} />} />
                </Routes>
              </AuthProvider>
            </BrowserRouter>
            <Toast />
          </ToastProvider>
        </LocaleProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
