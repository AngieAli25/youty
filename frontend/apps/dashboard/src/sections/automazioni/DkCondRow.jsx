import { MutationNumInput } from '@youty/shared';
// DkCondRow.jsx — one "SE / IF" condition row of the automation builder.
// Builds a rule of the API `conditions` JSON: { field, cmp, value } — fields and
// operators come from GET /api/automations/events-catalog (bilingual labels).
// NOTE for the integrator: this is a LOCAL copy of the prototype DkCondRow (the
// impostazioni section keeps its own for deposit rules) — unify in a future refactor.
import React from 'react';
import { Icon, NumInput } from '@youty/shared';
import { DkDrop } from './controls.jsx';
import { fieldKind, catLabel } from './catalog.js';

// compact symbols for the numeric comparators (prototype visual language);
// catalog labels are kept as tooltips.
const CMP_SYMBOL = { eq: '=', neq: '≠', lt: '<', lte: '≤', gt: '>', gte: '≥' };

// sensible default value per field when switching field
const FIELD_DEFAULTS = { reliability: 60, total_spent: 100, visits: 1, noshow_count: 1 };

/** Default rule used by "add condition" — exported so the builder seeds new rows consistently. */
export function defaultRule(fields, clientCategories) {
  const first = (fields && fields[0]) || { value: 'reliability' };
  return ruleForField(first.value, clientCategories);
}

export function ruleForField(field, clientCategories) {
  if (fieldKind(field) === 'text') {
    const firstCat = clientCategories && clientCategories[0];
    return { field, cmp: 'contains', value: firstCat ? firstCat.name : '' };
  }
  return { field, cmp: 'gte', value: FIELD_DEFAULTS[field] != null ? FIELD_DEFAULTS[field] : 1 };
}

export default function DkCondRow({ c, onChange, onRemove, t, lang, fields, operators, clientCategories }) {
  const kind = fieldKind(c.field);
  const numCmps = (operators || []).filter((o) => o.value !== 'contains');

  const onField = (fid) => onChange(ruleForField(fid, clientCategories));

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', padding: '11px 13px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--hair)' }}>
      <span style={{ fontWeight: 800, fontSize: 11.5, letterSpacing: '0.08em', color: 'var(--clay-ink)', background: 'var(--clay-tint)', padding: '3px 8px', borderRadius: 6 }}>{t('SE', 'IF')}</span>
      <DkDrop
        value={c.field}
        onChange={onField}
        options={(fields || []).map((f) => ({ value: f.value, label: catLabel(f, lang) }))}
      />
      {kind === 'text' ? (
        // `categories` matches by label name via "contains" — offer the salon's labels.
        <React.Fragment>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--muted)' }}>{t('contiene', 'contains')}</span>
          {clientCategories && clientCategories.length > 0 ? (
            <DkDrop
              value={c.value}
              onChange={(v) => onChange({ value: v })}
              options={clientCategories.map((cat) => ({ value: cat.name, label: cat.name }))}
            />
          ) : (
            <input
              value={c.value || ''}
              onChange={(e) => onChange({ value: e.target.value })}
              placeholder={t('Etichetta…', 'Label…')}
              style={{ width: 130, border: '1px solid var(--hair)', borderRadius: 9, height: 36, padding: '0 10px', background: 'var(--surface)', outline: 'none', fontSize: 13.5, fontWeight: 600 }}
            />
          )}
        </React.Fragment>
      ) : (
        <React.Fragment>
          <DkDrop
            value={c.cmp}
            onChange={(v) => onChange({ cmp: v })}
            options={numCmps.map((o) => ({ value: o.value, label: CMP_SYMBOL[o.value] || catLabel(o, lang), title: catLabel(o, lang) }))}
            narrow
          />
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--hair)', borderRadius: 9, padding: '0 10px', height: 36, background: 'var(--surface)' }}>
            {kind === 'money' && <span className="t-sm" style={{ color: 'var(--muted-2)', fontWeight: 700 }}>€</span>}
            <MutationNumInput
              integer={kind !== 'money'}
              min={0}
              value={c.value}
              onChange={(value) => onChange({ value })}
              style={{ width: 52, border: 'none', outline: 'none', background: 'transparent', fontSize: 14.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
            />
          </div>
        </React.Fragment>
      )}
      <div style={{ flex: 1 }} />
      <button className="dk-iconbtn" onClick={onRemove} aria-label="remove" style={{ width: 32, height: 32, display: 'grid', placeItems: 'center', borderRadius: 9, cursor: 'pointer', color: 'var(--muted)' }}><Icon name="x" size={16} /></button>
    </div>
  );
}
