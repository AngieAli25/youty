import { MutationNumInput } from '@youty/shared';
// lib.jsx — local shared helpers for the impostazioni section.
// NOTE: DkDrop / DkCondRow are LOCAL COPIES of the automazioni prototype builder
// (desktop-automazioni.jsx). The automazioni section keeps its own copy: flag for
// a future shared extraction.
import React, { useEffect, useRef, useState } from 'react';
import { ApiError, Icon, NumInput } from '@youty/shared';
import DkSeg from '../../ui/DkSeg.jsx';

/* ---------------- Google-Docs-like palette (GD_PALETTE port) ---------------- */
export function gdHexFromHSL(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return ('#' + f(0) + f(8) + f(4)).toUpperCase();
}
const GD_HUES = [0, 22, 45, 90, 140, 175, 205, 230, 265, 300];
export const GD_PALETTE = (() => {
  const rows = [];
  rows.push(['#000000', '#434343', '#666666', '#999999', '#B7B7B7', '#CCCCCC', '#D9D9D9', '#EFEFEF', '#F3F3F3', '#FFFFFF']);
  rows.push(GD_HUES.map((h) => gdHexFromHSL(h, 78, 50)));
  [92, 84, 74].forEach((l) => rows.push(GD_HUES.map((h) => gdHexFromHSL(h, 70, l))));
  [40, 30, 20].forEach((l) => rows.push(GD_HUES.map((h) => gdHexFromHSL(h, 65, l))));
  return rows;
})();

