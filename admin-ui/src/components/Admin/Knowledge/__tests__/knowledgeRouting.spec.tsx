import React from 'react';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import SpaceCreatePage from '../SpaceCreatePage';
import SpaceDocumentsPage from '../SpaceDocumentsPage';

const mockUseKnowledgeSpacesQuery = jest.fn();
const mockUseKnowledgeDocumentsQuery = jest.fn();
const mockUseAdminDepartmentsQuery = jest.fn();

jest.mock('~/data-provider/Knowledge', () => ({
  useKnowledgeSpacesQuery: () => mockUseKnowledgeSpacesQuery(),
  useKnowledgeDocumentsQuery: (id: string | null | undefined) => mockUseKnowledgeDocumentsQuery(id),
  useCreateSpaceMutation: () => ({ mutate: jest.fn(), isLoading: false }),
  useUploadDocumentMutation: () => ({ mutate: jest.fn(), isLoading: false }),
  useUpdateDocumentMutation: () => ({ mutate: jest.fn(), isLoading: false }),
  useDeleteDocumentMutation: () => ({ mutate: jest.fn(), isLoading: false }),
  useReindexSpaceMutation: () => ({ mutate: jest.fn(), isLoading: false }),
}));

jest.mock('~/data-provider/Admin', () => ({
  useAdminDepartmentsQuery: () => mockUseAdminDepartmentsQuery(),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useCapabilities: () => ({ capabilities: new Set(['manage:configs']) }),
}));

jest.mock('@librechat/client', () => ({
  Button: ({
    children,
    asChild,
    ...props
  }: React.PropsWithChildren<{ asChild?: boolean } & Record<string, unknown>>) =>
    asChild ? children : <button {...props}>{children}</button>,
  Label: ({ children, htmlFor }: React.PropsWithChildren<{ htmlFor?: string }>) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
  Switch: () => <input type="checkbox" readOnly />,
  MultiSelect: () => <div data-testid="departments-multiselect" />,
  Select: ({ children }: React.PropsWithChildren<unknown>) => <div>{children}</div>,
  SelectTrigger: ({ children }: React.PropsWithChildren<unknown>) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: React.PropsWithChildren<unknown>) => <div>{children}</div>,
  SelectItem: ({ children }: React.PropsWithChildren<unknown>) => <div>{children}</div>,
  Table: ({ children }: React.PropsWithChildren<unknown>) => <table>{children}</table>,
  TableHeader: ({ children }: React.PropsWithChildren<unknown>) => <thead>{children}</thead>,
  TableBody: ({ children }: React.PropsWithChildren<unknown>) => <tbody>{children}</tbody>,
  TableRow: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <tr {...props}>{children}</tr>
  ),
  TableHead: ({ children }: React.PropsWithChildren<unknown>) => <th>{children}</th>,
  TableRowHeader: ({ children }: React.PropsWithChildren<unknown>) => <th>{children}</th>,
  TableCell: ({ children }: React.PropsWithChildren<unknown>) => <td>{children}</td>,
  Tag: ({ label }: { label: string }) => <span>{label}</span>,
  IconButton: ({
    children,
    label,
    onClick,
  }: React.PropsWithChildren<{ label: string; onClick?: (event: React.MouseEvent) => void }>) => (
    <button aria-label={label} onClick={onClick}>
      {children}
    </button>
  ),
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
  AlertDialog: ({ children, open }: React.PropsWithChildren<{ open: boolean }>) =>
    open ? <div>{children}</div> : null,
  AlertDialogContent: ({ children }: React.PropsWithChildren<unknown>) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: React.PropsWithChildren<unknown>) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: React.PropsWithChildren<unknown>) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: React.PropsWithChildren<unknown>) => (
    <div>{children}</div>
  ),
  AlertDialogFooter: ({ children }: React.PropsWithChildren<unknown>) => <div>{children}</div>,
  AlertDialogCancel: ({ children }: React.PropsWithChildren<unknown>) => <button>{children}</button>,
  AlertDialogAction: ({
    children,
    onClick,
  }: React.PropsWithChildren<{ onClick?: () => void }>) => (
    <button onClick={onClick}>{children}</button>
  ),
  Alert: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <div role="alert" {...props}>
      {children}
    </div>
  ),
}));

/**
 * `knowledge/new` and `knowledge/:id` must be declared in this order in
 * `~/routes/index.tsx` so the literal segment is never shadowed by the dynamic param —
 * this exact mistake was already made once for `/admin/users`. Mirrors that regression
 * test here against the real page components.
 */
function renderKnowledgeRouter(initialEntry: string) {
  const router = createMemoryRouter(
    [
      { path: '/admin/knowledge/new', element: <SpaceCreatePage /> },
      { path: '/admin/knowledge/:id', element: <SpaceDocumentsPage /> },
    ],
    { initialEntries: [initialEntry] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('admin knowledge route ordering', () => {
  beforeEach(() => {
    mockUseAdminDepartmentsQuery.mockReturnValue({ data: [] });
    mockUseKnowledgeSpacesQuery.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    mockUseKnowledgeDocumentsQuery.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
  });

  it('"knowledge/new" resolves to the create page, not the documents page with id="new"', () => {
    renderKnowledgeRouter('/admin/knowledge/new');

    expect(screen.getByLabelText('com_admin_knowledge_field_name')).toBeInTheDocument();
    expect(mockUseKnowledgeDocumentsQuery).not.toHaveBeenCalledWith('new');
  });

  it('a real space id still resolves to the documents page', () => {
    renderKnowledgeRouter('/admin/knowledge/space-1');

    expect(mockUseKnowledgeDocumentsQuery).toHaveBeenCalledWith('space-1');
    expect(screen.queryByLabelText('com_admin_knowledge_field_name')).not.toBeInTheDocument();
  });
});
