import { withPortalForm } from '@youty/shared';
import { MutationButton } from '@youty/shared';
// TechSheet.jsx — technical sheet card (read-only: sheets are IMMUTABLE on the
// API, no update/delete route) and creation form. Shared by the profile tab
// and the registry TechSheetModal. Prototype TECH_FIELDS mapped onto the
// API's flat TechnicalSheet columns (see helpers.js).
import React, { useState } from 'react';
import { api, ApiError, Avatar, Icon, mediaUrl } from '@youty/shared';
import { useDash } from '../../ctx.jsx';
import { TECH_FIELDS, dateTimeLabel, initialsOf, inputCss, sheetVal } from './helpers.js';

export function TechSheetCard({ sheet, defaultOpen }) {
  const { t, lang } = useDash();
  const [open, setOpen] = useState(!!defaultOpen);
  const fields = TECH_FIELDS(t);
  return (
    <div className="dk-card" style={{ padding: 0, boxShadow: 'none', border: '1px solid var(--hair)', overflow: 'hidden' }}>
      <button className="dk-row" onClick={() => setOpen((v) => !v)} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '14px 18px', width: '100%', textAlign: 'left', background: 'transparent', cursor: 'pointer', border: 'none' }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--clay-tint)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name="edit" size={16} color="var(--clay-ink)" /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{sheet.treatment || t('Trattamento', 'Treatment')}</div>
          <div className="t-sm" style={{ color: 'var(--muted)', marginTop: 1, display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            {sheet.author_name && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Avatar initials={initialsOf(sheet.author_name)} size={17} />{sheet.author_name}</span>}
            <span>· {dateTimeLabel(sheet.created_at, lang)}</span>
            {sheet.category && <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--clay-ink)', background: 'var(--clay-tint)', padding: '1px 7px', borderRadius: 99 }}>{sheet.category}</span>}
          </div>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: 'var(--muted-2)', flexShrink: 0 }}><Icon name="lock" size={12} color="var(--muted-2)" />{t('Sola lettura', 'Read-only')}</span>
        <Icon name="chevD" size={15} color="var(--muted-2)" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 160ms', flexShrink: 0 }} />
      </button>
      {open && (
        <div style={{ padding: '4px 18px 18px', borderTop: '1px solid var(--hair)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px', paddingTop: 14 }}>
            {fields.map((f) => {
              const val = sheetVal(sheet, f.k);
              return (
                <div key={f.k} style={{ gridColumn: f.type === 'textarea' ? '1 / -1' : 'auto' }}>
                  <div className="t-meta" style={{ marginBottom: 4 }}>{f.label}</div>
                  <div style={{ fontSize: 13.5, fontWeight: 500, color: val ? 'var(--ink-2)' : 'var(--muted-2)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{val || '—'}</div>
                </div>
              );
            })}
          </div>
          {sheet.photo && (
            <div style={{ marginTop: 16 }}>
              <div className="t-meta" style={{ marginBottom: 8 }}>{t('Foto', 'Photo')}</div>
              <img src={mediaUrl(sheet.photo)} alt="" style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--hair)' }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TechSheetFormContent({ clientId, appointmentId = null, defaultCategory, onSaved, onCancel }) {
  const { t, lang, serviceCategories, fireToast } = useDash();
  const fields = TECH_FIELDS(t);
  const catOptions = serviceCategories.map((sc) => (lang === 'en' && sc.name_en) ? sc.name_en : sc.name_it);
  const [category, setCategory] = useState(defaultCategory || catOptions[0] || t('Generale', 'General'));
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const setV = (k, v) => setValues((o) => ({ ...o, [k]: v }));
  const canSave = !!(values.treatment || '').trim() && !!category;

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        appointment_id: appointmentId,
        category,
        treatment: (values.treatment || '').trim(),
        zone: values.zone || '',
        products: values.products || '',
        params: (values.params || '').trim() ? { text: values.params.trim() } : {},
        outcome: values.outcome || '',
        duration_hold: values.duration_hold || '',
        advice: values.advice || '',
        protocol: values.protocol || '',
        next_step: values.next_step || '',
      };
      const sheet = await api.post(`/api/clients/${clientId}/sheets`, body);
      onSaved && onSaved(sheet);
    } catch (err) {
      fireToast({ msg: err instanceof ApiError ? err.message : t('Errore di rete', 'Network error'), icon: 'alert' });
    } finally { setSaving(false); }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--clay-tint)', borderRadius: 12, marginBottom: 16 }}>
        <Icon name="info" size={15} color="var(--clay-ink)" />
        <span className="t-sm" style={{ color: 'var(--ink-2)', fontWeight: 600 }}>{t('Una volta salvata, la scheda diventa di sola lettura e resta nella cronologia.', 'Once saved, the sheet becomes read-only and stays in the history.')}</span>
      </div>
      {/* category — free string on the API; the service-category catalog gives the sensible options */}
      <div style={{ marginBottom: 14 }}>
        <div className="t-meta" style={{ marginBottom: 6 }}>{t('Categoria', 'Category')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {[...new Set([...(defaultCategory ? [defaultCategory] : []), ...catOptions])].map((name) => {
            const on = category === name;
            return (
              <button key={name} onClick={() => setCategory(name)} style={{ padding: '6px 12px', borderRadius: 99, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: '1px solid ' + (on ? 'var(--clay)' : 'var(--hair)'), background: on ? 'var(--clay-tint)' : 'var(--surface)', color: on ? 'var(--clay-ink)' : 'var(--ink-2)' }}>{name}</button>
            );
          })}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {fields.map((f) => (
          <div key={f.k} style={{ gridColumn: f.type === 'textarea' ? '1 / -1' : 'auto' }}>
            <div className="t-meta" style={{ marginBottom: 6 }}>{f.label}{f.required && <span style={{ color: 'var(--danger)' }}> *</span>}</div>
            {f.type === 'textarea' ? (
              <textarea value={values[f.k] || ''} onChange={(e) => setV(f.k, e.target.value)} rows={2} placeholder={f.ph || ''} style={{ ...inputCss, resize: 'none', lineHeight: 1.5 }} />
            ) : f.type === 'select' ? (
              <select value={values[f.k] || ''} onChange={(e) => setV(f.k, e.target.value)} style={{ ...inputCss, cursor: 'pointer' }}>
                <option value="">{t('— seleziona —', '— select —')}</option>
                {f.opts.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input value={values[f.k] || ''} onChange={(e) => setV(f.k, e.target.value)} placeholder={f.ph || ''} style={inputCss} />
            )}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
        <button className="dk-btn dk-btn--ghost" style={{ flex: 1 }} onClick={onCancel}>{t('Annulla', 'Cancel')}</button>
        <MutationButton className="dk-btn dk-btn--clay" style={{ flex: 1, opacity: canSave && !saving ? 1 : 0.4 }} disabled={!canSave || saving} onClick={save}>
          <Icon name="check" size={16} color="#fff" />{saving ? t('Salvo…', 'Saving…') : t('Salva scheda', 'Save sheet')}
        </MutationButton>
      </div>
    </div>
  );
}

export const TechSheetForm = withPortalForm(TechSheetFormContent, { framed: false, overlay: false });
