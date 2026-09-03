// OAuthPopup.jsx — standalone popup page for the Yourang OAuth flow.
// Rendered outside the dashboard shell (main.jsx branches on the pathname).
//   /oauth-popup/start?mode=login|connect → get authorize URL, redirect there
//   /oauth-popup/done                      → exchange the code, notify opener, close
// Two modes:
//   login   → from the login page (no session): backend provisions/links a salon
//             and returns a staff session; opener applies it and enters the app.
//   connect → from settings (logged in): backend links the current salon.
// Same origin as the opener → api carries the staff Bearer (connect), and
// postMessage targets window.location.origin.
import React, { useEffect, useState } from 'react';
import { api, staffAuth, useT } from '@youty/shared';

const START = {
  login: '/api/integrations/yourang/oauth/login/start',
  connect: '/api/integrations/yourang/oauth/start',
};

export default function OAuthPopup({ path }) {
  const { t } = useT();
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const notify = (msg) => {
      if (window.opener) window.opener.postMessage(msg, window.location.origin);
    };

    (async () => {
      try {
        if (path === '/oauth-popup/start') {
          const mode = new URLSearchParams(window.location.search).get('mode') === 'login'
            ? 'login' : 'connect';
          const res = await api.get(START[mode]);
          window.location.replace(res.authorize_url);
          return;
        }
        // /oauth-popup/done — the proxy redirected back with ?yr_link (and the
        // ?mode we asked it to carry, since there is no local state row now).
        const params = new URLSearchParams(window.location.search);
        const err = params.get('error');
        if (err) throw new Error(err);
        const code = params.get('yr_link');
        const mode = params.get('mode') === 'login' ? 'login' : 'connect';
        if (!code) throw new Error('missing yr_link');
        const res = await api.post('/api/integrations/yourang/oauth/exchange', { code, mode });
        // Nessun opener = flow aperto dalla scorciatoia nella sidebar di Yourang,
        // in una tab normale. window.close() non funziona su una finestra non
        // aperta da script e resteremmo sullo spinner: applichiamo qui la
        // sessione (stessa origin, localStorage) ed entriamo nell'app.
        if (!window.opener || window.opener === window) {
          if (res.mode === 'login' && res.session) staffAuth.applySession(res.session);
          window.location.replace('/');
          return;
        }
        notify({ type: 'yourang-oauth', ok: true, mode: res.mode, session: res.session });
        window.close();
      } catch (e) {
        if (cancelled) return;
        const message = String(e?.message || e);
        setError(message);
        notify({ type: 'yourang-oauth', ok: false, error: message });
      }
    })();

    return () => { cancelled = true; };
  }, [path]);

  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100vh', fontFamily: 'system-ui, sans-serif', padding: 24, textAlign: 'center' }}>
      {error ? (
        <div>
          <p style={{ fontWeight: 600 }}>{t('Connessione a Yourang non riuscita', 'Yourang connection failed')}</p>
          <p style={{ color: '#888', fontSize: 13 }}>{error}</p>
          {/* Senza opener close() è bloccato: il bottone deve riportare al login. */}
          <button
            onClick={() => (window.opener ? window.close() : window.location.replace('/'))}
            style={{ marginTop: 12 }}
          >
            {window.opener ? t('Chiudi', 'Close') : t('Torna al login', 'Back to sign in')}
          </button>
        </div>
      ) : (
        <p>{t('Connessione a Yourang in corso…', 'Connecting to Yourang…')}</p>
      )}
    </div>
  );
}
