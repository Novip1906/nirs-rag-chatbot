import { useState } from 'react';
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@librechat/client';
import type { KnowledgeDocumentInput, KnowledgeDocumentStatus } from '~/api';
import { useLocalize } from '~/hooks';

const ACCEPTED_EXTENSIONS = '.pdf,.docx,.xlsx,.pptx,.txt,.md,.csv';

interface DocumentUploadFormProps {
  replacingTitle?: string;
  onSubmit: (file: File, metadata: KnowledgeDocumentInput) => void;
  onCancel: () => void;
  isSaving: boolean;
}

export default function DocumentUploadForm({
  replacingTitle,
  onSubmit,
  onCancel,
  isSaving,
}: DocumentUploadFormProps): JSX.Element {
  const localize = useLocalize();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [source, setSource] = useState('');
  const [owner, setOwner] = useState('');
  const [version, setVersion] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [status, setStatus] = useState<KnowledgeDocumentStatus>('active');

  const canSubmit = file != null && title.trim() !== '';

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || file == null) {
      return;
    }
    onSubmit(file, {
      title,
      source,
      owner,
      version,
      effectiveDate: effectiveDate === '' ? null : effectiveDate,
      status,
    });
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="max-w-lg space-y-4">
      {replacingTitle != null && (
        <p className="text-sm text-text-secondary">
          {localize('com_admin_knowledge_upload_replaces', { title: replacingTitle })}
        </p>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="admin-knowledge-upload-file">
          {localize('com_admin_knowledge_field_file')}
        </Label>
        <Input
          id="admin-knowledge-upload-file"
          type="file"
          required
          accept={ACCEPTED_EXTENSIONS}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="admin-knowledge-upload-title">
          {localize('com_admin_knowledge_field_document_title')}
        </Label>
        <Input
          id="admin-knowledge-upload-title"
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="admin-knowledge-upload-source">
            {localize('com_admin_knowledge_field_source')}
          </Label>
          <Input
            id="admin-knowledge-upload-source"
            value={source}
            onChange={(event) => setSource(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="admin-knowledge-upload-owner">
            {localize('com_admin_knowledge_field_owner')}
          </Label>
          <Input
            id="admin-knowledge-upload-owner"
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="admin-knowledge-upload-version">
            {localize('com_admin_knowledge_field_version')}
          </Label>
          <Input
            id="admin-knowledge-upload-version"
            value={version}
            onChange={(event) => setVersion(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="admin-knowledge-upload-effective-date">
            {localize('com_admin_knowledge_field_effective_date')}
          </Label>
          <Input
            id="admin-knowledge-upload-effective-date"
            type="date"
            value={effectiveDate}
            onChange={(event) => setEffectiveDate(event.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="admin-knowledge-upload-status">
          {localize('com_admin_knowledge_field_status')}
        </Label>
        <Select
          value={status}
          onValueChange={(value) => setStatus(value as KnowledgeDocumentStatus)}
        >
          <SelectTrigger id="admin-knowledge-upload-status" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">{localize('com_admin_knowledge_status_active')}</SelectItem>
            <SelectItem value="draft">{localize('com_admin_knowledge_status_draft')}</SelectItem>
            <SelectItem value="archived">
              {localize('com_admin_knowledge_status_archived')}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          {localize('com_admin_action_cancel')}
        </Button>
        <Button type="submit" variant="submit" disabled={!canSubmit || isSaving}>
          {localize('com_admin_knowledge_upload_submit')}
        </Button>
      </div>
    </form>
  );
}
