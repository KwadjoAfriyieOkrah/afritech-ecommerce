'use client';

import { useEffect } from 'react';
import { clearAuthToken, fetchCurrentUser, getAuthToken } from '@/services/api';
import { isMockApiEnabled } from '@/services/mockApi';
import { useUserStore } from '@/store';

/**
 * Restores the signed-in user from the HttpOnly cookie on first paint.
 * Mock mode keeps its browser-local token. Renders nothing.
 */
export function SessionLoader() {
  const setUser = useUserStore((state) => state.setUser);
  const setSessionReady = useUserStore((state) => state.setSessionReady);

  useEffect(() => {
    let cancelled = false;
    const mockMode = isMockApiEnabled();

    if (!mockMode) clearAuthToken();
    if (mockMode && !getAuthToken()) {
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
