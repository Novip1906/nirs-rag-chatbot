import { useEffect } from 'react';
import { Skeleton, SegmentedControl } from '@librechat/client';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAccess, useLocalize } from '~/hooks';
import { getActiveTab, visibleTabs } from './adminNav.config';
import type { AdminTabId } from './adminNav.config';

function TabsSkeleton(): JSX.Element {
  return (
    <div className="flex gap-2" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} className="h-8 w-20 rounded-full" />
      ))}
    </div>
  );
}

export default function AdminTabs(): JSX.Element {
  const localize = useLocalize();
  const location = useLocation();
  const navigate = useNavigate();
  const access = useAccess();

  const pending = access.isLoading || (access.isAdmin && access.isAiLoading);
  const tabs = visibleTabs(access);
  const routedTab = getActiveTab(location.pathname);
  const activeTab = tabs.find((tab) => tab.id === routedTab.id);
  const fallbackTab = activeTab == null ? tabs[0] : undefined;
  const fallbackTo = fallbackTab != null ? (fallbackTab.sections[0]?.to ?? fallbackTab.defaultTo) : null;

  useEffect(() => {
    if (!pending && fallbackTo != null) {
      navigate(fallbackTo, { replace: true });
    }
  }, [pending, fallbackTo, navigate]);

  if (pending) {
    return <TabsSkeleton />;
  }

  if (tabs.length === 0) {
    return <></>;
  }

  /**
   * Кнопка, ведущая в отказ сервера, хуже отсутствующей кнопки — глава не должна видеть
   * вкладку «Общие», на которую у неё нет прав. `routedTab` только группирует
   * путь тематически и не знает о правах; фактический список рисуемых вкладок — уже
   * суженный `visibleTabs`.
   */
  return (
    <SegmentedControl<AdminTabId>
      items={tabs.map((tab) => ({ value: tab.id, label: localize(tab.labelKey) }))}
      value={(activeTab ?? tabs[0]).id}
      ariaLabel={localize('com_admin_tabs_label')}
      onChange={(id) => {
        const tab = tabs.find((candidate) => candidate.id === id);
        if (tab == null) {
          return;
        }
        /**
         * `tab.sections` здесь уже сужены `visibleTabs` до доступных вошедшему — клик
         * должен вести в первую из них, а не в `defaultTo`: тот назначен без учёта прав
         * и у главы отдела может указывать на раздел, скрытый на этой самой вкладке.
         */
        navigate(tab.sections[0]?.to ?? tab.defaultTo);
      }}
    />
  );
}
