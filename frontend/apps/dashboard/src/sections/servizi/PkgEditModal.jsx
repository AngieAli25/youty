import { withPortalForm } from '@youty/shared';
import { MutationButton } from '@youty/shared';
// PkgEditModal.jsx — create / edit a package (POST/PUT /api/catalog/packages).
// items = [{service_id, qty}] picked from the service catalog; savings preview.
import React, { useState } from 'react';
import { Icon, Toggle, fmtEur, EmptyState } from '@youty/shared';
import { DkModal } from '../../ui/index.js';
import { FRow, PriceBox } from './parts.jsx';

function svcName(s, lang) {
  return lang === 'en' && s.name_en ? s.name_en : s.name_it;
}

function PkgEditModal({ pkg, services, onSave, onDelete, onClose, t, lang }) {
  const isNew = !pkg?.id;
  const [draft, setDraft] = useState(() => ({
    name: pkg?.name || '',
    description: pkg?.description || '',
    price: pkg?.price != null ? String(pkg.price) : '0',
    active: pkg?.active ?? true,
    items: (pkg?.items || []).map((it) => ({ service_id: it.service_id, qty: it.qty || 1 })),
  }));
  const [svcQ, setSvcQ] = useState('');
  const [svcOpen, setSvcOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const servicesById = Object.fromEntries(services.map((s) => [s.id, s]));

  const addSvc = (id) => setDraft((d) => (
    d.items.some((it) => it.service_id === id)
      ? d
      : { ...d, items: [...d.items, { service_id: id, qty: 1 }] }
  ));
  const setQty = (id, qty) => setDraft((d) => ({
    ...d,
    items: qty <= 0
      ? d.items.filter((it) => it.service_id !== id)
      : d.items.map((it) => (it.service_id === id ? { ...it, qty } : it)),
  }));

  const orig = draft.items.reduce((sum, it) => {
    const s = servicesById[it.service_id];
    return sum + (s ? Number(s.price) * it.qty : 0);
  }, 0);
  const price = Number(draft.price || 0);
  const saving_ = orig - price;
  const off = orig > 0 && saving_ > 0 ? Math.round((saving_ / orig) * 100) : 0;

  const canSave = draft.name.trim().length > 0 && draft.items.length > 0 && price >= 0 && !saving;

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave({
        name: draft.name.trim(),
        description: draft.description.trim(),
        price: price.toFixed(2),
        active: draft.active,
        items: draft.items,
      });
    } finally {
      setSaving(false);
    }
  };

  const inputCss = { border: '1px solid var(--hair)', borderRadius: 10, outline: 'none', fontSize: 14.5, padding: '10px 12px', fontFamily: 'var(--sans)', background: 'var(--surface)', width: '100%' };
  const pickable = services.filter((s) => s.active && (!svcQ || svcName(s, lang).toLowerCase().includes(svcQ.toLowerCase())));

  return (
    <DkModal
      open onClose={onClose}
      title={isNew ? t('Nuovo pacchetto', 'New package') : t('Modifica pacchetto', 'Edit package')}
      sub={t('Più servizi a prezzo scontato', 'Multiple services at a discounted price')}
      width={600}
      foot={(
        <React.Fragment>
          {!isNew && onDelete && (
            <MutationButton className="dk-btn dk-btn--ghost" style={{ marginRight: 'auto', color: 'var(--danger)' }} onClick={onDelete}>
              <Icon name="pause" size={15} color="var(--danger)" />{t('Disattiva', 'Deactivate')}
            </MutationButton>
          )}
          <button className="dk-btn dk-btn--ghost" onClick={onClose}>{t('Annulla', 'Cancel')}</button>
          <MutationButton className="dk-btn dk-btn--clay" disabled={!canSave} style={{ opacity: canSave ? 1 : 0.5 }} onClick={submit}>
            <Icon name="check" size={17} color="#fff" />{saving ? t('Salvataggio…', 'Saving…') : t('Salva pacchetto', 'Save package')}
          </MutationButton>
        </React.Fragment>
      )}
    >
      <input
        value={draft.name} onChange={(e) => set({ name: e.target.value })}
        placeholder={t('Nome pacchetto', 'Package name')}
        style={{ border: 'none', borderBottom: '2px solid var(--hair)', outline: 'none', fontSize: 20, fontWeight: 700, fontFamily: 'var(--serif)', padding: '6px 0', background: 'transparent', width: '100%', marginBottom: 12 }}
      />
      <div style={{ marginBottom: 14 }}>
        <div className="t-meta" style={{ marginBottom: 6 }}>{t('Descrizione', 'Description')}</div>
        <textarea
          value={draft.description} onChange={(e) => set({ description: e.target.value })} rows={2}
          placeholder={t('Occasione, periodo di validità, note…', 'Occasion, validity period, notes…')}
          style={{ ...inputCss, resize: 'none', lineHeight: 1.45 }}
        />
      </div>

      <div className="t-meta" style={{ marginBottom: 8 }}>{t('Servizi inclusi', 'Included services')} <span style={{ color: 'var(--clay)' }}>*</span></div>

      {/* selected services with qty steppers */}
      {draft.items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {draft.items.map((it) => {
            const s = servicesById[it.service_id];
            return (
              <div key={it.service_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', border: '1px solid var(--hair)', borderRadius: 10, background: 'var(--surface-2)' }}>
                <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 13.5 }}>{s ? svcName(s, lang) : t('Servizio rimosso', 'Removed service')}</span>
                {s && <span className="t-num" style={{ fontSize: 13, color: 'var(--muted)' }}>{fmtEur(Number(s.price) * it.qty, lang)}</span>}
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <button className="dk-iconbtn" style={{ width: 26, height: 26, borderRadius: 7, fontSize: 14 }} onClick={() => setQty(it.service_id, it.qty - 1)}>−</button>
                  <span style={{ minWidth: 26, textAlign: 'center', fontWeight: 700, fontSize: 13.5 }}>×{it.qty}</span>
                  <button className="dk-iconbtn" style={{ width: 26, height: 26, borderRadius: 7, fontSize: 14 }} onClick={() => setQty(it.service_id, it.qty + 1)}>+</button>
                </div>
                <button className="press" onClick={() => setQty(it.service_id, 0)} style={{ cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
                  <Icon name="x" size={14} color="var(--muted-2)" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* service picker */}
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <div className="dk-search" style={{ width: '100%' }}>
          <Icon name="search" size={16} color="var(--muted-2)" />
          <input
            value={svcQ}
            onChange={(e) => { setSvcQ(e.target.value); setSvcOpen(true); }}
            onFocus={() => setSvcOpen(true)}
            placeholder={draft.items.length ? t('Aggiungi un altro servizio…', 'Add another service…') : t('Cerca e aggiungi servizi…', 'Search and add services…')}
          />
          <button onClick={() => setSvcOpen((o) => !o)} style={{ cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
            <Icon name="chevD" size={15} color="var(--muted-2)" style={{ transform: svcOpen ? 'rotate(180deg)' : 'none', transition: 'transform 140ms' }} />
          </button>
        </div>
        {svcOpen && (
          <React.Fragment>
            <div onClick={() => setSvcOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 20 }} />
            <div className="dk-card scroll" style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 21, padding: 6, boxShadow: 'var(--sh-pop)', maxHeight: 230, overflowY: 'auto' }}>
              {pickable.map((s) => {
                const sel = draft.items.find((it) => it.service_id === s.id);
                return (
                  <button
                    key={s.id} className="dk-row"
                    onClick={() => (sel ? setQty(s.id, sel.qty + 1) : addSvc(s.id))}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 10px', borderRadius: 8, textAlign: 'left' }}
                  >
                    <span style={{ width: 18, height: 18, borderRadius: 6, border: '1.6px solid ' + (sel ? 'var(--clay)' : 'var(--faint)'), background: sel ? 'var(--clay)' : 'transparent', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                      {sel && <Icon name="check" size={11} color="#fff" stroke={2.6} />}
                    </span>
                    <span style={{ flex: 1, fontWeight: 600, fontSize: 13.5, color: sel ? 'var(--clay-ink)' : 'var(--ink-2)' }}>
                      {svcName(s, lang)}{sel && sel.qty > 1 ? ` ×${sel.qty}` : ''}
                    </span>
                    <span className="t-num" style={{ fontSize: 13, color: 'var(--muted)' }}>{fmtEur(Number(s.price), lang)}</span>
                  </button>
                );
              })}
              {!pickable.length && <div style={{ padding: 4 }}><EmptyState icon="search" title={t('Nessun servizio', 'No services')} /></div>}
            </div>
          </React.Fragment>
        )}
      </div>
      <div className="t-sm" style={{ color: 'var(--muted-2)', marginBottom: 14, marginTop: -8 }}>
        {t('Clicca di nuovo un servizio per ripeterlo (es. 5× manicure).', 'Click a service again to repeat it (e.g. 5× manicure).')}
      </div>

      {/* price + savings preview */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 16px', background: 'var(--surface-2)', borderRadius: 12, marginBottom: 8 }}>
        <div>
          <div className="t-meta" style={{ marginBottom: 6, whiteSpace: 'nowrap' }}>{t('Prezzo pacchetto', 'Package price')}</div>
          <PriceBox value={draft.price} onChange={(v) => set({ price: v })} width={118} />
        </div>
        <div style={{ flex: 1, textAlign: 'right' }}>
          <div className="t-sm" style={{ color: 'var(--muted)' }}>
            {t('Valore singoli', 'Individual value')} <span style={{ textDecoration: orig > price ? 'line-through' : 'none' }}>{fmtEur(orig, lang)}</span>
          </div>
          {off > 0 && (
            <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--clay-ink)' }}>
              {t('Sconto', 'Discount')} -{off}% · {fmtEur(saving_, lang)}
            </div>
          )}
        </div>
      </div>

      <FRow label={t('Pacchetto attivo', 'Package active')} hint={draft.active ? t('Visibile e vendibile', 'Visible and sellable') : t('Nascosto', 'Hidden')}>
        <Toggle on={draft.active} onChange={(v) => set({ active: v })} />
      </FRow>
    </DkModal>
  );
}

export default withPortalForm(PkgEditModal, { preview: ({ pkg }) => !!pkg?.id });
