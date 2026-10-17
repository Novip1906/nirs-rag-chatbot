import React, { useRef, useCallback } from 'react';
import { FileUpload, TooltipAnchor, AttachmentIcon } from '@librechat/client';
import { EToolResources, defaultAgentCapabilities } from 'librechat-data-provider';
import type { TConversation } from 'librechat-data-provider';
import type { ExtendedFile, FileSetter } from '~/common';
import { useShortcutAriaKey, useShortcutHint } from '~/hooks/useKeyboardShortcuts';
import {
  useLocalize,
  useGetAgentsConfig,
  useAgentCapabilities,
  useFileHandlingNoChatContext,
} from '~/hooks';
import { cn } from '~/utils';

/**
 * A file the model can read as-is. Everything else has to be turned into text
 * on the server first, which is what {@link EToolResources.context} does.
 */
function goesToProviderUnchanged(file: File): boolean {
  return file.type.startsWith('image/') || file.type === 'application/pdf';
}

interface AttachFileDirectProps {
  disabled?: boolean | null;
  files: Map<string, ExtendedFile>;
  setFiles: FileSetter;
  setFilesLoading: React.Dispatch<React.SetStateAction<boolean>>;
  conversation: TConversation | null;
}

/**
 * The paperclip, opening the OS file picker on the first click.
 *
 * Upstream's `AttachFileMenu` asks first — "to the provider" or "as text" —
 * because the answer decides which upload path the file takes, and the two
 * accept different formats. That question belongs to whoever built the thing,
 * not to an employee attaching a Word file: both wordings describe plumbing,
 * and picking wrong means the file is refused. So the picker opens unfiltered
 * and the answer is derived from what was actually chosen — images and PDFs go
 * to the model untouched, everything else is extracted to text server-side.
 *
 * A selection spanning both lanes is split into two batches. `handleFiles`
 * serialises them through its own queue, so the second waits for the first
 * rather than racing it.
 */
const AttachFileDirect = ({
  disabled,
  files,
  setFiles,
  setFilesLoading,
  conversation,
}: AttachFileDirectProps) => {
  const localize = useLocalize();
  const inputRef = useRef<HTMLInputElement>(null);
  const isUploadDisabled = disabled ?? false;
  const tooltipDescription = useShortcutHint('uploadFile', localize('com_sidepanel_attach_files'));
  const ariaKey = useShortcutAriaKey('uploadFile');

  const { agentsConfig } = useGetAgentsConfig();
  const { contextEnabled } = useAgentCapabilities(
    agentsConfig?.capabilities ?? defaultAgentCapabilities,
  );

  const { handleFiles } = useFileHandlingNoChatContext(undefined, {
    files,
    setFiles,
    setFilesLoading,
    conversation,
  });

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      event.stopPropagation();
      const selected = Array.from(event.target.files ?? []);
      event.target.value = '';
      if (selected.length === 0) {
        return;
      }

      setFilesLoading(true);

      if (!contextEnabled) {
        handleFiles(selected);
        return;
      }

      const toProvider = selected.filter(goesToProviderUnchanged);
      const toText = selected.filter((file) => !goesToProviderUnchanged(file));

      if (toProvider.length > 0) {
        handleFiles(toProvider);
      }
      if (toText.length > 0) {
        handleFiles(toText, EToolResources.context);
      }
    },
    [contextEnabled, handleFiles, setFilesLoading],
  );

  const openPicker = useCallback(() => {
    if (!inputRef.current) {
      return;
    }
    inputRef.current.value = '';
    inputRef.current.click();
  }, []);

  return (
    <FileUpload ref={inputRef} handleFileChange={handleFileChange}>
      <TooltipAnchor
        description={tooltipDescription}
        id="attach-file"
        disabled={isUploadDisabled}
        render={
          <button
            type="button"
            aria-label={localize('com_sidepanel_attach_files')}
            aria-keyshortcuts={ariaKey}
            disabled={isUploadDisabled}
            className={cn(
              'flex size-theme-control items-center justify-center rounded-theme-control-round p-1 transition-colors duration-theme-fast hover:bg-surface-composer-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary focus-visible:ring-opacity-50',
            )}
            onKeyDownCapture={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                openPicker();
              }
            }}
            onClick={openPicker}
          >
            <div className="flex w-full items-center justify-center gap-2">
              <AttachmentIcon />
            </div>
          </button>
        }
      />
    </FileUpload>
  );
};

export default React.memo(AttachFileDirect);
