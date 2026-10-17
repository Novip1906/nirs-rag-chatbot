import { useCallback } from 'react';
import type { TranslationKeys } from '~/hooks/useLocalize';
import { useLocalize } from '~/hooks';

const SCENARIO_LABEL_KEY: Record<string, TranslationKeys> = {
  message: 'com_admin_scenario_message',
  title: 'com_admin_scenario_title',
  subagent: 'com_admin_scenario_subagent',
  reasoning: 'com_admin_scenario_reasoning',
  summarization: 'com_admin_scenario_summarization',
  sequential: 'com_admin_scenario_sequential',
  kb_index: 'com_admin_scenario_kb_index',
  kb_query: 'com_admin_scenario_kb_query',
  image_gen: 'com_admin_scenario_image_gen',
};

export function useScenarioLabel(): (scenario: string) => string {
  const localize = useLocalize();
  return useCallback(
    (scenario: string) => {
      if (scenario === '') {
        return localize('com_admin_scenario_message');
      }
      const labelKey = SCENARIO_LABEL_KEY[scenario];
      /** An unrecognized scenario isn't necessarily bad data — the backend can ship new
       *  ones before this map catches up. Show it as-is rather than hiding it behind
       *  the generic label, so the admin can still see what was actually recorded. */
      return labelKey ? localize(labelKey) : scenario;
    },
    [localize],
  );
}