export function PaletteGrid({ value, onChange, style }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxWidth: 280, ...style }}>
      {GD_PALETTE.map((row, ri) => (
        <div key={ri} style={{ display: 'flex', gap: 3 }}>
          {row.map((c) => {
            const on = (value || '').toLowerCase() === c.toLowerCase();
            return (
              <button key={c} onClick={() => onChange(c)} title={c}
                style={{ width: 22, height: 22, borderRadius: 5, background: c, cursor: 'pointer', border: '1px solid ' + (c.toUpperCase() === '#FFFFFF' ? 'var(--hair)' : 'transparent'), outline: on ? '2px solid var(--ink)' : 'none', outlineOffset: 1, flexShrink: 0, display: 'grid', placeItems: 'center' }}>
                {on && <Icon name="check" size={12} color={ri === 0 && row.indexOf(c) > 6 ? 'var(--ink)' : '#fff'} stroke={2.6} />}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ---------------- common bits ---------------- */
export const inputCss = {
  border: '1px solid var(--hair)', borderRadius: 10, outline: 'none', fontSize: 14,
  padding: '10px 12px', fontFamily: 'var(--sans)', background: 'var(--surface)', color: 'var(--ink)',
};

export function toastErr(err, fireToast, t) {
  if (err instanceof ApiError) fireToast({ msg: err.message, icon: 'alert' });
  else fireToast({ msg: t('Errore di rete', 'Network error'), icon: 'alert' });
}

export function LockNote({ t, msg }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 15px', background: 'var(--surface-2)', borderRadius: 12, border: '1px solid var(--hair)' }}>
      <Icon name="lock" size={16} color="var(--muted)" />
      <span className="t-sm" style={{ color: 'var(--muted)', fontWeight: 600 }}>
        {msg || t('Sezione riservata al titolare.', 'This section is reserved to the owner.')}
      </span>
    </div>
  );
}

export function CopyField({ value, t, fireToast }) {
  const copy = () => {
    try { navigator.clipboard && navigator.clipboard.writeText(value); } catch { /* ignore */ }
    fireToast && fireToast({ msg: t('Copiato negli appunti', 'Copied to clipboard'), icon: 'check' });
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--hair)', borderRadius: 10, padding: '0 6px 0 12px', height: 40, background: 'var(--surface-2)' }}>
      <span style={{ flex: 1, minWidth: 0, fontFamily: 'ui-monospace, monospace', fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</span>
      <button onClick={copy} className="dk-btn dk-btn--soft" style={{ height: 30, padding: '0 12px', fontSize: 12.5, flexShrink: 0 }} title={t('Copia', 'Copy')}>
        <Icon name="tag" size={13} />{t('Copia', 'Copy')}
      </button>
    </div>
  );
}

/* ---------------- condition builder (local copy — see note at top) ----------------
   Works directly on the API rule shape: { field, cmp, value }
   cmp ∈ eq,neq,lt,lte,gt,gte,contains */
const CMP_NUM = [['gt', '>'], ['gte', '≥'], ['lt', '<'], ['lte', '≤'], ['eq', '=']];

export function DkDrop({ value, onChange, options, narrow }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const cur = options.find((o) => o.value === value) || options[0] || { label: '—' };
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen((o) => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 36, padding: narrow ? '0 10px' : '0 12px', border: '1px solid var(--hair)', borderRadius: 9, background: 'var(--surface)', cursor: 'pointer', fontSize: narrow ? 16 : 13.5, fontWeight: 700, color: 'var(--ink)' }}>
        {cur.label}<Icon name="chevD" size={13} color="var(--muted)" />
      </button>
      {open && (
        <div className="dk-card" style={{ position: 'absolute', top: 'calc(100% + 5px)', left: 0, minWidth: narrow ? 64 : 200, padding: 5, zIndex: 30, boxShadow: 'var(--sh-pop)' }}>
          {options.map((o) => {
            const on = o.value === value;
            return (
              <button key={String(o.value)} className="dk-row" onClick={() => { onChange(o.value); setOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 9px', borderRadius: 8, textAlign: 'left', cursor: 'pointer' }}>
                <span style={{ flex: 1, fontWeight: on ? 700 : 600, fontSize: narrow ? 15 : 13.5, color: on ? 'var(--ink)' : 'var(--ink-2)' }}>{o.label}</span>
                {on && <Icon name="check" size={14} color="var(--clay-ink)" stroke={2.4} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function DkCondRow({ rule, onChange, onRemove, t, lang, fields }) {
  const f = fields.find((x) => x.id === rule.field) || fields[0];
  const unitTxt = typeof f.unit === 'object' ? f.unit[lang] : f.unit;
  const onField = (fid) => {
    const nf = fields.find((x) => x.id === fid) || fields[0];
    if (nf.type === 'bool') onChange({ field: fid, cmp: 'eq', value: true });
    else if (nf.type === 'enum') onChange({ field: fid, cmp: nf.cmp || 'eq', value: nf.options.length ? nf.options[0].value : '' });
    else onChange({ field: fid, cmp: nf.defaultCmp || 'gt', value: nf.defaultValue != null ? nf.defaultValue : (nf.type === 'money' ? 100 : 1) });
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', padding: '11px 13px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--hair)' }}>
      <span style={{ fontWeight: 800, fontSize: 11.5, letterSpacing: '0.08em', color: 'var(--clay-ink)', background: 'var(--clay-tint)', padding: '3px 8px', borderRadius: 6 }}>{t('SE', 'IF')}</span>
      <DkDrop value={rule.field} onChange={onField} options={fields.map((x) => ({ value: x.id, label: x.label[lang] || x.label.it }))} />
      {f.type === 'bool' ? (
        <React.Fragment>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--muted)' }}>{t('è', 'is')}</span>
          <DkSeg value={rule.value ? 'y' : 'n'} onChange={(v) => onChange({ value: v === 'y' })} options={[{ value: 'y', label: t('Sì', 'Yes') }, { value: 'n', label: 'No' }]} style={{ padding: 3 }} />
        </React.Fragment>
      ) : f.type === 'enum' ? (
        <React.Fragment>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--muted)' }}>{f.cmp === 'contains' ? t('include', 'includes') : t('è', 'is')}</span>
          <DkDrop value={rule.value} onChange={(v) => onChange({ value: v })} options={f.options} />
        </React.Fragment>
      ) : (
        <React.Fragment>
          <DkDrop value={rule.cmp} onChange={(v) => onChange({ cmp: v })} options={CMP_NUM.map(([k, s]) => ({ value: k, label: s }))} narrow />
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--hair)', borderRadius: 9, padding: '0 10px', height: 36, background: 'var(--surface)' }}>
            {f.type === 'money' && <span className="t-sm" style={{ color: 'var(--muted-2)', fontWeight: 700 }}>€</span>}
            <MutationNumInput integer min={0} value={rule.value} onChange={(value) => onChange({ value })} style={{ width: 52, border: 'none', outline: 'none', background: 'transparent', fontSize: 14.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }} />
            {unitTxt && f.type !== 'money' && <span className="t-sm" style={{ color: 'var(--muted-2)', fontWeight: 700 }}>{unitTxt}</span>}
          </div>
        </React.Fragment>
      )}
      <div style={{ flex: 1 }} />
      <button className="dk-iconbtn" onClick={onRemove} aria-label="remove" style={{ width: 32, height: 32, display: 'grid', placeItems: 'center', borderRadius: 9, cursor: 'pointer', color: 'var(--muted)' }}><Icon name="x" size={16} /></button>
    </div>
  );
}

/* ---------------- deposit-rule fields (dkDepositFields port, API facts) ---------------- */
export function depositFields(clientCategories, t, lang) {
  return [
    { id: 'reliability', type: 'num', defaultCmp: 'lt', defaultValue: 60, unit: '', label: { it: 'Affidabilità', en: 'Reliability' } },
    { id: 'categories', type: 'enum', cmp: 'contains', label: { it: 'Etichetta cliente', en: 'Client label' }, options: clientCategories.map((c) => ({ value: c.name, label: c.name })) },
    { id: 'total_spent', type: 'money', defaultCmp: 'lt', defaultValue: 100, unit: '€', label: { it: 'Totale speso', en: 'Total spent' } },
    { id: 'visits', type: 'num', defaultCmp: 'lt', defaultValue: 2, unit: '', label: { it: 'Numero di visite', en: 'Number of visits' } },
    { id: 'noshow_count', type: 'num', defaultCmp: 'gte', defaultValue: 1, unit: '', label: { it: 'No-show', en: 'No-shows' } },
    { id: 'latecancel_count', type: 'num', defaultCmp: 'gte', defaultValue: 1, unit: '', label: { it: 'Cancellazioni tardive', en: 'Late cancellations' } },
    { id: 'deposit_always', type: 'bool', label: { it: 'Deposito sempre richiesto', en: 'Deposit always required' } },
  ];
}

/* ---------------- natural-language rule sentence (dkRuleSentence port) ---------------- */
export function ruleSentence(conditions, fields, t, lang) {
  const rules = (conditions && conditions.rules) || [];
  if (!rules.length) return t('Tutte le clienti', 'All clients');
  const joinTxt = (conditions.op === 'or') ? ` ${t('O', 'OR')} ` : ` ${t('E', 'AND')} `;
  const CMP_TXT = { lt: '<', lte: '≤', gt: '>', gte: '≥', eq: '=', neq: '≠' };
  return rules.map((r) => {
    const f = fields.find((x) => x.id === r.field);
    if (!f) return `${r.field} ${CMP_TXT[r.cmp] || r.cmp} ${r.value}`;
    const label = f.label[lang] || f.label.it;
    if (f.type === 'enum') {
      const o = (f.options || []).find((x) => x.value === r.value);
      return label + ' = ' + (o ? o.label : r.value);
    }
    if (f.type === 'bool') return label + (r.value ? '' : ' = No');
    return label + ' ' + (CMP_TXT[r.cmp] || r.cmp) + ' ' + (f.type === 'money' ? '€' : '') + r.value;
  }).join(joinTxt);
}
