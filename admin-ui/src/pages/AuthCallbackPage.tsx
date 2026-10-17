import { useEffect, useRef, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Spinner } from '@librechat/client';
import { useAuthContext } from '~/hooks';
import { consumeState, consumeVerifier } from '~/auth/pkce';
import { clearSessionActive, consumeSilentTarget } from '~/auth/silentSession';

type Status = 'pending' | 'success' | 'failure';

const DEFAULT_TARGET = '/admin';

export default function AuthCallbackPage(): JSX.Element {
  const [searchParams] = useSearchParams();
  const { completeLogin } = useAuthContext();
  const [status, setStatus] = useState<Status>('pending');
  const [target, setTarget] = useState<string>(DEFAULT_TARGET);
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) {
      return;
    }
    attempted.current = true;

    // Consumed unconditionally: whether this callback succeeds or fails, the stored
    // target belongs to this one round trip and must not leak into a later attempt.
    const restoredTarget = consumeSilentTarget();

    const expectedState = consumeState();

    const errorParam = searchParams.get('error');
    if (errorParam) {
      consumeVerifier();
      clearSessionActive();
      setStatus('failure');
      return;
    }

    const code = searchParams.get('code');
    if (!code) {
      consumeVerifier();
      clearSessionActive();
      setStatus('failure');
      return;
    }

    if (expectedState == null || searchParams.get('state') !== expectedState) {
      consumeVerifier();
      clearSessionActive();
      setStatus('failure');
      return;
    }

    completeLogin(code).then((ok) => {
      if (ok) {
        setTarget(restoredTarget ?? DEFAULT_TARGET);
      }
      setStatus(ok ? 'success' : 'failure');
    });
  }, [searchParams, completeLogin]);

  if (status === 'success') {
    return <Navigate to={target} replace={true} />;
  }

  if (status === 'failure') {
    const errorParam = searchParams.get('error') ?? 'exchange_failed';
    const description = searchParams.get('error_description') ?? '';
    return (
      <Navigate
        to={`/login?error=${encodeURIComponent(errorParam)}&error_description=${encodeURIComponent(description)}`}
        replace={true}
      />
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-primary">
      <Spinner className="size-6 text-text-secondary" />
    </div>
  );
}
