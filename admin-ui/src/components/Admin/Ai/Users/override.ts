import { useCallback, useEffect, useRef, useState } from 'react';

export interface OverrideDraft<T> {
  /** Включён ли личный набор. */
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  /** Что показывать в полях: унаследованное при выключенном тумблере, личное при включённом. */
  value: T;
  setValue: (value: T) => void;
  /** Личное значение для отправки, `null` — наследовать. */
  payload: T | null;
  touched: boolean;
}

/**
 * Переключатель «личный набор» с памятью на время жизни экрана.
 *
 * Поля видны всегда: при выключенном тумблере они показывают унаследованное от отдела и
 * не редактируются, при включённом — личное. Выключение не стирает введённое: черновик
 * остаётся в памяти, и повторное включение возвращает те же значения, которые админ
 * только что набрал. Так переключатель работает как предпросмотр — видно, что именно
 * сохранится в каждом из двух состояний.
 *
 * Первое в жизни включение стартует с унаследованных значений, а не с пустых: поля уже
 * были на экране, и обнулять их в момент включения значило бы терять то, что админ
 * видел. Плата за это — набор перестаёт следовать за отделом с момента включения; это
 * ровно то, чем личный набор и является.
 *
 * `resetKey` — идентификатор загруженной записи, а не сами значения: `saved` приходит
 * литералом, новым на каждый рендер, и синхронизация по нему зациклила бы обновления.
 *
 * Сам `resetKey` не меняется между первым рендером (запрос ещё летит, `saved === null`)
 * и рендером с загруженными данными — `id` из маршрута один и тот же. Поэтому в
 * зависимости эффекта добавлен признак «данные уже пришли»: без него черновик синхронизуется
 * один раз, пока `saved` ещё `null`, и застревает выключенным даже после того, как реальный
 * личный набор пришёл с сервера.
 */
export function useOverrideDraft<T>(
  saved: T | null,
  inherited: T,
  resetKey: string,
  version?: number,
): OverrideDraft<T> {
  const [enabled, setEnabledState] = useState(saved != null);
  const [draft, setDraft] = useState<T | null>(saved);
  const [touched, setTouched] = useState(false);
  const savedRef = useRef(saved);
  savedRef.current = saved;

  const touchedRef = useRef(false);
  touchedRef.current = touched;
  const previousResetKeyRef = useRef(resetKey);

  useEffect(() => {
    const resetKeyChanged = previousResetKeyRef.current !== resetKey;
    previousResetKeyRef.current = resetKey;
    if (!resetKeyChanged && touchedRef.current) {
      return;
    }
    setEnabledState(savedRef.current != null);
    setDraft(savedRef.current);
    setTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- saved itself must stay out, see comment above
  }, [resetKey, saved != null, version]);

  const setEnabled = useCallback(
    (next: boolean) => {
      setEnabledState(next);
      setTouched(true);
      if (next) {
        setDraft((current) => current ?? inherited);
      }
    },
    [inherited],
  );

  const setValue = useCallback((next: T) => {
    setDraft(next);
    setTouched(true);
  }, []);

  const value = enabled ? (draft ?? inherited) : inherited;

  return {
    enabled,
    setEnabled,
    value,
    setValue,
    payload: enabled ? value : null,
    touched,
  };
}
