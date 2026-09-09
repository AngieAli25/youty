import { MutationButton } from '@youty/shared';
// Prenota.jsx — booking wizard (core flow), ported from prototype ClientBooking.
// Steps: -1 choice (single/pacchetti) → 0 service picker (public catalog)
//        → 1 day+time (GET /api/agenda/client/availability) + stylist picker
//        (GET /api/staff/public/operators) → 2 review
//        → POST /api/agenda/client/appointments → success (deposit messaging).
import React from 'react';
import { ApiError, Icon, api, clientAuth, fmtEur, fmtDur, minutesOfDay, timeLabel } from '@youty/shared';
import { useApp, SALON_SLUG } from '../ctx.jsx';
import { headFont } from '../theme.js';
import {
  ClientSubHead, DetailRow, StickyCta, usePublicServices, usePublicOperators, svcLangName, catIcon,
  nextDays, dayStripLabel, fmtDayMed, toDateStr, errToast,
} from './lib.jsx';

const STEP_INFO = [['Servizio', 'Service'], ['Giorno e ora', 'Day & time'], ['Conferma', 'Confirm']];

function StepBar({ i, t }) {
  return (
    <div style={{ padding: '10px 22px 20px' }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 9 }}>
        {[0, 1, 2].map((n) => (
          <div key={n} style={{ flex: 1, height: 4, borderRadius: 99, background: n <= i ? 'var(--brand)' : 'var(--hair)', transition: 'background 220ms' }} />
        ))}
      </div>
      <div className="t-meta" style={{ color: 'var(--brand-ink)' }}>{t('Passo', 'Step')} {i + 1} {t('di', 'of')} 3 · {t(STEP_INFO[i][0], STEP_INFO[i][1])}</div>
    </div>
  );
}

