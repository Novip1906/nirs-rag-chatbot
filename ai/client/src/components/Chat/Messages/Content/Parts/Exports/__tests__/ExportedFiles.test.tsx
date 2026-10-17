import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import type { TAttachment } from 'librechat-data-provider';
import ExportedFiles from '../ExportedFiles';

const mockHandleDownload = jest.fn();
jest.mock('../../LogLink', () => ({
  useAttachmentLink: () => ({ handleDownload: mockHandleDownload }),
}));

jest.mock('~/hooks', () => ({
  useLocalize:
    () =>
    (key: string): string => {
      const translations: Record<string, string> = {
        com_ui_exported_files: 'Created files',
        com_ui_export_format_pdf: 'PDF document',
        com_ui_export_format_docx: 'Word document',
        com_ui_export_format_pptx: 'PowerPoint presentation',
        com_ui_export_format_xlsx: 'Excel spreadsheet',
        com_ui_export_format_csv: 'CSV table',
        com_ui_export_format_md: 'Markdown document',
      };
      return translations[key] ?? key;
    },
}));

jest.mock('~/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
  getFileType: () => ({ paths: [], color: '', title: 'File' }),
}));

jest.mock('~/components/Chat/Input/Files/FilePreview', () => ({
  __esModule: true,
  default: () => <div data-testid="file-preview" />,
}));

const buildAttachment = (overrides: Partial<TAttachment> = {}): TAttachment =>
  ({
    file_id: 'file-1',
    user: 'user-1',
    filename: 'file.pdf',
    filepath: '/files/file.pdf',
    type: 'application/octet-stream',
    ...overrides,
  }) as TAttachment;

describe('ExportedFiles', () => {
  beforeEach(() => {
    mockHandleDownload.mockReset();
  });

  it('renders an empty DOM for an empty list', () => {
    const { container } = render(<ExportedFiles attachments={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders all files expanded as a labeled list with no collapse button', () => {
    const attachments = [
      buildAttachment({ file_id: 'a', filename: 'Отчёт.pdf' }),
      buildAttachment({ file_id: 'b', filename: 'Договор.docx' }),
      buildAttachment({ file_id: 'c', filename: 'Слайды.pptx' }),
    ];

    render(<ExportedFiles attachments={attachments} />);

    expect(screen.getByRole('list', { name: 'Created files' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /show|hide/i })).not.toBeInTheDocument();
  });

  it.each([
    ['pdf', 'Отчёт.pdf', 'PDF document'],
    ['docx', 'Договор.docx', 'Word document'],
    ['pptx', 'Слайды.pptx', 'PowerPoint presentation'],
    ['xlsx', 'Таблица.xlsx', 'Excel spreadsheet'],
    ['csv', 'Данные.csv', 'CSV table'],
    ['md', 'Заметки.md', 'Markdown document'],
  ])(
    'shows the %s format icon and English label without the default file preview',
    (format, filename, label) => {
      render(<ExportedFiles attachments={[buildAttachment({ filename })]} />);

      const icon = screen.getByTestId('export-format-icon');
      expect(icon).toHaveAttribute('data-format', format);
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.queryByTestId('file-preview')).not.toBeInTheDocument();
    },
  );

  it('renders a plain card without a format icon for an unrecognized extension', () => {
    render(<ExportedFiles attachments={[buildAttachment({ filename: 'Архив.zip' })]} />);

    expect(screen.queryByTestId('export-format-icon')).not.toBeInTheDocument();
    expect(screen.getByTestId('file-preview')).toBeInTheDocument();
  });

  it('downloads once when the file card is clicked', () => {
    render(<ExportedFiles attachments={[buildAttachment({ filename: 'Отчёт.pdf' })]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Отчёт.pdf' }));

    expect(mockHandleDownload).toHaveBeenCalledTimes(1);
  });
});
