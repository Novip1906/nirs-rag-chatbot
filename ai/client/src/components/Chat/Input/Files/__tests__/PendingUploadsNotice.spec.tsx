import { render, screen } from '@testing-library/react';
import type { ExtendedFile } from '~/common';
import PendingUploadsNotice from '../PendingUploadsNotice';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

function makeFiles(entries: Array<Partial<ExtendedFile>>): Map<string, ExtendedFile> {
  const map = new Map<string, ExtendedFile>();
  entries.forEach((entry, index) => {
    const file_id = entry.file_id ?? `file-${index}`;
    map.set(file_id, { file_id, size: 0, progress: 1, ...entry } as ExtendedFile);
  });
  return map;
}

describe('PendingUploadsNotice', () => {
  it('says why sending is blocked while a file is still incomplete', () => {
    render(<PendingUploadsNotice files={makeFiles([{ progress: 0.4 }])} />);

    expect(screen.getByRole('status')).toHaveTextContent('com_ui_attachments_wait_send');
  });

  it('stays silent once every file has finished', () => {
    render(<PendingUploadsNotice files={makeFiles([{ progress: 1 }])} />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('stays silent when there are no files at all', () => {
    render(<PendingUploadsNotice files={new Map()} />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