export default function Prenota() {
  const { t, lang, brand, session, setView, fireToast } = useApp();
  const { cats, error: catError } = usePublicServices(SALON_SLUG);
  const { operators } = usePublicOperators(SALON_SLUG);
  const [step, setStep] = React.useState(-1);          // -1 choice · 0 service · 1 time · 2 review · 3 dati · 4 otp · 9 success
  const [serviceIds, setServiceIds] = React.useState([]);
  const [dayIdx, setDayIdx] = React.useState(0);
  const [operatorId, setOperatorId] = React.useState(null); // null = "prima disponibile"
  const [slot, setSlot] = React.useState(null);         // SlotOut {start, assignment}
  const [slots, setSlots] = React.useState(null);       // null = loading
  const [booking, setBooking] = React.useState(false);
  const [booked, setBooked] = React.useState(null);     // AppointmentOut on success
  const [ident, setIdent] = React.useState({ first_name: '', last_name: '', phone: '' });
  const [otp, setOtp] = React.useState('');
  const [otpErr, setOtpErr] = React.useState(null);
  const days = React.useMemo(() => nextDays(14), []);

  React.useEffect(() => { if (catError) errToast(catError, fireToast, t); }, [catError]); // eslint-disable-line react-hooks/exhaustive-deps

  const allSvcs = React.useMemo(
    () => (cats || []).flatMap((c) => c.services.map((s) => ({ ...s, catName: c.name_it }))),
    [cats],
  );
  const svcs = serviceIds.map((id) => allSvcs.find((s) => s.id === id)).filter(Boolean);
  const s = svcs[0];
  const dur = svcs.reduce((sum, sv) => sum + (sv.duration_min || 0), 0);
  const price = svcs.reduce((sum, sv) => sum + Number(sv.price || 0), 0);
  const toggleSvc = (id) => setServiceIds((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  const items = serviceIds.map((id) => ({ service_id: id, operator_id: operatorId }));

  /* ---- stylist picker (step 1): only operators eligible for the chosen services ---- */
  const eligibleOperators = React.useMemo(() => {
    if (!operators || !serviceIds.length) return [];
    const doAll = operators.filter((op) => serviceIds.every((id) => op.service_ids.includes(id)));
    if (doAll.length) return doAll;
    return operators.filter((op) => op.service_ids.includes(serviceIds[0]));
  }, [operators, serviceIds]);
  const selectedOperator = eligibleOperators.find((op) => op.id === operatorId) || null;

  /* ---- availability fetch (step 1) ---- */
  const loadSlots = React.useCallback(async (dIdx) => {
    setSlots(null);
    setSlot(null);
    try {
      const list = await api.get('/api/agenda/public/availability', {
        params: { salon: SALON_SLUG, date: toDateStr(days[dIdx]), items },
        auth: false,
      });
      setSlots(list);
    } catch (err) {
      setSlots([]);
      errToast(err, fireToast, t);
    }
  }, [days, JSON.stringify(items)]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (step === 1) loadSlots(dayIdx); }, [step, dayIdx, loadSlots]);

  /* ---- confirm booking ---- */
  const confirm = async () => {
    if (booking || !slot) return;
    setBooking(true);
    try {
      const appt = await api.post('/api/agenda/client/appointments', { items, start: slot.start });
      setBooked(appt);
      setStep(9);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        fireToast({ msg: t('Questo orario è appena stato preso: scegline un altro.', 'That time was just taken: pick another.'), icon: 'alert' });
        setStep(1);
        loadSlots(dayIdx);
      } else {
        errToast(err, fireToast, t);
      }
    } finally {
      setBooking(false);
    }
  };

  /* invio OTP: numero noto → request-otp; sconosciuto (404) → register con nome/cognome */
  const sendBookingOtp = async () => {
    setOtpErr(null);
    const phone = ident.phone.trim();
    if (!ident.first_name.trim() || !ident.last_name.trim() || !phone) return;
    setBooking(true);
    try {
      try {
        await clientAuth.requestOtp(SALON_SLUG, phone);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          await clientAuth.register({
            salon_slug: SALON_SLUG,
            first_name: ident.first_name.trim(),
            last_name: ident.last_name.trim(),
            phone,
            lang,
          });
        } else { throw err; }
      }
      setStep(4);
    } catch (err) {
      errToast(err, fireToast, t);
    } finally { setBooking(false); }
  };

  /* verifica OTP → sessione → crea appuntamento */
  const verifyAndBook = async () => {
    setOtpErr(null);
    if (otp.length !== 6 || booking) return;
    setBooking(true);
    // 1) verifica OTP → crea la sessione
    try {
      await clientAuth.verifyOtp(SALON_SLUG, ident.phone.trim(), otp);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) setOtpErr(t('Codice non valido o scaduto', 'Invalid or expired code'));
      else if (err instanceof ApiError && err.status === 429) setOtpErr(t('Troppi tentativi. Riprova tra qualche minuto.', 'Too many attempts. Try again in a few minutes.'));
      else errToast(err, fireToast, t);
      setBooking(false);
      return;
    }
    // 2) sessione creata → crea l'appuntamento
    try {
      const appt = await api.post('/api/agenda/client/appointments', { items, start: slot.start });
      setBooked(appt);
      setStep(9);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        fireToast({ msg: t('Questo orario è appena stato preso: scegline un altro.', 'That time was just taken: pick another.'), icon: 'alert' });
        setStep(1); loadSlots(dayIdx);
      } else {
        errToast(err, fireToast, t);
      }
    } finally { setBooking(false); }
  };

  const head = (title) => (
    <ClientSubHead brand={brand} title={title} onBack={step <= -1 ? () => setView('home') : () => setStep(step - 1)} />
  );

  /* recap chip on later steps */
  const SummaryChip = () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 'var(--r-md)', background: 'var(--brand-tint)', marginBottom: 18 }}>
      <div style={{ width: 38, height: 38, borderRadius: 11, background: 'var(--paper-0)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        <Icon name={catIcon(s?.catName)} size={19} color="var(--brand-ink)" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--brand-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {svcs.map((sv) => svcLangName(sv, lang)).join(' + ')}
        </div>
        <div className="t-sm" style={{ color: 'var(--brand-ink)', opacity: 0.72 }}>{fmtDur(dur, lang)} · {fmtEur(price, lang)}</div>
      </div>
    </div>
  );

  /* ============ SUCCESS ============ */
  if (step === 9 && booked) {
    const dep = Number(booked.deposit_amount || 0);
    const depRequired = booked.deposit_status === 'required' && dep > 0;
    return (
      <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 30, textAlign: 'center' }}>
        <div className="pop-in" style={{ width: 86, height: 86, borderRadius: 99, background: 'var(--brand-tint)', display: 'grid', placeItems: 'center', marginBottom: 20 }}>
          <Icon name="check" size={44} color="var(--brand)" stroke={2.2} />
        </div>
        <div style={{ fontFamily: headFont(brand), fontSize: 26, fontWeight: brand.type === 'serif' ? 500 : 800 }}>{t('Fatto!', 'All set!')}</div>
        <div className="t-body" style={{ color: 'var(--muted)', marginTop: 8, maxWidth: 280 }}>
          {t(`Appuntamento confermato per ${fmtDayMed(booked.start, lang)} alle ${timeLabel(minutesOfDay(booked.start))}. Ti abbiamo inviato la conferma su WhatsApp 💫`,
            `Appointment confirmed for ${fmtDayMed(booked.start, lang)} at ${timeLabel(minutesOfDay(booked.start))}. We've sent your confirmation on WhatsApp 💫`)}
        </div>
        {depRequired && (
          <div style={{ display: 'flex', gap: 12, padding: 15, background: 'var(--brand-tint)', borderRadius: 'var(--r-md)', marginTop: 18, textAlign: 'left', maxWidth: 320 }}>
            <Icon name="coupon" size={20} color="var(--brand-ink)" />
            <div style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink-2)' }}>
              {t(`Ti chiederemo la caparra di ${fmtEur(dep, lang)} per confermare l'appuntamento (scalata dal totale).`,
                `We'll ask for a ${fmtEur(dep, lang)} deposit to confirm your appointment (deducted from the total).`)}
            </div>
          </div>
        )}
        {booked.deposit_status === 'paid' && dep > 0 && (
          <div className="t-sm" style={{ color: 'var(--ok)', marginTop: 14, fontWeight: 700 }}>
            {t(`Deposito di ${fmtEur(dep, lang)} versato`, `${fmtEur(dep, lang)} deposit paid`)}
          </div>
        )}
        <button className="btn btn--brand press" style={{ marginTop: 26 }} onClick={() => setView('home')}>{t('Torna alla home', 'Back to home')}</button>
      </div>
    );
  }

  /* ============ STEP -1: choice ============ */
  if (step === -1) {
    return (
      <div style={{ paddingBottom: 30 }}>
        {head(t('Prenota', 'Book'))}
        <div style={{ padding: '4px 22px' }} className="stagger">
          <div className="t-body" style={{ color: 'var(--muted)', marginBottom: 22, maxWidth: 320 }}>
            {t(`Come preferisci prenotare da ${brand.name}?`, `How would you like to book at ${brand.name}?`)}
          </div>

          {/* hero — recommended */}
          <button className="press" onClick={() => setStep(0)}
            style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 15, padding: '20px 18px', borderRadius: 'var(--r-lg, 20px)', background: 'var(--brand)', color: 'var(--brand-on)', marginBottom: 22, boxShadow: 'var(--sh-card)' }}>
            <div style={{ width: 50, height: 50, borderRadius: 15, background: 'rgba(255,255,255,0.16)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Icon name="calendar" size={26} color="var(--brand-on)" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '3px 9px', borderRadius: 99, background: 'rgba(255,255,255,0.2)', marginBottom: 7 }}>{t('Consigliato', 'Recommended')}</span>
              <div style={{ fontWeight: 700, fontSize: 18, lineHeight: 1.1 }}>{t('Prenota nell’app', 'Book in the app')}</div>
              <div style={{ fontSize: 13, opacity: 0.82, marginTop: 3 }}>{t('In 3 passaggi, solo orari liberi', '3 steps, only free times')}</div>
            </div>
            <Icon name="chevR" size={20} color="var(--brand-on)" />
          </button>

          <div className="t-meta" style={{ marginBottom: 12 }}>{t('Oppure', 'Or')}</div>
          <button className="press" onClick={() => setView('pacchetti')}
            style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 13, padding: 15, borderRadius: 'var(--r-md)', border: '1px solid var(--hair)', background: 'var(--paper-0)' }}>
            <div style={{ width: 44, height: 44, borderRadius: 99, background: 'var(--brand-tint)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Icon name="gift" size={21} color="var(--brand-ink)" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15.5, color: 'var(--ink)' }}>{t('Pacchetti & offerte', 'Packages & offers')}</div>
              <div className="t-sm" style={{ color: 'var(--muted)' }}>{t('Percorsi completi a prezzo speciale', 'Full journeys at a special price')}</div>
            </div>
            <Icon name="chevR" size={18} color="var(--muted-2)" />
          </button>
        </div>
      </div>
    );
  }

  /* ============ STEP 0: service picker ============ */
  if (step === 0) {
    return (
      <div style={{ paddingBottom: 30, minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
        {head(t('Scegli il servizio', 'Choose a service'))}
        <StepBar i={0} t={t} />
        <div style={{ padding: '0 22px' }}>
          {/* singolo servizio vs pacchetto */}
          <div style={{ display: 'flex', gap: 4, background: 'var(--paper-2)', borderRadius: 99, padding: 4, marginBottom: 8 }}>
            <button className="press" style={{ flex: 1, padding: 9, borderRadius: 99, fontSize: 13, fontWeight: 700, background: 'var(--brand)', color: 'var(--brand-on)' }}>
              {t('Servizi singoli', 'Single services')}
            </button>
            <button className="press" onClick={() => setView('pacchetti')} style={{ flex: 1, padding: 9, borderRadius: 99, fontSize: 13, fontWeight: 700, background: 'transparent', color: 'var(--muted)' }}>
              {t('Pacchetti', 'Packages')}
            </button>
          </div>
          <div className="t-sm" style={{ color: 'var(--muted)', marginBottom: 16 }}>{t('Puoi selezionare più servizi per la stessa visita.', 'You can pick more than one service for the same visit.')}</div>

          {!cats ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skel" style={{ height: 72, borderRadius: 'var(--r-md)' }} />)}
            </div>
          ) : (cats.filter((c) => c.services.length).map((g, gi, arr) => (
            <div key={g.id} style={{ marginBottom: gi === arr.length - 1 ? 0 : 22 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 11 }}>
                <Icon name={catIcon(g.name_it)} size={15} color="var(--brand-ink)" />
                <span className="t-meta">{svcLangName(g, lang)}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {g.services.map((sv) => {
                  const on = serviceIds.includes(sv.id);
                  return (
                    <button key={sv.id} className="press" onClick={() => toggleSvc(sv.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: 13, padding: 15, borderRadius: 'var(--r-md)', textAlign: 'left', border: '1.5px solid ' + (on ? 'var(--brand)' : 'var(--hair)'), background: on ? 'var(--brand-tint)' : 'var(--paper-0)' }}>
                      <div style={{ width: 24, height: 24, borderRadius: 8, flexShrink: 0, border: '1.5px solid ' + (on ? 'var(--brand)' : 'var(--line-strong)'), background: on ? 'var(--brand)' : 'transparent', display: 'grid', placeItems: 'center' }}>
                        {on && <Icon name="check" size={15} color="var(--brand-on)" stroke={2.6} />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{svcLangName(sv, lang)}</div>
                        <div className="t-sm" style={{ color: 'var(--muted)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="clock" size={13} color="var(--muted-2)" />{fmtDur(sv.duration_min, lang)}</span>
                        </div>
                      </div>
                      <span className="t-num" style={{ fontSize: 17, color: 'var(--brand-ink)', flexShrink: 0 }}>{fmtEur(Number(sv.price), lang)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )))}
        </div>
        <div style={{ flex: 1 }} />
        <StickyCta>
          <button className="btn btn--brand btn--block press" disabled={!serviceIds.length} style={{ opacity: serviceIds.length ? 1 : 0.4 }}
            onClick={() => { setSlot(null); setDayIdx(0); setOperatorId(null); setStep(1); }}>
            {serviceIds.length > 1
              ? t(`Continua · ${serviceIds.length} servizi · ${fmtEur(price, lang)}`, `Continue · ${serviceIds.length} services · ${fmtEur(price, lang)}`)
              : t('Continua', 'Continue')}
          </button>
        </StickyCta>
      </div>
    );
  }

  /* ============ STEP 1: day + time ============ */
  if (step === 1) {
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
        {head(t('Scegli giorno e ora', 'Choose day & time'))}
        <StepBar i={1} t={t} />
        <div style={{ padding: '0 22px' }}>
          <SummaryChip />
          {/* stylist picker — "prima disponibile" + operatrici idonee ai servizi scelti */}
          {eligibleOperators.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div className="t-meta" style={{ marginBottom: 10 }}>{t('Operatrice', 'Stylist')}</div>
              <div className="scroll" style={{ display: 'flex', gap: 9, overflowX: 'auto', paddingBottom: 6, marginInline: -2, paddingInline: 2 }}>
                <button className="press" onClick={() => setOperatorId(null)}
                  style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 99, border: '1.5px solid ' + (operatorId === null ? 'var(--brand)' : 'var(--hair)'), background: operatorId === null ? 'var(--brand)' : 'var(--paper-0)', color: operatorId === null ? 'var(--brand-on)' : 'var(--ink)' }}>
                  <Icon name="sparkle" size={15} color={operatorId === null ? 'var(--brand-on)' : 'var(--brand-ink)'} />
                  <span style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap' }}>{t('Prima disponibile', 'First available')}</span>
                </button>
                {eligibleOperators.map((op) => {
                  const on = operatorId === op.id;
                  return (
                    <button key={op.id} className="press" onClick={() => setOperatorId(op.id)}
                      style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px 7px 7px', borderRadius: 99, border: '1.5px solid ' + (on ? 'var(--brand)' : 'var(--hair)'), background: on ? 'var(--brand)' : 'var(--paper-0)', color: on ? 'var(--brand-on)' : 'var(--ink)' }}>
                      <div style={{ width: 24, height: 24, borderRadius: 99, background: op.color, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                        <span style={{ fontSize: 10, fontWeight: 800, color: '#2a2a2a' }}>{op.initials}</span>
                      </div>
                      <span style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap' }}>{op.first_name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {/* day strip — next 14 days */}
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
              <div className="t-sm" style={{ color: 'var(--muted)', marginTop: 8, marginBottom: 14 }}>
                {t('Nessun orario libero questo giorno. Prova un altro giorno o mettiti in lista d’attesa.', 'No free time this day. Try another day or join the waiting list.')}
              </div>
              <button className="press" onClick={() => setView('waitlist-new', { serviceId: serviceIds[0] || null })}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 18px', borderRadius: 99, background: 'var(--brand-tint)', color: 'var(--brand-ink)', fontWeight: 700, fontSize: 13.5 }}>
                <Icon name="clock" size={15} color="var(--brand-ink)" />{t('Vai alla lista d’attesa', 'Go to waiting list')}
              </button>
            </div>
          )}
        </div>
        <div style={{ flex: 1 }} />
        <StickyCta>
          <button className="btn btn--brand btn--block press" disabled={!slot} style={{ opacity: slot ? 1 : 0.4 }} onClick={() => setStep(2)}>
            {t('Continua', 'Continue')}
          </button>
        </StickyCta>
      </div>
    );
  }

  /* ============ STEP 3: I tuoi dati (solo anonimo) ============ */
  if (step === 3) {
    const okData = ident.first_name.trim() && ident.last_name.trim() && ident.phone.trim();
    return (
      <div style={{ paddingBottom: 30, minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
        {head(t('I tuoi dati', 'Your details'))}
        <div style={{ padding: '4px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="t-sm" style={{ color: 'var(--muted)' }}>
            {t('Ti inviamo un codice via SMS per confermare la prenotazione.', 'We send an SMS code to confirm your booking.')}
          </div>
          <input className="ca-input" placeholder={t('Nome', 'First name')} autoComplete="given-name"
            value={ident.first_name} onChange={(e) => setIdent((v) => ({ ...v, first_name: e.target.value }))} />
          <input className="ca-input" placeholder={t('Cognome', 'Last name')} autoComplete="family-name"
            value={ident.last_name} onChange={(e) => setIdent((v) => ({ ...v, last_name: e.target.value }))} />
          <input className="ca-input" type="tel" inputMode="tel" autoComplete="tel" placeholder="+39 333 000 0000"
            value={ident.phone} onChange={(e) => setIdent((v) => ({ ...v, phone: e.target.value }))} />
        </div>
        <div style={{ flex: 1 }} />
        <StickyCta>
          <button className="btn btn--brand btn--block press" disabled={!okData || booking} style={{ opacity: okData && !booking ? 1 : 0.5 }} onClick={sendBookingOtp}>
            {booking ? t('Invio…', 'Sending…') : t('Invia codice', 'Send code')}
          </button>
        </StickyCta>
      </div>
    );
  }

  /* ============ STEP 4: OTP (solo anonimo) ============ */
  if (step === 4) {
    return (
      <div style={{ paddingBottom: 30, minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
        {head(t('Conferma il numero', 'Confirm your number'))}
        <div style={{ padding: '4px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="t-sm" style={{ color: 'var(--muted)' }}>
            {t('Inserisci il codice a 6 cifre inviato al ', 'Enter the 6-digit code sent to ')}<b>{ident.phone}</b>.
          </div>
          {otpErr && <div className="ca-err"><Icon name="alert" size={15} color="var(--danger)" />{otpErr}</div>}
          <input className="ca-otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="······"
            value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(e) => { if (e.key === 'Enter' && otp.length === 6) verifyAndBook(); }} />
          <button className="press" style={{ alignSelf: 'flex-start', fontSize: 13, fontWeight: 700, color: 'var(--brand-ink)', background: 'none', border: 'none', cursor: 'pointer' }}
            onClick={sendBookingOtp} disabled={booking}>{t('Reinvia codice', 'Resend code')}</button>
        </div>
        <div style={{ flex: 1 }} />
        <StickyCta>
          <MutationButton className="btn btn--brand btn--block press" disabled={otp.length !== 6 || booking} style={{ opacity: otp.length === 6 && !booking ? 1 : 0.5 }} onClick={verifyAndBook}>
            <Icon name="check" size={18} color="var(--brand-on)" />
            {booking ? t('Conferma…', 'Confirming…') : t('Conferma prenotazione', 'Confirm booking')}
          </MutationButton>
        </StickyCta>
      </div>
    );
  }

  /* ============ STEP 2: review + confirm ============ */
  return (
    <div style={{ paddingBottom: 30, minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      {head(t('Conferma prenotazione', 'Confirm booking'))}
      <StepBar i={2} t={t} />
      <div style={{ padding: '0 22px' }}>
        <div className="card" style={{ padding: 20, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--hair)' }}>
            <div style={{ width: 46, height: 46, borderRadius: 13, background: 'var(--brand-tint)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Icon name={catIcon(s?.catName)} size={23} color="var(--brand-ink)" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: headFont(brand), fontSize: 19, fontWeight: brand.type === 'serif' ? 500 : 700, lineHeight: 1.2 }}>
                {svcs.map((sv) => svcLangName(sv, lang)).join(' + ')}
              </div>
            </div>
          </div>
          {svcs.length > 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid var(--hair)' }}>
              {svcs.map((sv) => (
                <div key={sv.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5 }}>
                  <span style={{ color: 'var(--ink-2)', fontWeight: 600 }}>{svcLangName(sv, lang)}</span>
                  <span className="t-num" style={{ color: 'var(--muted)' }}>{fmtEur(Number(sv.price), lang)}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            <DetailRow icon="calendar" label={t('Quando', 'When')} value={slot ? fmtDayMed(slot.start, lang) + ' · ' + timeLabel(minutesOfDay(slot.start)) : '—'} />
            <DetailRow icon="clock" label={t('Durata', 'Duration')} value={fmtDur(dur, lang)} />
            <DetailRow icon="user" label={t('Operatrice', 'Stylist')} value={selectedOperator ? `${selectedOperator.first_name} ${selectedOperator.last_name}` : t('Prima disponibile', 'First available')} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--hair)' }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{t('Totale', 'Total')}</span>
            <span className="t-num" style={{ fontSize: 22, color: 'var(--brand-ink)' }}>{fmtEur(price, lang)}</span>
          </div>
        </div>
        <div className="t-sm" style={{ color: 'var(--muted)', display: 'flex', alignItems: 'flex-start', gap: 7 }}>
          <Icon name="check" size={14} color="var(--ok)" stroke={2.4} />
          <span style={{ flex: 1 }}>{t('Mostriamo solo orari davvero liberi: se richiesta, la caparra ti verrà comunicata alla conferma.', 'We only show truly free times: if a deposit is required, you’ll be told on confirmation.')}</span>
        </div>
      </div>
      <div style={{ flex: 1 }} />
      <StickyCta>
        <MutationButton className="btn btn--brand btn--block press" disabled={booking} style={{ opacity: booking ? 0.6 : 1 }}
          onClick={() => (session ? confirm() : setStep(3))}>
          <Icon name="check" size={18} color="var(--brand-on)" />
          {booking ? t('Prenotazione…', 'Booking…') : t('Conferma prenotazione', 'Confirm booking')}
        </MutationButton>
      </StickyCta>
    </div>
  );
}
