import { useState } from 'react';
import {
  Button,
  OGDialog,
  OGDialogContent,
  OGDialogFooter,
  OGDialogHeader,
  OGDialogTitle,
  useToastContext,
} from '@librechat/client';
import { Check, Copy } from 'lucide-react';
import { useLocalize } from '~/hooks';

interface TemporaryPasswordDialogProps {
  password: string;
  onClose: () => void;
}

export default function TemporaryPasswordDialog({
  password,
  onClose,
}: TemporaryPasswordDialogProps): JSX.Element {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      showToast({ message: localize('com_admin_toast_error'), status: 'error' });
    }
  };

  return (
    <OGDialog open>
      <OGDialogContent
        className="w-11/12 max-w-md"
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <OGDialogHeader>
          <OGDialogTitle>{localize('com_admin_employees_temp_password_title')}</OGDialogTitle>
        </OGDialogHeader>
        <div className="space-y-4 px-6 pb-2">
          <div className="flex items-center gap-2 rounded-lg border border-border-light bg-surface-secondary p-3">
            <span className="min-w-0 flex-1 select-all break-all font-mono text-lg font-semibold text-text-primary">
              {password}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleCopy}
              aria-label={localize('com_admin_action_copy')}
            >
              {copied ? (
                <Check className="size-4" aria-hidden="true" />
              ) : (
                <Copy className="size-4" aria-hidden="true" />
              )}
            </Button>
          </div>
          <p className="text-xs text-text-secondary">
            {localize('com_admin_employees_temp_password_description')}
          </p>
          <OGDialogFooter className="px-0">
            <Button type="button" variant="submit" onClick={onClose}>
              {localize('com_admin_action_done')}
            </Button>
          </OGDialogFooter>
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}
