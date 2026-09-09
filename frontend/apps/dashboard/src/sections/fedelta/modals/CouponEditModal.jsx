import { MutationNumInput } from '@youty/shared';
import { withPortalForm } from '@youty/shared';
import { MutationButton } from '@youty/shared';
import React, { useState } from 'react';
import { api, ApiError, fmtEur, Icon, NumInput } from '@youty/shared';
import { DkModal } from '../../../ui/index.js';
import ClientPicker from '../ClientPicker.jsx';
import { inputCss, numCss, segBtn } from '../formStyles.js';
import { COUPON_ORIGIN_META, COUPON_STATUS_META } from '../meta.js';

/** Create/edit a manual coupon. `client_id` optional (client search), `kind` percent|amount,
 * `value`, `expires_at` optional. The prototype's `gift` kind and services-restriction have no
 * API fields on Coupon — dropped here (see fedelta section report).
 * PUT only succeeds while status === 'active' (backend 422s otherwise) — read-only past that. */
function CouponEditModal({ draft, setDraft, onClose, onSaved, onDeleted, onRedeemed, canWrite, t, lang, fireToast }) {
  const [saving, setSaving] = useState(false);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const isNew = !!draft._new;
  const locked = !isNew && draft.status !== 'active'; // backend refuses edits once redeemed/expired
  const canSave = canWrite && !locked && Number(draft.value) > 0;

  const kinds = [['percent', t('Percentuale', 'Percentage')], ['amount', t('Importo', 'Amount')]];
  const valueLabel = draft.kind === 'amount' ? '-' + fmtEur(Number(draft.value) || 0, lang) : '-' + (draft.value || 0) + '%';

  const buildPayload = () => ({
    client_id: draft.client ? draft.client.id : null,
    kind: draft.kind,
    value: draft.kind === 'amount' ? Number(draft.value || 0).toFixed(2) : Math.round(Number(draft.value || 0)),
    expires_at: draft.expires_at ? new Date(draft.expires_at + 'T23:59:00').toISOString() : null,
  });

  const save = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      if (isNew) {
        await api.post('/api/marketing/coupons', buildPayload());
      } else {
        await api.put(`/api/marketing/coupons/${draft.id}`, buildPayload());
      }
      onSaved(isNew ? t('Coupon creato', 'Coupon created') : t('Coupon aggiornato', 'Coupon updated'));
    } catch (err) {
      fireToast({ msg: err instanceof ApiError ? err.message : t('Errore di rete', 'Network error'), icon: 'alert' });
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await api.del(`/api/marketing/coupons/${draft.id}`);
      onDeleted();
    } catch (err) {
      fireToast({ msg: err instanceof ApiError ? err.message : t('Errore di rete', 'Network error'), icon: 'alert' });
      setSaving(false);
    }
  };

  const redeem = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const updated = await api.post(`/api/marketing/coupons/${draft.id}/redeem`, {});
      setDraft((d) => ({ ...d, status: updated.status, redeemed_at: updated.redeemed_at }));
      fireToast({ msg: t('Coupon segnato come utilizzato', 'Coupon marked as redeemed'), icon: 'check' });
      if (onRedeemed) onRedeemed(); // refresh the list behind the modal
    } catch (err) {
      fireToast({ msg: err instanceof ApiError ? err.message : t('Errore di rete', 'Network error'), icon: 'alert' });
    } finally {
      setSaving(false);
    }
  };

  const om = !isNew ? (COUPON_ORIGIN_META[draft.origin] || COUPON_ORIGIN_META.manual) : null;
  const sm = !isNew ? (COUPON_STATUS_META[draft.status] || COUPON_STATUS_META.active) : null;

  return (
    <DkModal open onClose={onClose} title={isNew ? t('Nuovo coupon', 'New coupon') : t('Coupon', 'Coupon') + ' · ' + draft.code}
      sub={t('Valore, cliente e validità', 'Value, client and validity')} width={520}
      foot={<React.Fragment>
        {!isNew && canWrite && <MutationButton className="dk-btn dk-btn--ghost" style={{ color: 'var(--danger)', borderColor: 'color-mix(in srgb, var(--danger) 40%, var(--hair))', marginRight: 'auto' }} onClick={del} disabled={saving}><Icon name="x" size={16} color="var(--danger)" />{t('Elimina', 'Delete')}</MutationButton>}
        {!isNew && canWrite && draft.status === 'active' && <MutationButton className="dk-btn dk-btn--ghost" onClick={redeem} disabled={saving}>{t('Segna come utilizzato', 'Mark as redeemed')}</MutationButton>}
        <button className="dk-btn dk-btn--ghost" onClick={onClose}>{t('Chiudi', 'Close')}</button>
        {(isNew || !locked) && canWrite && <MutationButton className="dk-btn dk-btn--clay" disabled={!canSave || saving} onClick={save}>{t('Salva', 'Save')}</MutationButton>}
      </React.Fragment>}>
      {!isNew && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color: om.color, background: om.bg, padding: '3px 9px', borderRadius: 99 }}>{om[lang]}</span>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: sm.color, background: sm.bg, padding: '3px 9px', borderRadius: 99 }}>{sm[lang]}</span>
          {locked && <span className="t-sm" style={{ color: 'var(--muted)', marginLeft: 'auto' }}>{t('Non più modificabile', 'No longer editable')}</span>}
        </div>
      )}
      <div className="t-meta" style={{ marginBottom: 8 }}>{t('Tipo', 'Type')}</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {kinds.map(([k, l]) => (
          <button key={k} disabled={locked} onClick={() => set({ kind: k })} style={segBtn(draft.kind === k)}>{l}</button>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', background: 'var(--surface-2)', borderRadius: 12, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <div className="t-meta" style={{ marginBottom: 8 }}>{draft.kind === 'percent' ? t('Percentuale', 'Percentage') : t('Importo', 'Amount')}</div>
          <div style={numCss}>
            {draft.kind === 'amount' && <span className="t-sm" style={{ color: 'var(--muted-2)', fontWeight: 700 }}>€</span>}
            <MutationNumInput disabled={locked} min={0} integer={draft.kind === 'percent'} max={draft.kind === 'percent' ? 100 : undefined} value={draft.value} onChange={(value) => set({ value })} style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 16, fontWeight: 700, width: 70 }} />
            {draft.kind === 'percent' && <span className="t-sm" style={{ color: 'var(--muted-2)', fontWeight: 700 }}>%</span>}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="t-sm" style={{ color: 'var(--muted)' }}>{t('Mostrato come', 'Shown as')}</div>
          <div className="t-num" style={{ fontSize: 24, color: 'var(--clay-ink)' }}>{valueLabel}</div>
        </div>
      </div>
      <div className="t-meta" style={{ marginBottom: 8 }}>{t('Cliente (opzionale)', 'Client (optional)')}</div>
      <div style={{ marginBottom: 16, opacity: locked ? 0.6 : 1, pointerEvents: locked ? 'none' : 'auto' }}>
        <ClientPicker client={draft.client} onChange={(c) => set({ client: c })} placeholder={t('Cerca una cliente…', 'Search a client…')} t={t} />
      </div>
      <div className="t-meta" style={{ marginBottom: 6 }}>{t('Scadenza (opzionale)', 'Expiry (optional)')}</div>
      {/* draft.expires_at is always a YYYY-MM-DD string here (normalised by CouponSub.openExisting) */}
      <input type="date" disabled={locked} value={draft.expires_at || ''} onChange={(e) => set({ expires_at: e.target.value || null })} style={inputCss} />
    </DkModal>
  );
}

export default withPortalForm(CouponEditModal, { preview: ({ draft }) => !!draft?.id });
