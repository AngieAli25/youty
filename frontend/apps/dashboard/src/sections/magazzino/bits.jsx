import { MutationNumInput } from '@youty/shared';
import { MutationButton } from '@youty/shared';
// bits.jsx — small UI pieces shared by the Magazzino sub-tabs (ported from the prototype).
import React, { useEffect, useState } from 'react';
import { Icon, NumInput } from '@youty/shared';

/** debounce a changing value (used for the server-side q filter) */
export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function MiniMetric({ label, value, wide, onClick, active }) {
  return (
    <button disabled={!onClick} onClick={onClick} className="dk-card" style={{ padding: '12px 16px', boxShadow: 'none', border: '1.5px solid ' + (active ? 'var(--clay)' : 'var(--hair)'), flex: wide ? 2 : 1, textAlign: 'left', cursor: onClick ? 'pointer' : 'default', background: active ? 'var(--clay-tint)' : undefined }}>
      <div className="t-meta" style={{ marginBottom: 4, color: active ? 'var(--clay-ink)' : undefined }}>{label}</div>
      <div className="t-num" style={{ fontSize: 22, color: active ? 'var(--clay-ink)' : undefined }}>{value}</div>
    </button>
  );
}

export function SearchToolbar({ q, setQ, placeholder, onAdd, addLabel, extra }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
      <div className="dk-search" style={{ flex: 1, minWidth: 0, width: 'auto' }}>
        <Icon name="search" size={18} color="var(--muted-2)" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
        {q && <button className="press" onClick={() => setQ('')} style={{ cursor: 'pointer', display: 'grid', placeItems: 'center' }}><Icon name="x" size={15} color="var(--muted-2)" /></button>}
      </div>
      {extra}
      {onAdd && <MutationButton className="dk-btn dk-btn--clay" onClick={onAdd} style={{ flexShrink: 0 }}><Icon name="plus" size={17} color="#fff" />{addLabel}</MutationButton>}
    </div>
  );
}

/** integer stepper-less number box (qty / thresholds) */
export function NumBox({ value, onChange, suffix, width = 92, disabled }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--hair)', borderRadius: 10, padding: '0 12px', height: 42, background: disabled ? 'var(--surface-2)' : 'var(--surface)', width }}>
      <MutationNumInput integer min={0} value={value} disabled={disabled} onChange={onChange} style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 15, fontWeight: 600, width: '100%' }} />
      {suffix && <span className="t-sm" style={{ color: 'var(--muted-2)', fontWeight: 600 }}>{suffix}</span>}
    </div>
  );
}

/** decimal money/percent box — buffers the raw string so "12." keeps typing */
export function MoneyBox({ value, onChange, suffix = '€', width = '100%', disabled }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--hair)', borderRadius: 10, padding: '0 12px', height: 42, background: disabled ? 'var(--surface-2)' : 'var(--surface)', width }}>
      <MutationNumInput
        min={0} value={value} disabled={disabled} onChange={onChange}
        style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 15, fontWeight: 600, width: '100%' }}
      />
      {suffix && <span className="t-sm" style={{ color: 'var(--muted-2)', fontWeight: 600 }}>{suffix}</span>}
    </div>
  );
}

/** {items,count} pagination footer */
export function Pager({ count, offset, limit, onPage, t }) {
  if (!count || count <= limit) return null;
  const from = offset + 1;
  const to = Math.min(offset + limit, count);
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, padding: '12px 20px', borderTop: '1px solid var(--hair)' }}>
      <span className="t-sm" style={{ color: 'var(--muted)' }}>{from}–{to} {t('di', 'of')} {count}</span>
      <button className="dk-iconbtn" disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - limit))} style={{ width: 32, height: 32, borderRadius: 9, opacity: offset === 0 ? 0.4 : 1 }}><Icon name="chevL" size={16} /></button>
      <button className="dk-iconbtn" disabled={to >= count} onClick={() => onPage(offset + limit)} style={{ width: 32, height: 32, borderRadius: 9, opacity: to >= count ? 0.4 : 1 }}><Icon name="chevR" size={16} /></button>
    </div>
  );
}

/** table loading placeholder */
export function SkelRows({ n = 5, height = 54 }) {
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[...Array(n)].map((_, i) => <div key={i} className="skel" style={{ height, borderRadius: 12 }} />)}
    </div>
  );
}

/** bordered section block used inside the product drawer */
export function Sec({ title, last, children }) {
  return (
    <div style={{ border: '1px solid var(--hair)', borderRadius: 14, padding: 16, marginBottom: last ? 4 : 14 }}>
      <div className="t-meta" style={{ marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );
}

/** labelled field inside a Sec */
export function Fld({ label, hint, last, children }) {
  return (
    <div style={{ marginBottom: last ? 0 : 16 }}>
      <div className="t-meta" style={{ marginBottom: 6 }}>{label}</div>
      {children}
      {hint && <div className="t-sm" style={{ color: 'var(--muted-2)', marginTop: 5 }}>{hint}</div>}
    </div>
  );
}

export const inputCss = {
  width: '100%', border: '1px solid var(--hair)', borderRadius: 10, outline: 'none',
  fontSize: 14.5, padding: '10px 12px', fontFamily: 'var(--sans)', background: 'var(--surface)', boxSizing: 'border-box',
};
