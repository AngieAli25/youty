import { MutationButton } from '@youty/shared';
// Sposta.jsx — reschedule an upcoming appointment: day strip + availability
// with the SAME service items, then POST /api/agenda/client/appointments/{id}/move.
// The 24h-policy 400 error is surfaced inline (banner) + toast.
import React from 'react';
import { ApiError, Icon, api, fmtDur, minutesOfDay, timeLabel } from '@youty/shared';
import { useApp } from '../ctx.jsx';
import { headFont } from '../theme.js';
import {
  ClientSubHead, Meta, StickyCta, nextDays, dayStripLabel, fmtDayMed, toDateStr,
  fmtApptDate, apptTime, apptDur, apptServiceNames, errToast,
} from './lib.jsx';

export default function Sposta() {
  const { t, lang, brand, setView, viewParams, fireToast } = useApp();
  const appt = viewParams?.appt || null;
  const [dayIdx, setDayIdx] = React.useState(0);
  const [slot, setSlot] = React.useState(null);
  const [slots, setSlots] = React.useState(null);
  const [moving, setMoving] = React.useState(false);
  const [policyErr, setPolicyErr] = React.useState(null);
  const [done, setDone] = React.useState(null); // new start ISO on success
  const days = React.useMemo(() => nextDays(14), []);

  const items = React.useMemo(
    () => (appt?.services || []).map((s) => ({ service_id: s.service_id })),
    [appt],
  );

  React.useEffect(() => {
    if (!appt || done) return;
    let alive = true;
    setSlots(null);
    setSlot(null);
    api.get('/api/agenda/client/availability', { params: { date: toDateStr(days[dayIdx]), items } })
      .then((list) => { if (alive) setSlots(list); })
      .catch((err) => { if (alive) { setSlots([]); errToast(err, fireToast, t); } });
    return () => { alive = false; };
  }, [appt, dayIdx, done]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!appt) {
    return (
      <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 30, textAlign: 'center' }}>
        <div className="t-body" style={{ color: 'var(--muted)', marginBottom: 18 }}>
          {t('Seleziona prima l’appuntamento da spostare.', 'First pick the appointment to reschedule.')}
        </div>
        <button className="btn btn--brand press" onClick={() => setView('prenotazioni')}>{t('Le tue prenotazioni', 'Your bookings')}</button>
      </div>
    );
  }

  /* success state */
  if (done) {
    return (
      <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 30, textAlign: 'center' }}>
        <div className="pop-in" style={{ width: 86, height: 86, borderRadius: 99, background: 'var(--brand-tint)', display: 'grid', placeItems: 'center', marginBottom: 20 }}>
          <Icon name="check" size={44} color="var(--brand)" stroke={2.2} />
        </div>
        <div style={{ fontFamily: headFont(brand), fontSize: 26, fontWeight: brand.type === 'serif' ? 500 : 800 }}>{t('Spostato!', 'Rescheduled!')}</div>
        <div className="t-body" style={{ color: 'var(--muted)', marginTop: 8, maxWidth: 280 }}>
          {t(`Ci vediamo ${fmtDayMed(done, lang)} alle ${timeLabel(minutesOfDay(done))}. Ti abbiamo inviato la conferma su WhatsApp 💫`,
            `See you ${fmtDayMed(done, lang)} at ${timeLabel(minutesOfDay(done))}. We've sent your confirmation on WhatsApp 💫`)}
        </div>
        <button className="btn btn--brand press" style={{ marginTop: 26 }} onClick={() => setView('home')}>{t('Torna alla home', 'Back to home')}</button>
      </div>
    );
  }

  const confirm = async () => {
    if (!slot || moving) return;
    setMoving(true);
    setPolicyErr(null);
    try {
      await api.post(`/api/agenda/client/appointments/${appt.id}/move`, { start: slot.start });
      setDone(slot.start);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setPolicyErr(err.message); // 24h policy — show it clearly inline
        fireToast({ msg: err.message, icon: 'alert' });
      } else if (err instanceof ApiError && err.status === 409) {
        fireToast({ msg: t('Questo orario è appena stato preso: scegline un altro.', 'That time was just taken: pick another.'), icon: 'alert' });
        setSlot(null);
        setSlots(null);
        api.get('/api/agenda/client/availability', { params: { date: toDateStr(days[dayIdx]), items } })
          .then(setSlots).catch(() => setSlots([]));
      } else {
        errToast(err, fireToast, t);
      }
    } finally {
      setMoving(false);
    }
  };

  const free = slots || [];
  const morning = free.filter((sl) => minutesOfDay(sl.start) < 720);
  const afternoon = free.filter((sl) => minutesOfDay(sl.start) >= 720);
  const TimeGrid = ({ list }) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))', gap: 9 }}>
      {list.map((sl) => {
        const on = slot?.start === sl.start;
        return (
          <button key={sl.start} className="press tabnum" onClick={() => setSlot(sl)}
            style={{ padding: '13px 0', borderRadius: 12, fontWeight: 700, fontSize: 14.5, border: '1.5px solid ' + (on ? 'var(--brand)' : 'var(--hair)'), background: on ? 'var(--brand)' : 'var(--paper-0)', color: on ? 'var(--brand-on)' : 'var(--ink)' }}>
            {timeLabel(minutesOfDay(sl.start))}
          </button>
        );
      })}
    </div>
  );

  return (
    <div style={{ paddingBottom: 30, minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <ClientSubHead brand={brand} title={t('Sposta appuntamento', 'Reschedule')} onBack={() => setView('home')} />
      <div style={{ padding: '8px 22px' }}>
        {/* current appointment recap */}
        <div style={{ padding: '12px 14px', borderRadius: 'var(--r-md)', background: 'var(--brand-tint)', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--brand-ink)' }}>{apptServiceNames(appt)}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 6 }}>
            <Meta icon="calendar" text={fmtApptDate(appt.start, lang)} />
            <Meta icon="clock" text={apptTime(appt.start) + ' · ' + fmtDur(apptDur(appt), lang)} />
          </div>
        </div>

        {policyErr && (
          <div style={{ display: 'flex', gap: 12, padding: 15, background: 'var(--danger-tint)', borderRadius: 'var(--r-md)', marginBottom: 16 }}>
            <Icon name="alert" size={20} color="var(--danger)" />
            <div style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink-2)', flex: 1 }}>{policyErr}</div>
          </div>
        )}

        <div className="t-body" style={{ color: 'var(--muted)', marginBottom: 16 }}>
          {t('Scegli un nuovo orario. Mostriamo solo gli slot davvero disponibili.', 'Pick a new time. We only show slots that are actually free.')}
        </div>

        {/* day strip */}
        <div className="scroll" style={{ display: 'flex', gap: 9, overflowX: 'auto', paddingBottom: 6, marginBottom: 20, marginInline: -2, paddingInline: 2 }}>
          {days.map((d, i) => {
            const on = i === dayIdx;
            const { wd, num } = dayStripLabel(d, lang);
            return (
              <button key={i} className="press" onClick={() => setDayIdx(i)}
                style={{ flexShrink: 0, minWidth: 62, padding: '9px 14px', borderRadius: 14, border: '1.5px solid ' + (on ? 'var(--brand)' : 'var(--hair)'), background: on ? 'var(--brand)' : 'var(--paper-0)', color: on ? 'var(--brand-on)' : 'var(--ink)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <span style={{ fontSize: 11.5, fontWeight: 600, opacity: on ? 0.85 : 0.6 }}>{wd}</span>
                <span className="tabnum" style={{ fontSize: 15, fontWeight: 800 }}>{num}</span>
              </button>
            );
          })}
        </div>

        {slots === null ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))', gap: 9 }}>
            {Array.from({ length: 9 }).map((_, i) => <div key={i} className="skel" style={{ height: 46, borderRadius: 12 }} />)}
          </div>
        ) : free.length ? (
          <React.Fragment>
            {morning.length > 0 && (
              <div style={{ marginBottom: afternoon.length ? 18 : 0 }}>
                <div className="t-meta" style={{ marginBottom: 10 }}>{t('Mattina', 'Morning')}</div>
                <TimeGrid list={morning} />
              </div>
            )}
            {afternoon.length > 0 && (
              <div>
                <div className="t-meta" style={{ marginBottom: 10 }}>{t('Pomeriggio', 'Afternoon')}</div>
                <TimeGrid list={afternoon} />
              </div>
            )}
          </React.Fragment>
        ) : (
          <div style={{ padding: '28px 16px', borderRadius: 'var(--r-md)', border: '1px dashed var(--hair)', textAlign: 'center' }}>
            <Icon name="clock" size={26} color="var(--muted-2)" />
            <div className="t-sm" style={{ color: 'var(--muted)', marginTop: 8 }}>
              {t('Nessun orario libero questo giorno: prova un altro giorno.', 'No free time this day: try another day.')}
            </div>
          </div>
        )}
      </div>
      <div style={{ flex: 1 }} />
      <StickyCta>
        <MutationButton className="btn btn--brand btn--block press" disabled={!slot || moving} style={{ opacity: !slot || moving ? 0.4 : 1 }} onClick={confirm}>
          {moving ? t('Spostamento…', 'Rescheduling…') : t('Conferma nuovo orario', 'Confirm new time')}
        </MutationButton>
      </StickyCta>
    </div>
  );
}
