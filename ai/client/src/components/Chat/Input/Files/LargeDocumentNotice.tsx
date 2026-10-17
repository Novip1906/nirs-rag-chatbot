import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { estimatePageCount } from 'librechat-data-provider';
import type { ExtendedFile } from '~/common';
import { useLocalize } from '~/hooks';

interface LargeDocumentNoticeProps {
  files: ExtendedFile[];
  warnTokens: number;
}

/**
 * У PDF страницы посчитаны на сервере по-настоящему, у остальных форматов их
 * приходится оценивать из объёма текста. Пересчитывать страницы PDF из
 * `tokenCount` нельзя: страница PDF стоит 258 токенов, страница текста — 750,
 * и оценка занизила бы число страниц втрое.
 */
function pagesOf(file: ExtendedFile): number {
  return file.pageCount ?? estimatePageCount(file.tokenCount ?? 0);
}

export default function LargeDocumentNotice({
  files,
  warnTokens,
}: LargeDocumentNoticeProps): JSX.Element | null {
  const localize = useLocalize();
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());

  const large = useMemo(
    () =>
      files.find(
        (file) =>
          file.filename != null &&
          file.tokenCount != null &&
          file.tokenCount >= warnTokens &&
          !dismissed.has(file.file_id),
      ),
    [files, warnTokens, dismissed],
  );

  if (!large) {
    return null;
  }

  return (
    <div
      role="status"
      className="mb-2 flex items-start gap-2 rounded-lg border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-secondary"
    >
      <span className="flex-1">
        {localize('com_ui_large_document_notice', {
          0: large.filename,
          1: pagesOf(large),
        })}
      </span>
      <button
        type="button"
        aria-label={localize('com_ui_large_document_dismiss')}
        onClick={() => setDismissed((prev) => new Set(prev).add(large.file_id))}
        className="rounded-md p-1 hover:bg-surface-hover"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
