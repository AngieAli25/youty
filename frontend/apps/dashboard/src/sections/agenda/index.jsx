import { useMutationAction } from '@youty/shared';
import { MutationNumInput } from '@youty/shared';
import { MutationButton } from '@youty/shared';
// Agenda — day/week/month calendar wired to /api/agenda/* (port of desktop-agenda.jsx)
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, Avatar, Icon, timeLabel, toDateStr, todayStr, parseISO, NumInput } from '@youty/shared';
import { useDash } from '../../ctx.jsx';
import {
  MONTHS_IT, MONTHS_EN, DOW_IT, DOW_EN,
  isoAtMin, mondayOf, addMonths, toastErr, firstName, opDisplay,
} from './lib.js';
import DayGrid, { ApptHoverCard } from './DayGrid.jsx';
import WeekView from './WeekView.jsx';
import MonthView from './MonthView.jsx';
import RightRail from './RightRail.jsx';
import NewApptModal from './modals/NewApptModal.jsx';
import GroupBookingDrawer from './modals/GroupBookingDrawer.jsx';

export default function AgendaSection() {
  const {
    t, lang, operators, services, serviceCategories, hasScope, canMutate,
    openModal, modal, fireToast, opColors, setOpColor, opPalette,
    setTab, setDeepLink, showRevenue,
  } = useDash();
  const canWrite = canMutate('agenda');
  const mutation = useMutationAction();

  /* ---- navigation state ---- */
  const [date, setDate] = useState(todayStr());
  const [calView, setCalView] = useState('day'); // day | week | month
  const [jumpOpen, setJumpOpen] = useState(false);
  const [railOpen, setRailOpenRaw] = useState(() => {
    try { return localStorage.getItem('dk-agenda-rail') !== '0'; } catch { return true; }
  });
  const setRailOpen = (v) => {
    setRailOpenRaw(v);
    try { localStorage.setItem('dk-agenda-rail', v ? '1' : '0'); } catch { /* ignore */ }
  };

  /* ---- real "now" (updated every 30s) ---- */
  const [nowMin, setNowMin] = useState(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); });
  useEffect(() => {
    const id = setInterval(() => { const d = new Date(); setNowMin(d.getHours() * 60 + d.getMinutes()); }, 30000);
    return () => clearInterval(id);
  }, []);
  const isToday = date === todayStr();

  /* ---- day data ---- */
  const [dayData, setDayData] = useState(null);   // null = first load → skeleton
  const [waitlist, setWaitlist] = useState([]);
  const [summary, setSummary] = useState(null);

  const fetchDay = useCallback(async () => {
    const rows = await api.get('/api/agenda/day', { params: { date } });
    setDayData(rows);
  }, [date]);
  const fetchWaitlist = useCallback(() => api.get('/api/agenda/waitlist').then(setWaitlist).catch(() => {}), []);
  const fetchSummary = useCallback(() => api.get('/api/sales/today-summary').then(setSummary).catch(() => {}), []);
  const refetchAll = useCallback(() => { fetchDay().catch(() => {}); fetchWaitlist(); fetchSummary(); }, [fetchDay, fetchWaitlist, fetchSummary]);

  useEffect(() => {
    let alive = true;
    setDayData(null);
    api.get('/api/agenda/day', { params: { date } })
      .then((rows) => { if (alive) setDayData(rows); })
      .catch((err) => { if (alive) { setDayData([]); toastErr(err, t, fireToast); } });
    return () => { alive = false; };
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { fetchWaitlist(); fetchSummary(); }, [fetchWaitlist, fetchSummary]);

  /* refetch after any modal closes — mutations happen inside modals, keep the grid fresh */
  const prevModal = useRef(modal);
  useEffect(() => {
    if (prevModal.current && !modal) refetchAll();
    prevModal.current = modal;
  }, [modal, refetchAll]);

  /* ---- operator visibility chips ---- */
  const [vis, setVis] = useState({});
  useEffect(() => {
    setVis((m) => {
      const next = { ...m };
      operators.forEach((o) => { if (next[o.id] === undefined) next[o.id] = true; });
      return next;
    });
  }, [operators]);
  const visCount = operators.filter((o) => vis[o.id]).length;
  const allOn = operators.every((o) => vis[o.id]);
  const opFirsts = operators.map((o) => o.first_name); // disambiguazione omonimie nelle chip
  const toggleVis = (id) => setVis((m) => ({ ...m, [id]: !m[id] }));
  const setAll = (on) => setVis(() => { const m = {}; operators.forEach((o) => { m[o.id] = on; }); return m; });

  const colorOf = useCallback((id) => opColors[id] || 'var(--clay)', [opColors]);
  const catColor = useCallback((catId) => {
    const c = (serviceCategories || []).find((x) => x.id === catId);
    return c ? c.color : null;
  }, [serviceCategories]);
  // colore per-servizio, dalla categoria del servizio (fallback: colore operatrice)
  const itemColor = useCallback((item) => {
    const s = (services || []).find((x) => x.id === item.service_id);
    const col = s ? catColor(s.category_id) : null;
    return col || colorOf(item.operator_id);
  }, [services, catColor, colorOf]);

  /* ---- interactions state ---- */
  const [hover, setHover] = useState(null);       // { a, x, y, side }
  const [slotMenu, setSlotMenu] = useState(null); // { opId, startMin, x, y, mode?, dur? }
  const [picker, setPicker] = useState(null);     // opId whose colour picker is open

  const onHover = (a, el) => {
    if (!a) { setHover(null); return; }
    const r = el.getBoundingClientRect();
    const right = r.right + 320 < window.innerWidth;
    setHover({ a, x: right ? r.right + 10 : r.left - 10, y: Math.min(r.top, window.innerHeight - 260), side: right ? 'right' : 'left' });
  };

  /* ---- new-appointment drawer (#5) + group booking (#6): live panels, agenda resta visibile ---- */
  const [newAppt, setNewAppt] = useState(null); // prefill | null
  const [groupOpen, setGroupOpen] = useState(false);
  const openNewAppt = mutation((prefill) => { if (hasScope('agenda')) setNewAppt(prefill || {}); });

  /* ---- mutations (drag & drop, pauses) ---- */
  const [pending, setPending] = useState(null); // optimistic override { kind, id, startMin, opId, dur }

  const moveAppt = async (a, startMin, opId) => {
    if (startMin === undefined || (startMin === aMin(a.start) && opId === a.operator_id)) return;
    setPending({ kind: 'appt', id: a.id, startMin, opId });
    try {
      await api.post(`/api/agenda/appointments/${a.id}/move`, { start: isoAtMin(date, startMin), operator_id: opId });
      const reassigned = opId !== a.operator_id;
      const opName = firstName((operators.find((o) => o.id === opId) || {}).first_name || '');
      fireToast({
        msg: reassigned
          ? t(`Spostato a ${opName}, ${timeLabel(startMin)}`, `Moved to ${opName}, ${timeLabel(startMin)}`)
          : t('Spostato alle ' + timeLabel(startMin), 'Moved to ' + timeLabel(startMin)),
        icon: 'calendar',
      });
      await fetchDay();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) fireToast({ msg: t('Orario non più disponibile', 'Time no longer available'), icon: 'alert' });
      else toastErr(err, t, fireToast);
      await fetchDay().catch(() => {}); // revert to server truth
    } finally { setPending(null); }
  };

  const movePause = async (p, startMin, opId) => {
    setPending({ kind: 'pause', id: p.id, startMin, opId });
    try {
      await api.put(`/api/agenda/pauses/${p.id}`, { operator_id: opId, start: isoAtMin(date, startMin), duration_min: p.duration_min, note: p.note || '' });
      await fetchDay();
    } catch (err) { toastErr(err, t, fireToast); await fetchDay().catch(() => {}); }
    finally { setPending(null); }
  };

  const resizePause = async (p, dur) => {
    if (dur === p.duration_min) return;
    setPending({ kind: 'pause', id: p.id, startMin: aMin(p.start), opId: p.operator_id, dur });
    try {
      await api.put(`/api/agenda/pauses/${p.id}`, { operator_id: p.operator_id, start: p.start, duration_min: dur, note: p.note || '' });
      await fetchDay();
    } catch (err) { toastErr(err, t, fireToast); await fetchDay().catch(() => {}); }
    finally { setPending(null); }
  };

  const deletePause = async (p) => {
    try {
      await api.del(`/api/agenda/pauses/${p.id}`);
      fireToast({ msg: t('Pausa rimossa', 'Break removed'), icon: 'x' });
      await fetchDay();
    } catch (err) { toastErr(err, t, fireToast); }
  };

  // #1 — resize del bordo inferiore di un blocco = nuova durata di QUEL servizio.
  // Invia l'intera lista item (il backend onora duration_min per item e non ritocca la caparra).
  const resizeItem = async (appt, item, newDur) => {
    if (!newDur || newDur === item.duration_min) return;
    try {
      const items = (appt.items || []).map((it) => ({
        id: it.id, service_id: it.service_id, operator_id: it.operator_id,
        duration_min: it.id === item.id ? newDur : it.duration_min,
      }));
      await api.put(`/api/agenda/appointments/${appt.id}`, { items });
      fireToast({ msg: t('Durata aggiornata', 'Duration updated'), icon: 'check' });
      await fetchDay();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) fireToast({ msg: t('Orario non più disponibile', 'Time no longer available'), icon: 'alert' });
      else toastErr(err, t, fireToast);
      await fetchDay().catch(() => {});
    }
  };

  const addBreak = async (opId, startMin, dur) => {
    setSlotMenu(null);
    try {
      await api.post('/api/agenda/pauses', { operator_id: opId, start: isoAtMin(date, startMin), duration_min: dur || 60 });
      const o = operators.find((x) => x.id === opId);
      fireToast({
        msg: t(`Pausa aggiunta · ${firstName(o?.first_name)} alle ${timeLabel(startMin)}`, `Break added · ${firstName(o?.first_name)} at ${timeLabel(startMin)}`),
        icon: 'clock',
      });
      await fetchDay();
    } catch (err) { toastErr(err, t, fireToast); }
  };

  /* ---- toolbar helpers ---- */
  const MONTHS = lang === 'en' ? MONTHS_EN : MONTHS_IT;
  const cur = parseISO(date);
  const navPrev = () => {
    if (calView === 'day') { const d = parseISO(date); d.setDate(d.getDate() - 1); setDate(toDateStr(d)); }
    else if (calView === 'week') { const d = parseISO(date); d.setDate(d.getDate() - 7); setDate(toDateStr(d)); }
    else setDate(addMonths(date, -1));
  };
  const navNext = () => {
    if (calView === 'day') { const d = parseISO(date); d.setDate(d.getDate() + 1); setDate(toDateStr(d)); }
    else if (calView === 'week') { const d = parseISO(date); d.setDate(d.getDate() + 7); setDate(toDateStr(d)); }
    else setDate(addMonths(date, 1));
  };
  const jumpToMonth = (m, y) => { setCalView('month'); setDate(toDateStr(new Date(y, m, 1))); setJumpOpen(false); };
  const jumpToDate = (iso) => { if (!iso) return; setDate(iso); setCalView('day'); setJumpOpen(false); };

  const monday = mondayOf(date);
  const weekDays = [...Array(7)].map((_, i) => {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    return d;
  });
  const periodLabel = () => {
    if (calView === 'month') return MONTHS[cur.getMonth()] + ' ' + cur.getFullYear();
    const s = weekDays[0], e = weekDays[6];
    return s.getMonth() === e.getMonth()
      ? `${s.getDate()}–${e.getDate()} ${MONTHS[e.getMonth()]} ${e.getFullYear()}`
      : `${s.getDate()} ${MONTHS[s.getMonth()].slice(0, 3)} – ${e.getDate()} ${MONTHS[e.getMonth()].slice(0, 3)} ${e.getFullYear()}`;
  };

  const openDay = (iso) => { setDate(iso); setCalView('day'); };
  const rows = (dayData || []).filter((r) => vis[r.operator.id] !== false);
  const visibleRows = rows.length ? rows : (dayData || []);

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* timeline column */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* sub toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 26px', borderBottom: '1px solid var(--hair)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button className="dk-iconbtn" style={{ width: 38, height: 38 }} onClick={navPrev}><Icon name="chevL" size={18} /></button>
            <button className="dk-iconbtn" style={{ width: 38, height: 38 }} onClick={navNext}><Icon name="chevR" size={18} /></button>
          </div>
          {calView === 'day' ? (
            <React.Fragment>
              <div style={{ position: 'relative' }}>
                <button onClick={() => setJumpOpen((o) => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', background: 'transparent', border: 'none', fontFamily: 'var(--serif)', fontSize: 19, fontWeight: 500, color: 'var(--ink)', whiteSpace: 'nowrap' }}>
                  {MONTHS[cur.getMonth()] + ' ' + cur.getFullYear()}
                  <Icon name="chevD" size={15} color="var(--muted)" style={{ transform: jumpOpen ? 'rotate(180deg)' : 'none', transition: 'transform 140ms' }} />
                </button>
                {jumpOpen && <JumpPopover t={t} MONTHS={MONTHS} curM={cur.getMonth()} curY={cur.getFullYear()} onClose={() => setJumpOpen(false)} onMonth={jumpToMonth} onDate={jumpToDate} />}
              </div>
              {/* week day strip — real dates */}
              <div style={{ display: 'flex', gap: 4, background: 'var(--surface)', border: '1px solid var(--hair)', borderRadius: 14, padding: 4 }}>
                {weekDays.map((d, i) => {
                  const iso = toDateStr(d);
                  const sel = iso === date;
                  return (
                    <button key={i} onClick={() => setDate(iso)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '6px 13px', borderRadius: 10, cursor: 'pointer', background: sel ? 'var(--ink)' : 'transparent', color: sel ? '#fff' : 'var(--ink)', border: 'none', transition: 'all 150ms' }}>
                      <span style={{ fontSize: 10.5, fontWeight: 600, opacity: sel ? 0.7 : 0.5 }}>{t(DOW_IT[i], DOW_EN[i])}</span>
                      <span className="t-num" style={{ fontSize: 17, color: sel ? '#fff' : 'var(--ink)' }}>{d.getDate()}</span>
                    </button>
                  );
                })}
              </div>
              {!isToday && <button className="dk-btn dk-btn--soft" style={{ height: 40 }} onClick={() => setDate(todayStr())}>{t('Oggi', 'Today')}</button>}
            </React.Fragment>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ position: 'relative' }}>
                <button onClick={() => setJumpOpen((o) => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', background: 'transparent', border: 'none', fontFamily: 'var(--serif)', fontSize: 21, fontWeight: 500, color: 'var(--ink)' }}>
                  {periodLabel()}
                  <Icon name="chevD" size={16} color="var(--muted)" style={{ transform: jumpOpen ? 'rotate(180deg)' : 'none', transition: 'transform 140ms' }} />
                </button>
                {jumpOpen && <JumpPopover t={t} MONTHS={MONTHS} curM={cur.getMonth()} curY={cur.getFullYear()} onClose={() => setJumpOpen(false)} onMonth={jumpToMonth} onDate={jumpToDate} />}
              </div>
              {!isToday && <button className="dk-btn dk-btn--soft" style={{ height: 36 }} onClick={() => setDate(todayStr())}>{t('Oggi', 'Today')}</button>}
            </div>
          )}
          <div style={{ flex: 1 }} />
          {hasScope('agenda') && (
            <MutationButton className="dk-btn dk-btn--soft" style={{ height: 40 }} onClick={() => setGroupOpen(true)} title={t('Prenota più clienti insieme', 'Book several clients together')}>
              <Icon name="clients" size={16} />{t('Gruppo', 'Group')}
            </MutationButton>
          )}
          {/* view selector: Giorno / Settimana / Mese */}
          <div style={{ display: 'flex', gap: 4, background: 'var(--surface)', border: '1px solid var(--hair)', borderRadius: 12, padding: 4 }}>
            {[['day', 'Giorno', 'Day'], ['week', 'Settimana', 'Week'], ['month', 'Mese', 'Month']].map(([v, it, en]) => {
              const sel = calView === v;
              return <button key={v} onClick={() => setCalView(v)} style={{ padding: '8px 15px', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none', background: sel ? 'var(--ink)' : 'transparent', color: sel ? '#fff' : 'var(--ink)', transition: 'all 140ms' }}>{t(it, en)}</button>;
            })}
          </div>
        </div>

        {/* body — day / week / month */}
        {calView === 'week' ? (
          <WeekView weekStart={toDateStr(monday)} operators={operators} colorOf={colorOf} nowMin={isTodayInWeek(weekDays) ? nowMin : null} onOpenDay={openDay} onNewAppt={openNewAppt} />
        ) : calView === 'month' ? (
          <MonthView anchor={date} onOpenDay={openDay} />
        ) : (
          <React.Fragment>
            {/* staff visibility filter chips */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 26px', borderBottom: '1px solid var(--hair)', overflowX: 'auto' }}>
              <span className="t-meta" style={{ flexShrink: 0 }}>{t('Calendari', 'Calendars')}</span>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'nowrap' }}>
                {operators.map((o) => {
                  const on = vis[o.id] !== false;
                  const col = colorOf(o.id);
                  return (
                    <button key={o.id} onClick={() => toggleVis(o.id)} title={`${o.first_name} ${o.last_name}`.trim() + (o.role_title ? ' · ' + o.role_title : '')} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 12px 5px 6px', borderRadius: 99, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap', border: '1px solid ' + (on ? 'transparent' : 'var(--hair)'), background: on ? col : 'var(--surface)', transition: 'all 140ms' }}>
                      <Avatar initials={o.initials} size={24} color={col} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: on ? 'var(--ink)' : 'var(--muted)' }}>{opDisplay(o.first_name, o.last_name, opFirsts)}</span>
                      {on && <Icon name="check" size={13} color="var(--ink)" stroke={2.6} />}
                    </button>
                  );
                })}
              </div>
              <div style={{ flex: 1, minWidth: 8 }} />
              <span className="t-sm tabnum" style={{ color: 'var(--muted)', fontWeight: 600, flexShrink: 0 }}>{visCount}/{operators.length}</span>
              <button className="dk-btn dk-btn--soft" style={{ height: 32, fontSize: 12.5, flexShrink: 0 }} onClick={() => setAll(!allOn)}>{allOn ? t('Deseleziona', 'Clear') : t('Tutte', 'All')}</button>
            </div>

            {dayData === null ? (
              <DaySkeleton />
            ) : (
              <DayGrid
                rows={visibleRows}
                date={date}
                nowMin={isToday ? nowMin : null}
                colorOf={colorOf}
                itemColor={itemColor}
                pending={pending}
                canWrite={canWrite}
                showRevenue={showRevenue}
                picker={picker}
                setPicker={setPicker}
                setOpColor={setOpColor}
                opPalette={opPalette}
                onHover={onHover}
                onLeave={() => setHover(null)}
                onOpenAppt={(a) => openModal('apptdetail', { appointment: a, onMutate: refetchAll })}
                onSlotMenu={mutation((opId, startMin, x, y) => { if (hasScope('agenda')) setSlotMenu({ opId, startMin, x, y }); })}
                onMoveAppt={moveAppt}
                onResizeItem={resizeItem}
                onMovePause={movePause}
                onResizePause={resizePause}
                onDeletePause={deletePause}
              />
            )}
          </React.Fragment>
        )}
      </div>

      {/* right rail — collapsible */}
      {railOpen ? (
        <aside className="dk-rail" style={{ width: 'var(--rail-w)', flexShrink: 0, borderLeft: '1px solid var(--hair)', background: 'var(--paper)', overflowY: 'auto', padding: '14px 22px 22px' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button className="dk-rail-toggle" onClick={() => setRailOpen(false)} title={t('Comprimi pannello', 'Collapse panel')} style={{ width: 30, height: 30, border: 'none' }}><Icon name="chevR" size={16} /></button>
          </div>
          <RightRail
            summary={summary}
            waitlist={waitlist}
            onOpenLog={() => { setDeepLink && setDeepLink('log-today'); setTab('impostazioni'); }}
            onOpenWaitlist={() => openModal('waitlist')}
            onOpenOpportunity={() => openModal('opportunity')}
          />
        </aside>
      ) : (
        <aside style={{ width: 52, flexShrink: 0, borderLeft: '1px solid var(--hair)', background: 'var(--paper)', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 14, gap: 4 }}>
          <button className="dk-rail-toggle" onClick={() => setRailOpen(true)} title={t('Espandi pannello', 'Expand panel')} style={{ width: 30, height: 30, border: 'none' }}><Icon name="chevL" size={16} /></button>
          <Icon name="calendar" size={18} color="var(--muted-2)" style={{ marginTop: 10 }} />
        </aside>
      )}

      {hover && <ApptHoverCard hover={hover} t={t} lang={lang} operators={operators} colorOf={colorOf} />}

      {/* slot menu — new appointment / add break */}
      {slotMenu && (
        <React.Fragment>
          <div onClick={() => setSlotMenu(null)} style={{ position: 'fixed', inset: 0, zIndex: 95 }} />
          <div className="dk-card" style={{ position: 'fixed', boxSizing: 'border-box', top: Math.min(slotMenu.y, window.innerHeight - (slotMenu.mode === 'break' ? 300 : 130)), left: Math.min(slotMenu.x, window.innerWidth - 246), zIndex: 96, width: 234, padding: 6, boxShadow: 'var(--sh-pop)', overflow: 'hidden' }}>
            <div className="t-meta" style={{ padding: '6px 10px 4px' }}>
              {firstName((operators.find((o) => o.id === slotMenu.opId) || {}).first_name)} · {timeLabel(slotMenu.startMin)}
            </div>
            {slotMenu.mode === 'break' ? (
              <div style={{ padding: '4px 8px 8px' }}>
                <div className="t-sm" style={{ fontWeight: 700, color: 'var(--muted)', margin: '4px 2px 8px' }}>{t('Durata pausa', 'Break duration')}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 8 }}>
                  {[15, 30, 45, 60, 90, 120].map((d) => {
                    const on = (slotMenu.dur || 60) === d;
                    return (
                      <MutationButton key={d} onClick={() => setSlotMenu((m) => ({ ...m, dur: d }))} style={{ padding: '8px 0', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: '1px solid ' + (on ? 'var(--clay)' : 'var(--hair)'), background: on ? 'var(--clay-tint)' : 'var(--surface)', color: on ? 'var(--clay-ink)' : 'var(--ink-2)' }}>{d < 60 ? d + ' min' : (d / 60) + ' h'}</MutationButton>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '0 2px' }}>
                  <span className="t-sm" style={{ color: 'var(--muted)', flex: 1 }}>{t('Personalizzata', 'Custom')}</span>
                  <MutationNumInput integer min={5} value={slotMenu.dur || 60} onChange={(dur) => setSlotMenu((m) => ({ ...m, dur }))} style={{ width: 64, textAlign: 'right', border: '1px solid var(--hair)', borderRadius: 8, padding: '6px 8px', fontSize: 13, fontWeight: 700, fontFamily: 'var(--mono, monospace)', outline: 'none' }} />
                  <span className="t-sm" style={{ color: 'var(--muted-2)' }}>min</span>
                </div>
                <div className="t-sm" style={{ color: 'var(--muted-2)', marginBottom: 10, padding: '0 2px' }}>{timeLabel(slotMenu.startMin)}–{timeLabel(slotMenu.startMin + (slotMenu.dur || 60))}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="dk-btn dk-btn--ghost" style={{ flex: 1, minWidth: 0, height: 36, padding: '0 6px', boxSizing: 'border-box' }} onClick={() => setSlotMenu((m) => ({ ...m, mode: null }))}>{t('Indietro', 'Back')}</button>
                  <MutationButton className="dk-btn dk-btn--clay" style={{ flex: 1, minWidth: 0, height: 36, padding: '0 6px', boxSizing: 'border-box' }} onClick={() => addBreak(slotMenu.opId, slotMenu.startMin, slotMenu.dur || 60)}><Icon name="check" size={15} color="#fff" />{t('Aggiungi', 'Add')}</MutationButton>
                </div>
              </div>
            ) : (
              <React.Fragment>
                <MutationButton className="dk-row" onClick={() => { const m = slotMenu; setSlotMenu(null); openNewAppt({ operatorId: m.opId, start: isoAtMin(date, m.startMin), date }); }} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 10px', borderRadius: 9, textAlign: 'left', border: 'none', background: 'transparent' }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--clay-tint)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name="plus" size={15} color="var(--clay-ink)" /></div>
                  <span style={{ fontWeight: 600, fontSize: 13.5 }}>{t('Nuovo appuntamento', 'New appointment')}</span>
                </MutationButton>
                <MutationButton className="dk-row" onClick={() => setSlotMenu((m) => ({ ...m, mode: 'break', dur: 60 }))} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 10px', borderRadius: 9, textAlign: 'left', border: 'none', background: 'transparent' }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--surface-2)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name="clock" size={15} color="var(--muted)" /></div>
                  <span style={{ fontWeight: 600, fontSize: 13.5 }}>{t('Aggiungi pausa', 'Add break')}</span>
                </MutationButton>
              </React.Fragment>
            )}
          </div>
        </React.Fragment>
      )}

      {/* #5 — nuovo appuntamento come drawer laterale: l'agenda resta viva e cliccabile */}
      {newAppt && (
        <NewApptModal asDrawer prefill={newAppt} onClose={() => setNewAppt(null)} onCreated={refetchAll} />
      )}

      {/* #6 — prenotazione di gruppo: drawer con l'agenda visibile per scaglionare gli slot */}
      {groupOpen && (
        <GroupBookingDrawer date={date} onClose={() => setGroupOpen(false)} onCreated={refetchAll} />
      )}
    </div>
  );
}

