import type { ExtendedFile } from '~/common';
import { hasIncompleteFiles } from '~/utils';
import { useLocalize } from '~/hooks';

export default function PendingUploadsNotice({
  files,
}: {
  files: Map<string, ExtendedFile>;
}): JSX.Element | null {
  const localize = useLocalize();

  if (!hasIncompleteFiles(files)) {
    return null;
  }

  return (
    <div role="status" className="mx-2 mt-1 text-xs text-text-secondary">
      {localize('com_ui_attachments_wait_send')}
    </div>
  );
}
