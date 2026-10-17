import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import copy from 'copy-to-clipboard';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { OGDialog, OGDialogContent, OGDialogTitle, OGDialogDescription } from '@librechat/client';
import { useLocalize } from '~/hooks';
import { getFileExtension } from './preview';
import { formatEffectiveDate } from './dates';
import CopyButton from '~/components/Messages/Content/CopyButton';
import { getResponseStatus, logger, triggerDownload } from '~/utils';
import { useKnowledgeDocumentPreview } from '~/data-provider/Knowledge';
import { getKnowledgeDocumentFile } from '~/data-provider/Knowledge/request';

interface KnowledgeDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileId: string;
  /** The title known to the caller before the `/preview` response lands
   * (e.g. `docTitle` from a citation) — shown until, and as a fallback if,
   * the fetched `preview.title` isn't available. */
  title: string;
  spaceName?: string;
  version?: string;
  effectiveDate?: string;
}

/**
 * Formats bytes with a unit suffix. Kept as a local helper, separate from
 * the identical one in `FilePreviewDialog.tsx`: that component is shared
 * with upstream LibreChat and is deliberately left untouched by the
 * knowledge-base fork.
 */
function formatBytes(bytes: number): string {
  if (bytes >= 1048576) {
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

/**
 * Previews a knowledge-base document via `/api/office/knowledge/documents/:fileId`,
 * distinct from `FilePreviewDialog`: knowledge documents aren't rows in the
 * `files` collection `FilePreviewDialog` reads from, so they need their own
 * fetch path. Body rendering branches on the server-decided `kind`:
 * - `pdf` — the file body, fetched as a blob and shown in an `<iframe>`.
 * - `html` — a server-sanitized, self-contained HTML document, rendered via
 *   `srcDoc` in a sandboxed `<iframe>` that never grants `allow-same-origin`,
 *   so the document body can never reach this app's origin.
 * - `text` — plain text, with a copy-to-clipboard affordance.
 */
export default function KnowledgeDocumentDialog({
  open,
  onOpenChange,
  fileId,
  title,
  spaceName,
  version,
  effectiveDate,
}: KnowledgeDocumentDialogProps) {
  const localize = useLocalize();
  const { i18n } = useTranslation();
  const {
    data: preview,
    isLoading: previewLoading,
    isError: previewError,
    error: previewErrorValue,
  } = useKnowledgeDocumentPreview(fileId, open);

  const [fileBlobUrl, setFileBlobUrl] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileLoadError, setFileLoadError] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  // A plain ref, not state: `fileLoading` below drives the loading spinner, but
  // reacting to it as an effect dependency would cancel this same fetch right
  // after it starts (`setFileLoading(true)` re-runs the effect before the
  // request resolves). The ref is read as a synchronous guard only.
  const fileLoadingRef = useRef(false);

  useEffect(() => {
    if (!open || preview?.kind !== 'pdf' || fileBlobUrl || fileLoadingRef.current) {
      return undefined;
    }
    let cancelled = false;
    fileLoadingRef.current = true;
    setFileLoading(true);
    setFileLoadError(false);

    (async () => {
      try {
        const response = await getKnowledgeDocumentFile(fileId);
        if (cancelled) {
          return;
        }
        const typed = new Blob([response.data], { type: 'application/pdf' });
        setFileBlobUrl(URL.createObjectURL(typed));
      } catch (err) {
        if (!cancelled) {
          logger.error('[KnowledgeDocumentDialog] Failed to load PDF body:', err);
          setFileLoadError(true);
        }
      } finally {
        if (!cancelled) {
          fileLoadingRef.current = false;
          setFileLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, preview?.kind, fileId, fileBlobUrl]);

  useEffect(() => {
    return () => {
      if (fileBlobUrl) {
        URL.revokeObjectURL(fileBlobUrl);
      }
    };
  }, [fileBlobUrl]);

  useEffect(() => {
    if (open) {
      return;
    }
    setFileBlobUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return null;
    });
    fileLoadingRef.current = false;
    setFileLoading(false);
    setFileLoadError(false);
    setIsCopied(false);
  }, [open]);

  const heading = preview?.title ?? title;

  const handleDownload = useCallback(async () => {
    try {
      const response = await getKnowledgeDocumentFile(fileId, { download: true });
      const downloadUrl = URL.createObjectURL(response.data);
      triggerDownload(downloadUrl, preview?.filename ?? heading);
    } catch (err) {
      logger.error('[KnowledgeDocumentDialog] Download failed:', err);
    }
  }, [fileId, preview?.filename, heading]);

  const handleCopy = useCallback(() => {
    if (!preview?.text) {
      return;
    }
    copy(preview.text, { format: 'text/plain' });
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 3000);
  }, [preview?.text]);

  const metaParts = useMemo(() => {
    const parts: string[] = [];
    if (spaceName) {
      parts.push(spaceName);
    }
    if (version) {
      parts.push(localize('com_citation_document_version', { version }));
    }
    if (effectiveDate) {
      const formatted = formatEffectiveDate(effectiveDate, i18n.language);
      if (formatted) {
        parts.push(localize('com_citation_document_effective_date', { date: formatted }));
      }
    }
    if (preview) {
      const extension = getFileExtension(preview.filename);
      if (extension) {
        parts.push(extension.toUpperCase());
      }
      if (preview.bytes > 0) {
        parts.push(formatBytes(preview.bytes));
      }
    }
    return parts;
  }, [spaceName, version, effectiveDate, i18n.language, localize, preview]);

  const status = getResponseStatus(previewErrorValue);
  const errorMessage = useMemo(() => {
    if (status === 403) {
      return localize('com_knowledge_document_forbidden');
    }
    if (status === 404) {
      return localize('com_knowledge_document_not_found');
    }
    return localize('com_knowledge_document_preview_error');
  }, [status, localize]);

  const showLoading = previewLoading || fileLoading;
  const showError = !previewLoading && (previewError || fileLoadError);
  const showBody = !previewLoading && !previewError && !fileLoading && !fileLoadError && preview;

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogContent
        className="flex w-full max-w-4xl flex-col !overflow-hidden p-0"
        showCloseButton={true}
      >
        <div className="shrink-0 px-6 pr-12 pt-6">
          <OGDialogTitle className="truncate text-base">{heading}</OGDialogTitle>
          <div className="mt-0.5 flex items-center gap-3">
            {metaParts.length > 0 && (
              <OGDialogDescription className="min-w-0 truncate">
                {metaParts.join(' · ')}
              </OGDialogDescription>
            )}
            {preview && (
              <button
                type="button"
                onClick={handleDownload}
                className="inline-flex shrink-0 items-center gap-1 text-xs text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-heavy"
                aria-label={`${localize('com_ui_download')} ${heading}`}
              >
                <Download className="size-3" aria-hidden="true" />
                {localize('com_ui_download')}
              </button>
            )}
          </div>
        </div>

        <div className="relative min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4">
          {showLoading && (
            <div className="flex h-60 items-center justify-center rounded-lg bg-surface-secondary">
              <span className="shimmer text-sm text-text-secondary">
                {localize('com_ui_loading')}
              </span>
            </div>
          )}
          {showError && (
            <div className="flex h-32 items-center justify-center rounded-lg bg-surface-secondary">
              <span className="text-sm text-text-secondary">{errorMessage}</span>
            </div>
          )}
          {showBody && preview.kind === 'pdf' && fileBlobUrl && (
            <iframe
              src={fileBlobUrl}
              title={`${localize('com_ui_preview')}: ${heading}`}
              className="h-[70vh] w-full rounded-lg border border-border-light"
            />
          )}
          {showBody && preview.kind === 'html' && (
            <iframe
              srcDoc={preview.html ?? ''}
              sandbox="allow-scripts allow-popups"
              title={`${localize('com_ui_preview')}: ${heading}`}
              className="h-[70vh] w-full rounded-lg border border-border-light bg-surface-primary"
            />
          )}
          {showBody && preview.kind === 'text' && (
            <>
              <div className="pointer-events-none sticky top-0 z-10 flex justify-end pr-1">
                <CopyButton
                  isCopied={isCopied}
                  onClick={handleCopy}
                  iconOnly
                  label={localize('com_ui_copy')}
                  className="pointer-events-auto rounded-lg bg-surface-secondary"
                />
              </div>
              <div className="-mt-8 rounded-lg bg-surface-secondary p-4">
                <pre className="whitespace-pre-wrap break-words pr-8 font-mono text-sm leading-6 text-text-primary">
                  {preview.text ?? ''}
                </pre>
              </div>
            </>
          )}
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}
