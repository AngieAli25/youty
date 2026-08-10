// Hook.jsx — form pubblico di raccolta contatti del salone.
// Vive su /<slug>/hook: nessuna sessione, nessun OTP, solo lascia i tuoi dati.
// Il branding (logo, colore) è quello del salone, già caricato da ctx.
import React, { useState } from 'react';
import { api, Icon } from '@youty/shared';
import { useApp, SALON_SLUG } from '../ctx.jsx';
import { headFont } from '../theme.js';

export default function Hook() {
  const { t, brand } = useApp();
  const [f, setF] = useState({ first_name: '', last_name: '', phone: '', email: '' });
  const [marketing, setMarketing] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [trap, setTrap] = useState(false); // honeypot: deve restare false
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const canSend = f.first_name.trim() && f.phone.trim() && privacy && !busy;

  /* Senza informativa il modulo non si apre: spuntare "ho letto" davanti a
   * niente da leggere non è un consenso, e senza consenso valido non c'è
   * titolo per raccogliere i dati. L'endpoint risponde 403 per conto suo —
   * questo è lo stesso muro, dal lato gentile. La titolare vede l'avviso in
   * Impostazioni → Link pubblici. */
  const closed = !brand.privacyUrl;

  const submit = async () => {
    if (!canSend) return;
    setError(null);
    setBusy(true);
    try {
      await api.post('/api/clients/public/hook', {
        salon_slug: SALON_SLUG,
        first_name: f.first_name.trim(),
        last_name: f.last_name.trim(),
        phone: f.phone.trim(),
        email: f.email.trim(),
        marketing,
        privacy,
        trap,
      }, { auth: false });
      setDone(true);
    } catch (err) {
      setError(err?.message || t('Errore di rete', 'Network error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {/* hero col brand del salone */}
      <div style={{ background: 'var(--brand)', padding: 'calc(var(--safe-top) + 34px) 24px 30px' }}>
        <div style={{ width: 62, height: 62, borderRadius: 99, background: 'var(--brand-on)', display: 'grid', placeItems: 'center', overflow: 'hidden', marginBottom: 14, boxShadow: '0 4px 14px rgba(0,0,0,0.18)' }}>
          {brand.logo
            ? <img src={brand.logo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span style={{ fontFamily: 'var(--serif)', fontSize: 28, fontStyle: 'italic', color: 'var(--brand)', lineHeight: 1 }}>{brand.name.charAt(0)}</span>}
        </div>
        <div style={{ fontFamily: headFont(brand), fontSize: 30, fontWeight: brand.type === 'serif' ? 500 : 800, color: 'var(--brand-on)', lineHeight: 1.05 }}>{brand.name}</div>
        <div style={{ color: 'var(--brand-on)', opacity: 0.75, fontSize: 13, fontWeight: 600, marginTop: 6 }}>
          {done
            ? t('Grazie!', 'Thank you!')
            : closed
              ? ''
              : t('Lascia i tuoi contatti', 'Leave your contact details')}
        </div>
      </div>

      <div style={{ padding: '26px 24px 40px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {done ? (
          <React.Fragment>
            <div className="t-h3">{t('Ti abbiamo registrata', 'You are on the list')}</div>
            <div className="t-body" style={{ color: 'var(--muted)' }}>
              {t('Ti contatteremo presto. A presto da ', 'We will be in touch soon. See you at ')}{brand.name}.
            </div>
          </React.Fragment>
        ) : closed ? (
          <React.Fragment>
            <div className="t-h3">{t('Modulo non disponibile', 'Form unavailable')}</div>
            <div className="t-body" style={{ color: 'var(--muted)' }}>
              {t('Questo salone non ha ancora pubblicato la sua informativa privacy, quindi non possiamo raccogliere i tuoi dati. Riprova più tardi.',
                 'This salon has not published its privacy policy yet, so we cannot collect your details. Please try again later.')}
            </div>
          </React.Fragment>
        ) : (
          <React.Fragment>
            <div className="t-body" style={{ color: 'var(--muted)' }}>
              {t('Compila il modulo: ti ricontattiamo noi.', 'Fill in the form and we will get back to you.')}
            </div>

            {error && <div className="ca-err"><Icon name="alert" size={15} color="var(--danger)" />{error}</div>}

            <input className="ca-input" placeholder={t('Nome', 'First name')} autoComplete="given-name"
              value={f.first_name} onChange={set('first_name')} />
            <input className="ca-input" placeholder={t('Cognome', 'Last name')} autoComplete="family-name"
              value={f.last_name} onChange={set('last_name')} />
            <input className="ca-input" type="tel" inputMode="tel" autoComplete="tel" placeholder={t('Telefono', 'Phone')}
              value={f.phone} onChange={set('phone')} />
            <input className="ca-input" type="email" inputMode="email" autoComplete="email" placeholder={t('Email', 'Email')}
              value={f.email} onChange={set('email')} />

            {/* Honeypot: una CHECKBOX, non un campo di testo. L'autofill di Chrome
              * riempiva il vecchio input `website` e faceva scartare utenti veri
              * in silenzio; le checkbox l'autofill non le spunta, mentre un bot
              * che compila tutto quello che trova sì. */}
            <input type="checkbox" tabIndex={-1} aria-hidden="true" checked={trap}
              onChange={(e) => setTrap(e.target.checked)}
              style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }} />

            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, lineHeight: 1.45, cursor: 'pointer' }}>
              <input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)}
                style={{ marginTop: 2, width: 18, height: 18, accentColor: 'var(--brand)', flex: '0 0 auto' }} />
              <span>
                {t('Ho letto e accetto l’', 'I have read and accept the ')}
                {/* Sempre un link: se l'informativa manca il form non arriva
                  * a renderizzarsi (vedi `closed`), quindi qui c'è sempre. */}
                <a href={brand.privacyUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--brand)', fontWeight: 700 }}>
                  {t('informativa privacy', 'privacy policy')}
                </a>
                {t(' del salone.', ' of the salon.')}
              </span>
            </label>

            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, lineHeight: 1.45, cursor: 'pointer' }}>
              <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)}
                style={{ marginTop: 2, width: 18, height: 18, accentColor: 'var(--brand)', flex: '0 0 auto' }} />
              <span style={{ color: 'var(--muted)' }}>
                {t('Acconsento a ricevere offerte e comunicazioni promozionali (facoltativo).',
                   'I agree to receive offers and promotional messages (optional).')}
              </span>
            </label>

            <button className="btn btn--brand btn--block press" disabled={!canSend}
              style={{ opacity: canSend ? 1 : 0.5 }} onClick={submit}>
              {busy ? t('Invio…', 'Sending…') : t('Invia', 'Send')}
            </button>
          </React.Fragment>
        )}
      </div>
    </div>
  );
}
