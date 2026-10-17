import * as Ariakit from '@ariakit/react';
import { ChevronDown, LogOut, MessageSquare } from 'lucide-react';
import { chatUrl } from '~/config';
import { useAuthContext, useLocalize } from '~/hooks';

/**
 * Инициалы вместо загруженной аватарки: у админки нет своего хранилища картинок, а имя
 * есть всегда. Берём по одной букве из первых двух слов — «Иван Иванов» даёт «ИИ»,
 * адрес почты — первую букву до собаки.
 */
export function initialsOf(name?: string | null, email?: string | null): string {
  const source = name?.trim() || email?.split('@')[0] || '';
  const words = source.split(/[\s._-]+/).filter(Boolean);
  const letters = words.slice(0, 2).map((word) => word[0]);
  return letters.join('').toUpperCase() || '?';
}

export default function AccountMenu(): JSX.Element | null {
  const localize = useLocalize();
  const { user, logout } = useAuthContext();

  if (user == null) {
    return null;
  }

  const name = user.name || user.email || localize('com_admin_account');
  const itemClassName =
    'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-text-primary outline-none transition-colors data-[active-item]:bg-surface-hover';

  return (
    <Ariakit.MenuProvider placement="bottom-end">
      <Ariakit.MenuButton
        aria-label={localize('com_admin_account')}
        className="flex items-center gap-2 rounded-full border border-transparent p-1 pr-2 text-sm transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-heavy aria-[expanded=true]:bg-surface-hover"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-submit text-xs font-semibold text-text-on-status">
          {initialsOf(user.name, user.email)}
        </span>
        <span className="hidden max-w-[12rem] truncate text-text-primary lg:inline">{name}</span>
        <ChevronDown className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
      </Ariakit.MenuButton>
      <Ariakit.Menu
        portal
        gutter={6}
        className="animate-popover z-50 w-64 rounded-xl border border-border-light bg-surface-dialog p-1.5 shadow-lg outline-none"
      >
        <div className="px-2.5 py-2">
          <p className="truncate text-sm font-medium text-text-primary">{name}</p>
          {user.email != null && user.email !== '' && (
            <p className="truncate text-xs text-text-secondary">{user.email}</p>
          )}
        </div>
        <Ariakit.MenuSeparator className="my-1 border-border-light" />
        <Ariakit.MenuItem
          className={itemClassName}
          render={<a href={chatUrl()} rel="noopener noreferrer" />}
        >
          <MessageSquare className="size-4 shrink-0" aria-hidden="true" />
          {localize('com_admin_open_chat')}
        </Ariakit.MenuItem>
        <Ariakit.MenuSeparator className="my-1 border-border-light" />
        <Ariakit.MenuItem className={itemClassName} onClick={() => logout()}>
          <LogOut className="size-4 shrink-0" aria-hidden="true" />
          {localize('com_admin_logout')}
        </Ariakit.MenuItem>
      </Ariakit.Menu>
    </Ariakit.MenuProvider>
  );
}
