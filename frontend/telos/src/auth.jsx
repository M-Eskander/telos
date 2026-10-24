import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { api, setUnauthorizedHandler } from './api.js';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  // Tracks whether a real session existed, so the initial "not signed in"
  // response is never reported as an expired session.
  const userRef = useRef(null);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (userRef.current) setSessionExpired(true);
      userRef.current = null;
      setUser(null);
    });
    api('/auth/me')
      .then((r) => {
        userRef.current = r.user;
        setUser(r.user);
      })
      .catch(() => {
        userRef.current = null;
        setUser(null);
      })
      .finally(() => setReady(true));
  }, []);

  const login = useCallback(async (email, password) => {
    const r = await api('/auth/login', { method: 'POST', body: { email, password } });
    setSessionExpired(false);
    userRef.current = r.user;
    setUser(r.user);
  }, []);

  const logout = useCallback(async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* clear anyway */ }
    setSessionExpired(false);
    userRef.current = null;
    setUser(null);
  }, []);

  return (
    <Ctx.Provider value={{ user, ready, login, logout, sessionExpired }}>
      {children}
    </Ctx.Provider>
  );
}
