import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  Button,
  Input,
  Label,
  OGDialog,
  OGDialogTemplate,
  Textarea,
  useToastContext,
} from '@librechat/client';
import { useCreateEmployeeSpaceMutation } from '~/data-provider/Knowledge';
import { useLocalize } from '~/hooks';

const MAX_DESCRIPTION_LENGTH = 200;

interface SpaceCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (spaceId: string) => void;
}

export default function SpaceCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: SpaceCreateDialogProps) {
  const localize = useLocalize();
  const formId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { showToast } = useToastContext();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const frameId = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frameId);
  }, [open]);

  const createMutation = useCreateEmployeeSpaceMutation({
    onSuccess: (space) => {
      showToast({ status: 'success', message: localize('com_knowledge_space_created') });
      onOpenChange(false);
      onCreated?.(space.id);
    },
    onError: () => {
      showToast({ status: 'error', message: localize('com_knowledge_space_create_error') });
    },
  });

  const trimmedName = name.trim();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (trimmedName === '' || createMutation.isLoading) {
      return;
    }
    const trimmedDescription = description.trim();
    createMutation.mutate({
      name: trimmedName,
      ...(trimmedDescription ? { description: trimmedDescription } : {}),
    });
  };

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={localize('com_knowledge_create_space_title')}
        showCloseButton={false}
        className="w-11/12 max-w-md"
        main={
          <form id={formId} onSubmit={handleSubmit} className="flex w-full flex-col gap-4">
            <div className="grid w-full items-center gap-2">
              <Label htmlFor={`${formId}-name`}>{localize('com_knowledge_space_name_label')}</Label>
              <Input
                id={`${formId}-name`}
                ref={inputRef}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
            <div className="grid w-full items-center gap-2">
              <Label htmlFor={`${formId}-description`}>
                {localize('com_ui_description')}{' '}
                <span className="font-normal text-text-secondary">
                  {localize('com_ui_optional')}
                </span>
              </Label>
              <Textarea
                id={`${formId}-description`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                maxLength={MAX_DESCRIPTION_LENGTH}
                className="min-h-[4.5rem] bg-transparent"
              />
            </div>
          </form>
        }
        buttons={
          <Button
            type="submit"
            form={formId}
            variant="submit"
            disabled={trimmedName === '' || createMutation.isLoading}
          >
            {localize('com_ui_create')}
          </Button>
        }
      />
    </OGDialog>
  );
}