/* minutes-of-day for an ISO datetime (kept local to avoid re-import churn) */
function aMin(iso) {
  const d = parseISO(iso);
  return d.getHours() * 60 + d.getMinutes();
}

function isTodayInWeek(weekDays) {
  const today = todayStr();
  return weekDays.some((d) => toDateStr(d) === today);
}

/* ---- month/date jump popover ---- */
function JumpPopover({ t, MONTHS, curM, curY, onClose, onMonth, onDate }) {
  return (
    <React.Fragment>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
      <div className="dk-card" style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 41, padding: 12, width: 260, boxShadow: 'var(--sh-pop)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <button className="dk-iconbtn" style={{ width: 28, height: 28, borderRadius: 8 }} onClick={() => onMonth(curM, curY - 1)}><Icon name="chevL" size={14} /></button>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{curY}</span>
          <button className="dk-iconbtn" style={{ width: 28, height: 28, borderRadius: 8 }} onClick={() => onMonth(curM, curY + 1)}><Icon name="chevR" size={14} /></button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, marginBottom: 12 }}>
          {MONTHS.map((mo, mi) => {
            const on = mi === curM;
            return (
              <button key={mi} onClick={() => onMonth(mi, curY)} style={{ padding: '8px 4px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: '1px solid ' + (on ? 'var(--clay)' : 'var(--hair)'), background: on ? 'var(--clay)' : 'var(--surface)', color: on ? '#fff' : 'var(--ink-2)' }}>{mo.slice(0, 3)}</button>
            );
          })}
        </div>
        <div style={{ borderTop: '1px solid var(--hair)', paddingTop: 10 }}>
          <div className="t-meta" style={{ marginBottom: 6 }}>{t('Vai a una data', 'Jump to a date')}</div>
          <input type="date" onChange={(e) => onDate(e.target.value)} style={{ width: '100%', border: '1px solid var(--hair)', borderRadius: 9, outline: 'none', fontSize: 13.5, padding: '8px 10px', fontFamily: 'var(--sans)', background: 'var(--surface)', boxSizing: 'border-box' }} />
        </div>
      </div>
    </React.Fragment>
  );
}

/* ---- day grid loading skeleton ---- */
function DaySkeleton() {
  return (
    <div style={{ flex: 1, overflow: 'hidden', padding: '14px 26px' }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <div style={{ width: 64, flexShrink: 0 }} />
        {[...Array(5)].map((_, i) => <div key={i} className="skel" style={{ flex: 1, height: 54, borderRadius: 12 }} />)}
      </div>
      <div style={{ display: 'flex', gap: 6, height: '100%' }}>
        <div style={{ width: 64, flexShrink: 0 }} />
        {[...Array(5)].map((_, i) => <div key={i} className="skel" style={{ flex: 1, height: 520, borderRadius: 12 }} />)}
      </div>
    </div>
  );
}
