import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { useRecoilValue } from 'recoil';
import { resolveHour12, systemLocale } from '~/utils/clock';
import { clockFormatAtom } from '~/store/clockFormat';
import store from '~/store';

export default function useClockFormat(): boolean {
  const preference = useAtomValue(clockFormatAtom);
  const lang = useRecoilValue(store.lang);
  return useMemo(() => {
    const uiLocale = lang && lang !== 'auto' ? lang : systemLocale();
    return resolveHour12(preference, uiLocale);
  }, [preference, lang]);
}
