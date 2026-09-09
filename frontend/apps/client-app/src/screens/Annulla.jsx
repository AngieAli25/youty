import { MutationButton } from '@youty/shared';
// Annulla.jsx — cancel confirmation with deposit-forfeit warning, then
// POST /api/agenda/client/appointments/{id}/cancel. 400 policy errors are
// surfaced inline + toast.
import React from 'react';
import { ApiError, Icon, api, fmtEur, fmtDur, depositMeta } from '@youty/shared';
import { useApp } from '../ctx.jsx';
import { headFont } from '../theme.js';
import {
  ClientSubHead, Meta, fmtApptDate, apptTime, apptDur, apptServiceNames, errToast,
} from './lib.jsx';

export default function Annulla() {
  const { t, lang, brand, setView, viewParams, fireToast } = useApp();
  const appt = viewParams?.appt || null;
  const [busy, setBusy] = React.useState(false);
  const [policyErr, setPolicyErr] = React.useState(null);
  const [done, setDone] = React.useState(false);

  if (!appt) {
    return (
      <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 30, textAlign: 'center' }}>
        <div className="t-body" style={{ color: 'var(--muted)', marginBottom: 18 }}>
          {t('Seleziona prima l’appuntamento da annullare.', 'First pick the appointment to cancel.')}
        </div>
        <button className="btn btn--brand press" onClick={() => setView('prenotazioni')}>{t('Le tue prenotazioni', 'Your bookings')}</button>
      </div>
    );
  }

  if (done) {
    return (
      <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 30, textAlign: 'center' }}>
        <div className="pop-in" style={{ width: 86, height: 86, borderRadius: 99, background: 'var(--paper-2)', display: 'grid', placeItems: 'center', marginBottom: 20 }}>
          <Icon name="check" size={44} color="var(--muted)" stroke={2.2} />
        </div>
        <div style={{ fontFamily: headFont(brand), fontSize: 26, fontWeight: brand.type === 'serif' ? 500 : 800 }}>{t('Appuntamento annullato', 'Appointment cancelled')}</div>
        <div className="t-body" style={{ color: 'var(--muted)', marginTop: 8, maxWidth: 280 }}>
          {t('Ci dispiace non vederti! Prenota quando vuoi, ti aspettiamo 💫', 'Sorry to miss you! Book again anytime, we’ll be here 💫')}
        </div>
        <button className="btn btn--brand press" style={{ marginTop: 26 }} onClick={() => setView('prenota')}>{t('Prenota di nuovo', 'Book again')}</button>
        <button className="press" style={{ marginTop: 12, fontSize: 14, fontWeight: 600, color: 'var(--muted)' }} onClick={() => setView('home')}>{t('Torna alla home', 'Back to home')}</button>
      </div>
    );
  }

  const depAmt = Number(appt.deposit_amount || 0);
  const depPaid = appt.deposit_status === 'paid' && depAmt > 0;
  const dm = depositMeta(appt.deposit_status, t);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setPolicyErr(null);
    try {
      await api.post(`/api/agenda/client/appointments/${appt.id}/cancel`);
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setPolicyErr(err.message); // 24h policy — contatta il salone
        fireToast({ msg: err.message, icon: 'alert' });
      } else {
        errToast(err, fireToast, t);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ paddingBottom: 30 }}>
      <ClientSubHead brand={brand} title={t('Annulla appuntamento', 'Cancel')} onBack={() => setView('home')} />
      <div style={{ padding: '8px 22px' }}>
        {/* deposit / policy warning */}
        <div style={{ display: 'flex', gap: 12, padding: 16, background: 'var(--danger-tint)', borderRadius: 'var(--r-md)', marginBottom: 20 }}>
          <Icon name="alert" size={22} color="var(--danger)" />
          <div style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--ink-2)', flex: 1 }}>
            {depPaid
              ? t(`Annullando a meno di 24h dall'appuntamento perderai il deposito di ${fmtEur(depAmt, lang)} versato. Sei sicura?`,
                  `Cancelling within 24h of the appointment forfeits your ${fmtEur(depAmt, lang)} deposit. Are you sure?`)
              : t('Sei sicura di voler annullare? A meno di 24h dall’appuntamento l’annullamento non è consentito dall’app.',
                  'Are you sure you want to cancel? Within 24h of the appointment, cancelling from the app isn’t allowed.')}
          </div>
        </div>

        {policyErr && (
          <div style={{ display: 'flex', gap: 12, padding: 15, background: 'var(--danger-tint)', borderRadius: 'var(--r-md)', marginBottom: 20, border: '1.5px solid var(--danger)' }}>
            <Icon name="alert" size={20} color="var(--danger)" />
            <div style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink-2)', flex: 1 }}>{policyErr}</div>
          </div>
        )}

        {/* appointment summary */}
        <div className="card" style={{ padding: 16, marginBottom: 24, boxShadow: 'none', border: '1px solid var(--hair)' }}>
          <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.2 }}>{apptServiceNames(appt)}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: 12 }}>
            <Meta icon="calendar" text={fmtApptDate(appt.start, lang)} />
            <Meta icon="clock" text={apptTime(appt.start) + ' · ' + fmtDur(apptDur(appt), lang)} />
            {appt.operator?.name && <Meta icon="user" text={appt.operator.name} />}
          </div>
          {dm && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12, padding: '5px 12px', borderRadius: 99, background: 'var(--paper-2)', color: dm.color, fontWeight: 700, fontSize: 12.5 }}>
              <span style={{ width: 7, height: 7, borderRadius: 99, background: dm.dot }} />
              {dm.label}{depAmt > 0 ? ' · ' + fmtEur(depAmt, lang) : ''}
            </div>
          )}
        </div>

        <MutationButton className="btn btn--block press" disabled={busy} style={{ background: 'var(--danger)', color: '#fff', opacity: busy ? 0.6 : 1 }} onClick={confirm}>
          {busy ? t('Annullamento…', 'Cancelling…') : t('Sì, annulla', 'Yes, cancel')}
        </MutationButton>
        <button className="btn btn--ghost btn--block press" style={{ marginTop: 10 }} onClick={() => setView('home')}>
          {t('No, mantieni', 'No, keep it')}
        </button>
      </div>
    </div>
  );
}
