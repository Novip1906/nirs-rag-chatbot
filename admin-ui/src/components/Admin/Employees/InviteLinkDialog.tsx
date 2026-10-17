import { useRef, useState } from 'react';
import {
  Button,
  OGDialog,
  OGDialogContent,
  OGDialogFooter,
  OGDialogHeader,
  OGDialogTitle,
  useToastContext,
} from '@librechat/client';
import { useLocalize } from '~/hooks';

interface InviteLinkDialogProps {
  link: string;
  email: string;
  emailSent: boolean;
  onClose: () => void;
}

export default function InviteLinkDialog({
  link,
  email,
  emailSent,
  onClose,
}: InviteLinkDialogProps): JSX.Element {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const fieldRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      fieldRef.current?.select();
      showToast({ message: localize('com_admin_employees_invite_copy_failed'), status: 'warning' });
    }
  };

  return (
    <OGDialog open>
      <OGDialogContent
        className="w-11/12 max-w-lg"
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <OGDialogHeader>
          <OGDialogTitle>{localize('com_admin_employees_invite_title')}</OGDialogTitle>
        </OGDialogHeader>
        <div className="space-y-4 px-6 pb-2">
          {emailSent ? (
            <p className="text-sm text-text-secondary">
              {localize('com_admin_employees_invite_sent', { email })}
            </p>
          ) : (
            <p className="text-sm text-text-warning" role="alert">
              {localize('com_admin_employees_invite_not_sent', { email })}
            </p>
          )}
          <input
            ref={fieldRef}
            readOnly
            value={link}
            aria-label={localize('com_admin_employees_invite_link_label')}
            onFocus={(event) => event.currentTarget.select()}
            className="w-full min-w-0 rounded-lg border border-border-light bg-surface-secondary px-3 py-2 font-mono text-sm text-text-primary"
          />
          <OGDialogFooter className="px-0">
            <Button type="button" variant="outline" onClick={handleCopy}>
              {localize(
                copied ? 'com_admin_employees_invite_copied' : 'com_admin_employees_invite_copy',
              )}
            </Button>
            <Button type="button" variant="submit" onClick={onClose}>
              {localize('com_admin_action_done')}
            </Button>
          </OGDialogFooter>
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}
