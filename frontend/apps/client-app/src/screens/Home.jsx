import { MutationButton } from '@youty/shared';
// Home.jsx — branded home: cover, greeting, next-appointment card with
// status/deposit chips + actions, empty-state variant, salon footer.
// Data: GET /api/agenda/client/appointments → upcoming[0].
import React from 'react';
import { Icon, fmtEur, fmtDur, statusMeta, depositMeta } from '@youty/shared';
import { useApp } from '../ctx.jsx';
import { headFont } from '../theme.js';
import {
  Meta, useClientAppointments, relLabel, fmtApptDate, apptTime, apptDur,
  apptServiceNames, mapsUrl, downloadIcs, errToast,
} from './lib.jsx';

/* cover with monogram (prototype Cover, data from brand) */
function Cover({ brand, t }) {
  return (
    <div style={{ minHeight: 190, background: 'var(--brand)', position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ position: 'absolute', inset: 0, opacity: 0.13, background: 'radial-gradient(circle at 78% 22%, var(--brand-on) 0 1.5px, transparent 1.6px) 0 0/22px 22px' }} />
      <div style={{ position: 'absolute', top: 'calc(var(--safe-top) - 10px)', right: 18, fontFamily: 'var(--serif)', fontSize: 46, color: 'var(--brand-on)', opacity: 0.18, fontStyle: 'italic' }}>{brand.name.charAt(0)}</div>
      <div style={{ position: 'relative', padding: 'calc(var(--safe-top) + 16px) 22px 20px' }}>
        <div style={{ width: 56, height: 56, borderRadius: 99, background: 'var(--brand-on)', display: 'grid', placeItems: 'center', overflow: 'hidden', marginBottom: 12, boxShadow: '0 4px 14px rgba(0,0,0,0.18)' }}>
          {brand.logo
            ? <img src={brand.logo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span style={{ fontFamily: 'var(--serif)', fontSize: 26, fontStyle: 'italic', color: 'var(--brand)', lineHeight: 1 }}>{brand.name.charAt(0)}</span>}
        </div>
        <div style={{ fontFamily: headFont(brand), fontSize: 30, fontWeight: brand.type === 'serif' ? 500 : 800, color: 'var(--brand-on)', letterSpacing: brand.type === 'serif' ? '0' : '-0.02em', lineHeight: 1 }}>{brand.name}</div>
        <div style={{ color: 'var(--brand-on)', opacity: 0.72, fontSize: 13, fontWeight: 600, marginTop: 6, letterSpacing: '0.04em' }}>{t('La tua area personale', 'Your personal area')}</div>
      </div>
    </div>
  );
}

function SalonFooter({ brand, t }) {
  return (
    <div style={{ marginTop: 22, paddingTop: 22, borderTop: '1px solid var(--hair)', textAlign: 'center' }}>
      <div style={{ fontFamily: headFont(brand), fontSize: 20, fontWeight: brand.type === 'serif' ? 500 : 800 }}>{brand.name}</div>
      <div className="t-sm" style={{ color: 'var(--muted)', marginTop: 6 }}>{t('Prenotazioni online e promemoria WhatsApp', 'Online booking and WhatsApp reminders')}</div>
      {brand.address && <div className="t-sm" style={{ color: 'var(--muted)', marginTop: 4 }}>{brand.address}</div>}
      {brand.openingHours && <div className="t-sm" style={{ color: 'var(--muted)', marginTop: 4, whiteSpace: 'pre-line' }}>{brand.openingHours}</div>}
      <div style={{ display: 'flex', gap: 14, justifyContent: 'center', marginTop: 12 }}>
        <a href={mapsUrl(brand)} target="_blank" rel="noopener noreferrer" title={t('Indicazioni', 'Directions')}
          style={{ width: 40, height: 40, borderRadius: 99, background: 'var(--brand-tint)', display: 'grid', placeItems: 'center', textDecoration: 'none' }}>
          <Icon name="mapPin" size={18} color="var(--brand-ink)" />
        </a>
        {brand.phone && (
          <a href={`tel:${brand.phone}`} title={t('Chiama', 'Call')}
            style={{ width: 40, height: 40, borderRadius: 99, background: 'var(--brand-tint)', display: 'grid', placeItems: 'center', textDecoration: 'none' }}>
            <Icon name="phone" size={18} color="var(--brand-ink)" />
          </a>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const { session, setView, brand, t } = useApp();

  /* ---- HOME ANONIMA ---- */
  if (!session) {
    return (
      <div style={{ paddingBottom: 40, position: 'relative' }}>
        <Cover brand={brand} t={t} />
        <div style={{ padding: '20px 22px 0' }} className="stagger">
          <div style={{ fontFamily: headFont(brand), fontSize: 24, fontWeight: brand.type === 'serif' ? 500 : 800, lineHeight: 1.15, marginBottom: 8 }}>
            {t('Prenota il tuo appuntamento', 'Book your appointment')}
          </div>
          <div className="t-sm" style={{ color: 'var(--muted)', marginBottom: 18, maxWidth: 300 }}>
            {t(`Scegli il servizio e l'orario da ${brand.name}. Ti bastano un minuto e il tuo numero.`,
               `Pick a service and time at ${brand.name}. It only takes a minute and your phone number.`)}
          </div>
          <MutationButton className="btn btn--brand btn--block press" style={{ marginBottom: 18, height: 54 }} onClick={() => setView('prenota')}>
            <Icon name="plus" size={18} color="var(--brand-on)" />{t('Prenota ora', 'Book now')}
          </MutationButton>
          <SalonFooter brand={brand} t={t} />
        </div>
      </div>
    );
  }

  /* ---- HOME LOGGATA (comportamento attuale) ---- */
  return <HomeLogged />;
}

function HomeLogged() {
  const { t, lang, brand, client, setView, fireToast } = useApp();
  const { data, error } = useClientAppointments();
  React.useEffect(() => { if (error) errToast(error, fireToast, t); }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  const next = data?.upcoming?.[0] || null;
  const loading = !data && !error;
  const sm = next && statusMeta(next.status, t);
  const dm = next && depositMeta(next.deposit_status, t);
  const depAmt = next ? Number(next.deposit_amount || 0) : 0;

  return (
    <div style={{ paddingBottom: 40, position: 'relative' }}>
      <Cover brand={brand} t={t} />
      <div style={{ padding: '20px 22px 0' }} className="stagger">

        {/* greeting */}
        <div style={{ fontFamily: headFont(brand), fontSize: 26, fontWeight: brand.type === 'serif' ? 500 : 800, lineHeight: 1.1, marginBottom: 16 }}>
          {t('Ciao', 'Hi')} {client?.first_name || ''} 👋
        </div>

        {loading ? (
          <div className="skel" style={{ height: 220, borderRadius: 'var(--r-md)', marginBottom: 18 }} />
        ) : next ? (
          <React.Fragment>
            <div className="t-meta" style={{ color: 'var(--brand-ink)', marginBottom: 12 }}>{t('Il tuo prossimo appuntamento', 'Your next appointment')}</div>
            <div className="card" style={{ padding: 18, marginBottom: 18 }}>
              {/* status + deposit chips */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 99, background: sm.tint, color: sm.color, fontWeight: 700, fontSize: 12.5 }}>
                  <Icon name={sm.icon} size={14} color={sm.color} stroke={2.4} />{sm.label}
                </span>
                {dm && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 99, background: 'var(--brand-tint)', color: dm.color, fontWeight: 700, fontSize: 12.5 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 99, background: dm.dot }} />
                    {dm.label}{depAmt > 0 ? ' · ' + fmtEur(depAmt, lang) : ''}
                  </span>
                )}
              </div>
              {/* relative time — in evidenza */}
              <div style={{ fontFamily: headFont(brand), fontSize: 30, fontWeight: brand.type === 'serif' ? 500 : 800, color: 'var(--brand-ink)', lineHeight: 1.05, marginBottom: 14 }}>
                {relLabel(next.start, lang, t)}
              </div>
              {/* details */}
              <div style={{ fontFamily: 'var(--sans)', fontSize: 17, fontWeight: 700, lineHeight: 1.2 }}>{apptServiceNames(next)}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: 12 }}>
                <Meta icon="calendar" text={fmtApptDate(next.start, lang)} />
                <Meta icon="clock" text={apptTime(next.start) + ' · ' + fmtDur(apptDur(next), lang)} />
                {next.operator?.name && <Meta icon="user" text={next.operator.name} />}
              </div>
              {/* primary card action — Sposta */}
              <MutationButton className="press" onClick={() => setView('sposta', { appt: next })}
                style={{ width: '100%', minHeight: 50, marginTop: 18, borderRadius: 'var(--r-pill)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'transparent', border: '1.5px solid var(--brand)', color: 'var(--brand-ink)', fontWeight: 700, fontSize: 15 }}>
                <Icon name="calendar" size={17} color="var(--brand-ink)" />{t('Sposta appuntamento', 'Reschedule')}
              </MutationButton>
              {/* quick icon actions */}
              <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                <button className="press" onClick={() => { downloadIcs(next, brand.name); fireToast({ msg: t('Evento aggiunto al calendario', 'Calendar event downloaded'), icon: 'check' }); }}
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '12px 8px', borderRadius: 'var(--r-md)', background: 'var(--paper-2)', color: 'var(--ink-2)' }}>
                  <Icon name="calendar" size={20} color="var(--brand-ink)" />
                  <span style={{ fontSize: 11.5, fontWeight: 600, textAlign: 'center', lineHeight: 1.2 }}>{t('Aggiungi al calendario', 'Add to calendar')}</span>
                </button>
                <a href={mapsUrl(brand)} target="_blank" rel="noopener noreferrer" className="press"
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '12px 8px', borderRadius: 'var(--r-md)', background: 'var(--paper-2)', color: 'var(--ink-2)', textDecoration: 'none' }}>
                  <Icon name="mapPin" size={20} color="var(--brand-ink)" />
                  <span style={{ fontSize: 11.5, fontWeight: 600, textAlign: 'center', lineHeight: 1.2 }}>{t('Indicazioni', 'Directions')}</span>
                </a>
              </div>
              {/* cancel — discreet text link + policy note */}
              <div style={{ textAlign: 'center', marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--hair)' }}>
                <MutationButton className="press" onClick={() => setView('annulla', { appt: next })}
                  style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
                  {t('Annulla appuntamento', 'Cancel appointment')}
                </MutationButton>
                <div className="t-sm" style={{ color: 'var(--muted-2)', marginTop: 6 }}>
                  {t('Sposti o annulli gratuitamente fino a 24h prima.', 'Reschedule or cancel free of charge up to 24h before.')}
                </div>
              </div>
            </div>
          </React.Fragment>
        ) : (
          /* STATO VUOTO — invito a prenotare */
          <div className="card" style={{ padding: 24, marginBottom: 18, textAlign: 'center' }}>
            <div style={{ width: 64, height: 64, borderRadius: 20, background: 'var(--brand-tint)', display: 'grid', placeItems: 'center', margin: '0 auto 14px' }}>
              <Icon name="calendar" size={30} color="var(--brand-ink)" />
            </div>
            <div style={{ fontFamily: headFont(brand), fontSize: 22, fontWeight: brand.type === 'serif' ? 500 : 800, color: 'var(--brand-ink)', lineHeight: 1.15 }}>
              {t('Prenota il tuo prossimo appuntamento', 'Book your next appointment')}
            </div>
            <div className="t-sm" style={{ color: 'var(--muted)', marginTop: 8, maxWidth: 260, marginInline: 'auto' }}>
              {t(`Non hai appuntamenti in programma da ${brand.name}.`, `You have no upcoming appointments at ${brand.name}.`)}
            </div>
          </div>
        )}

        {/* UNICA CTA primaria piena */}
        <MutationButton className="btn btn--brand btn--block press" style={{ marginBottom: 18, height: 54 }} onClick={() => setView('prenota')}>
          <Icon name="plus" size={18} color="var(--brand-on)" />{next ? t('Prenota un appuntamento', 'Book an appointment') : t('Prenota ora', 'Book now')}
        </MutationButton>

        <SalonFooter brand={brand} t={t} />
      </div>
    </div>
  );
}
