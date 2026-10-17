import { Skeleton } from '@librechat/client';
import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '~/utils';
import { useAccess, useLocalize } from '~/hooks';
import AdminErrorState from './common/AdminErrorState';
import { getActiveTab, visibleTabs } from './adminNav.config';

function NavSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-1" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <Skeleton key={index} className="h-9 w-full rounded-lg" />
      ))}
    </div>
  );
}

export default function AdminNav(): JSX.Element {
  const localize = useLocalize();
  const location = useLocation();
  const access = useAccess();

  /**
   * `<nav aria-label>` остаётся снаружи всех состояний — это единственный
   * ориентир для скринридера, что здесь находится боковая навигация; убрать его на
   * время загрузки или ошибки значило бы, что ориентир то появляется, то исчезает.
   */
  let content: JSX.Element;
  if (access.isLoading || (access.isAdmin && access.isAiLoading)) {
    /**
     * Пока полномочия не загружены, неизвестно, какие разделы показывать — пустая
     * навигация выглядела бы так же, как для главы без прав, а не как загрузка.
     */
    content = <NavSkeleton />;
  } else {
    /**
     * `getActiveTab` группирует по маршруту независимо от прав — она отвечает, какая
     * вкладка тематически соответствует пути. Список секций внутри неё сужается
     * отдельно, `visibleTabs`: так путь вроде `/admin/departments` у главы находит
     * вкладку «Сотрудники», но рисует только те секции, что ей разрешены (в этом
     * случае — ни одной, и сайдбар для неё пуст, а не падает).
     */
    const tabs = visibleTabs(access);
    const routedTab = getActiveTab(location.pathname);
    const activeTab = tabs.find((tab) => tab.id === routedTab.id);
    const aiUnavailable =
      activeTab?.id === 'ai' && activeTab.sections.length === 0 && access.aiError;
    content = aiUnavailable ? (
      <AdminErrorState onRetry={access.refetchAi} />
    ) : (
      <>
        {activeTab?.sections.map(({ to, labelKey, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-surface-active text-text-primary'
                  : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary',
              )
            }
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            {localize(labelKey)}
          </NavLink>
        ))}
      </>
    );
  }

  return (
    <nav aria-label={localize('com_admin_nav_label')} className="flex flex-col gap-1 p-3">
      {content}
    </nav>
  );
}
