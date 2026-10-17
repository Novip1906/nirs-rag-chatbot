import type { QueryKey } from '@tanstack/react-query';

export const knowledgeKeys = {
  spaces: ['knowledge', 'spaces'] as QueryKey,
  documents: (spaceId: string): QueryKey => ['knowledge', 'documents', spaceId],
  documentPreview: (fileId: string): QueryKey => ['knowledge', 'documentPreview', fileId],
  employeeSpaces: ['knowledge', 'employeeSpaces'] as QueryKey,
  employeeDocuments: (spaceId: string): QueryKey => ['knowledge', 'employeeDocuments', spaceId],
};
