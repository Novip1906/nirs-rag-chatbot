import { memo } from 'react';
import type { TAttachment, TFile, TAttachmentMetadata } from 'librechat-data-provider';
import {
  displayFilename,
  FILE_CHIP_BUTTON_CLASSNAME,
  renderAttachmentKey,
} from '../attachmentTypes';
import FileContainer from '~/components/Chat/Input/Files/FileContainer';
import { resolveExportFormat } from './formats';
import { useAttachmentLink } from '../LogLink';
import { useLocalize } from '~/hooks';
import FormatIcon from './FormatIcon';

const ExportedFileCard = memo(({ attachment }: { attachment: TAttachment }) => {
  const localize = useLocalize();
  const file = attachment as TFile & TAttachmentMetadata;
  const { handleDownload } = useAttachmentLink({
    href: attachment.filepath ?? '',
    filename: attachment.filename ?? '',
    file_id: file.file_id,
    user: file.user,
    source: file.source,
  });
  const format = resolveExportFormat({
    filename: attachment.filename ?? '',
    type: file.type ?? '',
  });

  return (
    <FileContainer
      file={attachment}
      onClick={handleDownload}
      displayName={displayFilename(attachment.filename)}
      icon={format ? <FormatIcon format={format} /> : undefined}
      typeLabel={format ? localize(format.labelKey) : undefined}
      containerClassName="max-w-fit"
      buttonClassName={FILE_CHIP_BUTTON_CLASSNAME}
    />
  );
});
ExportedFileCard.displayName = 'ExportedFileCard';

export default function ExportedFiles({ attachments }: { attachments?: TAttachment[] }) {
  const localize = useLocalize();

  if (!attachments || attachments.length === 0) {
    return null;
  }

  return (
    <div
      role="list"
      aria-label={localize('com_ui_exported_files')}
      className="my-2 flex flex-wrap items-center gap-2.5"
    >
      {attachments.map((attachment, index) => (
        <div role="listitem" key={renderAttachmentKey('export', attachment, index)}>
          <ExportedFileCard attachment={attachment} />
        </div>
      ))}
    </div>
  );
}
