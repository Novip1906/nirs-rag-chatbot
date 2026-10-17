import { memo, useMemo, useState } from 'react';
import { Plus, Upload } from 'lucide-react';
import { Button, useMediaQuery } from '@librechat/client';
import { isAdminLevelRole, SystemRoles } from 'librechat-data-provider';
import { useNavigate, useParams } from 'react-router-dom';
import { useEmployeeSpacesQuery } from '~/data-provider/Knowledge';
import useSidebarToggle from '~/hooks/Nav/useSidebarToggle';
import { useAuthContext, useLocalize } from '~/hooks';
import SpaceCreateDialog from './SpaceCreateDialog';
import UploadDialog from './UploadDialog';
import SpaceList from './SpaceList';

/**
 * The sidebar panel of the knowledge base. It takes the place of the chat list
 * while documents are open: the two never serve the same task, and a spaces
 * column of its own would make a third one beside them.
 */
const SpacesSection = memo(() => {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { spaceId } = useParams();
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const { setSidebarOpen } = useSidebarToggle();
  const { user } = useAuthContext();
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const spacesQuery = useEmployeeSpacesQuery();
  const spaces = useMemo(() => spacesQuery.data ?? [], [spacesQuery.data]);
  const canUpload = useMemo(() => spaces.some((space) => space.canWrite), [spaces]);
  /** Не по содержимому списка (у главы без единого пространства он пуст) — по роли,
   *  тем же признаком, что и `canManageForeign` в `DocumentList`. */
  const canCreateSpace = isAdminLevelRole(user?.role) || user?.role === SystemRoles.HEAD;
  const selectedSpaceId = spaceId ?? spaces[0]?.id ?? null;

  const handleSelect = (nextSpaceId: string) => {
    navigate(`/knowledge/${nextSpaceId}`);
    /** The drawer covers the documents it just opened, so on mobile choosing a
     * space has to close it — same as choosing a conversation does. */
    if (isSmallScreen) {
      setSidebarOpen(false);
    }
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden pb-3 pt-2"
      role="region"
      aria-label={localize('com_knowledge_spaces_heading')}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-2">
        <h2 className="text-sm font-semibold text-text-primary">
          {localize('com_knowledge_spaces_heading')}
        </h2>
        <div className="flex items-center gap-2">
          {canCreateSpace && (
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={() => setShowCreateDialog(true)}
              aria-label={localize('com_knowledge_create_space_title')}
            >
              <Plus className="size-4" aria-hidden="true" />
            </Button>
          )}
          {canUpload && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowUploadDialog(true)}
              aria-label={localize('com_ui_upload')}
            >
              <Upload className="mr-1.5 size-4" aria-hidden="true" />
              {localize('com_ui_upload')}
            </Button>
          )}
        </div>
      </div>
      <SpaceList
        spaces={spaces}
        selectedSpaceId={selectedSpaceId}
        onSelect={handleSelect}
        isLoading={spacesQuery.isLoading}
        isError={spacesQuery.isError}
      />
      {canUpload && selectedSpaceId != null && (
        <UploadDialog
          open={showUploadDialog}
          onOpenChange={setShowUploadDialog}
          spaces={spaces}
          defaultSpaceId={selectedSpaceId}
        />
      )}
      {canCreateSpace && (
        <SpaceCreateDialog
          open={showCreateDialog}
          onOpenChange={setShowCreateDialog}
          onCreated={handleSelect}
        />
      )}
    </div>
  );
});

SpacesSection.displayName = 'SpacesSection';

export default SpacesSection;
