// ctx.jsx — AppProvider for the client web app: branding boot, session, view routing.
// Screen agents CONSUME this via useApp() — never edit it.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, clientAuth, mediaUrl, SALON_SLUG, useT, useToastHost } from '@youty/shared';
import { makeBrand } from './theme.js';

/* Il salone servito da questa pagina è il primo segmento del path
 * (`/the-parlour`). La risoluzione vive in @youty/shared perché serve anche a
 * clientAuth, che namespacizza la sessione per salone. Vedi shared/src/salon.js.
 * Ri-esportato qui: gli schermi lo importano da '../ctx.jsx'. */
export { SALON_SLUG };

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

const FALLBACK_BRAND_COLOR = '#7C4A57';

export function AppProvider({ children }) {
  const { t, lang, setLang } = useT();

  /* ---- white-label branding boot ---- */
  const [brand, setBrand] = useState(null);
  const [brandError, setBrandError] = useState(null);
  const loadBrand = useCallback(async () => {
    setBrandError(null);
    try {
      const b = await api.get('/api/core/public/branding', { params: { salon: SALON_SLUG }, auth: false });
      setBrand(makeBrand({
        color: b.brand_color || FALLBACK_BRAND_COLOR,
        name: b.name,
        slug: b.slug,
        logoUrl: b.logo_url ? mediaUrl(b.logo_url) : null,
        address: b.address || '',
        phone: b.phone || '',
        openingHours: b.opening_hours || '',
        privacyUrl: b.privacy_policy_url || '',
      }));
    } catch (err) {
      setBrandError(err?.message || 'Errore');
    }
  }, []);
  useEffect(() => { loadBrand(); }, [loadBrand]);

  /* ---- session ---- */
  const [session, setSession] = useState(clientAuth.getSession());
  useEffect(() => clientAuth.subscribe(setSession), []);
  const client = session?.client || null;

  /* ---- login overlay a richiesta (l'app non ha più un gate d'ingresso) ---- */
  const [authOpen, setAuthOpen] = useState(false);
  const authResume = useRef(null);
  const openAuth = useCallback((onDone) => { authResume.current = onDone || null; setAuthOpen(true); }, []);
  const closeAuth = useCallback(() => { authResume.current = null; setAuthOpen(false); }, []);
  // quando la sessione compare mentre l'overlay è aperto → riprendi e chiudi
  useEffect(() => {
    if (session && authOpen) {
      const cb = authResume.current;
      authResume.current = null;
      setAuthOpen(false);
      if (cb) cb();
    }
  }, [session, authOpen]);

  /* ---- toast ---- */
  const { fireToast, toastProps } = useToastHost();

  /* ---- view routing (state-based, like the prototype) ---- */
  const [view, setViewRaw] = useState('home');
  const [viewParams, setViewParams] = useState({});
  const setView = useCallback((v, params = {}) => {
    setViewRaw(v);
    setViewParams(params);
  }, []);

  const ctx = {
    t, lang, setLang,
    brand, reloadBrand: loadBrand, brandError,
    session, client,
    authOpen, openAuth, closeAuth,
    fireToast, toastProps,
    view, setView, viewParams,
  };

  return <AppCtx.Provider value={ctx}>{children}</AppCtx.Provider>;
}
