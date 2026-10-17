import { useMemo } from 'react';
import { useRecoilValue } from 'recoil';
import { AgentCapabilities } from 'librechat-data-provider';
import { useGetCustomConfigSpeechQuery } from 'librechat-data-provider/react-query';
import type { SettingsContextValue } from './types';
import { useAuthContext, useGetAgentsConfig } from '~/hooks';
import { useGetStartupConfig } from '~/data-provider';
import store from '~/store';

export function useSettingsContext(): SettingsContextValue {
  const { user } = useAuthContext();
  const { data: startupConfig } = useGetStartupConfig();
  const { data: speechConfig } = useGetCustomConfigSpeechQuery({ enabled: false });
  const { agentsConfig } = useGetAgentsConfig();

  const balanceEnabled = startupConfig?.balance?.enabled === true;
  const adminPanelURL = startupConfig?.adminPanelURL ?? '';
  const isLocalProvider = user?.provider === 'local';
  const twoFactorEnabled = user?.twoFactorEnabled === true;
  const aboutEnabled = startupConfig?.interface?.buildInfo !== false;
  const serverTranscribes = speechConfig?.sttExternal != null && !!speechConfig.sttExternal;
  const speechToTextAllowed = startupConfig?.interface?.speechToText !== false;
  const speechToTextEnabled = speechToTextAllowed && !serverTranscribes;
  const dictationEnabled = speechToTextAllowed && serverTranscribes;
  const textToSpeechEnabled = startupConfig?.interface?.textToSpeech !== false;
  const engineTTS = useRecoilValue<string>(store.engineTTS);
  const hasStatefulCodeSessions =
    agentsConfig?.capabilities.includes(AgentCapabilities.stateful_code_sessions) ?? false;

  return useMemo(
    () => ({
      balanceEnabled,
      hasStatefulCodeSessions,
      isLocalProvider,
      twoFactorEnabled,
      aboutEnabled,
      speechToTextEnabled,
      dictationEnabled,
      textToSpeechEnabled,
      engineTTS,
      adminPanelURL,
    }),
    [
      balanceEnabled,
      hasStatefulCodeSessions,
      isLocalProvider,
      twoFactorEnabled,
      aboutEnabled,
      speechToTextEnabled,
      dictationEnabled,
      textToSpeechEnabled,
      engineTTS,
      adminPanelURL,
    ],
  );
}
