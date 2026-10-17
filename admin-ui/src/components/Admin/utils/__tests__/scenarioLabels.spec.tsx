import { renderHook } from '@testing-library/react';
import { useScenarioLabel } from '../scenarioLabels';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

describe('useScenarioLabel', () => {
  it('resolves each known scenario to its own locale key', () => {
    const { result } = renderHook(() => useScenarioLabel());
    expect(result.current('message')).toBe('com_admin_scenario_message');
    expect(result.current('title')).toBe('com_admin_scenario_title');
    expect(result.current('subagent')).toBe('com_admin_scenario_subagent');
    expect(result.current('reasoning')).toBe('com_admin_scenario_reasoning');
    expect(result.current('summarization')).toBe('com_admin_scenario_summarization');
    expect(result.current('sequential')).toBe('com_admin_scenario_sequential');
    expect(result.current('kb_index')).toBe('com_admin_scenario_kb_index');
    expect(result.current('kb_query')).toBe('com_admin_scenario_kb_query');
  });

  /**
   * Records written before `scenario` existed carry `''`. The admin should see the
   * ordinary "user request" label, not a blank cell.
   */
  it('treats an empty scenario as an ordinary user request, not a blank label', () => {
    const { result } = renderHook(() => useScenarioLabel());
    expect(result.current('')).toBe('com_admin_scenario_message');
  });

  /**
   * The backend can ship a new scenario before this map catches up — the admin must
   * still see what was actually recorded, not a generic label standing in for it.
   */
  it('shows an unrecognized scenario as-is, without falling back to the user-request label', () => {
    const { result } = renderHook(() => useScenarioLabel());
    expect(() => result.current('some-future-scenario')).not.toThrow();
    expect(result.current('some-future-scenario')).toBe('some-future-scenario');
  });
});
