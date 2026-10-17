import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { KnowledgeSpaceItem } from '~/api';
import SpaceEditPage from '../SpaceEditPage';

const mockUseKnowledgeSpacesQuery = jest.fn();
const mockUseCapabilities = jest.fn();

jest.mock('~/data-provider/Knowledge', () => ({
  useKnowledgeSpacesQuery: () => mockUseKnowledgeSpacesQuery(),
  useUpdateSpaceMutation: () => ({ mutate: jest.fn(), isLoading: false }),
}));

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useParams: () => ({ id: 'space-2' }),
  useNavigate: () => jest.fn(),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useCapabilities: () => mockUseCapabilities(),
}));

jest.mock('../SpaceForm', () => ({
  __esModule: true,
  default: () => <div data-testid="space-form-stub" />,
}));

jest.mock('@librechat/client', () => ({
  Button: ({ children, asChild, ...props }: React.PropsWithChildren<{ asChild?: boolean }>) =>
    asChild ? children : <button {...props}>{children}</button>,
  Alert: ({ children }: React.PropsWithChildren<unknown>) => <div role="alert">{children}</div>,
}));

const OWN_SPACE: KnowledgeSpaceItem = {
  id: 'space-1',
  name: 'Своё пространство',
  description: '',
  allowedDepartments: ['dept-1'],
  embeddingModel: 'baai/bge-m3',
  enabled: true,
  documentCount: 0,
};

function renderEditPage(spaces: KnowledgeSpaceItem[]) {
  mockUseKnowledgeSpacesQuery.mockReturnValue({
    data: spaces,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  });
  render(
    <MemoryRouter>
      <SpaceEditPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockUseCapabilities.mockReturnValue({
    capabilities: new Set(['manage:knowledge_documents']),
    role: 'HEAD',
    departmentId: 'dept-1',
    departmentName: 'IT',
  });
});

/**
 * Прямая ссылка `/admin/knowledge/:id/edit` на пространство, которое сервер главе не
 * отдаёт (чужой отдел — `listSpaces` его просто не включает в список), не должна
 * приводить к пустой странице без объяснения: `space` не находится в `spacesQuery.data`
 * и должен показать понятную ошибку со ссылкой назад, а не рендерить форму вслепую.
 */
describe('SpaceEditPage — пространство не найдено (чужой отдел или удалено)', () => {
  it('показывает понятную ошибку и ссылку назад вместо пустой страницы', () => {
    renderEditPage([OWN_SPACE]);

    expect(screen.getByText('com_admin_knowledge_not_found')).toBeInTheDocument();
    expect(screen.getAllByText('com_admin_knowledge_back_to_list').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('space-form-stub')).not.toBeInTheDocument();
  });
});

describe('SpaceEditPage — пространство своего отдела найдено', () => {
  it('рендерит форму редактирования', () => {
    renderEditPage([{ ...OWN_SPACE, id: 'space-2' }]);

    expect(screen.getByTestId('space-form-stub')).toBeInTheDocument();
    expect(screen.queryByText('com_admin_knowledge_not_found')).not.toBeInTheDocument();
  });
});
