import { withPortalForm, PortalFormBody } from '@youty/shared';
import { MutationButton } from '@youty/shared';
// NewApptModal — booking composer: client search, multi-service items, availability slots
// POST /api/agenda/appointments (shows returned deposit_amount/deposit_status, handles 409)
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, Avatar, Icon, Toggle, fmtEur, fmtDur, timeLabel, minutesOfDay, todayStr, depositMeta, statusMeta } from '@youty/shared';
import DkModal from '../../../ui/DkModal.jsx';
import { useDash } from '../../../ctx.jsx';
import { initialsOf, toastErr, fmtMoney } from '../lib.js';

function NewApptModal({ prefill, onClose, asDrawer, onCreated }) {
  const { t, lang, services, serviceCategories, operators, fireToast, hasScope, canMutate } = useDash();
  const pf = prefill || {};
  const canWrite = hasScope('agenda');

  /* ---- client picker ---- */
  const [q, setQ] = useState('');
  const [searchFocused, setSearchFocused] = useState(false); // tendina visibile solo al focus
  const [clients, setClients] = useState(null); // search results
  const [client, setClient] = useState(pf.clientId ? { id: pf.clientId, full_name: pf.clientName || '…' } : null);
  useEffect(() => {
    let alive = true;
    const tm = setTimeout(() => {
      api.get('/api/clients/', { params: { q: q || undefined, limit: 6 } })
        .then((res) => { if (alive) setClients(res.items || []); })
        .catch(() => { if (alive) setClients([]); });
    }, 220);
    return () => { alive = false; clearTimeout(tm); };
  }, [q]);
  // enrich prefilled client (deposit_always flag, full name)
  useEffect(() => {
    if (pf.clientId) {
      api.get(`/api/clients/${pf.clientId}`).then(setClient).catch(() => {});
    }
  }, [pf.clientId]);

  /* ---- date + items ---- */
  const [date, setDate] = useState(pf.date || (pf.start ? pf.start.slice(0, 10) : todayStr()));
  const seq = useRef(1);
  const initialItems = useMemo(() => {
    if (pf.serviceIds?.length) return pf.serviceIds.map((sid) => ({ key: 'i' + (seq.current++), service_id: sid, operator_id: pf.operatorId || null }));
    if (pf.operatorId) {
      const op = operators.find((o) => o.id === pf.operatorId);
      const sid = op?.service_ids?.[0];
      if (sid) return [{ key: 'i' + (seq.current++), service_id: sid, operator_id: pf.operatorId }];
    }
    return [];
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [items, setItems] = useState(initialItems);

  const activeServices = (services || []).filter((s) => s.active !== false);
  const svcOf = (id) => (services || []).find((s) => s.id === id);
  const catColor = (catId) => (serviceCategories || []).find((c) => c.id === catId)?.color || 'var(--clay)';
  const eligibleOps = (serviceId) => operators.filter((o) => (o.service_ids || []).includes(serviceId));

  const addItem = (serviceId) => {
    const preferred = pf.operatorId && eligibleOps(serviceId).some((o) => o.id === pf.operatorId) ? pf.operatorId : null;
    setItems((l) => [...l, { key: 'i' + (seq.current++), service_id: serviceId, operator_id: preferred }]);
  };
  const removeItem = (key) => setItems((l) => l.filter((x) => x.key !== key));
  const setItemOp = (key, opId) => setItems((l) => l.map((x) => (x.key === key ? { ...x, operator_id: opId } : x)));
  const isServiceSelected = (serviceId) => items.some((x) => x.service_id === serviceId);
  const toggleService = (serviceId) => {
    if (isServiceSelected(serviceId)) setItems((l) => l.filter((x) => x.service_id !== serviceId));
    else addItem(serviceId);
  };

  const totalPrice = items.reduce((s, it) => s + Number(svcOf(it.service_id)?.price || 0), 0);
  const totalDur = items.reduce((s, it) => { const sv = svcOf(it.service_id); return s + (sv?.duration_min || 0) + (sv?.soak_min || 0); }, 0);

  /* ---- availability ---- */
  const [slots, setSlots] = useState(null); // null = loading, [] = none
  const [selStart, setSelStart] = useState(null); // ISO string of chosen slot
  const [showAllTimes, setShowAllTimes] = useState(!pf.start);
  const itemsKey = JSON.stringify(items.map((i) => [i.service_id, i.operator_id]));
  useEffect(() => {
    if (!items.length || !date) { setSlots([]); setSelStart(null); return; }
    let alive = true;
    setSlots(null);
    api.get('/api/agenda/availability', { params: { date, items: items.map((i) => ({ service_id: i.service_id, operator_id: i.operator_id })) } })
      .then((res) => {
        if (!alive) return;
        setSlots(res);
        setSelStart((prev) => {
          if (prev && res.some((s) => s.start === prev)) return prev;
          if (pf.start && date === pf.start.slice(0, 10) && res.length) {
            const want = minutesOfDay(pf.start);
            // prende SEMPRE l'orario cliccato, arrotondando allo slot disponibile più vicino
            return res.reduce((best, s) =>
              Math.abs(minutesOfDay(s.start) - want) < Math.abs(minutesOfDay(best.start) - want) ? s : best
            ).start;
          }
          return null;
        });
      })
      .catch((err) => { if (alive) { setSlots([]); toastErr(err, t, fireToast); } });
    return () => { alive = false; };
  }, [date, itemsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const selSlot = (slots || []).find((s) => s.start === selStart) || null;
  const assignedName = (serviceId) => {
    const a = selSlot?.assignment?.find((x) => x.service_id === serviceId);
    const o = a && operators.find((op) => op.id === a.operator_id);
    return o ? o.first_name : null;
  };

  /* ---- note / flexible / submit ---- */
  const [note, setNote] = useState('');
  const [flexible, setFlexible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(null); // AppointmentOut after success

  const dateLabel = (() => {
    const d = new Date(date + 'T00:00');
    const today = new Date(todayStr() + 'T00:00');
    const diff = Math.round((d - today) / 86400000);
    const base = d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
    if (diff === 0) return t('Oggi', 'Today') + ' · ' + base;
    if (diff === 1) return t('Domani', 'Tomorrow') + ' · ' + base;
    return base + (diff > 1 ? ` · +${diff}g` : '');
  })();

  async function create() {
    if (!client || !items.length || !selStart || saving) return;
    setSaving(true);
    try {
      const res = await api.post('/api/agenda/appointments', {
        client_id: client.id,
        items: items.map((i) => ({ service_id: i.service_id, operator_id: i.operator_id })),
        start: selStart,
        note, flexible,
      });
      setCreated(res);
      fireToast({ msg: t(`Appuntamento creato per ${String(client.full_name).split(' ')[0]}`, `Appointment created for ${String(client.full_name).split(' ')[0]}`), icon: 'check' });
      onCreated?.(res);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        fireToast({ msg: t('Orario non più disponibile', 'Time no longer available'), icon: 'alert' });
        setSelStart(null); setShowAllTimes(true);
        api.get('/api/agenda/availability', { params: { date, items: items.map((i) => ({ service_id: i.service_id, operator_id: i.operator_id })) } })
          .then(setSlots).catch(() => {});
      } else toastErr(err, t, fireToast);
    } finally { setSaving(false); }
  }

  // drawer mode: reset to a clean form so staff can book another back-to-back
  function resetForm() {
    setCreated(null);
    setClient(null);
    setQ('');
    setClients(null);
    setItems([]);
    setSelStart(null);
    setSlots([]);
    setNote('');
    setFlexible(false);
    setShowAllTimes(true);
  }

  const inputCss = { border: '1px solid var(--hair)', borderRadius: 10, outline: 'none', fontSize: 13.5, padding: '9px 11px', fontFamily: 'var(--sans)', background: 'var(--surface)', boxSizing: 'border-box' };

  /* ---- drawer chrome (right-side panel, NO scrim so the agenda stays live) ---- */
  const drawerStyle = {
    position: 'fixed', top: 'var(--top-h)', right: 0, bottom: 0,
    width: 460, maxWidth: '92vw', zIndex: 120,
    background: 'var(--surface)', borderLeft: '1px solid var(--hair)', boxShadow: 'var(--sh-pop)',
    display: 'flex', flexDirection: 'column',
    animation: 'dkSlideR 280ms var(--ease-emph)',
  };
  // plain function (NOT a component) so the drawer body isn't remounted each
  // render — that would blur the search input / textarea on every keystroke.
  const drawerShell = ({ title, sub, foot, children }) => (
    <div style={drawerStyle}>
      <div className="dk-modalhead">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="t-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
          {sub && <div className="t-sm" style={{ color: 'var(--muted)', marginTop: 4 }}>{sub}</div>}
        </div>
        <button className="dk-iconbtn" style={{ flexShrink: 0, marginLeft: 12 }} onClick={onClose}><Icon name="x" size={18} /></button>
      </div>
      <div className="dk-modalbody" style={{ flex: 1, minHeight: 0 }}><PortalFormBody onClose={onClose}>{children}</PortalFormBody></div>
      {foot && <div style={{ padding: '16px 24px', borderTop: '1px solid var(--hair)', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'flex-end', background: 'var(--surface-2)' }}>{foot}</div>}
    </div>
  );

  /* ---- success view: deposit_amount / deposit_status from the API response ---- */
  if (created) {
    const dm = depositMeta(created.deposit_status, t);
    const sm = statusMeta(created.status, t);
    const successContent = (
      <React.Fragment>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 14, background: 'var(--ok-tint)', marginBottom: 14 }}>
          <div style={{ width: 38, height: 38, borderRadius: 12, background: 'var(--ok)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name="check" size={19} color="#fff" stroke={2.6} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{timeLabel(minutesOfDay(created.start))}–{timeLabel(minutesOfDay(created.end))} · {dateLabel}</div>
            <div className="t-sm" style={{ color: 'var(--muted)' }}>{(created.items || []).map((i) => i.service_name).join(' + ')}</div>
          </div>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: sm.color, background: sm.tint, padding: '3px 9px', borderRadius: 99, flexShrink: 0 }}>{sm.label}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 12, background: 'var(--surface-2)', marginBottom: 10 }}>
          <span style={{ fontWeight: 700 }}>{t('Totale', 'Total')}</span>
          <span className="t-num" style={{ fontSize: 17, fontWeight: 700 }}>{fmtMoney(created.total_price, lang)}</span>
        </div>
        {dm ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderRadius: 12, background: created.deposit_status === 'paid' ? 'var(--ok-tint)' : 'var(--warn-tint)' }}>
            <Icon name="wallet" size={17} color={dm.color} />
            <span style={{ flex: 1, fontWeight: 700, fontSize: 13.5, color: dm.color }}>{dm.label}</span>
            <span className="t-num" style={{ fontWeight: 700 }}>{fmtEur(Number(created.deposit_amount), lang)}</span>
          </div>
        ) : (
          <div className="t-sm" style={{ color: 'var(--muted-2)', padding: '2px 4px' }}>{t('Nessuna caparra richiesta', 'No deposit required')}</div>
        )}
      </React.Fragment>
    );
    if (asDrawer) {
      return drawerShell({
        title: t('Prenotazione creata', 'Booking created'),
        sub: created.client?.full_name,
        foot: (
          <React.Fragment>
            <MutationButton className="dk-btn dk-btn--ghost" onClick={resetForm}><Icon name="plus" size={16} />{t('Nuova prenotazione', 'New booking')}</MutationButton>
            <button className="dk-btn dk-btn--clay" onClick={onClose}><Icon name="check" size={16} color="#fff" />{t('Chiudi', 'Close')}</button>
          </React.Fragment>
        ),
        children: successContent,
      });
    }
    return (
      <DkModal open onClose={onClose} title={t('Prenotazione creata', 'Booking created')} sub={created.client?.full_name} width={480}
        foot={<button className="dk-btn dk-btn--clay" onClick={onClose}><Icon name="check" size={16} color="#fff" />{t('Chiudi', 'Close')}</button>}>
        {successContent}
      </DkModal>
    );
  }

  const formFoot = (
    <React.Fragment>
      <div style={{ flex: asDrawer ? '1 1 100%' : 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 14, color: 'var(--muted)' }}>
        {items.length > 0 && <span className="t-sm" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}><Icon name="clock" size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />{fmtDur(totalDur, lang)}</span>}
        {selStart && <span className="t-sm" style={{ fontWeight: 600, color: 'var(--clay-ink)', whiteSpace: 'nowrap' }}><Icon name="calendar" size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />{timeLabel(minutesOfDay(selStart))}</span>}
      </div>
      <button className="dk-btn dk-btn--ghost" onClick={onClose}>{t('Annulla', 'Cancel')}</button>
      <MutationButton className="dk-btn dk-btn--clay" disabled={!canWrite || !client || !items.length || !selStart || saving} onClick={create}>
        <Icon name="plus" size={17} color="#fff" />{saving ? t('Creazione…', 'Creating…') : t('Crea prenotazione', 'Create booking') + ' · ' + fmtMoney(totalPrice, lang)}
      </MutationButton>
    </React.Fragment>
  );

  const formTitle = t('Nuova prenotazione', 'New booking');
  const formSub = t('Scegli cliente, servizi e uno degli orari disponibili', 'Pick the client, the services and one of the available times');
  const dateBox = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: asDrawer ? 18 : 22, padding: '11px 14px', borderRadius: 12, border: '1px solid var(--hair)', background: 'var(--surface)' }}>
      <Icon name="calendar" size={17} color="var(--clay-ink)" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="t-meta" style={{ fontSize: 9.5, marginBottom: 1 }}>{t('Data', 'Date')}</div>
        <div style={{ fontWeight: 700, fontSize: 13.5, textTransform: 'capitalize' }}>{dateLabel}</div>
      </div>
      <input type="date" value={date} min={todayStr()} onChange={(e) => setDate(e.target.value || todayStr())} style={{ border: '1px solid var(--hair)', borderRadius: 8, padding: '6px 8px', fontSize: 12.5, fontFamily: 'var(--sans)', outline: 'none', cursor: 'pointer', color: 'var(--ink)' }} />
    </div>
  );
  const formBody = (
    <div>
      {/* la data va sopra al cliente */}
      {dateBox}
      <div style={{ display: 'grid', gridTemplateColumns: asDrawer ? '1fr' : '236px 1fr', gap: asDrawer ? 18 : 22 }}>
        {/* client */}
        <div>
          <div className="t-meta" style={{ marginBottom: 8 }}>{t('Cliente', 'Client')}</div>
          <div className="dk-search" style={{ width: '100%', marginBottom: 8 }}>
            <Icon name="search" size={17} color="var(--muted-2)" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Cerca…', 'Search…')}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 150)} />
          </div>
          {client && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px', borderRadius: 10, background: 'var(--clay-tint)', marginBottom: 6 }}>
              <Avatar initials={initialsOf(client.full_name)} size={32} />
              <span style={{ flex: 1, fontWeight: 700, fontSize: 13.5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{client.full_name}</span>
              <button onClick={() => setClient(null)} style={{ cursor: 'pointer', border: 'none', background: 'transparent', display: 'grid', placeItems: 'center' }}><Icon name="x" size={14} color="var(--muted-2)" /></button>
            </div>
          )}
          {/* la tendina compare solo al click/focus della barra; a riposo solo la ricerca */}
          {searchFocused && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {clients === null && [...Array(4)].map((_, i) => <div key={i} className="skel" style={{ height: 44, borderRadius: 10 }} />)}
              {(clients || []).filter((c) => !client || c.id !== client.id).map((cl) => (
                <button key={cl.id} className="dk-row" onClick={() => { setClient(cl); setQ(''); }} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px', borderRadius: 10, background: 'transparent', textAlign: 'left', border: 'none', cursor: 'pointer' }}>
                  <Avatar initials={initialsOf(cl.full_name)} size={32} />
                  <span style={{ flex: 1, fontWeight: 600, fontSize: 13.5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cl.full_name}</span>
                </button>
              ))}
              {clients && !clients.length && <div className="t-sm" style={{ color: 'var(--muted-2)', padding: '8px 4px' }}>{t('Nessun cliente trovato', 'No client found')}</div>}
            </div>
          )}
          {client?.deposit_always && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12, padding: '10px 12px', background: 'var(--warn-tint)', borderRadius: 10 }}>
              <Icon name="coupon" size={15} color="var(--warn)" />
              <span className="t-sm" style={{ color: 'var(--ink-2)', fontWeight: 600 }}>{t('Cliente con caparra obbligatoria · verrà richiesta in automatico', 'Deposit-always client · it will be required automatically')}</span>
            </div>
          )}
        </div>

        {/* booking builder */}
        <div>
          {/* services catalogue */}
          <div className="t-meta" style={{ marginBottom: 8 }}>{t('Aggiungi i servizi richiesti', 'Add the requested services')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 16 }}>
            {activeServices.map((s) => {
              const on = isServiceSelected(s.id);
              return (
                <button key={s.id} onClick={() => toggleService(s.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 12px', borderRadius: 99, fontSize: 12.5, fontWeight: on ? 700 : 600, cursor: 'pointer', border: '1.5px solid ' + (on ? 'var(--clay)' : 'var(--hair)'), background: on ? 'var(--clay-tint)' : 'var(--surface)', color: on ? 'var(--clay-ink)' : 'var(--ink-2)' }}>
                  <span style={{ width: 7, height: 7, borderRadius: 99, background: catColor(s.category_id) }} />
                  {lang === 'en' && s.name_en ? s.name_en : s.name_it}
                  <Icon name={on ? 'check' : 'plus'} size={13} color={on ? 'var(--clay-ink)' : 'var(--muted-2)'} stroke={on ? 2.6 : undefined} />
                </button>
              );
            })}
          </div>

          {/* item lines */}
          {!items.length ? (
            <div style={{ textAlign: 'center', padding: '28px 20px', border: '1.5px dashed var(--line-strong)', borderRadius: 14, color: 'var(--muted)', marginBottom: 16 }}>
              <Icon name="calendar" size={26} color="var(--muted-2)" style={{ margin: '0 auto 8px' }} />
              <div className="t-sm" style={{ fontWeight: 600 }}>{t('Aggiungi un servizio per iniziare la prenotazione', 'Add a service to start the booking')}</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
              {items.map((it) => {
                const s = svcOf(it.service_id);
                if (!s) return null;
                const eligible = eligibleOps(it.service_id);
                const assigned = it.operator_id === null && selSlot ? assignedName(it.service_id) : null;
                return (
                  <div key={it.key} style={{ border: '1px solid var(--hair)', borderRadius: 14, overflow: 'hidden', background: 'var(--surface)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 14px', background: `color-mix(in srgb, ${catColor(s.category_id)} 16%, var(--surface))`, borderBottom: '1px solid var(--hair)' }}>
                      <span style={{ width: 10, height: 10, borderRadius: 99, background: catColor(s.category_id), flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.15 }}>{lang === 'en' && s.name_en ? s.name_en : s.name_it}</div>
                        <div className="t-sm" style={{ color: 'var(--muted)', marginTop: 2 }}>
                          <Icon name="clock" size={12} style={{ verticalAlign: '-2px', marginRight: 3 }} />{fmtDur((s.duration_min || 0) + (s.soak_min || 0), lang)}{s.soak_min ? ' · ' + t('incl. posa', 'incl. soak') + ' ' + fmtDur(s.soak_min, lang) : ''}
                          {assigned && <span> · {t('assegnato a', 'assigned to')} <b style={{ color: 'var(--ink)' }}>{assigned}</b></span>}
                        </div>
                      </div>
                      <span className="t-num" style={{ fontSize: 15, fontWeight: 700, flexShrink: 0 }}>{fmtEur(Number(s.price), lang)}</span>
                      <button className="dk-iconbtn" style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0 }} onClick={() => removeItem(it.key)}><Icon name="x" size={15} /></button>
                    </div>
                    <div style={{ padding: '12px 14px' }}>
                      <div className="t-meta" style={{ marginBottom: 8 }}>{t('Operatrice', 'Stylist')}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                        <button onClick={() => setItemOp(it.key, null)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 13px', borderRadius: 99, cursor: 'pointer', border: '1.5px solid ' + (it.operator_id === null ? 'var(--clay)' : 'var(--hair)'), background: it.operator_id === null ? 'var(--clay-tint)' : 'var(--surface)', fontSize: 13, fontWeight: it.operator_id === null ? 700 : 600, color: it.operator_id === null ? 'var(--clay-ink)' : 'var(--ink-2)' }}>
                          <Icon name="sparkle" size={13} color={it.operator_id === null ? 'var(--clay-ink)' : 'var(--muted-2)'} />{t('Prima disponibile', 'First available')}
                        </button>
                        {eligible.map((o) => {
                          const on = o.id === it.operator_id;
                          return (
                            <button key={o.id} onClick={() => setItemOp(it.key, o.id)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 13px 4px 5px', borderRadius: 99, cursor: 'pointer', border: '1.5px solid ' + (on ? (o.color || 'var(--clay)') : 'var(--hair)'), background: on ? `color-mix(in srgb, ${o.color || 'var(--clay)'} 18%, var(--surface))` : 'var(--surface)' }}>
                              <Avatar initials={o.initials} size={24} color={o.color || 'var(--clay)'} />
                              <span style={{ fontSize: 13, fontWeight: on ? 700 : 600, whiteSpace: 'nowrap' }}>{o.first_name}</span>
                              {on && <Icon name="check" size={14} color={o.color || 'var(--clay)'} stroke={2.6} />}
                            </button>
                          );
                        })}
                        {!eligible.length && <span className="t-sm" style={{ color: 'var(--danger)', fontWeight: 600 }}>{t('Nessuna operatrice abilitata a questo servizio', 'No stylist can perform this service')}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* availability slots */}
          {items.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div className="hr" style={{ margin: '0 0 12px' }} />
              {!showAllTimes && selStart ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="t-meta" style={{ margin: 0 }}>{t('Orario', 'Time')}</div>
                  <span className="t-num" style={{ fontSize: 14, fontWeight: 700 }}>{timeLabel(minutesOfDay(selStart))}</span>
                  <button onClick={() => setShowAllTimes(true)} style={{ marginLeft: 'auto', cursor: 'pointer', background: 'transparent', border: 'none', fontSize: 12.5, fontWeight: 700, color: 'var(--clay-ink)' }}>{t('Cambia orario', 'Change time')}</button>
                </div>
              ) : (
                <React.Fragment>
                  <div className="t-meta" style={{ marginBottom: 9 }}>{t('Orari disponibili', 'Available times')}</div>
                  {slots === null ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {[...Array(10)].map((_, i) => <div key={i} className="skel" style={{ width: 56, height: 30, borderRadius: 8 }} />)}
                    </div>
                  ) : slots.length ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {slots.map((s) => {
                        const sel = s.start === selStart;
                        return (
                          <button key={s.start} onClick={() => setSelStart(s.start)} className="tabnum" style={{ padding: '5px 9px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: '1.5px solid ' + (sel ? 'var(--ink)' : 'var(--hair)'), background: sel ? 'var(--ink)' : 'var(--surface)', color: sel ? '#fff' : 'var(--ink)' }}>
                            {timeLabel(minutesOfDay(s.start))}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="t-sm" style={{ color: 'var(--danger)', fontWeight: 600 }}>{t('Nessuno slot libero per questa combinazione — prova un altro giorno o operatrice', 'No free slot for this combination — try another day or stylist')}</div>
                  )}
                </React.Fragment>
              )}
            </div>
          )}

          {/* note + flexible */}
          <div style={{ marginBottom: 12 }}>
            <div className="t-meta" style={{ marginBottom: 6 }}>{t('Nota (facoltativa)', 'Note (optional)')}</div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={t('es. preferisce il tono più freddo…', 'e.g. prefers the cooler tone…')} style={{ ...inputCss, width: '100%', resize: 'vertical' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 15px', background: 'var(--surface-2)', borderRadius: 14 }}>
            <Icon name="refresh" size={18} color="var(--clay-ink)" />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{t('Cliente flessibile', 'Flexible client')}</div>
              <div className="t-sm" style={{ color: 'var(--muted)' }}>{t('Disponibile a spostarsi per ottimizzare l’agenda', 'Open to being moved to optimise the agenda')}</div>
            </div>
            <Toggle on={flexible} onChange={setFlexible} />
          </div>
        </div>
      </div>
    </div>
  );

  if (asDrawer) {
    return drawerShell({ title: formTitle, sub: formSub, foot: formFoot, children: formBody });
  }
  return (
    <DkModal open onClose={onClose} title={formTitle} sub={formSub} width={780} foot={formFoot}>
      {formBody}
    </DkModal>
  );
}

export default withPortalForm(NewApptModal);
