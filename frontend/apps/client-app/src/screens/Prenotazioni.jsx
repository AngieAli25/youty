import { MutationButton } from '@youty/shared';
// Prenotazioni.jsx — upcoming + past appointment lists with status/deposit
// chips; upcoming items expose sposta/annulla actions.
// Data: GET /api/agenda/client/appointments.
import React from 'react';
import { Icon, fmtEur, fmtDur, statusMeta, depositMeta } from '@youty/shared';
import { useApp } from '../ctx.jsx';
import {
  ClientSubHead, Meta, DashedEmpty, useClientAppointments,
  fmtApptDate, apptTime, apptDur, apptServiceNames, errToast,
} from './lib.jsx';

function StatusChip({ status, t }) {
  const m = statusMeta(status, t);
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: m.tint, color: m.color, flexShrink: 0 }}>
      {m.label}
    </span>
  );
}

function ApptRow({ appt, t, lang, dim, actions, onSposta, onAnnulla }) {
  const dm = depositMeta(appt.deposit_status, t);
  const depAmt = Number(appt.deposit_amount || 0);
  return (
    <div className="card" style={{ padding: 15, marginBottom: 10, boxShadow: 'none', border: '1px solid var(--hair)', opacity: dim ? 0.72 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 15, flex: 1, lineHeight: 1.25 }}>{apptServiceNames(appt)}</div>
        <StatusChip status={appt.status} t={t} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
        <Meta icon="calendar" text={fmtApptDate(appt.start, lang)} />
        <Meta icon="clock" text={apptTime(appt.start) + ' · ' + fmtDur(apptDur(appt), lang)} />
        {appt.operator?.name && <Meta icon="user" text={appt.operator.name} />}
      </div>
      {dm && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10, padding: '4px 10px', borderRadius: 99, background: 'var(--paper-2)', fontWeight: 700, fontSize: 12, color: dm.color }}>
          <span style={{ width: 6, height: 6, borderRadius: 99, background: dm.dot }} />
          {dm.label}{depAmt > 0 ? ' · ' + fmtEur(depAmt, lang) : ''}
        </div>
      )}
      {actions && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--hair)' }}>
          <MutationButton className="press" onClick={onSposta}
            style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 0', borderRadius: 'var(--r-pill)', border: '1.5px solid var(--brand)', color: 'var(--brand-ink)', fontWeight: 700, fontSize: 13.5, background: 'transparent' }}>
            <Icon name="calendar" size={15} color="var(--brand-ink)" />{t('Sposta', 'Reschedule')}
          </MutationButton>
          <MutationButton className="press" onClick={onAnnulla}
            style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 0', borderRadius: 'var(--r-pill)', border: '1.5px solid var(--hair)', color: 'var(--danger)', fontWeight: 700, fontSize: 13.5, background: 'transparent' }}>
            <Icon name="x" size={15} color="var(--danger)" />{t('Annulla', 'Cancel')}
          </MutationButton>
        </div>
      )}
    </div>
  );
}

export default function Prenotazioni() {
  const { t, lang, brand, setView, fireToast } = useApp();
  const { data, error } = useClientAppointments();
  React.useEffect(() => { if (error) errToast(error, fireToast, t); }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  const loading = !data && !error;
  const upcoming = data?.upcoming || [];
  const past = data?.past || [];

  return (
    <div style={{ paddingBottom: 30 }}>
      <ClientSubHead brand={brand} title={t('Le tue prenotazioni', 'Your bookings')} onBack={() => setView('home')} />
      <div style={{ padding: '8px 22px' }}>
        <div className="t-meta" style={{ marginBottom: 10 }}>{t('In programma', 'Upcoming')}</div>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="skel" style={{ height: 120, borderRadius: 'var(--r-md)' }} />
            <div className="skel" style={{ height: 120, borderRadius: 'var(--r-md)' }} />
          </div>
        ) : upcoming.length ? (
          <div className="stagger">
            {upcoming.map((appt) => (
              <ApptRow key={appt.id} appt={appt} t={t} lang={lang} actions
                onSposta={() => setView('sposta', { appt })}
                onAnnulla={() => setView('annulla', { appt })} />
            ))}
          </div>
        ) : (
          <DashedEmpty style={{ marginBottom: 6 }}>
            {t('Nessun appuntamento in programma.', 'No upcoming appointments.')}
            <div style={{ marginTop: 12 }}>
              <MutationButton className="press" onClick={() => setView('prenota')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 18px', borderRadius: 99, background: 'var(--brand-tint)', color: 'var(--brand-ink)', fontWeight: 700, fontSize: 13.5 }}>
                <Icon name="plus" size={15} color="var(--brand-ink)" />{t('Prenota ora', 'Book now')}
              </MutationButton>
            </div>
          </DashedEmpty>
        )}

        <div className="t-meta" style={{ margin: '20px 0 10px' }}>{t('Storico', 'History')}</div>
        {loading ? (
          <div className="skel" style={{ height: 90, borderRadius: 'var(--r-md)' }} />
        ) : past.length ? (
          past.map((appt) => <ApptRow key={appt.id} appt={appt} t={t} lang={lang} dim />)
        ) : (
          <div className="t-sm" style={{ color: 'var(--muted-2)', padding: '8px 0 16px' }}>
            {t('Ancora nessuna visita passata.', 'No past visits yet.')}
          </div>
        )}
      </div>
    </div>
  );
}
