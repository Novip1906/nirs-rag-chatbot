import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ExtendedFile } from '~/common';
import LargeDocumentNotice from '../LargeDocumentNotice';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, string | number>) =>
    values ? `${key}:${Object.values(values).join(',')}` : key,
}));

function makeFiles(entries: Array<Partial<ExtendedFile>>): ExtendedFile[] {
  return entries.map(
    (entry, index) =>
      ({
        file_id: `file-${index}`,
        filename: `doc-${index}.docx`,
        type: 'text/plain',
        progress: 1,
        ...entry,
      }) as ExtendedFile,
  );
}

describe('LargeDocumentNotice', () => {
  it('молчит, когда все документы небольшие', () => {
    render(<LargeDocumentNotice files={makeFiles([{ tokenCount: 500 }])} warnTokens={8000} />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('молчит на документе чуть ниже порога', () => {
    render(
      <LargeDocumentNotice
        files={makeFiles([{ filename: 'Регламент.docx', tokenCount: 7500 }])}
        warnTokens={8000}
      />,
    );

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('предупреждает ровно на пороге и называет число страниц', () => {
    render(
      <LargeDocumentNotice
        files={makeFiles([{ filename: 'Регламент.docx', tokenCount: 8000 }])}
        warnTokens={8000}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Регламент.docx');
    expect(screen.getByRole('status')).toHaveTextContent('11');
  });

  /**
   * У PDF страницы посчитаны сервером; пересчёт из `tokenCount` дал бы 138
   * страниц вместо 400 и сотрудник не узнал бы свой документ.
   */
  it('показывает у PDF посчитанные сервером страницы, а не оценку из объёма', () => {
    render(
      <LargeDocumentNotice
        files={makeFiles([
          {
            filename: 'Договор.pdf',
            type: 'application/pdf',
            tokenCount: 103200,
            pageCount: 400,
          },
        ])}
        warnTokens={8000}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'com_ui_large_document_notice:Договор.pdf,400',
    );
  });

  /** Рубли сотруднику не показываем ни при каких условиях. */
  it('не упоминает деньги', () => {
    render(
      <LargeDocumentNotice
        files={makeFiles([{ filename: 'Договор.docx', tokenCount: 40000 }])}
        warnTokens={8000}
      />,
    );

    expect(screen.getByRole('status').textContent).not.toMatch(/₽|руб/i);
  });

  it('скрывается после закрытия и больше не возвращается', async () => {
    render(
      <LargeDocumentNotice
        files={makeFiles([{ filename: 'Договор.docx', tokenCount: 40000 }])}
        warnTokens={8000}
      />,
    );

    await userEvent.click(screen.getByRole('button'));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('игнорирует файлы без подсчитанного объёма', () => {
    render(
      <LargeDocumentNotice files={makeFiles([{ tokenCount: undefined }])} warnTokens={8000} />,
    );

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('молчит для большого файла без имени, чтобы не показать "undefined"', () => {
    render(
      <LargeDocumentNotice
        files={makeFiles([{ filename: undefined, tokenCount: 40000 }])}
        warnTokens={8000}
      />,
    );

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('молчит, когда список пуст', () => {
    render(<LargeDocumentNotice files={[]} warnTokens={8000} />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
