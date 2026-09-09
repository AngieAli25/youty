import { MutationButton } from '@youty/shared';
// DayGrid — multi-operator day timeline 08:00–20:00.
// Ogni SERVIZIO di una visita è un blocco a sé, nella colonna della sua operatrice,
// all'orario concatenato dallo start della visita, colorato per categoria di servizio.
// Drag di un blocco = sposta l'intera visita; trascinando il bordo inferiore si
// modifica la durata di QUEL servizio. Le pause restano blocchi spostabili/ridimensionabili.
import React, { useRef, useState } from 'react';
import { Avatar, Icon, fmtDur, timeLabel, statusMeta } from '@youty/shared';
import { useDash } from '../../ctx.jsx';
import { DK_START, DK_END, PXM, COLW, aStartMin, aDur, aEndMin, svcLabel, hmToMin, fmtMoney, initialsOf, firstName, lastName, opDisplay, itemBlocks } from './lib.js';

export default function DayGrid({
  rows, date, nowMin, colorOf, itemColor, pending, canWrite, showRevenue,
  picker, setPicker, setOpColor, opPalette,
  onHover, onLeave, onOpenAppt, onSlotMenu,
  onMoveAppt, onResizeItem, onMovePause, onResizePause, onDeletePause,
}) {
  const { t, lang, settings } = useDash();
  const step = settings?.slot_interval_min || 15;   // granularità fasce orarie (Impostazioni)
  const drag = useRef(null);
  const [, force] = useState(0);
  const scrollRef = useRef(null);

  const hours = []; for (let h = 8; h <= 20; h++) hours.push(h);
  const quarters = []; for (let m = DK_START; m <= DK_END; m += step) quarters.push(m);
  const gridH = (DK_END - DK_START) * PXM;
  const ops = rows.map((r) => r.operator);
  const opFirsts = ops.map((o) => firstName(o.name)); // disambiguazione omonimie

  // tutti i blocchi-servizio del giorno (ogni appuntamento compare una volta nel payload)
  const allBlocks = rows.flatMap((r) => r.appointments).flatMap((a) => itemBlocks(a));
  const allPauses = rows.flatMap((r) => r.pauses);

  function colFromX(clientX) {
    const grid = scrollRef.current?.querySelector('.dk-tl-cols');
    if (!grid) return null;
    const r = grid.getBoundingClientRect();
    const colW = r.width / Math.max(1, ops.length);
    let idx = Math.floor((clientX - r.left) / colW);
    idx = Math.max(0, Math.min(ops.length - 1, idx));
    return ops[idx].id;
  }

  // Drag di un blocco-servizio → sposta l'INTERA visita
  function onItemDown(e, block) {
    if (!canWrite) return;
    e.preventDefault();
    drag.current = {
      kind: 'item', apptId: block.apptId, itemId: block.item.id, block,
      startY: e.clientY, orig: block.startMin, origOp: block.opId,
      apptStart: aStartMin(block.appt), ns: block.startMin, nop: block.opId, moved: false,
    };
  }
  // Trascinamento bordo inferiore → durata di QUEL servizio
  function onItemResizeDown(e, block) {
    if (!canWrite) return;
    e.preventDefault(); e.stopPropagation();
    drag.current = {
      kind: 'item', mode: 'resize', apptId: block.apptId, itemId: block.item.id, block,
      startY: e.clientY, orig: block.startMin, origDur: block.activeMin, ndur: block.activeMin, moved: false,
    };
  }
  function onPauseDown(e, pause) {
    if (!canWrite) return;
    e.preventDefault();
    drag.current = {
      kind: 'pause', id: pause.id, obj: pause, startY: e.clientY,
      orig: aStartMin(pause), origOp: pause.operator_id, ns: aStartMin(pause), nop: pause.operator_id, moved: false,
    };
  }
  function onPauseResizeDown(e, pause) {
    if (!canWrite) return;
    e.preventDefault(); e.stopPropagation();
    drag.current = {
      kind: 'pause', mode: 'resize', id: pause.id, obj: pause, startY: e.clientY,
      orig: aStartMin(pause), origDur: pause.duration_min, ndur: pause.duration_min, moved: false,
    };
  }

  function onMove(e) {
    if (!drag.current) return;
    const d = drag.current;
    if (d.mode === 'resize') {
      const dy = e.clientY - d.startY;
      let nd = Math.round((d.origDur + dy / PXM) / 15) * 15;
      nd = Math.max(15, Math.min(DK_END - d.orig, nd));
      d.ndur = nd; d.moved = Math.abs(dy) > 2;
      force((x) => x + 1);
      return;
    }
    const dy = e.clientY - d.startY;
    let ns = Math.round((d.orig + dy / PXM) / step) * step;
    ns = Math.max(DK_START, Math.min(DK_END - step, ns));
    const nop = colFromX(e.clientX) ?? d.origOp;
    d.ns = ns; d.nop = nop;
    d.moved = Math.abs(dy) > 4 || nop !== d.origOp;
    force((x) => x + 1);
  }

  function onUp() {
    const d = drag.current;
    if (!d) return;
    if (d.mode === 'resize') {
      if (d.moved && d.ndur !== d.origDur) {
        if (d.kind === 'item') onResizeItem(d.block.appt, d.block.item, d.ndur);
        else onResizePause(d.obj, d.ndur);
      }
      drag.current = null; force((x) => x + 1); return;
    }
    if (d.moved && (d.ns !== d.orig || d.nop !== d.origOp)) {
      if (d.kind === 'item') {
        // la visita si sposta così che il servizio trascinato finisca dove lasciato
        const appt = d.block.appt;
        const newApptStart = d.apptStart + (d.ns - d.orig);
        const multi = (appt.items || []).length > 1;
        const opArg = multi ? appt.operator_id : d.nop; // riassegnazione operatrice solo su visita mono-servizio
        onMoveAppt(appt, newApptStart, opArg);
      } else {
        onMovePause(d.obj, d.ns, d.nop);
      }
    }
    drag.current = null; force((x) => x + 1);
  }

  /* posizione: ghost del drag attivo > override ottimistico (pending) > valore server */
  const itemPos = (block) => {
    const d = drag.current;
    const phases = { activeMin: block.activeMin, soakMin: block.soakMin };
    if (d && d.kind === 'item' && d.apptId === block.apptId && d.mode !== 'resize') {
      // sposta tutti i blocchi della stessa visita del delta trascinato
      const startMin = d.itemId === block.item.id ? d.ns : block.startMin + (d.ns - d.orig);
      const opId = d.itemId === block.item.id ? ((block.appt.items || []).length > 1 ? block.opId : d.nop) : block.opId;
      return { startMin, opId, ...phases, dragging: true };
    }
    if (d && d.kind === 'item' && d.mode === 'resize' && d.itemId === block.item.id) {
      // durante il resize cambia SOLO il tempo attivo; la posa resta
      return { startMin: block.startMin, opId: block.opId, activeMin: d.ndur, soakMin: block.soakMin, resizing: true };
    }
    if (pending && pending.kind === 'appt' && pending.id === block.apptId) {
      return { startMin: pending.startMin + (block.startMin - aStartMin(block.appt)), opId: (block.appt.items || []).length > 1 ? block.opId : pending.opId, ...phases };
    }
    return { startMin: block.startMin, opId: block.opId, ...phases };
  };
  const pausePos = (p) => {
    const d = drag.current;
    if (d && d.kind === 'pause' && d.id === p.id && d.mode !== 'resize') return { startMin: d.ns, opId: d.nop, dragging: true };
    if (d && d.kind === 'pause' && d.id === p.id && d.mode === 'resize') return { startMin: aStartMin(p), opId: p.operator_id, dur: d.ndur, resizing: true };
    if (pending && pending.kind === 'pause' && pending.id === p.id) return { startMin: pending.startMin, opId: pending.opId, dur: pending.dur };
    return { startMin: aStartMin(p), opId: p.operator_id };
  };

  return (
    <div ref={scrollRef} className="scroll" style={{ flex: 1, overflow: 'auto', position: 'relative' }} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
      {/* operator header (sticky top) */}
      <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 9, background: 'var(--paper)', gap: 0, paddingBottom: 8, borderBottom: '1px solid var(--hair)' }}>
        <div style={{ width: 64, flexShrink: 0, position: 'sticky', left: 0, zIndex: 11, background: 'var(--paper)' }} />
        <div style={{ flex: 1, display: 'flex', gap: 6, paddingRight: 4 }}>
          {rows.map((row) => {
            const o = row.operator;
            const cnt = row.appointments.length;
            const rev = row.appointments.reduce((s, a) => s + Number(a.total_price || 0), 0);
            const col = colorOf(o.id);
            return (
              <div key={o.id} title={o.name} style={{ flex: '1 0 ' + COLW + 'px', padding: '10px 11px', display: 'flex', alignItems: 'center', gap: 9, minWidth: 0, borderRadius: '0 0 12px 12px', background: col, position: 'relative' }}>
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <Avatar initials={initialsOf(o.name)} size={34} color={col} ring />
                  <span style={{ position: 'absolute', bottom: -1, right: -1, width: 11, height: 11, borderRadius: 99, background: cnt ? 'var(--ok)' : 'var(--faint)', border: '2px solid #fff' }} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div title={o.name} style={{ fontWeight: 700, fontSize: 20, whiteSpace: 'nowrap', color: 'var(--ink)', letterSpacing: '-0.015em', lineHeight: 1.05, overflow: 'hidden', textOverflow: 'ellipsis' }}>{opDisplay(firstName(o.name), lastName(o.name), opFirsts)}</div>
                  <div style={{ color: 'var(--ink)', opacity: 0.6, fontSize: 11.5, fontWeight: 500, marginTop: 2 }}>
                    {cnt}{showRevenue ? ' · ' + fmtMoney(rev, lang) : ''}
                  </div>
                </div>
                <button onClick={() => setPicker(picker === o.id ? null : o.id)} title={t('Cambia colore', 'Change colour')} style={{ width: 24, height: 24, borderRadius: 7, flexShrink: 0, cursor: 'pointer', display: 'grid', placeItems: 'center', border: 'none', background: 'rgba(255,255,255,0.55)' }}>
                  <Icon name="palette" size={14} color="var(--ink)" />
                </button>
                {picker === o.id && (
                  <React.Fragment>
                    <div onClick={() => setPicker(null)} style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
                    <div className="dk-card" style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 6, zIndex: 61, padding: 12, boxShadow: 'var(--sh-pop)', width: 250, boxSizing: 'border-box' }}>
                      <div className="t-meta" style={{ marginBottom: 8 }}>{t('Colore operatrice', 'Stylist colour')}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                        <label title={t('Ruota dei colori', 'Colour wheel')} style={{ position: 'relative', width: 30, height: 30, borderRadius: 8, cursor: 'pointer', overflow: 'hidden', flexShrink: 0, border: '1px solid var(--hair)', background: col }}>
                          <input type="color" value={(col && col[0] === '#') ? col : '#C9B8F2'} onChange={(e) => setOpColor(o.id, e.target.value)} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
                        </label>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, border: '1px solid var(--hair)', borderRadius: 8, padding: '5px 8px', background: 'var(--surface)' }}>
                          <span style={{ color: 'var(--muted-2)', fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: 12.5 }}>#</span>
                          <input value={((col && col[0] === '#') ? col : '').replace('#', '').toUpperCase()} maxLength={6} placeholder="C9B8F2" onChange={(e) => { const v = e.target.value.replace(/[^0-9a-fA-F]/g, ''); setOpColor(o.id, '#' + v.padEnd(6, '0').slice(0, 6)); }} style={{ border: 'none', outline: 'none', background: 'transparent', fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: 12.5, width: 64, letterSpacing: '0.05em' }} />
                        </span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: 3 }}>
                        {(opPalette || []).map((c) => {
                          const on = (col || '').toLowerCase() === c.toLowerCase();
                          return <button key={c} onClick={() => { setOpColor(o.id, c); setPicker(null); }} title={c} style={{ width: 19, height: 19, borderRadius: 5, background: c, cursor: 'pointer', border: '1px solid transparent', outline: on ? '2px solid var(--ink)' : 'none', outlineOffset: 1 }} />;
                        })}
                      </div>
                    </div>
                  </React.Fragment>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* grid body */}
      <div style={{ display: 'flex', position: 'relative', height: gridH }}>
        {/* hour gutter (sticky left) */}
        <div style={{ width: 64, flexShrink: 0, position: 'sticky', left: 0, zIndex: 7, background: 'var(--paper)' }}>
          {hours.map((h) => (
            <React.Fragment key={h}>
              <div style={{ position: 'absolute', top: (h * 60 - DK_START) * PXM - 7, right: 10, fontSize: 11, fontWeight: 600, color: 'var(--muted-2)' }} className="tabnum">{String(h).padStart(2, '0')}:00</div>
              {h < 20 && <div style={{ position: 'absolute', top: (h * 60 + 30 - DK_START) * PXM - 6, right: 10, fontSize: 9.5, fontWeight: 600, color: 'var(--faint)' }} className="tabnum">{String(h).padStart(2, '0')}:30</div>}
            </React.Fragment>
          ))}
        </div>
        {/* columns */}
        <div className="dk-tl-cols" style={{ flex: 1, display: 'flex', position: 'relative', gap: 6, paddingRight: 4 }}>
          {quarters.map((m) => <div key={m} style={{ position: 'absolute', left: 0, right: 0, top: (m - DK_START) * PXM, height: 1, background: m % 60 === 0 ? 'var(--hair-2)' : 'color-mix(in srgb, var(--hair-2) 45%, transparent)' }} />)}
          {nowMin != null && nowMin >= DK_START && nowMin <= DK_END && (
            <div style={{ position: 'absolute', left: 0, right: 0, top: (nowMin - DK_START) * PXM, height: 2, background: '#F4708A', zIndex: 8 }}>
              <span style={{ position: 'absolute', left: -6, top: -5, width: 12, height: 12, borderRadius: 99, background: '#F4708A', boxShadow: '0 0 0 3px rgba(244,112,138,0.2)' }} />
            </div>
          )}
          {rows.map((row) => {
            const o = row.operator;
            const closed = closedIntervals(row.windows);
            return (
              <div
                key={o.id}
                title={canWrite ? t('Clicca uno spazio libero', 'Click a free slot') : undefined}
                onClick={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (drag.current && drag.current.moved) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const raw = DK_START + (e.clientY - rect.top) / PXM;
                  const snapped = Math.max(DK_START, Math.min(DK_END - step, Math.round(raw / step) * step));
                  onSlotMenu(o.id, snapped, e.clientX, e.clientY);
                }}
                style={{ flex: '1 0 ' + COLW + 'px', position: 'relative', minWidth: 0, borderRadius: 12, background: `color-mix(in srgb, ${colorOf(o.id)} 26%, #FFFFFF)`, cursor: canWrite ? 'copy' : 'default' }}
              >
                {closed.map(([s, e2], i) => (
                  <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: (s - DK_START) * PXM, height: (e2 - s) * PXM, pointerEvents: 'none', borderRadius: 10, background: 'repeating-linear-gradient(135deg, color-mix(in srgb, var(--paper) 70%, transparent) 0 6px, transparent 6px 12px)', zIndex: 1 }} />
                ))}
                {/* service blocks (each in its operator's column) */}
                {allBlocks.filter((b) => itemPos(b).opId === o.id).map((b) => {
                  const pos = itemPos(b);
                  return (
                    <ItemBlock
                      key={'i' + b.item.id} block={b} startMin={pos.startMin} activeMin={pos.activeMin} soakMin={pos.soakMin}
                      dragging={pos.dragging} t={t} lang={lang} canWrite={canWrite}
                      color={itemColor ? itemColor(b.item) : colorOf(b.opId)}
                      onDown={(e) => onItemDown(e, b)}
                      onResizeDown={(e) => onItemResizeDown(e, b)}
                      onHover={onHover} onLeave={onLeave}
                      onOpen={() => { if (!drag.current?.moved) { onLeave(); onOpenAppt(b.appt); } }}
                    />
                  );
                })}
                {/* pauses */}
                {allPauses.filter((p) => pausePos(p).opId === o.id).map((p) => {
                  const pos = pausePos(p);
                  return (
                    <PauseBlock
                      key={'p' + p.id} p={p} startMin={pos.startMin} dur={pos.dur ?? p.duration_min} dragging={pos.dragging} t={t} lang={lang}
                      canWrite={canWrite}
                      onDown={(e) => onPauseDown(e, p)}
                      onResizeDown={(e) => onPauseResizeDown(e, p)}
                      onRemove={() => onDeletePause(p)}
                    />
                  );
                })}
              </div>
            );
          })}
          {!rows.length && (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
              <div className="t-sm" style={{ color: 'var(--muted-2)' }}>{t('Nessuna operatrice attiva', 'No active staff')}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* closed (off-shift) intervals within the grid, from API windows [["09:00","13:00"],...] */
function closedIntervals(windows) {
  const win = (windows || []).map(([a, b]) => [hmToMin(a), hmToMin(b)]).sort((x, y) => x[0] - y[0]);
  const out = [];
  let cursor = DK_START;
  win.forEach(([s, e]) => {
    if (s > cursor) out.push([cursor, Math.min(s, DK_END)]);
    cursor = Math.max(cursor, e);
  });
  if (cursor < DK_END) out.push([cursor, DK_END]);
  return out.filter(([s, e]) => e > s);
}

/* ---------- service block (one per AppointmentService) ---------- */
function ItemBlock({ block, startMin, activeMin, soakMin, dragging, color, t, lang, canWrite, onDown, onResizeDown, onOpen, onHover, onLeave }) {
  const { item, appt, isFirst } = block;
  const active = activeMin ?? block.activeMin ?? 0;
  const soak = soakMin ?? block.soakMin ?? 0;
  const h = (active + soak) * PXM;
  const compact = h < 50;
  const bg = `color-mix(in srgb, ${color} 82%, #FFFFFF)`;
  const sm = statusMeta(appt.status, t);
  const showStatusDot = appt.status === 'checked_in' || appt.status === 'in_progress';
  const textZ = { position: 'relative', zIndex: 2 };
  return (
    <div
      onPointerDown={(e) => onDown(e)} onClick={onOpen}
      onMouseEnter={(e) => onHover && onHover(appt, e.currentTarget)} onMouseLeave={() => onLeave && onLeave()}
      style={{
        position: 'absolute', top: (startMin - DK_START) * PXM + 1.5, height: h - 3, left: 4, right: 4,
        background: bg, borderRadius: 12, border: 'none',
        boxShadow: dragging ? 'var(--sh-pop)' : '0 1px 3px rgba(17,24,39,0.12)', padding: compact ? '3px 9px' : '7px 11px', overflow: 'hidden',
        cursor: canWrite ? 'grab' : 'pointer', touchAction: 'none', zIndex: dragging ? 20 : 2, transform: dragging ? 'scale(1.02)' : 'none',
        opacity: appt.status === 'no_show' ? 0.5 : 1, transition: dragging ? 'none' : 'box-shadow 150ms',
        display: 'flex', flexDirection: compact ? 'row' : 'column', alignItems: compact ? 'baseline' : 'stretch', gap: compact ? 6 : 0,
      }}
    >
      {/* fase di posa: parte inferiore tratteggiata/più chiara — operatrice NON impegnata */}
      {soak > 0 && (
        <div title={t('Fase di posa', 'Soak phase')} style={{ position: 'absolute', left: 0, right: 0, top: active * PXM, bottom: 0, background: 'repeating-linear-gradient(135deg, rgba(255,255,255,0.62) 0 6px, rgba(255,255,255,0.14) 6px 12px)', borderTop: '1px dashed rgba(17,24,39,0.28)', borderRadius: '0 0 12px 12px', pointerEvents: 'none', display: 'grid', placeItems: 'center', zIndex: 1 }}>
          {soak * PXM > 20 && <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--ink-2)', opacity: 0.7 }}>{t('POSA', 'SOAK')}</span>}
        </div>
      )}
      {isFirst && appt.deposit_status === 'paid' && (
        <div title={t('Caparra incassata', 'Deposit collected')} style={{ position: 'absolute', top: 5, right: 5, width: 22, height: 22, borderRadius: 7, background: 'var(--surface)', border: '1.5px solid var(--ok)', display: 'grid', placeItems: 'center', boxShadow: '0 1px 2px rgba(17,24,39,0.12)', zIndex: 3 }}>
          <Icon name="wallet" size={13} color="var(--ok)" stroke={2} />
        </div>
      )}
      <div style={{ ...textZ, fontWeight: 600, fontSize: 12.5, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.25, flex: compact ? 1 : 'none', minWidth: 0, paddingRight: !compact && isFirst && appt.deposit_status === 'paid' ? 24 : 0 }}>{item.service_name}</div>
      <div style={{ ...textZ, display: 'flex', alignItems: 'center', gap: 5, marginTop: compact ? 0 : 1, flexShrink: 0 }}>
        {showStatusDot && <span title={sm.label} style={{ width: 7, height: 7, borderRadius: 99, background: sm.color, flexShrink: 0 }} />}
        <span className="tabnum" style={{ fontSize: 11, fontWeight: 500, color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>{timeLabel(startMin)}</span>
      </div>
      {!compact && <div style={{ ...textZ, color: 'var(--muted)', fontSize: 11, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{appt.client?.full_name}</div>}
      {canWrite && (
        <div onPointerDown={onResizeDown} title={t('Trascina per cambiare il tempo attivo', 'Drag to change the active time')} style={{ position: 'absolute', left: 0, right: 0, top: soak > 0 ? active * PXM - 6 : undefined, bottom: soak > 0 ? undefined : 0, height: 12, cursor: 'ns-resize', display: 'grid', placeItems: 'center', touchAction: 'none', zIndex: 3 }}>
          <div style={{ width: 24, height: 3, borderRadius: 99, background: 'rgba(17,24,39,0.18)' }} />
        </div>
      )}
    </div>
  );
}

/* ---------- pause (break) block — hatched, movable, resizable ---------- */
function PauseBlock({ p, startMin, dur, dragging, t, canWrite, onDown, onResizeDown, onRemove }) {
  const bh = dur * PXM;
  const bCompact = bh < 44;
  return (
    <div
      onPointerDown={(e) => onDown(e)}
      style={{
        position: 'absolute', top: (startMin - DK_START) * PXM + 1.5, height: bh - 3, left: 4, right: 4,
        borderRadius: 12, border: '1.5px dashed var(--pewter-300, #B6B4BB)',
        background: 'repeating-linear-gradient(135deg, rgba(120,120,128,0.13) 0 7px, rgba(120,120,128,0.04) 7px 14px)',
        boxShadow: dragging ? 'var(--sh-pop)' : 'none', padding: bCompact ? '3px 9px' : '7px 11px', overflow: 'hidden',
        cursor: canWrite ? 'grab' : 'default', touchAction: 'none', zIndex: dragging ? 20 : 2,
        display: 'flex', flexDirection: bCompact ? 'row' : 'column', alignItems: bCompact ? 'center' : 'stretch', gap: bCompact ? 6 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: bCompact ? 1 : 'none', minWidth: 0 }}>
        <Icon name="clock" size={13} color="var(--pewter-500, #6F6E74)" />
        <span style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--pewter-700, #45444A)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('Pausa', 'Break')}{p.note ? ' · ' + p.note : ''}</span>
      </div>
      <span className="tabnum" style={{ fontSize: 11, fontWeight: 500, color: 'var(--pewter-500, #6F6E74)', flexShrink: 0 }}>{timeLabel(startMin)}–{timeLabel(startMin + dur)}</span>
      {canWrite && (
        <MutationButton onClick={(e) => { e.stopPropagation(); onRemove(); }} onPointerDown={(e) => e.stopPropagation()} title={t('Rimuovi pausa', 'Remove break')} style={{ position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 6, border: 'none', background: 'rgba(255,255,255,0.7)', cursor: 'pointer', display: bCompact ? 'none' : 'grid', placeItems: 'center', zIndex: 4 }}>
          <Icon name="x" size={12} color="var(--pewter-500, #6F6E74)" />
        </MutationButton>
      )}
      {canWrite && (
        <div onPointerDown={onResizeDown} title={t('Ridimensiona', 'Resize')} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 12, cursor: 'ns-resize', display: 'grid', placeItems: 'center', touchAction: 'none' }}>
          <div style={{ width: 26, height: 3, borderRadius: 99, background: 'var(--pewter-300, #B6B4BB)' }} />
        </div>
      )}
    </div>
  );
}

/* ---------- appointment hover card ---------- */
export function ApptHoverCard({ hover, t, lang, operators, colorOf }) {
  const { a, x, y, side } = hover;
  const o = operators.find((op) => op.id === a.operator_id);
  const opName = o ? o.first_name + ' ' + o.last_name : ((a.items || [])[0]?.operator_name || '');
  const col = colorOf(a.operator_id);
  const startMin = aStartMin(a), endMin = aEndMin(a);
  return (
    <div style={{ position: 'fixed', top: y, left: side === 'right' ? x : undefined, right: side === 'left' ? (window.innerWidth - x) : undefined, zIndex: 90, width: 300, background: 'var(--surface)', border: '1px solid var(--hair)', borderRadius: 14, boxShadow: 'var(--sh-pop)', padding: 16, pointerEvents: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <Avatar initials={initialsOf(a.client?.full_name)} size={38} color={col} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{a.client?.full_name}</div>
          <div className="t-sm" style={{ color: 'var(--muted)' }}>{opName}</div>
        </div>
        <span style={{ width: 10, height: 10, borderRadius: 99, background: col, flexShrink: 0 }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
          <Icon name="scissors" size={15} color="var(--muted-2)" style={{ marginTop: 1, flexShrink: 0 }} />
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{svcLabel(a)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <Icon name="clock" size={15} color="var(--muted-2)" style={{ flexShrink: 0 }} />
          <span className="tabnum" style={{ fontSize: 13.5 }}>{timeLabel(startMin)}–{timeLabel(endMin)}</span>
          <span className="t-sm" style={{ color: 'var(--muted-2)' }}>· {fmtDur(endMin - startMin, lang)}</span>
        </div>
        {a.client?.phone && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Icon name="phone" size={15} color="var(--muted-2)" style={{ flexShrink: 0 }} />
            <span className="tabnum" style={{ fontSize: 13.5 }}>{a.client.phone}</span>
          </div>
        )}
        {a.note && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, marginTop: 2, padding: '9px 11px', background: 'var(--warn-tint)', borderRadius: 10 }}>
            <Icon name="info" size={15} color="var(--warn)" style={{ marginTop: 1, flexShrink: 0 }} />
            <span className="t-sm" style={{ color: 'var(--ink-2)', lineHeight: 1.4 }}>{a.note}</span>
          </div>
        )}
      </div>
    </div>
  );
}
