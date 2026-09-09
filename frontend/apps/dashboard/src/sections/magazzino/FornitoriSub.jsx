import { PortalFormGate } from '@youty/shared';
import { MutationInput } from '@youty/shared';
import { MutationButton } from '@youty/shared';
// FornitoriSub.jsx — supplier directory: CRUD on /api/inventory/suppliers.
// DELETE returns 400 when the supplier still has products/orders attached → toast.
import React, { useState } from 'react';
import { api, EmptyState, Icon } from '@youty/shared';
import { useDash } from '../../ctx.jsx';
import { ORDER_METHODS, errMsg } from './lib.js';
import { inputCss } from './bits.jsx';

const EMPTY = { name: '', email: '', phone: '', order_method: 'email', address: '', vat_number: '', sdi_pec: '', notes: '' };

function MethodPills({ value, onChange, t, lang }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {Object.entries(ORDER_METHODS).map(([k, m]) => {
        const on = value === k;
        return (
          <MutationButton key={k} onClick={() => onChange(k)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 13px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid ' + (on ? 'var(--clay)' : 'var(--hair)'), background: on ? 'var(--clay-tint)' : 'var(--surface)', color: on ? 'var(--clay-ink)' : 'var(--ink-2)' }}>
            <Icon name={m.icon} size={14} color={on ? 'var(--clay-ink)' : 'var(--muted)'} />{m[lang]}
          </MutationButton>
        );
      })}
    </div>
  );
}

