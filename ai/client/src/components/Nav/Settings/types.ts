import { createElement } from 'react';
import { MessageSquare, Info } from 'lucide-react';
import { SettingsTabValues } from 'librechat-data-provider';
import { GearIcon, DataIcon, UserIcon, SpeechIcon } from '@librechat/client';
import type { ComponentType, ReactNode } from 'react';
import type { TranslationKeys } from '~/hooks';

export type SettingsTab =
  | SettingsTabValues.GENERAL
  | SettingsTabValues.CHAT
  | SettingsTabValues.SPEECH
  | SettingsTabValues.DATA
  | SettingsTabValues.ACCOUNT
  | SettingsTabValues.ABOUT;

export type SectionId =
  | 'appearance'
  | 'layout'
  | 'accessibility'
  | 'admin'
  | 'sending'
  | 'messages'
  | 'conversations'
  | 'stt'
  | 'tts'
  | 'codeExecution'
  | 'data'
  | 'danger'
  | 'profile'
  | 'security'
  | 'billing'
  | 'about';

export interface SettingsContextValue {
  balanceEnabled: boolean;
  hasStatefulCodeSessions: boolean;
  isLocalProvider: boolean;
  twoFactorEnabled: boolean;
  aboutEnabled: boolean;
  speechToTextEnabled: boolean;
  dictationEnabled: boolean;
  textToSpeechEnabled: boolean;
  engineTTS: string;
  adminPanelURL: string;
}

export interface SettingEntry {
  id: string;
  tab: SettingsTab;
  section: SectionId;
  labelKey: TranslationKeys;
  keywords?: string[];
  Component: ComponentType;
  show?: (ctx: SettingsContextValue) => boolean;
}

export interface SectionMeta {
  id: SectionId;
  labelKey: TranslationKeys;
  icon?: ReactNode;
  danger?: boolean;
}

export interface TabMeta {
  id: SettingsTab;
  labelKey: TranslationKeys;
  icon: ReactNode;
  sections: SectionMeta[];
  show?: (ctx: SettingsContextValue) => boolean;
}

export const TABS: TabMeta[] = [
  {
    id: SettingsTabValues.GENERAL,
    labelKey: 'com_nav_setting_general',
    icon: createElement(GearIcon),
    sections: [
      { id: 'appearance', labelKey: 'com_ui_settings_section_appearance' },
      { id: 'layout', labelKey: 'com_ui_settings_section_layout' },
      { id: 'accessibility', labelKey: 'com_ui_settings_section_accessibility' },
      { id: 'admin', labelKey: 'com_ui_settings_section_admin' },
    ],
  },
  {
    id: SettingsTabValues.CHAT,
    labelKey: 'com_nav_setting_chat',
    icon: createElement(MessageSquare, { className: 'icon-sm', 'aria-hidden': true }),
    sections: [
      { id: 'sending', labelKey: 'com_ui_settings_section_sending' },
      { id: 'messages', labelKey: 'com_ui_settings_section_messages' },
      { id: 'conversations', labelKey: 'com_ui_settings_section_conversations' },
    ],
  },
  {
    id: SettingsTabValues.SPEECH,
    labelKey: 'com_nav_setting_speech',
    icon: createElement(SpeechIcon, { className: 'icon-sm' }),
    sections: [
      { id: 'stt', labelKey: 'com_ui_settings_section_stt' },
      { id: 'tts', labelKey: 'com_ui_settings_section_tts' },
    ],
    show: (ctx) => ctx.speechToTextEnabled || ctx.textToSpeechEnabled,
  },
  {
    id: SettingsTabValues.DATA,
    labelKey: 'com_ui_settings_tab_data',
    icon: createElement(DataIcon),
    sections: [
      { id: 'codeExecution', labelKey: 'com_ui_settings_section_code_execution' },
      { id: 'data', labelKey: 'com_ui_settings_section_data' },
      { id: 'danger', labelKey: 'com_ui_settings_section_danger_zone', danger: true },
    ],
  },
  {
    id: SettingsTabValues.ACCOUNT,
    labelKey: 'com_nav_setting_account',
    icon: createElement(UserIcon),
    sections: [
      { id: 'profile', labelKey: 'com_ui_settings_section_profile' },
      { id: 'security', labelKey: 'com_ui_settings_section_security' },
      { id: 'billing', labelKey: 'com_ui_settings_section_billing' },
    ],
  },
  {
    id: SettingsTabValues.ABOUT,
    labelKey: 'com_nav_setting_about',
    icon: createElement(Info, { className: 'icon-sm', 'aria-hidden': true }),
    sections: [{ id: 'about', labelKey: 'com_nav_setting_about' }],
    show: (ctx) => ctx.aboutEnabled,
  },
];
