// ctx.jsx — DashboardProvider: session, base catalogs from the API, navigation,
// modal/drawer/toast plumbing. Section agents CONSUME this via useDash() — never edit it.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, staffAuth, useT, useToastHost, usePortalAccess, PortalAccessProvider } from '@youty/shared';

const DashCtx = createContext(null);
export const useDash = () => useContext(DashCtx);

const OP_FALLBACK_PALETTE = ['#C9B8F2', '#B3DDF7', '#F7C5D9', '#FBE7A1', '#C2E8CB', '#FBD7B5', '#BFE9E1', '#C3CDF7', '#D2E5BE'];

export function DashboardProvider({ children }) {
  const { t, lang, setLang } = useT();

  /* ---- session ---- */
  const [session, setSession] = useState(staffAuth.getSession());
  useEffect(() => staffAuth.subscribe(setSession), []);
  const hasScope = useCallback((scope) => staffAuth.hasScope(scope), [session]);
  const { access: portalAccess, refresh: refreshPortalAccess, operationalAccess } = usePortalAccess({
    identity: `${session?.user?.id}:${session?.salon?.id}`, path: '/api/auth/portal-access', initial: session?.portal_access,
  });
  const canMutate = useCallback((scope) => operationalAccess && staffAuth.hasScope(scope), [operationalAccess, session]);

  /* ---- base data (loaded once, reloadable per collection) ---- */
  const [salon, setSalon] = useState(null);                       // SalonOut {id,name,slug,locations,settings,...}
  const [operators, setOperators] = useState([]);                 // [OperatorStatusOut]
  const [services, setServices] = useState([]);                   // [ServiceOut]
  const [serviceCategories, setServiceCategories] = useState([]); // [catalog CategoryOut]
  const [clientCategories, setClientCategories] = useState([]);   // [clients CategoryOut]
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState(null);

  const reload = useMemo(() => ({
    salon: () => api.get('/api/core/salon').then(setSalon),
    operators: () => api.get('/api/staff/').then(setOperators),
    services: () => api.get('/api/catalog/services').then(setServices),
    serviceCategories: () => api.get('/api/catalog/categories').then(setServiceCategories),
    clientCategories: () => api.get('/api/clients/categories').then(setClientCategories),
  }), []);

  const bootLoad = useCallback(async () => {
    setBooting(true);
    setBootError(null);
    try {
      await Promise.all([
        reload.salon(),
        reload.operators(),
        reload.serviceCategories(),
        reload.services(),
        reload.clientCategories(),
      ]);
    } catch (err) {
      setBootError(err?.message || 'Errore di caricamento');
    } finally {
      setBooting(false);
    }
  }, [reload]);

  useEffect(() => { bootLoad(); }, [bootLoad]);

  const settings = salon?.settings || null;
  const locations = salon?.locations || [];

  /* ---- navigation ---- */
  const [tab, setTabRaw] = useState('agenda');
  const [subTab, setSubTab] = useState(null);
  const setTab = useCallback((id, sub) => {
    setTabRaw(id);
    setSubTab(sub != null ? sub : null);
  }, []);

  /* ---- modal / drawer hosts ---- */
  const [modal, setModal] = useState(null);   // { name, props }
  const openModal = useCallback((name, props) => setModal({ name, props }), []);
  const closeModal = useCallback(() => setModal(null), []);
  const [drawer, setDrawer] = useState(null); // React element (rendered inside <DkDrawer>) or null

  /* ---- toast ---- */
  const { fireToast, toastProps } = useToastHost();

  /* ---- cross-section UI state ---- */
  const [search, setSearch] = useState('');
  const [selClient, setSelClient] = useState(null);   // client id for the Clienti profile
  const [deepLink, setDeepLink] = useState(null);     // e.g. 'log-today' (agenda cash-up → activity log)
  const [showRevenue, setShowRevenueRaw] = useState(() => {
    try { return localStorage.getItem('dk-show-revenue') !== '0'; } catch { return true; }
  });
  const setShowRevenue = useCallback((v) => {
    setShowRevenueRaw(v);
    try { localStorage.setItem('dk-show-revenue', v ? '1' : '0'); } catch { /* ignore */ }
  }, []);

  /* ---- operator colours: API color, overridable in state ---- */
  const [opColorOverrides, setOpColorOverrides] = useState({});
  const opColors = useMemo(() => {
    const m = {};
    operators.forEach((o, i) => {
      m[o.id] = opColorOverrides[o.id] || o.color || OP_FALLBACK_PALETTE[i % OP_FALLBACK_PALETTE.length];
    });
    return m;
  }, [operators, opColorOverrides]);
  const setOpColor = useCallback((id, c) => setOpColorOverrides((m) => ({ ...m, [id]: c })), []);

  const ctx = {
    t, lang, setLang,
    session, hasScope, canMutate, portalAccess, refreshPortalAccess, operationalAccess,
    salon, settings, locations,
    operators, services, serviceCategories, clientCategories,
    reload,
    tab, setTab, subTab, setSubTab,
    openModal, closeModal, modal,
    drawer, setDrawer,
    fireToast, toastProps,
    search, setSearch,
    selClient, setSelClient,
    deepLink, setDeepLink,
    showRevenue, setShowRevenue,
    opColors, setOpColor, opPalette: OP_FALLBACK_PALETTE,
  };

  if (booting) return <BootSkeleton />;
  if (bootError) return <BootError message={bootError} onRetry={bootLoad} t={t} />;

  return <PortalAccessProvider access={portalAccess} refresh={refreshPortalAccess}><DashCtx.Provider value={ctx}>{children}</DashCtx.Provider></PortalAccessProvider>;
}

/* ---- loading gate ---- */
function BootSkeleton() {
  return (
    <div className="dk-root" style={{ display: 'flex' }}>
      <aside className="dk-side" style={{ gap: 10 }}>
        <div className="skel" style={{ height: 30, width: 120, margin: '4px 10px 22px' }} />
        {[...Array(8)].map((_, i) => <div key={i} className="skel" style={{ height: 40, borderRadius: 12 }} />)}
      </aside>
      <div className="dk-main">
        <header className="dk-top">
          <div className="skel" style={{ height: 30, width: 220 }} />
          <div style={{ flex: 1 }} />
          <div className="skel" style={{ height: 42, width: 320, borderRadius: 999 }} />
        </header>
        <div className="dk-page">
          <div className="skel" style={{ height: 26, width: 280, marginBottom: 18 }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 22 }}>
            {[...Array(4)].map((_, i) => <div key={i} className="skel" style={{ height: 92, borderRadius: 16 }} />)}
          </div>
          <div className="skel" style={{ height: 380, borderRadius: 16 }} />
        </div>
      </div>
    </div>
  );
}

function BootError({ message, onRetry, t }) {
  return (
    <div className="dk-root" style={{ display: 'flex' }}>
      <div style={{ margin: 'auto', textAlign: 'center', maxWidth: 380 }}>
        <div className="t-title" style={{ marginBottom: 8 }}>{t('Errore di caricamento', 'Loading error')}</div>
        <div className="t-body" style={{ color: 'var(--muted)', marginBottom: 18 }}>{message}</div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button className="dk-btn dk-btn--clay" onClick={onRetry}>{t('Riprova', 'Retry')}</button>
          <button className="dk-btn dk-btn--ghost" onClick={() => staffAuth.logout()}>{t('Esci', 'Log out')}</button>
        </div>
      </div>
    </div>
  );
}
