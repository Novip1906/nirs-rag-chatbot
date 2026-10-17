import type { TFile } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import type { TranslationKeys } from '~/hooks';
import type { ExtendedFile } from '~/common';
import { getFileType, cn } from '~/utils';
import FilePreview from './FilePreview';
import { useLocalize } from '~/hooks';
import RemoveFile from './RemoveFile';

/**
 * `getFileType` — код из upstream, и подписи типов у него английские литералы. Переводить
 * их там значило бы тащить локализацию в утилиту, которую зовут и вне React; поэтому
 * перевод накладывается здесь, в единственном месте, где подпись показывается сотруднику.
 * Незнакомая подпись остаётся как есть — лучше английское слово, чем пустая строка.
 */
const FILE_TYPE_LABEL_KEYS: Record<string, TranslationKeys> = {
  Document: 'com_ui_filetype_document',
  Spreadsheet: 'com_ui_filetype_spreadsheet',
  Code: 'com_ui_filetype_code',
  Audio: 'com_ui_filetype_audio',
  Video: 'com_ui_filetype_video',
  Image: 'com_ui_filetype_image',
  File: 'com_ui_filetype_file',
};

const FileContainer = ({
  file,
  overrideType,
  displayName,
  subtitle,
  icon,
  typeLabel,
  buttonClassName,
  containerClassName,
  onDelete,
  onClick,
}: {
  file: Partial<ExtendedFile | TFile>;
  overrideType?: string;
  /**
   * Optional pre-computed label for the chip. Callers in code-execution
   * artifact contexts pass the de-suffixed name; upload chips and
   * persisted user files leave this undefined and render the raw filename.
   */
  displayName?: string;
  /**
   * Optional override for the subtitle line (defaults to the file
   * type's localized title — e.g. "PowerPoint Presentation"). Used by
   * the deferred-preview flow to surface "Preparing preview…" /
   * "Preview unavailable" inline within the chip rather than as a
   * loose-feeling annotation below it. Pass a ReactNode so callers
   * can include icons (spinner, alert) alongside the text.
   */
  subtitle?: ReactNode;
  icon?: ReactNode;
  typeLabel?: string;
  buttonClassName?: string;
  containerClassName?: string;
  onDelete?: () => void;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
}) => {
  const localize = useLocalize();
  const fileType = getFileType(overrideType ?? file.type);
  const fileTypeLabelKey = FILE_TYPE_LABEL_KEYS[fileType.title];
  const fileTypeLabel =
    typeLabel ?? (fileTypeLabelKey != null ? localize(fileTypeLabelKey) : fileType.title);
  const visibleName = displayName ?? file.filename ?? '';

  return (
    <div
      className={cn('group relative inline-block text-sm text-text-primary', containerClassName)}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={visibleName}
        className={cn(
          'relative overflow-hidden rounded-2xl border border-border-light bg-surface-hover-alt',
          buttonClassName,
        )}
      >
        <div className="w-56 p-1.5">
          <div className="flex flex-row items-center gap-2">
            {icon ?? <FilePreview file={file} fileType={fileType} className="relative" />}
            <div className="overflow-hidden">
              <div className="truncate font-medium" title={visibleName}>
                {visibleName}
              </div>
              <div aria-live="polite">
                {subtitle != null ? (
                  subtitle
                ) : (
                  <div className="truncate text-text-secondary" title={fileTypeLabel}>
                    {fileTypeLabel}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </button>
      {onDelete && <RemoveFile onRemove={onDelete} />}
    </div>
  );
};

export default FileContainer;
