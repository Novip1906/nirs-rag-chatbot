import { useId, useMemo, useState } from 'react';
import * as Ariakit from '@ariakit/react';
import { Ellipsis, Pencil, Trash2 } from 'lucide-react';
import { buttonVariants, DropdownPopup, Spinner } from '@librechat/client';
import type { KnowledgeSpaceSummary } from 'librechat-data-provider';
import type { MenuItemProps } from '~/common';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import SpaceDeleteDialog from './SpaceDeleteDialog';
import SpaceEditDialog from './SpaceEditDialog';

/** `cn` is what resolves the base utilities this variant overrides — same
 *  composition `ProjectsSection` uses for its own row-action button. */
const iconButtonClassName = cn(
  buttonVariants({ variant: 'section-action', size: 'icon-xs' }),
  'shrink-0',
);

interface SpaceListProps {
  spaces: KnowledgeSpaceSummary[];
  selectedSpaceId: string | null;
  onSelect: (spaceId: string) => void;
  isLoading: boolean;
  isError: boolean;
}

export default function SpaceList({
  spaces,
  selectedSpaceId,
  onSelect,
  isLoading,
  isError,
}: SpaceListProps) {
  const localize = useLocalize();

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center py-8">
        <Spinner className="text-text-secondary" aria-label={localize('com_ui_loading')} />
      </div>
    );
  }

  if (isError) {
    return (
      <p className="px-4 py-6 text-sm text-text-secondary">
        {localize('com_knowledge_spaces_load_error')}
      </p>
    );
  }

  if (spaces.length === 0) {
    return (
      <div className="flex flex-col gap-1 px-4 py-6 text-center">
        <p className="text-sm font-medium text-text-primary">
          {localize('com_knowledge_no_spaces_title')}
        </p>
        <p className="text-sm text-text-secondary">
          {localize('com_knowledge_no_spaces_description')}
        </p>
      </div>
    );
  }

  return (
    <nav
      aria-label={localize('com_knowledge_spaces_heading')}
      className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3"
    >
      {spaces.map((space) => (
        <SpaceRow
          key={space.id}
          space={space}
          isActive={space.id === selectedSpaceId}
          onSelect={onSelect}
        />
      ))}
    </nav>
  );
}

interface SpaceRowProps {
  space: KnowledgeSpaceSummary;
  isActive: boolean;
  onSelect: (spaceId: string) => void;
}

function SpaceRow({ space, isActive, onSelect }: SpaceRowProps) {
  const localize = useLocalize();
  const menuId = useId();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  const menuItems = useMemo<MenuItemProps[]>(
    () => [
      {
        id: `${menuId}-rename`,
        label: localize('com_knowledge_rename_space'),
        icon: <Pencil className="size-4 text-text-secondary" aria-hidden="true" />,
        onClick: () => setIsRenameOpen(true),
      },
      {
        id: `${menuId}-delete`,
        label: localize('com_ui_delete'),
        icon: <Trash2 className="size-4 text-text-secondary" aria-hidden="true" />,
        onClick: () => setIsDeleteOpen(true),
      },
    ],
    [localize, menuId],
  );

  return (
    <div
      className={cn(
        'group/space-row relative flex items-center rounded-lg text-sm transition-colors',
        isActive ? 'bg-surface-active' : 'hover:bg-surface-hover',
        !isActive && isMenuOpen && 'bg-surface-hover',
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(space.id)}
        aria-current={isActive ? 'true' : undefined}
        className={cn(
          'flex min-w-0 flex-1 items-center rounded-lg py-2 pl-3 text-left',
          space.canManage ? 'pr-9' : 'pr-3',
          isActive
            ? 'font-medium text-text-primary'
            : 'text-text-secondary hover:text-text-primary',
        )}
      >
        <span className="truncate">{space.name}</span>
      </button>
      {space.canManage && (
        <div
          className={cn(
            'absolute right-1 top-1/2 -translate-y-1/2',
            isMenuOpen
              ? 'opacity-100'
              : [
                  '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:transition-opacity',
                  'group-hover/space-row:opacity-100',
                  'has-[:focus-visible]:opacity-100',
                ],
          )}
        >
          <DropdownPopup
            portal={true}
            focusLoop={true}
            unmountOnHide={true}
            menuId={menuId}
            isOpen={isMenuOpen}
            setIsOpen={setIsMenuOpen}
            className="z-[125] min-w-40"
            iconClassName="mr-2 text-text-secondary"
            trigger={
              <Ariakit.MenuButton
                aria-label={`${localize('com_ui_more_options')} ${space.name}`}
                className={cn(iconButtonClassName, isMenuOpen && 'text-text-primary')}
              >
                <Ellipsis className="h-4 w-4" aria-hidden="true" />
              </Ariakit.MenuButton>
            }
            items={menuItems}
          />
        </div>
      )}
      {space.canManage && (
        <>
          <SpaceEditDialog open={isRenameOpen} onOpenChange={setIsRenameOpen} space={space} />
          <SpaceDeleteDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen} space={space} />
        </>
      )}
    </div>
  );
}