function SupplierForm({ draft, setDraft, t, lang }) {
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  return (
    <React.Fragment>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div style={{ gridColumn: '1 / -1' }}><div className="t-meta" style={{ marginBottom: 5 }}>{t('Nome', 'Name')}</div><MutationInput value={draft.name} onChange={(e) => set({ name: e.target.value })} style={inputCss} /></div>
        <div><div className="t-meta" style={{ marginBottom: 5 }}>Email</div><MutationInput value={draft.email} onChange={(e) => set({ email: e.target.value })} placeholder="ordini@fornitore.it" style={inputCss} /></div>
        <div><div className="t-meta" style={{ marginBottom: 5 }}>{t('Telefono', 'Phone')}</div><MutationInput value={draft.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="+39 …" style={inputCss} /></div>
        <div style={{ gridColumn: '1 / -1' }}><div className="t-meta" style={{ marginBottom: 5 }}>{t('Indirizzo', 'Address')}</div><MutationInput value={draft.address} onChange={(e) => set({ address: e.target.value })} placeholder={t('Via, civico, città, CAP', 'Street, city, ZIP')} style={inputCss} /></div>
        <div><div className="t-meta" style={{ marginBottom: 5 }}>{t('Partita IVA', 'VAT no.')}</div><MutationInput value={draft.vat_number} onChange={(e) => set({ vat_number: e.target.value })} placeholder="IT01234567890" style={inputCss} /></div>
        <div><div className="t-meta" style={{ marginBottom: 5 }}>{t('Codice SDI / PEC', 'SDI code / PEC')}</div><MutationInput value={draft.sdi_pec} onChange={(e) => set({ sdi_pec: e.target.value })} placeholder="es. ABCDEFG" style={inputCss} /></div>
        <div style={{ gridColumn: '1 / -1' }}><div className="t-meta" style={{ marginBottom: 5 }}>{t('Note', 'Notes')}</div><MutationInput value={draft.notes} onChange={(e) => set({ notes: e.target.value })} placeholder={t('es. ordine minimo, tempi di consegna…', 'e.g. minimum order, lead times…')} style={inputCss} /></div>
      </div>
      <div className="t-meta" style={{ marginBottom: 6 }}>{t("Metodo d'ordine preferito", 'Preferred order method')}</div>
      <MethodPills value={draft.order_method} onChange={(v) => set({ order_method: v })} t={t} lang={lang} />
    </React.Fragment>
  );
}

export default function FornitoriSub({ suppliers, allProds, canWrite, refreshShared }) {
  const { t, lang, fireToast } = useDash();
  const [editId, setEditId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [nw, setNw] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  const countOf = (sid) => (allProds || []).filter((p) => p.supplier_id === sid && p.active).length;

  const openEdit = (s) => {
    setEditId(s.id);
    setDraft({ name: s.name, email: s.email, phone: s.phone, order_method: s.order_method, address: s.address, vat_number: s.vat_number, sdi_pec: s.sdi_pec, notes: s.notes });
  };

  const trimmed = (d) => ({
    name: d.name.trim(), email: d.email.trim(), phone: d.phone.trim(), order_method: d.order_method,
    address: d.address.trim(), vat_number: d.vat_number.trim(), sdi_pec: d.sdi_pec.trim(), notes: d.notes.trim(),
  });

  const saveEdit = async (s) => {
    if (busy || !draft.name.trim()) return;
    setBusy(true);
    try {
      await api.put(`/api/inventory/suppliers/${s.id}`, trimmed(draft));
      fireToast({ msg: t(`Fornitore ${draft.name.trim()} aggiornato · si applica a ${countOf(s.id)} prodotti`, `Supplier ${draft.name.trim()} updated · applies to ${countOf(s.id)} products`), icon: 'check' });
      setEditId(null); setDraft(null);
      refreshShared();
    } catch (err) {
      fireToast({ msg: errMsg(err, t), icon: 'alert' });
    } finally { setBusy(false); }
  };

  const addSupplier = async () => {
    if (busy || !nw.name.trim()) return;
    setBusy(true);
    try {
      await api.post('/api/inventory/suppliers', trimmed(nw));
      fireToast({ msg: t(`Fornitore ${nw.name.trim()} creato`, `Supplier ${nw.name.trim()} created`), icon: 'check' });
      setAddOpen(false); setNw(EMPTY);
      refreshShared();
    } catch (err) {
      fireToast({ msg: errMsg(err, t), icon: 'alert' });
    } finally { setBusy(false); }
  };

  const del = async (s) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.del(`/api/inventory/suppliers/${s.id}`);
      fireToast({ msg: t(`Fornitore ${s.name} eliminato`, `Supplier ${s.name} deleted`), icon: 'x' });
      setEditId(null); setDraft(null);
      refreshShared();
    } catch (err) {
      // 400 "Fornitore con prodotti o ordini associati: impossibile eliminarlo"
      fireToast({ msg: errMsg(err, t), icon: 'alert' });
    } finally { setBusy(false); }
  };

  return (
    <React.Fragment>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <div className="t-sm" style={{ color: 'var(--muted)', flex: 1 }}>{t("Anagrafica fornitori. Modificando qui un contatto (es. l'email), l'aggiornamento si applica automaticamente a tutti i prodotti di quel fornitore.", 'Supplier directory. Editing a contact here (e.g. the email) automatically applies to all products from that supplier.')}</div>
        {canWrite && <MutationButton className="dk-btn dk-btn--clay" style={{ flexShrink: 0 }} onClick={() => setAddOpen(true)}><Icon name="plus" size={16} color="#fff" />{t('Nuovo fornitore', 'New supplier')}</MutationButton>}
      </div>

      {addOpen && (
        <div className="dk-card" style={{ padding: 18, marginBottom: 14, border: '1px solid var(--clay)' }}>
          <div className="t-meta" style={{ marginBottom: 12 }}>{t('Nuovo fornitore', 'New supplier')}</div>
          <PortalFormGate><SupplierForm draft={nw} setDraft={setNw} t={t} lang={lang} /></PortalFormGate>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="dk-btn dk-btn--ghost" onClick={() => { setAddOpen(false); setNw(EMPTY); }}>{t('Annulla', 'Cancel')}</button>
            <MutationButton className="dk-btn dk-btn--clay" disabled={!nw.name.trim() || busy} onClick={addSupplier}><Icon name="check" size={16} color="#fff" />{t('Crea', 'Create')}</MutationButton>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {suppliers.map((s) => {
          const isEdit = editId === s.id;
          const n = countOf(s.id);
          return (
            <div key={s.id} className="dk-card" style={{ padding: 18, border: '1px solid ' + (isEdit ? 'var(--clay)' : 'var(--hair)') }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <div style={{ width: 42, height: 42, borderRadius: 11, background: 'var(--clay-tint)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name="box" size={20} color="var(--clay-ink)" /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 3 }}>
                    <span style={{ fontFamily: 'var(--serif)', fontSize: 18, fontWeight: 500 }}>{s.name}</span>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--clay-ink)', background: 'var(--clay-tint)', padding: '2px 9px', borderRadius: 99 }}>{n} {t('prodotti', 'products')}</span>
                  </div>
                  {!isEdit && (
                    <div className="t-sm" style={{ color: 'var(--muted)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="mail" size={14} color="var(--muted-2)" />{s.email || '—'}</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="whatsapp" size={14} color="var(--muted-2)" />{s.phone || '—'}</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>{t('Ordine via', 'Order via')} <b style={{ color: 'var(--ink-2)' }}>{(ORDER_METHODS[s.order_method] || ORDER_METHODS.email)[lang]}</b></span>
                      {s.address && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="mapPin" size={14} color="var(--muted-2)" />{s.address}</span>}
                      {s.vat_number && <span>P.IVA {s.vat_number}</span>}
                      {s.sdi_pec && <span>SDI {s.sdi_pec}</span>}
                    </div>
                  )}
                  {!isEdit && s.notes && <div className="t-sm" style={{ color: 'var(--muted-2)', marginTop: 4 }}>{s.notes}</div>}
                </div>
                {!isEdit && canWrite && <MutationButton className="dk-btn dk-btn--ghost" style={{ flexShrink: 0 }} onClick={() => openEdit(s)}><Icon name="edit" size={15} />{t('Modifica', 'Edit')}</MutationButton>}
              </div>
              {isEdit && draft && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--hair)' }}>
                  <PortalFormGate><SupplierForm draft={draft} setDraft={setDraft} t={t} lang={lang} /></PortalFormGate>
                  <div className="t-sm" style={{ color: 'var(--muted-2)', margin: '12px 0' }}>{t(`La modifica si applicherà a ${n} prodotti di questo fornitore.`, `Changes will apply to ${n} products from this supplier.`)}</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <MutationButton className="dk-btn dk-btn--ghost" style={{ color: 'var(--danger)', borderColor: 'color-mix(in srgb, var(--danger) 40%, var(--hair))', marginRight: 'auto' }} disabled={busy} onClick={() => del(s)}><Icon name="x" size={15} color="var(--danger)" />{t('Elimina', 'Delete')}</MutationButton>
                    <button className="dk-btn dk-btn--ghost" onClick={() => { setEditId(null); setDraft(null); }}>{t('Annulla', 'Cancel')}</button>
                    <MutationButton className="dk-btn dk-btn--clay" disabled={!draft.name.trim() || busy} onClick={() => saveEdit(s)}><Icon name="check" size={16} color="#fff" />{t('Salva', 'Save')}</MutationButton>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {!suppliers.length && (
          <div className="dk-card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '40px 22px' }}>
              <EmptyState icon="box" title={t('Nessun fornitore', 'No suppliers')} sub={t('Aggiungi un fornitore per gestire prodotti e ordini.', 'Add a supplier to manage products and orders.')}
                mutationAction action={canWrite ? t('Nuovo fornitore', 'New supplier') : undefined} onAction={canWrite ? () => setAddOpen(true) : undefined} />
            </div>
          </div>
        )}
      </div>
    </React.Fragment>
  );
}
