import { memo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { NavLink } from '~/common';
import { useActivePanel, resolveActivePanel } from '~/Providers';

/**
 * The panel keyboard shortcuts locate a panel by its rail button
 * (`[data-testid="nav-panel-*"]`), read `aria-pressed`, and click it. The rail
 * does not exist on mobile, so those shortcuts would silently no-op on a
 * narrow window or a tablet with a keyboard.
 *
 * These hidden buttons keep that contract intact without reviving the rail.
 * Routing the shortcuts through `useActivePanel` instead would mean hoisting
 * `ActivePanelProvider` above `SidebarChatProvider`, which exists specifically
 * to keep panel changes from re-running `useChatHelpers`.
 *
 * Only available links render, so a shortcut for a panel this endpoint does not
 * offer still correctly does nothing.
 */
function ShortcutTargets({
  links,
  onLeaveRouteView,
  routeActiveId,
}: {
  links: NavLink[];
  onLeaveRouteView?: () => void;
  routeActiveId?: string;
}) {
  const navigate = useNavigate();
  const { active, setActive } = useActivePanel();
  const activeId = routeActiveId ?? resolveActivePanel(active, links);

  return (
    <>
      {links.map((link) => (
        <button
          key={link.id}
          type="button"
          hidden
          tabIndex={-1}
          data-testid={`nav-panel-${link.id}`}
          aria-pressed={link.id === activeId}
          onClick={() => {
            if (link.onClick) {
              link.onClick();
              return;
            }
            setActive(link.id);
            if (link.route != null) {
              navigate(link.route);
            } else if (routeActiveId) {
              onLeaveRouteView?.();
            }
          }}
        />
      ))}
    </>
  );
}

export default memo(ShortcutTargets);
