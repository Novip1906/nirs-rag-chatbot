import { useLocation } from 'react-router-dom';
import type { NavLink } from '~/common';
import { useActivePanel, resolveActivePanel, resolveRouteActiveId } from '~/Providers';

export default function Nav({ links }: { links: NavLink[] }) {
  const { active } = useActivePanel();
  const location = useLocation();
  /** A page opened by a link of its own brings its panel with it, whatever the
   * stored choice was — otherwise a reload straight onto that page would show
   * the panel of somewhere else. */
  const effectiveActive =
    resolveRouteActiveId(links, location.pathname) ?? resolveActivePanel(active, links);
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden text-text-primary">
      {links.map((link) =>
        link.id === effectiveActive && link.Component ? <link.Component key={link.id} /> : null,
      )}
    </div>
  );
}
