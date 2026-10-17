import { isValidElementType } from 'react-is';
import { SettingsTabValues } from 'librechat-data-provider';
import type { SettingsContextValue } from '../types';
import en from '~/locales/en/translation.json';
import { registry } from '../registry';
import { TABS } from '../types';

const validTabSections = new Map(TABS.map((t) => [t.id, new Set(t.sections.map((s) => s.id))]));

const settingsContext: SettingsContextValue = {
  balanceEnabled: false,
  hasStatefulCodeSessions: false,
  isLocalProvider: true,
  twoFactorEnabled: false,
  aboutEnabled: false,
  speechToTextEnabled: true,
  dictationEnabled: true,
  textToSpeechEnabled: true,
  engineTTS: 'browser',
  adminPanelURL: '',
};

describe('settings registry', () => {
  it('has unique ids', () => {
    const ids = registry.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('references a valid tab and section for every entry', () => {
    for (const entry of registry) {
      const sections = validTabSections.get(entry.tab);
      expect(sections).toBeDefined();
      expect(sections!.has(entry.section)).toBe(true);
    }
  });

  it('uses label keys that exist in the English locale', () => {
    for (const entry of registry) {
      expect(en).toHaveProperty(entry.labelKey);
    }
  });

  it('has a renderable Component for every entry', () => {
    for (const entry of registry) {
      expect(isValidElementType(entry.Component)).toBe(true);
    }
  });

  /**
   * Переключатели речи хранятся в браузере, поэтому у того, кто заходил раньше,
   * они остаются включёнными. Админский выключатель обязан убирать сами записи,
   * иначе настройка остаётся доступной несмотря на запрет.
   */
  describe('admin speech switches', () => {
    const sttEntries = registry.filter((entry) => entry.section === 'stt');
    const ttsEntries = registry.filter((entry) => entry.section === 'tts');

    const visible = (entries: typeof registry, ctx: SettingsContextValue) =>
      entries.filter((entry) => !entry.show || entry.show(ctx));

    it('hides every speech-to-text setting when the admin turns it off', () => {
      expect(sttEntries.length).toBeGreaterThan(0);
      expect(visible(sttEntries, settingsContext)).toHaveLength(sttEntries.length);
      expect(visible(sttEntries, { ...settingsContext, speechToTextEnabled: false })).toHaveLength(
        0,
      );
    });

    it('hides every text-to-speech setting when the admin turns it off', () => {
      expect(ttsEntries.length).toBeGreaterThan(0);
      expect(visible(ttsEntries, { ...settingsContext, textToSpeechEnabled: false })).toHaveLength(
        0,
      );
    });

    it('keeps text-to-speech settings when only speech-to-text is off', () => {
      const ctx = { ...settingsContext, speechToTextEnabled: false };
      expect(visible(ttsEntries, ctx).length).toBeGreaterThan(0);
    });
  });

  it('registers no Langfuse or API key settings', () => {
    const removed = ['langfuseConnection', 'providerApiKeys', 'agentApiKeys', 'revokeKeys'];
    for (const id of removed) {
      expect(registry.find((entry) => entry.id === id)).toBeUndefined();
    }
  });

  describe('stateful workspace default visibility', () => {
    const entry = registry.find((setting) => setting.id === 'defaultStatefulWorkspace');

    it('shows the setting when stateful code sessions are available', () => {
      expect(entry?.show?.({ ...settingsContext, hasStatefulCodeSessions: true })).toBe(true);
    });

    it('hides the setting when stateful code sessions are unavailable', () => {
      expect(entry?.show?.({ ...settingsContext, hasStatefulCodeSessions: false })).toBe(false);
    });
  });

  it('не содержит записей, убранных из корпоративной сборки', () => {
    const removedIds = [
      'atCommand',
      'plusCommand',
      'slashCommand',
      'advancedPrompts',
      'alwaysMakeProd',
      'autoSendPrompts',
      'forkSettings',
      'referenceSavedMemories',
      'importConversations',
      'sharedLinks',
      'manageFiles',
      'deleteCache',
      'deleteAccount',
    ];
    const present = registry.filter((entry) => removedIds.includes(entry.id));
    expect(present.map((entry) => entry.id)).toEqual([]);
  });

  it('не объявляет секций без единой записи', () => {
    const orphans = TABS.flatMap((tab) =>
      tab.sections
        .filter(
          (section) =>
            !registry.some((entry) => entry.tab === tab.id && entry.section === section.id),
        )
        .map((section) => `${tab.id}/${section.id}`),
    );
    expect(orphans).toEqual([]);
  });

  it('сохраняет то, что должно остаться', () => {
    const ids = new Set(registry.map((entry) => entry.id));
    expect(ids.has('archiveAllChats')).toBe(true);
    expect(ids.has('clearChats')).toBe(true);
    expect(ids.has('avatar')).toBe(true);
    expect(
      registry.some(
        (entry) => entry.tab === SettingsTabValues.ACCOUNT && entry.section === 'danger',
      ),
    ).toBe(false);
  });
});
