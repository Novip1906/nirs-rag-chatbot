import { renderHook, act } from '@testing-library/react';
import { useOverrideDraft } from '../override';

describe('useOverrideDraft', () => {
  it('starts off and shows inherited values when nothing personal is saved', () => {
    const { result } = renderHook(() => useOverrideDraft<number[]>(null, [1, 2], 'user-1'));

    expect(result.current.enabled).toBe(false);
    expect(result.current.value).toEqual([1, 2]);
    expect(result.current.payload).toBeNull();
    expect(result.current.touched).toBe(false);
  });

  it('starts on and shows the saved personal values', () => {
    const { result } = renderHook(() => useOverrideDraft<number[]>([9], [1, 2], 'user-1'));

    expect(result.current.enabled).toBe(true);
    expect(result.current.value).toEqual([9]);
    expect(result.current.payload).toEqual([9]);
  });

  it('carries the inherited values into the fields on the first switch-on', () => {
    const { result } = renderHook(() => useOverrideDraft<number[]>(null, [1, 2], 'user-1'));

    act(() => result.current.setEnabled(true));

    expect(result.current.value).toEqual([1, 2]);
    expect(result.current.payload).toEqual([1, 2]);
  });

  /** Ровно тот кейс, ради которого черновик и живёт: правку нельзя терять на тумблере. */
  it('remembers edits across an off/on round trip', () => {
    const { result } = renderHook(() => useOverrideDraft<number[]>([9], [1, 2], 'user-1'));

    act(() => result.current.setValue([7, 8]));
    act(() => result.current.setEnabled(false));

    expect(result.current.value).toEqual([1, 2]);
    expect(result.current.payload).toBeNull();

    act(() => result.current.setEnabled(true));

    expect(result.current.value).toEqual([7, 8]);
    expect(result.current.payload).toEqual([7, 8]);
  });

  it('previews the department values while the switch is off', () => {
    const { rerender, result } = renderHook(
      ({ inherited }: { inherited: number[] }) =>
        useOverrideDraft<number[]>(null, inherited, 'user-1'),
      { initialProps: { inherited: [1, 2] } },
    );

    rerender({ inherited: [3, 4] });

    expect(result.current.value).toEqual([3, 4]);
  });

  /** Личный набор на то и личный: сменившийся отдел его не переписывает. */
  it('keeps personal values when the department changes while the switch is on', () => {
    const { rerender, result } = renderHook(
      ({ inherited }: { inherited: number[] }) =>
        useOverrideDraft<number[]>([9], inherited, 'user-1'),
      { initialProps: { inherited: [1, 2] } },
    );

    rerender({ inherited: [3, 4] });

    expect(result.current.value).toEqual([9]);
  });

  it('marks the section as touched only once the admin acts on it', () => {
    const { result } = renderHook(() => useOverrideDraft<number[]>(null, [1, 2], 'user-1'));

    expect(result.current.touched).toBe(false);
    act(() => result.current.setEnabled(true));
    expect(result.current.touched).toBe(true);
  });

  /**
   * Синхронизация идёт по идентификатору записи, а не по самим значениям: `saved`
   * приходит новым литералом на каждый рендер, и слежение за ним зациклило бы хук.
   */
  it('re-syncs when a different user is loaded', () => {
    const { rerender, result } = renderHook(
      ({ saved, resetKey }: { saved: number[] | null; resetKey: string }) =>
        useOverrideDraft<number[]>(saved, [1, 2], resetKey),
      { initialProps: { saved: null as number[] | null, resetKey: 'user-1' } },
    );

    act(() => result.current.setEnabled(true));
    expect(result.current.touched).toBe(true);

    rerender({ saved: [5], resetKey: 'user-2' });

    expect(result.current.enabled).toBe(true);
    expect(result.current.value).toEqual([5]);
    expect(result.current.touched).toBe(false);
  });

  /**
   * Баг: `useAdminUserQuery` отвечает не сразу, поэтому на первом рендере `saved` — `null`
   * (данные ещё не пришли), хотя `resetKey` (id из маршрута) уже известен и не меняется,
   * когда запрос наконец отвечает. Форма открывалась с личным лимитом $5, но тумблер
   * оставался выключенным, а поле — пустым: эффект синхронизации срабатывал один раз,
   * пока `saved` было `null`, и больше не перезапускался.
   */
  it('picks up the saved value once the query resolves, for the same record', () => {
    const { rerender, result } = renderHook(
      ({ saved }: { saved: number[] | null }) =>
        useOverrideDraft<number[]>(saved, [1, 2], 'user-1'),
      { initialProps: { saved: null as number[] | null } },
    );

    expect(result.current.enabled).toBe(false);
    expect(result.current.value).toEqual([1, 2]);

    rerender({ saved: [5] });

    expect(result.current.enabled).toBe(true);
    expect(result.current.value).toEqual([5]);
    expect(result.current.payload).toEqual([5]);
  });

  it('does not reset the draft when the same user re-renders', () => {
    const { rerender, result } = renderHook(
      ({ saved }: { saved: number[] | null }) =>
        useOverrideDraft<number[]>(saved, [1, 2], 'user-1'),
      { initialProps: { saved: [9] as number[] | null } },
    );

    act(() => result.current.setValue([7]));
    rerender({ saved: [9] });

    expect(result.current.value).toEqual([7]);
  });
});
