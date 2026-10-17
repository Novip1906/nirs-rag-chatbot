import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  Button,
  Input,
  Label,
  OGDialog,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import type { KnowledgeSpaceSummary } from 'librechat-data-provider';
import { useUpdateEmployeeSpaceMutation } from '~/data-provider/Knowledge';
import { useLocalize } from '~/hooks';

interface SpaceEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  space: KnowledgeSpaceSummary;
}

export default function SpaceEditDialog({ open, onOpenChange, space }: SpaceEditDialogProps) {
  const localize = useLocalize();
  const formId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { showToast } = useToastContext();
  const [name, setName] = useState(space.name);

  useEffect(() => {
    if (open) {
      setName(space.name);
    }
  }, [open, space.name]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const frameId = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frameId);
  }, [open]);

  const updateMutation = useUpdateEmployeeSpaceMutation({
    onSuccess: () => {
      showToast({ status: 'success', message: localize('com_knowledge_space_updated') });
      onOpenChange(false);
    },
    onError: () => {
      showToast({ status: 'error', message: localize('com_knowledge_space_update_error') });
    },
  });

  const trimmedName = name.trim();
  const isUnchanged = trimmedName === space.name;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (trimmedName === '' || isUnchanged || updateMutation.isLoading) {
      return;
    }
    updateMutation.mutate({ id: space.id, payload: { name: trimmedName } });
  };

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={localize('com_knowledge_rename_space_title')}
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
          </form>
        }
        buttons={
          <Button
            type="submit"
            form={formId}
            variant="submit"
            disabled={trimmedName === '' || isUnchanged || updateMutation.isLoading}
          >
            {localize('com_ui_save')}
          </Button>
        }
      />
    </OGDialog>
  );
}
