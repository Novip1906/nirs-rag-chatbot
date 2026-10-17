import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SourceHovercard } from '~/components/Web/SourceHovercard';
import type { SourceData } from '~/components/Web/SourceHovercard';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, unknown>) => {
    const translations: Record<string, string> = {
      com_citation_more_details: `More details about ${values?.label ?? ''}`,
      com_file_source: 'File source',
      com_ui_relevance: 'Relevance',
      com_file_pages: `Pages: ${values?.pages ?? ''}`,
      com_citation_document_version: `Версия ${values?.version ?? ''}`,
      com_citation_document_effective_date: `Актуально с ${values?.date ?? ''}`,
      com_citation_document_owner: `Владелец: ${values?.owner ?? ''}`,
    };
    return translations[key] ?? key;
  },
}));

const base: SourceData = {
  link: '#file-1',
  title: 'contract.pdf',
  attribution: 'contract.pdf',
  snippet: 'some content',
};

function openHovercard(label: string): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`More details about ${label}`) }));
  return screen.getByRole('dialog');
}

describe('SourceHovercard — метаданные документа из базы знаний', () => {
  it('источник из базы знаний показывает название документа, пространство, версию и дату', () => {
    render(
      <SourceHovercard
        source={{
          ...base,
          docTitle: 'Положение об отпусках',
          spaceName: 'Кадры',
          version: '2.1',
          effectiveDate: '2026-03-14',
          owner: 'HR-отдел',
        }}
        label="Положение об отпусках"
        isFile
      />,
    );
    const dialog = openHovercard('Положение об отпусках');

    expect(within(dialog).getByText('Положение об отпусках')).toBeInTheDocument();
    expect(within(dialog).getByText('Кадры')).toBeInTheDocument();
    expect(within(dialog).getByText(/2\.1/)).toBeInTheDocument();
    expect(within(dialog).getByText(/2026-03-14/)).toBeInTheDocument();
    expect(within(dialog).getByText(/HR-отдел/)).toBeInTheDocument();
    expect(within(dialog).queryByText('contract.pdf')).not.toBeInTheDocument();
  });

  it('обычный приложенный файл рендерится как раньше, без карточки документа базы знаний', () => {
    render(<SourceHovercard source={base} label={base.attribution ?? ''} isFile />);
    const dialog = openHovercard(base.attribution ?? '');

    expect(within(dialog).getByText(base.attribution ?? '')).toBeInTheDocument();
    expect(within(dialog).queryByRole('link')).not.toBeInTheDocument();
  });

  it('источник из базы знаний без владельца не падает и просто его не показывает', () => {
    render(
      <SourceHovercard
        source={{ ...base, docTitle: 'Регламент', version: '1.0' }}
        label="Регламент"
        isFile
      />,
    );
    const dialog = openHovercard('Регламент');

    expect(within(dialog).getByText('Регламент')).toBeInTheDocument();
    expect(within(dialog).getByText(/1\.0/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('link')).not.toBeInTheDocument();
  });
});
