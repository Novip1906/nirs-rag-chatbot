import { useEffect, useId, useState } from 'react';
import {
  Button,
  Input,
  Label,
  OGDialog,
  OGDialogTemplate,
  Textarea,
  useToastContext,
} from '@librechat/client';
import type { KnowledgeDocumentItem } from 'librechat-data-provider';
import { useUpdateEmployeeKnowledgeDocumentMutation } from '~/data-provider/Knowledge';
import { useLocalize } from '~/hooks';

const MAX_DESCRIPTION_LENGTH = 200;

interface EditKnowledgeDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doc: KnowledgeDocumentItem;
  spaceId: string;
}

function toDateInputValue(value: string | null): string {
  return value == null ? '' : value.slice(0, 10);
}

export default function EditKnowledgeDocumentDialog({
  open,
  onOpenChange,
  doc,
  spaceId,
}: EditKnowledgeDocumentDialogProps) {
  const localize = useLocalize();
  const formId = useId();
  const { showToast } = useToastContext();

  const [title, setTitle] = useState(doc.title);
  const [description, setDescription] = useState(doc.description);
  const [effectiveDate, setEffectiveDate] = useState(toDateInputValue(doc.effectiveDate));

  useEffect(() => {
    if (open) {
      setTitle(doc.title);
      setDescription(doc.description);
      setEffectiveDate(toDateInputValue(doc.effectiveDate));
    }
  }, [open, doc]);

  const updateMutation = useUpdateEmployeeKnowledgeDocumentMutation(spaceId, {
    onSuccess: () => {
      showToast({ status: 'success', message: localize('com_knowledge_document_updated') });
      onOpenChange(false);
    },
    onError: () => {
      showToast({ status: 'error', message: localize('com_knowledge_document_update_error') });
    },
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (trimmedTitle === '') {
      return;
    }
    updateMutation.mutate({
      id: doc.id,
      payload: {
        title: trimmedTitle,
        description,
        effectiveDate: effectiveDate === '' ? null : effectiveDate,
      },
    });
  };

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={localize('com_knowledge_edit_document_title')}
        className="w-11/12 max-w-md"
        showCloseButton={false}
        main={
          <form id={formId} onSubmit={handleSubmit} className="flex w-full flex-col gap-4">
            <div className="grid w-full items-center gap-2">
              <Label htmlFor={`${formId}-title`}>
                {localize('com_knowledge_document_title_label')}
              </Label>
              <Input
                id={`${formId}-title`}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
              />
            </div>
            <div className="grid w-full items-center gap-2">
              <Label htmlFor={`${formId}-description`}>{localize('com_ui_description')}</Label>
              <Textarea
                id={`${formId}-description`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={MAX_DESCRIPTION_LENGTH}
              />
            </div>
            <div className="grid w-full items-center gap-2">
              <Label htmlFor={`${formId}-effective-date`}>
                {localize('com_knowledge_document_effective_date_label')}
              </Label>
              <Input
                id={`${formId}-effective-date`}
                type="date"
                value={effectiveDate}
                onChange={(event) => setEffectiveDate(event.target.value)}
              />
            </div>
          </form>
        }
        buttons={
          <Button
            type="submit"
            form={formId}
            variant="submit"
            disabled={updateMutation.isLoading || title.trim() === ''}
          >
            {localize('com_ui_save')}
          </Button>
        }
      />
    </OGDialog>
  );
}
