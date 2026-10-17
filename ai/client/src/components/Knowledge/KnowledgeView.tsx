import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Spinner, useMediaQuery } from '@librechat/client';
import type { KnowledgeDocumentItem, KnowledgeSpaceSummary } from 'librechat-data-provider';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import { useEmployeeDocumentsQuery, useEmployeeSpacesQuery } from '~/data-provider/Knowledge';
import { useLocalize } from '~/hooks';
import DocumentList from './DocumentList';

interface DocumentsPaneArgs {
  localize: ReturnType<typeof useLocalize>;
  isSpacesLoading: boolean;
  selectedSpace: KnowledgeSpaceSummary | null;
  documents: KnowledgeDocumentItem[];
  isDocumentsLoading: boolean;
  isDocumentsError: boolean;
}

function renderDocumentsPane({
  localize,
  isSpacesLoading,
  selectedSpace,
  documents,
  isDocumentsLoading,
  isDocumentsError,
}: DocumentsPaneArgs) {
  if (isSpacesLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="text-text-secondary" aria-label={localize('com_ui_loading')} />
      </div>
    );
  }

  if (selectedSpace == null) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
        <p className="text-[15px] font-semibold text-text-primary">
          {localize('com_knowledge_no_spaces_title')}
        </p>
        <p className="mt-1.5 text-sm text-text-secondary">
          {localize('com_knowledge_no_spaces_description')}
        </p>
      </div>
    );
  }

  return (
    <DocumentList
      space={selectedSpace}
      documents={documents}
      isLoading={isDocumentsLoading}
      isError={isDocumentsError}
    />
  );
}

export default function KnowledgeView() {
  const localize = useLocalize();
  const { spaceId } = useParams();
  const isSmallScreen = useMediaQuery('(max-width: 768px)');

  const spacesQuery = useEmployeeSpacesQuery();
  const spaces = useMemo(() => spacesQuery.data ?? [], [spacesQuery.data]);

  /**
   * The address names the space, and the sidebar panel writes it there. A bare
   * `/knowledge` and a link to a space that is gone both have to land
   * somewhere, so both fall back to the first space available.
   */
  const selectedSpace = useMemo(
    () => spaces.find((space) => space.id === spaceId) ?? spaces[0] ?? null,
    [spaces, spaceId],
  );

  /**
   * Archived documents are only worth fetching for whoever manages the space —
   * `DocumentList` filters them behind its own "show archived" toggle, but a
   * non-manager should never see them even before that toggle exists on screen.
   */
  const documentsQuery = useEmployeeDocumentsQuery(
    selectedSpace?.id ?? null,
    selectedSpace?.canManage ?? false,
  );
  const documents = documentsQuery.data ?? [];

  return (
    <div className="flex h-full w-full flex-col bg-presentation">
      {isSmallScreen && (
        <div className="flex shrink-0 items-center px-4 pt-3">
          <OpenSidebar />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {renderDocumentsPane({
          localize,
          isSpacesLoading: spacesQuery.isLoading,
          selectedSpace,
          documents,
          isDocumentsLoading: documentsQuery.isLoading,
          isDocumentsError: documentsQuery.isError,
        })}
      </div>
    </div>
  );
}
