import { MutationButton } from '@youty/shared';
// components.jsx — small presentational pieces shared inside the clienti section.
import React from 'react';
import { Icon } from '@youty/shared';
import { DkModal } from '../../ui/index.js';
import { relMeta } from './helpers.js';

/* Reliability ring (ported RelRing). */
export function RelRing({ score, color, size = 46 }) {
  const r = size * 18 / 46, circ = 2 * Math.PI * r, c = size / 2;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--paper-2)" strokeWidth={size * 5 / 46} />
        <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={size * 5 / 46} strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - Math.min(100, Math.max(0, score)) / 100)} />
      </svg>
      <span className="t-num" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: size * 13 / 46, color }}>{score}</span>
    </div>
  );
}

/* Compact reliability badge for list rows. */
export function RelBadge({ score, t, sm }) {
  const m = relMeta(score, t);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: sm ? 10.5 : 11.5, fontWeight: 700, color: m.color, background: `color-mix(in srgb, ${m.color} 14%, transparent)`, padding: sm ? '2px 8px' : '4px 10px', borderRadius: 99, whiteSpace: 'nowrap' }}>
      {score}<span style={{ fontWeight: 600 }}>· {m.label}</span>
    </span>
  );
}

/* Category label chip (client categories carry a name + color from the API). */
export function CatChip({ cat, sm, onRemove, removeTitle }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: sm ? 10.5 : 11.5, fontWeight: 700, color: 'var(--ink-2)', background: `color-mix(in srgb, ${cat.color || 'var(--hair)'} 45%, transparent)`, padding: onRemove ? '4px 6px 4px 10px' : (sm ? '2px 8px' : '4px 10px'), borderRadius: 99, whiteSpace: 'nowrap' }}>
      <span style={{ width: sm ? 7 : 8, height: sm ? 7 : 8, borderRadius: 99, background: cat.color || 'var(--muted-2)', boxShadow: '0 0 0 1px rgba(0,0,0,0.06) inset' }} />
      {cat.name}
      {onRemove && (
        <MutationButton onClick={onRemove} title={removeTitle} style={{ width: 16, height: 16, borderRadius: 99, display: 'grid', placeItems: 'center', cursor: 'pointer', background: 'rgba(0,0,0,0.08)', border: 'none' }}>
          <Icon name="x" size={10} color="var(--ink-2)" stroke={2.6} />
        </MutationButton>
      )}
    </span>
  );
}

/* KPI stat card (ported ProfStat). */
export function ProfStat({ label, value }) {
  return (
    <div className="dk-card" style={{ padding: 16, boxShadow: 'none', border: '1px solid var(--hair)' }}>
      <div className="t-meta" style={{ marginBottom: 6 }}>{label}</div>
      <div className="t-num" style={{ fontSize: 24 }}>{value}</div>
    </div>
  );
}

/* Deterministic decorative QR glyph for gift-card codes (ported QrGlyph). */
export function QrGlyph({ code, size = 44 }) {
  let h = 0; for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  const cells = [];
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) { h = (h * 1103515245 + 12345) >>> 0; if ((h >> 16) % 5 < 2 || (x < 2 && y < 2) || (x > 4 && y < 2) || (x < 2 && y > 4)) cells.push([x, y]); }
  const u = size / 7;
  return (
    <svg width={size} height={size} style={{ display: 'block', borderRadius: 6, background: '#fff', border: '1px solid var(--hair)', flexShrink: 0 }} aria-hidden="true">
      {cells.map(([x, y], i) => <rect key={i} x={x * u + 1.5} y={y * u + 1.5} width={u - 3} height={u - 3} rx={1} fill="var(--ink)" />)}
    </svg>
  );
}

/* Confirm dialog (local — the registry has no generic confirm modal). */
export function ConfirmModal({ title, sub, body, confirmLabel, danger = true, busy, onConfirm, onClose, t }) {
  return (
    <DkModal open onClose={onClose} title={title} sub={sub} width={420}
      foot={<React.Fragment>
        <button className="dk-btn dk-btn--ghost" onClick={onClose}>{t('Annulla', 'Cancel')}</button>
        <MutationButton className="dk-btn dk-btn--clay" disabled={busy} onClick={onConfirm}
          style={danger ? { background: 'var(--danger)', borderColor: 'var(--danger)', opacity: busy ? 0.6 : 1 } : { opacity: busy ? 0.6 : 1 }}>
          <Icon name={danger ? 'alert' : 'check'} size={16} color="#fff" />{confirmLabel}
        </MutationButton>
      </React.Fragment>}>
      <div className="t-body" style={{ color: 'var(--ink-2)', lineHeight: 1.5, padding: '4px 0 10px' }}>{body}</div>
    </DkModal>
  );
}

/* Field wrapper for forms (ported NCField). */
export function Field({ label, hint, children }) {
  return (
    <div>
      <div className="t-meta" style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
        {label}
        {hint && <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: 'var(--muted-2)' }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}
