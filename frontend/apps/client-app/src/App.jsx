import React, { useEffect } from 'react';
import { LangProvider, Toast } from '@youty/shared';
import { AppProvider, useApp } from './ctx.jsx';
import { brandVars } from './theme.js';
import { SCREENS } from './screens/registry.js';
import AuthFlow from './screens/auth/AuthFlow.jsx';
import NavBar, { NAV_VIEWS } from './NavBar.jsx';
import Utility from './Utility.jsx';
import Hook from './screens/Hook.jsx';

/* Il primo segmento del path è lo slug del salone (vedi shared/salon.js), il
 * secondo sceglie la pagina: /<slug> è l'app, /<slug>/hook il form contatti.
 * Letto una volta sola: l'app non naviga via URL. */
const PAGE = window.location.pathname.split('/').filter(Boolean)[1] || '';

export default function App() {
  return (
    <LangProvider>
      <AppProvider>
        <Root />
      </AppProvider>
    </LangProvider>
  );
}

function Root() {
  const { t, brand, brandError, reloadBrand, session, view, toastProps, authOpen, openAuth, closeAuth, setView } = useApp();

  const PERSONAL_VIEWS = ['prenotazioni', 'wallet', 'profilo', 'waitlist', 'waitlist-new', 'sposta', 'annulla', 'giftcard'];
  const gated = !session && PERSONAL_VIEWS.includes(view);
  useEffect(() => { if (gated) { openAuth(); setView('home'); } }, [gated]); // eslint-disable-line react-hooks/exhaustive-deps

  /* branding boot gate */
  if (!brand) {
    return (
      <div className="app-viewport">
        <div className="app-frame" style={{ alignItems: 'center', justifyContent: 'center', gap: 16, padding: 30 }}>
          {brandError ? (
            <React.Fragment>
              <div className="t-h3" style={{ textAlign: 'center' }}>{t('Impossibile caricare il salone', 'Could not load the salon')}</div>
              <div className="t-sm" style={{ color: 'var(--muted)', textAlign: 'center' }}>{brandError}</div>
              <button className="btn btn--primary press" onClick={reloadBrand}>{t('Riprova', 'Retry')}</button>
            </React.Fragment>
          ) : (
            <React.Fragment>
              <div className="skel" style={{ width: 72, height: 72, borderRadius: 99 }} />
              <div className="skel" style={{ width: 160, height: 20 }} />
            </React.Fragment>
          )}
        </div>
      </div>
    );
  }

  const vars = brandVars(brand);

  /* Form pubblico: niente shell, niente navbar, niente gate di sessione. */
  if (PAGE === 'hook') {
    return (
      <div className="app-viewport">
        <div className="app-frame" style={{ ...vars, fontFamily: 'var(--sans)' }}>
          <div className="scroll" style={{ flex: 1, minHeight: 0, background: 'var(--paper-0)' }}>
            <Hook />
          </div>
          <Toast {...toastProps} />
        </div>
      </div>
    );
  }

  const Screen = SCREENS[view] || SCREENS.home;
  const showNav = NAV_VIEWS.includes(view);

  return (
    <div className="app-viewport">
      <div className="app-frame" style={{ ...vars, fontFamily: 'var(--sans)' }}>
        <div className="scroll" style={{ flex: 1, minHeight: 0, background: 'var(--paper-0)' }}>
          <div style={{ minHeight: '100%', paddingBottom: showNav ? 'calc(var(--safe-bottom) + 78px)' : 0 }}>
            <Screen />
          </div>
        </div>
        {showNav && <Utility />}
        {showNav && <NavBar />}
        {authOpen && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 200, background: 'var(--paper-0)', display: 'flex', flexDirection: 'column' }}>
            <AuthFlow onClose={closeAuth} />
          </div>
        )}
        <Toast {...toastProps} />
      </div>
    </div>
  );
}
