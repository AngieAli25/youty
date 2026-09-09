import { MutationNumInput } from '@youty/shared';
import { MutationButton } from '@youty/shared';
// parts.jsx — small building blocks shared across Servizi/Pacchetti cards & modals.
import React from 'react';
import { Icon, Avatar, NumInput } from '@youty/shared';

export function CategoryDot({ color, size = 10 }) {
  return (
    <span
      style={{
        width: size, height: size, borderRadius: '50%',
        background: color || 'var(--muted-2)', flexShrink: 0, display: 'inline-block',
      }}
    />
  );
}

/** labelled form row, 150px label column + content */
export function FRow({ label, hint, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 14, alignItems: 'center', padding: '12px 0', borderTop: '1px solid var(--hair)' }}>
      <div>
        <div className="t-ui" style={{ fontWeight: 600, lineHeight: 1.25 }}>{label}</div>
        {hint && <div className="t-sm" style={{ color: 'var(--muted-2)', marginTop: 3, lineHeight: 1.3 }}>{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

/** € amount input — value is kept as the raw decimal string, formatted on save */
export function PriceBox({ value, onChange, width = 110 }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--hair)', borderRadius: 10, padding: '0 12px', height: 42, background: 'var(--surface)', width }}>
      <span className="t-sm" style={{ color: 'var(--muted-2)', fontWeight: 600 }}>€</span>
      <MutationNumInput
        min={0} value={value}
        onChange={onChange}
        style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 15, fontWeight: 600, width: '100%' }}
      />
    </div>
  );
}

/** duration_min: campo di testo numerico libero (minuti interi), senza freccette.
 *  Emette un intero; consente di svuotare mentre si digita, poi clampa a `min` sul blur. */
export function DurationInput({ value, onChange, min = 5 }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--hair)', borderRadius: 10, padding: '0 12px', height: 42, background: 'var(--surface)', width: 120 }}>
      <MutationNumInput
        integer min={min} value={value} onChange={onChange}
        style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 15, fontWeight: 600, width: '100%' }}
      />
      <span className="t-sm" style={{ color: 'var(--muted-2)', fontWeight: 600 }}>min</span>
    </div>
  );
}

/** overlapping avatar stack for the operators assigned to a service */
export function OperatorAvatarStack({ ops, max = 4 }) {
  if (!ops.length) return <span className="t-sm" style={{ color: 'var(--muted-2)' }}>—</span>;
  const shown = ops.slice(0, max);
  const extra = ops.length - shown.length;
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {shown.map((o, i) => (
        <div key={o.id} style={{ marginLeft: i ? -8 : 0 }} title={`${o.first_name} ${o.last_name}`}>
          <Avatar initials={o.initials} size={28} color={o.color} ring />
        </div>
      ))}
      {extra > 0 && (
        <div style={{ marginLeft: -8, width: 28, height: 28, borderRadius: '50%', background: 'var(--paper-2)', border: '1px solid var(--hair)', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, color: 'var(--ink-2)' }}>
          +{extra}
        </div>
      )}
    </div>
  );
}

/** search field + optional filter slot + "new" button */
export function SearchToolbar({ q, setQ, placeholder, onAdd, addLabel, canAdd = true, extra }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
      <div className="dk-search" style={{ flex: 1, minWidth: 0, width: 'auto' }}>
        <Icon name="search" size={18} color="var(--muted-2)" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
        {q && (
          <button className="press" onClick={() => setQ('')} style={{ cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
            <Icon name="x" size={15} color="var(--muted-2)" />
          </button>
        )}
      </div>
      {extra}
      {canAdd && (
        <MutationButton className="dk-btn dk-btn--clay" onClick={onAdd} style={{ flexShrink: 0 }}>
          <Icon name="plus" size={17} color="#fff" />{addLabel}
        </MutationButton>
      )}
    </div>
  );
}
