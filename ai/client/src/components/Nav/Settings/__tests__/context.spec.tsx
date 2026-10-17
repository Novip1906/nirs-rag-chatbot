import React from 'react';
import { RecoilRoot } from 'recoil';
import { renderHook } from '@testing-library/react';
import { SettingsTabValues } from 'librechat-data-provider';
import { useSettingsContext } from '../context';
import { TABS } from '../types';

type InterfaceFlags = { speechToText?: boolean; textToSpeech?: boolean };

let mockInterface: InterfaceFlags = {};
let mockSpeechConfig: { sttExternal?: boolean } | undefined;

jest.mock('~/hooks', () => ({
  useAuthContext: () => ({ user: { provider: 'openid', twoFactorEnabled: false } }),
  useGetAgentsConfig: () => ({ agentsConfig: undefined }),
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: { interface: mockInterface } }),
}));

jest.mock('librechat-data-provider/react-query', () => ({
  useGetCustomConfigSpeechQuery: () => ({ data: mockSpeechConfig }),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <RecoilRoot>{children}</RecoilRoot>
);

const renderContext = () => renderHook(() => useSettingsContext(), { wrapper }).result.current;

const speechTab = TABS.find((tab) => tab.id === SettingsTabValues.SPEECH);

describe('useSettingsContext: настройки распознавания речи', () => {
  beforeEach(() => {
    mockInterface = {};
    mockSpeechConfig = undefined;
  });

  it('прячет настройки распознавания и вкладку «Речь», когда речь распознаёт сервер', () => {
    mockInterface = { speechToText: true, textToSpeech: false };
    mockSpeechConfig = { sttExternal: true };

    const ctx = renderContext();

    expect(ctx.speechToTextEnabled).toBe(false);
    expect(speechTab?.show?.(ctx)).toBe(false);
  });

  it('оставляет настройки распознавания, когда сервер речь не распознаёт', () => {
    mockInterface = { speechToText: true };
    mockSpeechConfig = { sttExternal: false };

    expect(renderContext().speechToTextEnabled).toBe(true);
  });

  it('прячет настройки распознавания по админскому выключателю', () => {
    mockInterface = { speechToText: false };
    mockSpeechConfig = { sttExternal: false };

    expect(renderContext().speechToTextEnabled).toBe(false);
  });
});

describe('useSettingsContext: язык диктовки', () => {
  beforeEach(() => {
    mockInterface = {};
    mockSpeechConfig = undefined;
  });

  it('видна при серверном распознавании', () => {
    mockInterface = { speechToText: true };
    mockSpeechConfig = { sttExternal: true };

    expect(renderContext().dictationEnabled).toBe(true);
  });

  it('скрыта без серверного распознавания', () => {
    mockInterface = { speechToText: true };
    mockSpeechConfig = { sttExternal: false };

    expect(renderContext().dictationEnabled).toBe(false);
  });

  it('скрыта при админском выключателе speechToText false', () => {
    mockInterface = { speechToText: false };
    mockSpeechConfig = { sttExternal: true };

    expect(renderContext().dictationEnabled).toBe(false);
  });

  it('скрыта, когда диктовка недоступна', () => {
    mockInterface = {};
    mockSpeechConfig = undefined;

    expect(renderContext().dictationEnabled).toBe(false);
  });
});
