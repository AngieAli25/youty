// WeekView — 7-day overview from GET /api/agenda/week (per-op sub-columns, lane packing)
// Interactions mirror the day view (DayGrid): drag a block to reschedule/reassign,
// click a block to open its detail, click an empty slot to create a new appointment.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, minutesOfDay, timeLabel, todayStr, parseISO, statusMeta } from '@youty/shared';
import { useDash } from '../../ctx.jsx';
import { DK_START, DK_END, PXM, DOW_IT, DOW_EN, weekLayout, fmtMoney, toastErr, opDisplay, isoAtMin } from './lib.js';

export default function WeekView({ weekStart, operators, colorOf, onOpenDay, onNewAppt }) {
  const { t, lang, showRevenue, fireToast, openModal, hasScope, canMutate, settings } = useDash();
  const canWrite = canMutate('agenda');
  const step = settings?.slot_interval_min || 15;   // granularità fasce orarie (Impostazioni)
  const opFirsts = operators.map((o) => o.first_name); // per la disambiguazione omonimie
  const [days, setDays] = useState(null); // null = loading
  const [opTip, setOpTip] = useState(null); // { name, x, y }
  const [, force] = useState(0);            // re-render on drag ghost changes
  const scrollRef = useRef(null);
  const drag = useRef(null);                // active drag { id, obj, ns, nop, dayIdx, moved, ... }
  const justDragged = useRef(false);        // suppress the click that follows a drop

  // reusable refetch (no skeleton flash) — used after a move and passed to the detail modal
  const refetchWeek = useCallback(() => (
    api.get('/api/agenda/week', { params: { start: weekStart } })
      .then((rows) => setDays(rows))
      .catch((err) => toastErr(err, t, fireToast))
  ), [weekStart, t, fireToast]);

  useEffect(() => {
    let alive = true;
    setDays(null);
    api.get('/api/agenda/week', { params: { start: weekStart } })
      .then((rows) => { if (alive) setDays(rows); })
      .catch((err) => { if (alive) { setDays([]); toastErr(err, t, fireToast); } });
    return () => { alive = false; };
  }, [weekStart]); // eslint-disable-line react-hooks/exhaustive-deps

  const hours = []; for (let h = 8; h <= 20; h++) hours.push(h);
  const gridH = (DK_END - DK_START) * PXM;
  const today = todayStr();
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  if (days === null) {
    return (
      <div style={{ flex: 1, overflow: 'hidden', padding: '16px 26px', display: 'flex', gap: 8 }}>
        {[...Array(7)].map((_, i) => <div key={i} className="skel" style={{ flex: 1, height: 480, borderRadius: 12 }} />)}
      </div>
    );
  }

  const dayData = days.map((d) => {
    const list = d.appointments.map((a) => ({ ...a, startMin: minutesOfDay(a.start), endMin: minutesOfDay(a.start) + (a.duration_min || 0) }));
    const dayOps = operators.filter((o) => list.some((a) => a.operator_id === o.id));
    return { ...d, list, dayOps };
  });

  /* ---- drag & drop: which day column + operator sub-column is under clientX ---- */
  function targetFromX(clientX) {
    const root = scrollRef.current;
    if (!root) return { dayIdx: null, opId: null };
    let dayIdx = null, opId = null;
    root.querySelectorAll('[data-daycol]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX < r.right) dayIdx = Number(el.dataset.daycol);
    });
    root.querySelectorAll('[data-subcol]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX < r.right) opId = Number(el.dataset.op);
    });
    return { dayIdx, opId };
  }

  function onBlockDown(e, appt, dayIdx) {
    e.preventDefault();
    const startMin = minutesOfDay(appt.start);
    drag.current = {
      id: appt.id, obj: appt,
      startX: e.clientX, startY: e.clientY, cx: e.clientX, cy: e.clientY,
      orig: startMin, origOp: appt.operator_id, origDayIdx: dayIdx,
      ns: startMin, nop: appt.operator_id, dayIdx, moved: false,
    };
  }

  function onMove(e) {
    const d = drag.current;
    if (!d || !canWrite) return;
    const dy = e.clientY - d.startY;
    let ns = Math.round((d.orig + dy / PXM) / step) * step;
    ns = Math.max(DK_START, Math.min(DK_END - step, ns));
    const { dayIdx, opId } = targetFromX(e.clientX);
    d.ns = ns;
    d.dayIdx = dayIdx == null ? d.origDayIdx : dayIdx;
    d.nop = opId == null ? d.origOp : opId;
    d.cx = e.clientX; d.cy = e.clientY;
    d.moved = d.moved || Math.abs(dy) > 4 || Math.abs(e.clientX - d.startX) > 4 || d.dayIdx !== d.origDayIdx || d.nop !== d.origOp;
    force((x) => x + 1);
  }

  async function commitMove(d) {
    const day = dayData[d.dayIdx];
    if (!day) return;
    const body = { start: isoAtMin(day.date, d.ns) };
    if (d.nop != null && d.nop !== d.origOp) body.operator_id = d.nop;
    try {
      await api.post(`/api/agenda/appointments/${d.id}/move`, body);
      await refetchWeek();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        fireToast({ msg: t('Orario non più disponibile', 'Time no longer available'), icon: 'alert' });
        await refetchWeek();
      } else toastErr(err, t, fireToast);
    }
  }

  async function openDetail(appt) {
    try {
      const full = await api.get(`/api/agenda/appointments/${appt.id}`);
      openModal('apptdetail', { appointment: full, onMutate: refetchWeek });
    } catch (err) { toastErr(err, t, fireToast); }
  }

  // pointer-up (openOnClick=true) commits a move or, if it was a plain click, opens the detail;
  // pointer-leave (openOnClick=false) commits a move but never opens on a stray exit.
  function finishDrag(openOnClick) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) {
      justDragged.current = true;
      setTimeout(() => { justDragged.current = false; }, 0);
      const changed = d.ns !== d.orig || d.dayIdx !== d.origDayIdx || d.nop !== d.origOp;
      if (changed && canWrite) commitMove(d);
      force((x) => x + 1);
    } else {
      force((x) => x + 1);
      if (openOnClick) openDetail(d.obj);
    }
  }

  function onEmptyClick(e, opId, date) {
    if (e.target !== e.currentTarget) return;   // only the empty sub-column background, not a block
    if (justDragged.current || !hasScope('agenda')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const raw = DK_START + (e.clientY - rect.top) / PXM;
    const minutes = Math.max(DK_START, Math.min(DK_END - step, Math.round(raw / step) * step));
    onNewAppt && onNewAppt({ operatorId: opId, start: isoAtMin(date, minutes), date });
  }

  return (
    <div
      ref={scrollRef}
      className="scroll"
      style={{ flex: 1, overflow: 'auto', position: 'relative' }}
      onPointerMove={onMove}
      onPointerUp={() => finishDrag(true)}
      onPointerLeave={() => finishDrag(false)}
    >
      {/* sticky header: day + per-operator sub-columns */}
      <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 9, background: 'var(--paper)', borderBottom: '1px solid var(--hair)', width: 'max-content', minWidth: '100%' }}>
        <div style={{ width: 46, flexShrink: 0, position: 'sticky', left: 0, background: 'var(--paper)', zIndex: 10 }} />
        {dayData.map((d, i) => {
          const isToday = d.date === today;
          const rev = d.list.reduce((s, a) => s + Number(a.total_price || 0), 0);
          const dayW = Math.max(120, d.dayOps.length * 48);
          const num = parseISO(d.date).getDate();
          const statuses = Object.entries(d.by_status || {});
          return (
            <div key={i} style={{ flex: '0 0 ' + dayW + 'px', minWidth: 0, borderLeft: '1px solid var(--clay)', background: isToday ? '#D6E4F7' : 'transparent' }}>
              <button onClick={() => onOpenDay(d.date)} style={{ display: 'block', width: '100%', textAlign: 'center', padding: '8px 4px 5px', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: isToday ? 'var(--clay-ink)' : 'var(--muted)' }}>{t(DOW_IT[i], DOW_EN[i])}</span>
                  <span className="t-num" style={{ fontSize: 14, color: isToday ? '#fff' : 'var(--ink)', background: isToday ? 'var(--clay)' : 'transparent', width: 24, height: 24, borderRadius: 99, display: 'grid', placeItems: 'center' }}>{num}</span>
                </div>
                <div className="t-sm" style={{ color: 'var(--muted-2)', fontSize: 10, marginTop: 2 }}>
                  {d.count ? `${d.count}${showRevenue ? ' · ' + fmtMoney(rev, lang) : ''}` : t('Libero', 'Free')}
                </div>
                {statuses.length > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                    {statuses.map(([st, n]) => {
                      const sm = statusMeta(st, t);
                      return (
                        <span key={st} title={sm.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                          <span style={{ width: 6, height: 6, borderRadius: 99, background: sm.color }} />
                          <span className="tabnum" style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--muted)' }}>{n}</span>
                        </span>
                      );
                    })}
                  </div>
                )}
              </button>
              {/* operator sub-column headers */}
              {d.dayOps.length > 0 && (
                <div style={{ display: 'flex', borderTop: '1px solid var(--hair-2)' }}>
                  {d.dayOps.map((o) => (
                    <div key={o.id} title={o.first_name + ' ' + o.last_name} onMouseEnter={(e) => { const r = e.currentTarget.getBoundingClientRect(); setOpTip({ name: o.first_name + ' ' + o.last_name, x: r.left + r.width / 2, y: r.bottom + 6 }); }} onMouseLeave={() => setOpTip(null)} style={{ flex: 1, minWidth: 0, padding: '5px 2px', textAlign: 'center', borderLeft: '1px solid var(--hair-2)', cursor: 'default', background: `color-mix(in srgb, ${colorOf(o.id)} 30%, var(--paper))` }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', padding: '0 2px' }}>{opDisplay(o.first_name, o.last_name, opFirsts)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {/* grid */}
      <div style={{ display: 'flex', height: gridH, position: 'relative', width: 'max-content', minWidth: '100%' }}>
        <div style={{ width: 46, flexShrink: 0, position: 'sticky', left: 0, zIndex: 7, background: 'var(--paper)' }}>
          {hours.map((h) => <div key={h} style={{ position: 'absolute', top: (h * 60 - DK_START) * PXM - 7, right: 7, fontSize: 10, fontWeight: 600, color: 'var(--muted-2)' }} className="tabnum">{String(h).padStart(2, '0')}</div>)}
        </div>
        {dayData.map((d, i) => {
          const isToday = d.date === today;
          const dayW = Math.max(120, d.dayOps.length * 48);
          return (
            <div key={i} data-daycol={i} style={{ flex: '0 0 ' + dayW + 'px', minWidth: 0, position: 'relative', borderLeft: '1px solid var(--clay)', background: isToday ? '#D6E4F7' : 'transparent', display: 'flex' }}>
              {hours.map((h) => <div key={h} style={{ position: 'absolute', left: 0, right: 0, top: (h * 60 - DK_START) * PXM, height: 1, background: 'var(--hair-2)', zIndex: 0 }} />)}
              {isToday && nowMin >= DK_START && nowMin <= DK_END && <div style={{ position: 'absolute', left: 0, right: 0, top: (nowMin - DK_START) * PXM, height: 2, background: '#F4708A', zIndex: 6 }} />}
              {d.dayOps.map((o) => {
                const opList = d.list.filter((a) => a.operator_id === o.id);
                return (
                  <div
                    key={o.id}
                    data-subcol=""
                    data-day={i}
                    data-op={o.id}
                    onClick={(e) => onEmptyClick(e, o.id, d.date)}
                    title={canWrite ? t('Clicca uno spazio libero', 'Click a free slot') : undefined}
                    style={{ flex: 1, minWidth: 0, position: 'relative', borderLeft: '1px solid var(--hair-2)', cursor: canWrite ? 'copy' : 'default' }}
                  >
                    {weekLayout(opList).map((a) => {
                      const h = (a.endMin - a.startMin) * PXM;
                      const lc = a._laneCount || 1, lane = a._lane || 0;
                      const parts = String(a.client_name || '').split(' ');
                      const first = parts[0], last = parts.slice(1).join(' ');
                      const isDragging = !!(drag.current && drag.current.id === a.id && drag.current.moved);
                      return (
                        <div
                          key={a.id}
                          onPointerDown={(e) => onBlockDown(e, a, i)}
                          title={`${a.client_name} · ${timeLabel(a.startMin)} · ${o.first_name}`}
                          style={{ position: 'absolute', top: (a.startMin - DK_START) * PXM + 1, height: h - 2, left: `calc(${(lane / lc) * 100}% + 1px)`, width: `calc(${100 / lc}% - 2px)`, borderRadius: 6, background: `color-mix(in srgb, ${colorOf(o.id)} 82%, #FFFFFF)`, padding: '3px 5px', overflow: 'hidden', cursor: 'grab', touchAction: 'none', opacity: a.status === 'no_show' ? 0.5 : (isDragging ? 0.85 : 1), boxShadow: isDragging ? 'var(--sh-pop)' : '0 1px 2px rgba(17,24,39,0.1)', transform: isDragging ? 'scale(1.03)' : 'none', transition: isDragging ? 'none' : 'box-shadow 150ms', zIndex: isDragging ? 20 : 2 }}
                        >
                          <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2, pointerEvents: 'none' }}>{first}</div>
                          {last && h > 30 && lc < 3 && <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2, pointerEvents: 'none' }}>{last}</div>}
                          {h > 44 && <div className="tabnum" style={{ fontSize: 9.5, color: 'var(--ink-2)', marginTop: 1, pointerEvents: 'none' }}>{timeLabel(a.startMin)}</div>}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {opTip && <div style={{ position: 'fixed', top: opTip.y, left: opTip.x, transform: 'translateX(-50%)', zIndex: 90, background: 'var(--ink)', color: '#fff', fontSize: 12.5, fontWeight: 600, padding: '6px 11px', borderRadius: 8, whiteSpace: 'nowrap', pointerEvents: 'none', boxShadow: 'var(--sh-pop)' }}>{opTip.name}</div>}
      {drag.current && drag.current.moved && (() => {
        const d = drag.current;
        const day = dayData[d.dayIdx];
        const op = operators.find((o) => o.id === d.nop);
        return (
          <div style={{ position: 'fixed', top: d.cy + 16, left: d.cx + 16, zIndex: 95, background: 'var(--ink)', color: '#fff', fontSize: 12, fontWeight: 700, padding: '6px 10px', borderRadius: 8, whiteSpace: 'nowrap', pointerEvents: 'none', boxShadow: 'var(--sh-pop)' }}>
            {day ? `${t(DOW_IT[d.dayIdx], DOW_EN[d.dayIdx])} ${parseISO(day.date).getDate()} · ` : ''}{op ? `${op.first_name} · ` : ''}{timeLabel(d.ns)}
          </div>
        );
      })()}
    </div>
  );
}
