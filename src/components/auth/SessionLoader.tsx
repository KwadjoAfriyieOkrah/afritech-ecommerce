'use client';

import { useEffect } from 'react';
import { clearAuthToken, fetchCurrentUser, getAuthToken } from '@/services/api';
import { useUserStore } from '@/store';

/**
 * Restores the signed-in user on first paint. The token lives in
 * localStorage, so without this every reload would look like a sign-out
 * even though the token is still there. Renders nothing.
 */
export function SessionLoader() {
  const setUser = useUserStore((state) => state.setUser);
  const setSessionReady = useUserStore((state) => state.setSessionReady);

  useEffect(() => {
    let cancelled = false;

    if (!getAuthToken()) {
      setSessionReady(true);
      return;
    }

    void (async () => {
      try {
        const user = await fetchCurrentUser();
        if (!cancelled) setUser(user);
      } catch {
        // Rejected or unreachable token: treat the visitor as signed out.
        clearAuthToken();
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setSessionReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setUser, setSessionReady]);

  return null;
}
