import {
  BarChart3,
  BookOpen,
  Brain,
  Building2,
  ClipboardList,
  MessageSquare,
  Network,
  ScrollText,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react';
import type { ComponentType } from 'react';
import type { TranslationKeys } from '~/hooks/useLocalize';
import type { Access } from '~/hooks/useAccess';

export type AdminTabId = 'general' | 'ai';

/**
 * Полный набор полномочий, которые сервер вообще выдаёт (см. серверный сидинг ролей в
 * форке). Юнион, а не `string`, — опечатка вроде `'read:user'` в одной из секций ниже
 * не даёт ошибки типов, а просто прячет раздел у всех и навсегда, потому что ни у кого
 * нет полномочия с таким именем; компилятор ловит её здесь же.
 */
export type Capability =
  | 'access:admin'
  | 'read:users'
  | 'read:usage'
  | 'read:insights'
  | 'manage:users'
  | 'manage:configs'
  | 'manage:limit_requests'
  | 'manage:prompts'
  | 'manage:knowledge_documents'
  | 'manage:department_members'
  | 'manage:roles';

export interface AdminNavSection {
  to: string;
  labelKey: TranslationKeys;
  icon: ComponentType<{ className?: string }>;
  capability?: Capability;
}

export interface AdminTabConfig {
  id: AdminTabId;
  labelKey: TranslationKeys;
  sections: AdminNavSection[];
  defaultTo: string;
  adminOnly?: boolean;
}

export const ADMIN_TABS: AdminTabConfig[] = [
  {
    id: 'general',
    labelKey: 'com_admin_tab_general',
    sections: [
      { to: '/admin/users', labelKey: 'com_admin_nav_users', icon: Users },
      { to: '/admin/departments', labelKey: 'com_admin_nav_departments', icon: Building2 },
    ],
    defaultTo: '/admin/users',
    adminOnly: true,
  },
  {
    id: 'ai',
    labelKey: 'com_admin_tab_ai',
    sections: [
      {
        to: '/admin/ai/users',
        labelKey: 'com_admin_nav_ai_users',
        icon: UserCog,
        capability: 'read:users',
      },
      {
        to: '/admin/ai/departments',
        labelKey: 'com_admin_nav_ai_departments',
        icon: Network,
        capability: 'manage:configs',
      },
      {
        to: '/admin/requests',
        labelKey: 'com_admin_nav_requests',
        icon: ClipboardList,
        capability: 'manage:limit_requests',
      },
      {
        to: '/admin/prompts',
        labelKey: 'com_admin_nav_prompts',
        icon: ScrollText,
        capability: 'manage:prompts',
      },
      {
        to: '/admin/knowledge',
        labelKey: 'com_admin_nav_knowledge',
        icon: BookOpen,
        capability: 'manage:knowledge_documents',
      },
      {
        to: '/admin/spend',
        labelKey: 'com_admin_nav_spend',
        icon: Wallet,
        capability: 'read:usage',
      },
      {
        to: '/admin/analytics',
        labelKey: 'com_admin_nav_analytics',
        icon: BarChart3,
        capability: 'read:insights',
      },
      {
        to: '/admin/feedback',
        labelKey: 'com_admin_nav_feedback',
        icon: MessageSquare,
        capability: 'manage:configs',
      },
      {
        to: '/admin/memory',
        labelKey: 'com_admin_nav_memory',
        icon: Brain,
        capability: 'manage:roles',
      },
    ],
    defaultTo: '/admin/ai/users',
  },
];

export function visibleTabs(
  access: Pick<Access, 'isAdmin' | 'aiCapabilities' | 'aiError'> & { directoryError?: boolean },
): AdminTabConfig[] {
  return ADMIN_TABS.reduce<AdminTabConfig[]>((visible, tab) => {
    if (tab.adminOnly === true) {
      if (access.isAdmin || access.directoryError) {
        visible.push(tab);
      }
      return visible;
    }
    const sections = tab.sections.filter(
      (section) => section.capability != null && access.aiCapabilities.has(section.capability),
    );
    if (sections.length > 0 || access.aiError) {
      visible.push({ ...tab, sections });
    }
    return visible;
  }, []);
}

function pathMatches(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function getActiveTab(pathname: string): AdminTabConfig {
  const bySection = ADMIN_TABS.find((tab) =>
    tab.sections.some((section) => pathMatches(pathname, section.to)),
  );
  if (bySection) {
    return bySection;
  }
  const byDefault = ADMIN_TABS.find((tab) => pathMatches(pathname, tab.defaultTo));
  return byDefault ?? ADMIN_TABS[0];
}
