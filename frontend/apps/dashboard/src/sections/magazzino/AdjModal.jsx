import { withPortalForm } from '@youty/shared';
import { MutationButton } from '@youty/shared';
// AdjModal.jsx — quick load / unload with reason (ported from the prototype AdjModal).
// carico  → POST /products/{id}/load   (multipart: qty, reason, optional invoice file)
// scarico → POST /products/{id}/unload (qty, kind ∈ internal_use/adjustment/transfer, reason)
// 422 "Giacenza insufficiente" → toast.
import React, { useState } from 'react';
import { api, Icon, Avatar } from '@youty/shared';
import { useDash } from '../../ctx.jsx';
import { DkModal } from '../../ui/index.js';
import { errMsg, fmtQty, num } from './lib.js';
import { NumBox } from './bits.jsx';

const CARICO_REASONS = [
  { it: 'Carico merce', en: 'Restock' },
  { it: 'Rettifica inventario', en: 'Inventory adjustment' },
  { it: 'Reso cliente', en: 'Customer return' },
];

// The four causali for a manual scarico. Each maps to a backend `kind`; the human
// label (localized) is sent as `reason`. Shared with ScaricoManualeModal via import.
export const SCARICO_REASONS = [
  { it: 'Uso interno',            en: 'Internal use',        kind: 'internal_use' },
  { it: 'Consumo in trattamento', en: 'Treatment use',       kind: 'internal_use' },
  { it: 'Rettifica inventario',   en: 'Inventory adjustment', kind: 'adjustment' },
  { it: 'Danneggiato o scaduto',  en: 'Damaged or expired',  kind: 'adjustment' },
];

