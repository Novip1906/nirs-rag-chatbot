import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import KnowledgeDocumentDialog from '../KnowledgeDocumentDialog';
import { getKnowledgeDocumentFile } from '~/data-provider/Knowledge/request';
import { useKnowledgeDocumentPreview } from '~/data-provider/Knowledge';
import { triggerDownload } from '~/utils';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, unknown>) =>
    values != null ? `${key}:${JSON.stringify(values)}` : key,
}));

jest.mock('@librechat/client', () => {
  const ActualReact = jest.requireActual('react');
  return {
    OGDialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
      open ? ActualReact.createElement('div', { role: 'dialog' }, children) : null,
    OGDialogContent: ({ children, ...rest }: { children: React.ReactNode }) =>
      ActualReact.createElement('div', rest, children),
    OGDialogTitle: ({ children, ...rest }: { children: React.ReactNode }) =>
      ActualReact.createElement('h2', rest, children),
    OGDialogDescription: ({ children, ...rest }: { children: React.ReactNode }) =>
      ActualReact.createElement('p', rest, children),
  };
});

jest.mock('~/components/Messages/Content/CopyButton', () => ({
  __esModule: true,
  default: ({ onClick }: { onClick: () => void }) => (
    <button type="button" onClick={onClick} data-testid="copy-button" />
  ),
}));

jest.mock('~/data-provider/Knowledge', () => ({
  useKnowledgeDocumentPreview: jest.fn(),
}));

jest.mock('~/data-provider/Knowledge/request', () => ({
  getKnowledgeDocumentFile: jest.fn(),
}));

jest.mock('~/utils', () => ({
  ...jest.requireActual('~/utils'),
  triggerDownload: jest.fn(),
}));

const mockUseKnowledgeDocumentPreview = useKnowledgeDocumentPreview as jest.Mock;
const mockGetKnowledgeDocumentFile = getKnowledgeDocumentFile as jest.Mock;
const mockTriggerDownload = triggerDownload as jest.Mock;

function queryResult(overrides: Record<string, unknown>) {
  return { data: undefined, isLoading: false, isError: false, error: null, ...overrides };
}

const PDF_PREVIEW = {
  fileId: 'f1',
  title: 'Регламент',
  filename: 'reglament.pdf',
  mimetype: 'application/pdf',
  bytes: 999,
  kind: 'pdf' as const,
};

const HTML_PREVIEW = {
  fileId: 'f1',
  title: 'Регламент',
  filename: 'reglament.docx',
  mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  bytes: 500,
  kind: 'html' as const,
  html: '<p>hi</p>',
};

const TEXT_PREVIEW = {
  fileId: 'f1',
  title: 'Регламент',
  filename: 'reglament.txt',
  mimetype: 'text/plain',
  bytes: 1234,
  kind: 'text' as const,
  text: 'Текст документа',
};

describe('KnowledgeDocumentDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = jest.fn();
  });

  it('renders nothing when closed', () => {
    mockUseKnowledgeDocumentPreview.mockReturnValue(queryResult({}));
    render(
      <KnowledgeDocumentDialog
        open={false}
        onOpenChange={jest.fn()}
        fileId="f1"
        title="Регламент"
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a loading state while the preview is loading', () => {
    mockUseKnowledgeDocumentPreview.mockReturnValue(queryResult({ isLoading: true }));
    render(<KnowledgeDocumentDialog open onOpenChange={jest.fn()} fileId="f1" title="Регламент" />);
    expect(screen.getByText('com_ui_loading')).toBeInTheDocument();
  });

  it('renders the resolved title, metadata, and a copyable text body for kind "text"', () => {
    mockUseKnowledgeDocumentPreview.mockReturnValue(queryResult({ data: TEXT_PREVIEW }));
    render(
      <KnowledgeDocumentDialog
        open
        onOpenChange={jest.fn()}
        fileId="f1"
        title="Регламент (черновик)"
        spaceName="Кадры"
        version="1.0"
      />,
    );

    expect(screen.getByRole('heading', { name: 'Регламент' })).toBeInTheDocument();
    expect(screen.getByText('Текст документа')).toBeInTheDocument();
    expect(screen.getByText(/Кадры/)).toBeInTheDocument();
    expect(screen.getByTestId('copy-button')).toBeInTheDocument();
  });

  it('renders kind "html" as a sandboxed iframe without allow-same-origin', () => {
    mockUseKnowledgeDocumentPreview.mockReturnValue(queryResult({ data: HTML_PREVIEW }));
    render(<KnowledgeDocumentDialog open onOpenChange={jest.fn()} fileId="f1" title="Регламент" />);

    const iframe = screen.getByTitle(/Регламент/);
    expect(iframe.tagName).toBe('IFRAME');
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-popups');
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(iframe).toHaveAttribute('srcdoc', '<p>hi</p>');
  });

  it('fetches and renders kind "pdf" as a blob iframe', async () => {
    mockUseKnowledgeDocumentPreview.mockReturnValue(queryResult({ data: PDF_PREVIEW }));
    mockGetKnowledgeDocumentFile.mockResolvedValue({ data: new Blob(['pdf-bytes']) });

    render(<KnowledgeDocumentDialog open onOpenChange={jest.fn()} fileId="f1" title="Регламент" />);

    await waitFor(() => {
      expect(mockGetKnowledgeDocumentFile).toHaveBeenCalledWith('f1');
    });

    const iframe = await screen.findByTitle(/Регламент/);
    expect(iframe).toHaveAttribute('src', 'blob:mock-url');
  });

  it('shows the forbidden message for a 403 error', () => {
    mockUseKnowledgeDocumentPreview.mockReturnValue(
      queryResult({ isError: true, error: { isAxiosError: true, response: { status: 403 } } }),
    );
    render(<KnowledgeDocumentDialog open onOpenChange={jest.fn()} fileId="f1" title="Регламент" />);
    expect(screen.getByText('com_knowledge_document_forbidden')).toBeInTheDocument();
  });

  it('shows the not-found message for a 404 error', () => {
    mockUseKnowledgeDocumentPreview.mockReturnValue(
      queryResult({ isError: true, error: { isAxiosError: true, response: { status: 404 } } }),
    );
    render(<KnowledgeDocumentDialog open onOpenChange={jest.fn()} fileId="f1" title="Регламент" />);
    expect(screen.getByText('com_knowledge_document_not_found')).toBeInTheDocument();
  });

  it('shows a generic error message for any other failure', () => {
    mockUseKnowledgeDocumentPreview.mockReturnValue(
      queryResult({ isError: true, error: new Error('network down') }),
    );
    render(<KnowledgeDocumentDialog open onOpenChange={jest.fn()} fileId="f1" title="Регламент" />);
    expect(screen.getByText('com_knowledge_document_preview_error')).toBeInTheDocument();
  });

  it('downloads the document body when the download button is clicked', async () => {
    mockUseKnowledgeDocumentPreview.mockReturnValue(queryResult({ data: TEXT_PREVIEW }));
    mockGetKnowledgeDocumentFile.mockResolvedValue({ data: new Blob(['text-bytes']) });

    render(<KnowledgeDocumentDialog open onOpenChange={jest.fn()} fileId="f1" title="Регламент" />);

    fireEvent.click(screen.getByRole('button', { name: /com_ui_download/ }));

    await waitFor(() => {
      expect(mockGetKnowledgeDocumentFile).toHaveBeenCalledWith('f1', { download: true });
    });
    expect(mockTriggerDownload).toHaveBeenCalledWith('blob:mock-url', 'reglament.txt');
  });
});
