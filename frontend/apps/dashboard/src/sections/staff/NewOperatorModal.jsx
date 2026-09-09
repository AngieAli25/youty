import { MutationNumInput } from '@youty/shared';
import { withPortalForm } from '@youty/shared';
import { MutationButton } from '@youty/shared';
// NewOperatorModal — create operator form (POST /api/staff/). Rendered locally
// by the staff section (not in the shell modal registry).
import React, { useState } from 'react';
import { api, ApiError, Icon, NumInput } from '@youty/shared';
import { DkModal, HexInput } from '../../ui/index.js';
import { useDash } from '../../ctx.jsx';
import { GD_PALETTE, inputCss, svcLabel } from './lib.js';

function NewOperatorModal({ onClose, onCreated }) {
  const { t, lang, services, locations, operators, reload, fireToast, opPalette } = useDash();
  const [form, setForm] = useState({
    first_name: '', last_name: '', role_title: '',
    color: opPalette[operators.length % opPalette.length],
    hourly_cost: '18', service_ids: [],
  });
  const [saving, setSaving] = useState(false);
  const set = (p) => setForm((f) => ({ ...f, ...p }));
  const toggleSvc = (sid) => set({ service_ids: form.service_ids.includes(sid) ? form.service_ids.filter((x) => x !== sid) : [...form.service_ids, sid] });
  const valid = form.first_name.trim() && form.last_name.trim();

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const created = await api.post('/api/staff/', {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        color: form.color,
        role_title: form.role_title.trim(),
        location_id: (locations.find((l) => l.is_default) || locations[0] || {}).id ?? null,
        user_id: null,
        service_ids: form.service_ids,
        hourly_cost: (Number(form.hourly_cost) || 0).toFixed(2),
        cycle_weeks: 1,
        active: true,
        order: operators.length,
      });
      await reload.operators().catch(() => {});
      fireToast({ msg: t('Operatrice creata', 'Stylist created'), icon: 'check' });
      onCreated ? onCreated(created.id) : onClose();
    } catch (err) {
      fireToast({ msg: err instanceof ApiError ? err.message : t('Errore di rete', 'Network error'), icon: 'alert' });
    } finally {
      setSaving(false);
    }
  };

  const field = (label, node) => (
    <label style={{ display: 'block' }}>
      <div className="t-sm" style={{ color: 'var(--muted)', fontWeight: 600, marginBottom: 5 }}>{label}</div>
      {node}
    </label>
  );

  return (
    <DkModal open onClose={onClose} title={t('Nuova operatrice', 'New stylist')} width={560}
      foot={
        <React.Fragment>
          <button className="dk-btn dk-btn--ghost" onClick={onClose}>{t('Annulla', 'Cancel')}</button>
          <MutationButton className="dk-btn dk-btn--clay" onClick={save} disabled={!valid || saving} style={{ opacity: valid && !saving ? 1 : 0.55 }}>
            <Icon name="check" size={16} color="#fff" />{saving ? t('Salvataggio…', 'Saving…') : t('Crea', 'Create')}
          </MutationButton>
        </React.Fragment>
      }>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {field(t('Nome', 'First name'), <input value={form.first_name} onChange={(e) => set({ first_name: e.target.value })} style={inputCss} autoFocus />)}
          {field(t('Cognome', 'Last name'), <input value={form.last_name} onChange={(e) => set({ last_name: e.target.value })} style={inputCss} />)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 12 }}>
          {field(t('Ruolo', 'Role'), <input value={form.role_title} onChange={(e) => set({ role_title: e.target.value })} placeholder={t('es. Hair stylist', 'e.g. Hair stylist')} style={inputCss} />)}
          {field(t('Costo orario €', 'Hourly cost €'), <MutationNumInput min={0} value={form.hourly_cost} onChange={(hourly_cost) => set({ hourly_cost })} style={inputCss} />)}
        </div>

        <div>
          <div className="t-sm" style={{ color: 'var(--muted)', fontWeight: 600, marginBottom: 6 }}>{t('Colore in agenda', 'Calendar colour')}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{ width: 30, height: 30, borderRadius: 8, background: form.color, border: '1px solid var(--hair)', flexShrink: 0 }} />
            <HexInput value={form.color} onChange={(c) => set({ color: c })} width={70} />
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
            {opPalette.map((c) => (
              <button key={c} onClick={() => set({ color: c })} title={c} style={{ width: 24, height: 24, borderRadius: 6, background: c, cursor: 'pointer', border: '1px solid var(--hair)', outline: form.color.toLowerCase() === c.toLowerCase() ? '2px solid var(--ink)' : 'none', outlineOffset: 1 }} />
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {GD_PALETTE.slice(1, 4).map((row, ri) => (
              <div key={ri} style={{ display: 'flex', gap: 3 }}>
                {row.map((c) => (
                  <button key={c} onClick={() => set({ color: c })} title={c} style={{ width: 20, height: 20, borderRadius: 5, background: c, cursor: 'pointer', border: '1px solid transparent', outline: form.color.toLowerCase() === c.toLowerCase() ? '2px solid var(--ink)' : 'none', outlineOffset: 1, flexShrink: 0 }} />
                ))}
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="t-sm" style={{ color: 'var(--muted)', fontWeight: 600, marginBottom: 8 }}>{t('Servizi abilitati', 'Enabled services')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {services.map((s) => {
              const on = form.service_ids.includes(s.id);
              return (
                <button key={s.id} onClick={() => toggleSvc(s.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 99, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: '1px solid ' + (on ? 'var(--clay)' : 'var(--hair)'), background: on ? 'var(--clay)' : 'var(--surface)', color: on ? '#fff' : 'var(--ink-2)' }}>
                  {svcLabel(s, lang)}<Icon name={on ? 'check' : 'plus'} size={12} color={on ? '#fff' : 'var(--muted-2)'} />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </DkModal>
  );
}

export default withPortalForm(NewOperatorModal);
