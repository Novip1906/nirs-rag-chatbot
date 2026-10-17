import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import useToast from '../hooks/useToast';
import { NotificationSeverity } from '../common';
import { cn } from '../utils';

const SEVERITY_CLASSNAME: Record<NotificationSeverity, string> = {
  [NotificationSeverity.INFO]: 'border-status-info-border bg-status-info-subtle text-status-info',
  [NotificationSeverity.SUCCESS]:
    'border-status-success-border bg-status-success-subtle text-status-success',
  [NotificationSeverity.WARNING]:
    'border-status-warning-border bg-status-warning-subtle text-status-warning',
  [NotificationSeverity.ERROR]:
    'border-status-error-border bg-status-error-subtle text-status-error',
};

const SEVERITY_ICON: Record<NotificationSeverity, typeof Info> = {
  [NotificationSeverity.INFO]: Info,
  [NotificationSeverity.SUCCESS]: CheckCircle2,
  [NotificationSeverity.WARNING]: AlertTriangle,
  [NotificationSeverity.ERROR]: AlertTriangle,
};

/**
 * Renders whatever the last `showToast(...)` call (via `useToastContext`) put into the
 * shared `toastState` atom. Must be mounted once near the app root, inside `ToastProvider`
 * — without it, every `showToast` call quietly updates state nothing displays. That was
 * the actual bug: `ToastProvider` was never mounted in `App.tsx`, and this renderer never
 * existed in adminui at all (unlike the main chat client's `Toast` + `RadixToast.Viewport`
 * in `packages/client`) — so all six call sites (space create/update/delete, document
 * upload, reindex, error toasts) fired into a black hole.
 */
export function Toast(): JSX.Element | null {
  const { toast } = useToast();
  if (!toast.open) {
    return null;
  }

  const Icon = SEVERITY_ICON[toast.severity];

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-2 z-[1000] mx-auto flex max-w-[560px] justify-center px-2"
    >
      <div
        className={cn(
          'pointer-events-auto flex items-start gap-2 rounded-xl border px-3 py-2 text-sm shadow-lg',
          SEVERITY_CLASSNAME[toast.severity],
        )}
      >
        {toast.showIcon && <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
        <div className="whitespace-pre-wrap">{toast.message}</div>
      </div>
    </div>
  );
}
