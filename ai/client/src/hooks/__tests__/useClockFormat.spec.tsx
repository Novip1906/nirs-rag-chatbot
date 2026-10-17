import { RecoilRoot, useSetRecoilState } from 'recoil';
import { render, screen, act } from '@testing-library/react';
import { createStore, Provider as JotaiProvider } from 'jotai';
import type { ClockFormatPreference } from '~/store/clockFormat';
import { clockFormatAtom } from '~/store/clockFormat';
import useClockFormat from '../useClockFormat';
import store from '~/store';

const mockSystemLocale = jest.fn();
jest.mock('~/utils/clock', () => ({
  ...jest.requireActual('~/utils/clock'),
  systemLocale: () => mockSystemLocale(),
}));

function Probe() {
  const hour12 = useClockFormat();
  return <output data-testid="hour12">{String(hour12)}</output>;
}

const renderProbe = ({
  lang,
  preference = 'system',
}: {
  lang?: string;
  preference?: ClockFormatPreference;
} = {}) => {
  const jotaiStore = createStore();
  jotaiStore.set(clockFormatAtom, preference);
  return render(
    <RecoilRoot
      initializeState={({ set }) => {
        if (lang !== undefined) {
          set(store.lang, lang);
        }
      }}
    >
      <JotaiProvider store={jotaiStore}>
        <Probe />
      </JotaiProvider>
    </RecoilRoot>,
  );
};

describe('useClockFormat', () => {
  beforeEach(() => {
    mockSystemLocale.mockReturnValue('en-US');
  });

  afterEach(() => {
    mockSystemLocale.mockReset();
    localStorage.clear();
  });

  it.each([
    ['ru-RU', 'false'],
    ['en-US', 'true'],
    ['en-GB', 'false'],
    ['de-DE', 'false'],
  ])('"Системный" + interface language %s resolves hour12 to %s', (lang, expected) => {
    renderProbe({ lang, preference: 'system' });
    expect(screen.getByTestId('hour12')).toHaveTextContent(expected);
  });

  it('"12 ч" overrides a ru-RU interface language to a meridiem clock', () => {
    renderProbe({ lang: 'ru-RU', preference: '12h' });
    expect(screen.getByTestId('hour12')).toHaveTextContent('true');
  });

  it('"24 ч" overrides an en-US interface language to a 24-hour clock', () => {
    renderProbe({ lang: 'en-US', preference: '24h' });
    expect(screen.getByTestId('hour12')).toHaveTextContent('false');
  });

  it.each(['', 'auto'])(
    '"Системный" falls back to the browser locale when the interface language is %j',
    (lang) => {
      renderProbe({ lang, preference: 'system' });
      expect(screen.getByTestId('hour12')).toHaveTextContent('true');
    },
  );

  it('reacts to the clockFormat atom changing without a reload', async () => {
    const jotaiStore = createStore();
    jotaiStore.set(clockFormatAtom, 'system');
    render(
      <RecoilRoot initializeState={({ set }) => set(store.lang, 'en-US')}>
        <JotaiProvider store={jotaiStore}>
          <Probe />
        </JotaiProvider>
      </RecoilRoot>,
    );
    expect(screen.getByTestId('hour12')).toHaveTextContent('true');

    await act(async () => {
      jotaiStore.set(clockFormatAtom, '24h');
    });
    expect(screen.getByTestId('hour12')).toHaveTextContent('false');
  });

  it('reacts to the interface language changing without a reload', async () => {
    function LangSwitchProbe() {
      const hour12 = useClockFormat();
      const setLang = useSetRecoilState(store.lang);
      return (
        <>
          <output data-testid="hour12">{String(hour12)}</output>
          <button onClick={() => setLang('en-US')}>{'switch to en-US'}</button>
        </>
      );
    }

    const jotaiStore = createStore();
    jotaiStore.set(clockFormatAtom, 'system');
    render(
      <RecoilRoot initializeState={({ set }) => set(store.lang, 'ru-RU')}>
        <JotaiProvider store={jotaiStore}>
          <LangSwitchProbe />
        </JotaiProvider>
      </RecoilRoot>,
    );
    expect(screen.getByTestId('hour12')).toHaveTextContent('false');

    await act(async () => {
      screen.getByRole('button').click();
    });
    expect(screen.getByTestId('hour12')).toHaveTextContent('true');
  });
});
