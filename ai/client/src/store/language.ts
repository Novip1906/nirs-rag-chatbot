import { atom } from 'recoil';
import Cookies from 'js-cookie';
import { atomWithLocalStorage } from './utils';

const readStoredLang = () => {
  if (typeof localStorage === 'undefined') {
    return undefined;
  }

  const storedLang = localStorage.getItem('lang');
  if (!storedLang) {
    return undefined;
  }

  try {
    const parsedLang = JSON.parse(storedLang);
    return typeof parsedLang === 'string' ? parsedLang : storedLang;
  } catch {
    return storedLang;
  }
};

/** Internal tool for a Russian company: the interface is Russian unless someone picks
 *  otherwise. Browser locale is a poor default here — staff run German or English systems
 *  and would land on a half-translated interface, since only our own keys ship Russian. */
const DEPLOYMENT_LANG = 'ru-RU';

const defaultLang = () => Cookies.get('lang') || readStoredLang() || DEPLOYMENT_LANG;

const lang = atomWithLocalStorage('lang', defaultLang());
const languageLoading = atom<boolean>({
  key: 'languageLoading',
  default: false,
});

export default { lang, languageLoading };