function AdjModal({ prod, type, onClose, onDone }) {
  const { t, lang, fireToast, operators } = useDash();
  const isScarico = type === 'scarico';
  const reasons = isScarico ? SCARICO_REASONS : CARICO_REASONS;
  const [reason, setReason] = useState(null);
  const [qty, setQty] = useState(1);
  const [file, setFile] = useState(null);
  const [opId, setOpId] = useState(null);   // optional operatrice (scarico only)
  const [busy, setBusy] = useState(false);

  const stock = num(prod.stock_qty);
  const minV = num(prod.min_threshold);
  const delta = isScarico ? -Math.abs(qty) : Math.abs(qty);
  const after = Math.max(0, stock + delta);
  const insufficient = isScarico && qty > stock;
  const canConfirm = !!reason && qty > 0 && !busy && !insufficient;
  const unit = prod.package_unit || t('unità', 'units');

  const confirm = async () => {
    if (!canConfirm) return;
    setBusy(true);
    try {
      if (isScarico) {
        await api.post(`/api/inventory/products/${prod.id}/unload`, { qty, kind: reason.kind, reason: reason[lang], operator_id: opId });
      } else {
        const form = { qty, reason: reason[lang] };
        if (file) form.invoice = file;
        await api.postForm(`/api/inventory/products/${prod.id}/load`, form);
      }
      fireToast({ msg: t('Movimento registrato', 'Movement recorded'), icon: 'check' });
      onDone();
      onClose();
    } catch (err) {
      fireToast({ msg: errMsg(err, t), icon: 'alert' }); // 422 → "Giacenza insufficiente"
    } finally {
      setBusy(false);
    }
  };

  return (
    <DkModal open onClose={onClose} title={isScarico ? t('Scarico prodotto', 'Issue product') : t('Carico rapido', 'Quick restock')} sub={prod.name} width={440}
      foot={<React.Fragment>
        <button className="dk-btn dk-btn--ghost" onClick={onClose}>{t('Annulla', 'Cancel')}</button>
        <MutationButton className="dk-btn dk-btn--clay" disabled={!canConfirm} onClick={confirm}><Icon name="check" size={16} color="#fff" />{t('Conferma', 'Confirm')}</MutationButton>
      </React.Fragment>}>

      <div className="t-meta" style={{ marginBottom: 8 }}>{t('Causale', 'Reason')}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 18 }}>
        {reasons.map((r) => {
          const on = reason && reason.it === r.it;
          return (
            <button key={r.it} onClick={() => setReason(r)} style={{ padding: '8px 14px', borderRadius: 99, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: '1px solid ' + (on ? 'var(--clay)' : 'var(--hair)'), background: on ? 'var(--clay-tint)' : 'var(--surface)', color: on ? 'var(--clay-ink)' : 'var(--ink-2)' }}>{r[lang]}</button>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
        <div>
          <div className="t-meta" style={{ marginBottom: 6 }}>{isScarico ? t('Quantità da scaricare', 'Units to issue') : t('Quantità in arrivo', 'Incoming units')}</div>
          <NumBox value={qty} onChange={setQty} suffix={unit} width={150} />
          {insufficient && <div className="t-sm" style={{ color: 'var(--danger)', fontWeight: 700, marginTop: 5 }}>{t('Giacenza insufficiente', 'Insufficient stock')} · {fmtQty(stock, lang)} {unit}</div>}
        </div>
        <div style={{ padding: '12px 14px', background: 'var(--surface-2)', borderRadius: 10 }}>
          <div className="t-sm" style={{ color: 'var(--muted)', marginBottom: 2 }}>{t('Dopo', 'After')}</div>
          <div className="t-num" style={{ fontSize: 24, color: after <= minV ? 'var(--warn)' : 'var(--ink)' }}>{fmtQty(after, lang)}</div>
          {after <= minV && <div className="t-sm" style={{ color: 'var(--warn)', fontWeight: 700, marginTop: 2 }}>{t('Sotto soglia!', 'Below threshold!')}</div>}
        </div>
      </div>

      {isScarico && operators.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          <div className="t-meta" style={{ marginBottom: 8 }}>
            {t('Operatrice', 'Operator')}
            <span style={{ color: 'var(--muted-2)', fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}> · {t('opzionale', 'optional')}</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            <button
              onClick={() => setOpId(null)}
              style={{ padding: '6px 14px', borderRadius: 99, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: '1.5px solid ' + (opId == null ? 'var(--clay)' : 'var(--hair)'), background: opId == null ? 'var(--clay-tint)' : 'var(--surface)', color: opId == null ? 'var(--clay-ink)' : 'var(--ink-2)' }}
            >{t('Nessuna', 'None')} · —</button>
            {operators.map((o) => {
              const on = opId === o.id;
              return (
                <button
                  key={o.id} onClick={() => setOpId(o.id)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 12px 5px 5px', borderRadius: 99, cursor: 'pointer', border: '1.5px solid ' + (on ? o.color : 'var(--hair)'), background: on ? `color-mix(in srgb, ${o.color} 12%, transparent)` : 'var(--surface)' }}
                >
                  <Avatar initials={o.initials} size={22} color={o.color} ring={on} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: on ? 'var(--ink)' : 'var(--ink-2)' }}>{o.first_name}</span>
                  {on && <Icon name="check" size={13} color={o.color} stroke={2.6} />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!isScarico && (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: '1px solid var(--hair)', borderRadius: 9, fontSize: 13, padding: '8px 12px', background: 'var(--surface)', cursor: 'pointer', maxWidth: '100%', color: file ? 'var(--clay-ink)' : 'var(--muted)', fontWeight: 600 }}>
          <Icon name="arrowDn" size={14} color={file ? 'var(--clay-ink)' : 'var(--muted-2)'} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>{file ? file.name : t('Allega fattura (opz.)', 'Attach invoice (opt.)')}</span>
          <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFile(e.target.files[0] || null)} style={{ display: 'none' }} />
          {file && <button onClick={(e) => { e.preventDefault(); setFile(null); }} style={{ border: 'none', background: 'transparent', cursor: 'pointer', display: 'grid', placeItems: 'center' }}><Icon name="x" size={13} color="var(--muted-2)" /></button>}
        </label>
      )}
    </DkModal>
  );
}

export default withPortalForm(AdjModal);
