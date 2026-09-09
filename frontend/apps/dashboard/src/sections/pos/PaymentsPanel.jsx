import { withPortalForm } from '@youty/shared';
// PaymentsPanel — single or split payment editor, shared by the POS cart and the SellModal.
// Controlled: `value` is the payments model from lib.js (emptyPayments()), `onChange` updates it.
// Split rows must add up to `due` (the API 422s otherwise) — shows a live match indicator.
import React from 'react';
import { Icon } from '@youty/shared';
import { money, payMethods, round2, sanitizeAmtInput, toNum } from './lib.js';

function PaymentsPanel({ value: v, onChange, due, t, lang, compact = false }) {
  const methods = payMethods(t);
  const set = (patch) => onChange({ ...v, ...patch });
  const setRow = (i, patch) => set({ rows: v.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const removeRow = (i) => set({ rows: v.rows.filter((_, j) => j !== i) });

  const rowsSum = round2(v.rows.reduce((s, r) => s + toNum(r.amt), 0));
  const ok = Math.abs(rowsSum - due) <= 0.011;

  const toggleSplit = () => {
    if (!v.split) {
      const half = round2(due / 2);
      set({
        split: true,
        rows: [
          { method: v.method === 'gift_card' ? 'cash' : v.method, amt: half, code: '' },
          { method: 'card', amt: round2(due - half), code: '' },
        ],
      });
    } else {
      set({ split: false, rows: [] });
    }
  };
  const addRow = () => set({ rows: [...v.rows, { method: 'cash', amt: Math.max(0, round2(due - rowsSum)), code: '' }] });
  const balanceRow = (i) => {
    const others = v.rows.reduce((s, r, j) => (j === i ? s : s + toNum(r.amt)), 0);
    setRow(i, { amt: Math.max(0, round2(due - others)) });
  };

  const methodBtn = (active, k, label, onPick, small) => (
    <button key={k} onClick={onPick} style={{
      flex: 1, padding: small ? '8px 4px' : '10px 4px', borderRadius: small ? 9 : 10,
      fontSize: small ? 12 : 13, fontWeight: 600, cursor: 'pointer',
      border: '1px solid ' + (active ? 'var(--ink)' : 'var(--hair)'),
      background: active ? 'var(--ink)' : 'var(--surface)', color: active ? '#fff' : 'var(--ink)',
      whiteSpace: 'nowrap',
    }}>{label}</button>
  );

  const codeInput = (val, onVal) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, border: '1px solid var(--hair)', borderRadius: 10, padding: '9px 12px', background: 'var(--surface)' }}>
      <Icon name="gift" size={15} color="var(--clay-ink)" />
      <input value={val} onChange={(e) => onVal(e.target.value.toUpperCase())}
        placeholder={t('Codice gift card…', 'Gift card code…')} spellCheck={false}
        style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13.5, fontWeight: 700, fontFamily: 'ui-monospace, monospace', letterSpacing: '0.04em', minWidth: 0 }} />
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <div className="t-meta" style={{ flex: 1 }}>{t('Metodo di pagamento', 'Payment method')}</div>
        <button onClick={toggleSplit} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', background: 'transparent', border: 'none', fontSize: 12.5, fontWeight: 700, color: v.split ? 'var(--clay-ink)' : 'var(--muted)' }}>
          <Icon name={v.split ? 'check' : 'plus'} size={13} color={v.split ? 'var(--clay-ink)' : 'var(--muted)'} />
          {t('Pagamento diviso', 'Split payment')}
        </button>
      </div>

      {!v.split ? (
        <div>
          <div style={{ display: 'flex', gap: compact ? 6 : 8 }}>
            {methods.map(([k, l]) => methodBtn(v.method === k, k, l, () => set({ method: k }), compact))}
          </div>
          {v.method === 'gift_card' && codeInput(v.giftCode, (code) => set({ giftCode: code }))}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {v.rows.map((r, i) => (
            <div key={i}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex', gap: 5, flex: 1, minWidth: 0 }}>
                  {methods.map(([k, l]) => methodBtn(r.method === k, k, l, () => setRow(i, { method: k }), true))}
                </div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, border: '1px solid var(--hair)', borderRadius: 9, padding: '7px 9px', background: 'var(--surface)', width: 88, boxSizing: 'border-box', flexShrink: 0 }}>
                  <span style={{ color: 'var(--muted-2)', fontWeight: 700 }}>€</span>
                  <input type="text" inputMode="decimal" value={r.amt}
                    onChange={(e) => setRow(i, { amt: sanitizeAmtInput(e.target.value) })}
                    onBlur={() => { if (v.rows.length === 2) balanceRow(i === 0 ? 1 : 0); }}
                    placeholder="0,00"
                    style={{ border: 'none', outline: 'none', background: 'transparent', fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: 13.5, width: '100%' }} />
                </div>
                {v.rows.length > 2 && (
                  <button className="dk-iconbtn" style={{ width: 28, height: 28, flexShrink: 0 }} onClick={() => removeRow(i)} title={t('Rimuovi', 'Remove')}>
                    <Icon name="x" size={13} color="var(--muted-2)" />
                  </button>
                )}
              </div>
              {r.method === 'gift_card' && codeInput(r.code, (code) => setRow(i, { code }))}
            </div>
          ))}
          <button onClick={addRow} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start', padding: '6px 11px', borderRadius: 9, border: '1px dashed var(--hair)', background: 'var(--surface)', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: 'var(--clay-ink)' }}>
            <Icon name="plus" size={13} color="var(--clay-ink)" />{t('Aggiungi metodo', 'Add method')}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 10, background: ok ? 'var(--ok-tint)' : 'var(--warn-tint)' }}>
            <span className="t-sm" style={{ fontWeight: 700, color: ok ? 'var(--ok)' : 'var(--warn)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Icon name={ok ? 'check' : 'alert'} size={14} color={ok ? 'var(--ok)' : 'var(--warn)'} />
              {ok ? t('Importi corrispondenti', 'Amounts match') : t('La somma non corrisponde', 'Sum does not match')}
            </span>
            <span className="t-num" style={{ fontWeight: 700, color: ok ? 'var(--ok)' : 'var(--warn)' }}>{money(rowsSum, lang)} / {money(due, lang)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default withPortalForm(PaymentsPanel, { preview: () => true, framed: false, overlay: false });
