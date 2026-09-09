import { MutationButton } from '@youty/shared';
// WaitlistNew.jsx — join the waiting list: service picker (public catalog) +
// time preference (any/morning/afternoon/weekend/exact days+time).
// POST /api/agenda/client/waitlist {service_id, preference, exact_days, exact_time}.
// NOTE: no stylist picker — no public/client operators endpoint (API gap).
import React from 'react';
import { Icon, api, fmtEur, fmtDur } from '@youty/shared';
import { useApp, SALON_SLUG } from '../ctx.jsx';
import {
  ClientSubHead, StickyCta, usePublicServices, svcLangName, catIcon,
  WEEKDAYS_SHORT, errToast,
} from './lib.jsx';

export default function WaitlistNew() {
  const { t, lang, brand, setView, viewParams, fireToast } = useApp();
  const { cats, error: catError } = usePublicServices(SALON_SLUG);
  const [serviceId, setServiceId] = React.useState(viewParams?.serviceId || null);
  const [pref, setPref] = React.useState('any');
  const [exactDays, setExactDays] = React.useState([5]); // 0=lun … 6=dom
  const [exactTime, setExactTime] = React.useState('10:00');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => { if (catError) errToast(catError, fireToast, t); }, [catError]); // eslint-disable-line react-hooks/exhaustive-deps

  const prefs = [
    ['any', t('Qualsiasi', 'Any time')],
    ['morning', t('Mattina', 'Morning')],
    ['afternoon', t('Pomeriggio', 'Afternoon')],
    ['weekend', t('Weekend', 'Weekend')],
    ['exact', t('Orario preciso', 'Exact time')],
  ];

  const submit = async () => {
    if (!serviceId || busy) return;
    setBusy(true);
    try {
      const body = { service_id: serviceId, preference: pref };
      if (pref === 'exact') {
        body.exact_days = exactDays;
        body.exact_time = exactTime;
      }
      await api.post('/api/agenda/client/waitlist', body);
      fireToast({ msg: t('Sei in lista! Ti avvisiamo su WhatsApp.', 'You’re on the list! We’ll ping you on WhatsApp.'), icon: 'check' });
      setView('waitlist');
    } catch (err) {
      errToast(err, fireToast, t);
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = serviceId && (pref !== 'exact' || exactDays.length > 0);

  return (
    <div style={{ paddingBottom: 30, minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <ClientSubHead brand={brand} title={t('Aggiungiti alla lista', 'Join the list')} onBack={() => setView('waitlist')} />
      <div style={{ padding: '4px 22px' }}>
        <div className="t-body" style={{ color: 'var(--muted)', marginBottom: 20 }}>
          {t('Dicci cosa cerchi: ti avvisiamo appena si libera un posto adatto.', 'Tell us what you want: we’ll alert you as soon as a matching slot frees up.')}
        </div>

        <div className="t-meta" style={{ marginBottom: 11 }}>{t('Servizio', 'Service')}</div>
        {!cats ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 22 }}>
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="skel" style={{ height: 64, borderRadius: 'var(--r-md)' }} />)}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 22 }}>
            {cats.filter((c) => c.services.length).map((g) => (
              <React.Fragment key={g.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0 2px' }}>
                  <Icon name={catIcon(g.name_it)} size={14} color="var(--brand-ink)" />
                  <span className="t-meta">{svcLangName(g, lang)}</span>
                </div>
                {g.services.map((sv) => {
                  const on = serviceId === sv.id;
                  return (
                    <button key={sv.id} className="press" onClick={() => setServiceId(sv.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderRadius: 'var(--r-md)', textAlign: 'left', border: '1.5px solid ' + (on ? 'var(--brand)' : 'var(--hair)'), background: on ? 'var(--brand-tint)' : 'var(--paper-0)' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{svcLangName(sv, lang)}</div>
                        <div className="t-sm" style={{ color: 'var(--muted)' }}>{fmtDur(sv.duration_min, lang)} · {fmtEur(Number(sv.price), lang)}</div>
                      </div>
                      {on && <Icon name="check" size={18} color="var(--brand)" stroke={2.4} />}
                    </button>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        )}

        {serviceId && (
          <React.Fragment>
            <div className="t-meta" style={{ marginBottom: 11 }}>{t('Preferenza oraria', 'Time preference')}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {prefs.map(([k, l]) => {
                const on = pref === k;
                return (
                  <button key={k} className="press" onClick={() => setPref(k)}
                    style={{ padding: '10px 16px', borderRadius: 99, fontSize: 14, fontWeight: 700, border: '1.5px solid ' + (on ? 'var(--brand)' : 'var(--hair)'), background: on ? 'var(--brand)' : 'var(--paper-0)', color: on ? 'var(--brand-on)' : 'var(--ink)' }}>
                    {l}
                  </button>
                );
              })}
            </div>
            {pref === 'exact' && (
              <div style={{ marginTop: 12 }} className="fade-in">
                <div className="t-sm" style={{ color: 'var(--muted)', marginBottom: 8 }}>
                  {t('Scegli i giorni e l’orario. Ti avvisiamo se si libera (o il più vicino).', 'Pick the days and time. We’ll alert you if it frees up (or the closest).')}
                </div>
                <div className="t-meta" style={{ marginBottom: 8 }}>{t('Giorni', 'Days')}</div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                  {WEEKDAYS_SHORT.map(([, , letterIt, letterEn], idx) => {
                    const on = exactDays.includes(idx);
                    return (
                      <button key={idx} className="press"
                        onClick={() => setExactDays((d) => (d.includes(idx) ? d.filter((x) => x !== idx) : [...d, idx].sort()))}
                        style={{ flex: 1, aspectRatio: '1', minWidth: 0, borderRadius: 12, fontSize: 14, fontWeight: 800, border: '1.5px solid ' + (on ? 'var(--brand)' : 'var(--hair)'), background: on ? 'var(--brand)' : 'var(--paper-0)', color: on ? 'var(--brand-on)' : 'var(--ink)' }}>
                        {lang === 'en' ? letterEn : letterIt}
                      </button>
                    );
                  })}
                </div>
                <div className="t-meta" style={{ marginBottom: 8 }}>{t('Orario', 'Time')}</div>
                <input type="time" value={exactTime} onChange={(e) => setExactTime(e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '13px 15px', border: '1.5px solid var(--hair)', borderRadius: 'var(--r-md)', outline: 'none', background: 'var(--paper-0)', fontSize: 16, fontWeight: 700, fontFamily: 'var(--sans)', color: 'var(--ink)' }} />
              </div>
            )}
          </React.Fragment>
        )}
      </div>
      <div style={{ flex: 1 }} />
      <StickyCta>
        <MutationButton className="btn btn--brand btn--block press" disabled={!canSubmit || busy} style={{ opacity: canSubmit && !busy ? 1 : 0.4 }} onClick={submit}>
          <Icon name="check" size={18} color="var(--brand-on)" />
          {busy ? t('Invio…', 'Sending…') : t('Conferma richiesta', 'Confirm request')}
        </MutationButton>
      </StickyCta>
    </div>
  );
}
