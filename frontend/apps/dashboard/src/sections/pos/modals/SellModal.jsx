import { MutationNumInput } from '@youty/shared';
import { withPortalForm } from '@youty/shared';
import { MutationButton } from '@youty/shared';
// SellModal — check-out of an appointment (payment & sale), opened from the Agenda with
// openModal('sell', { appointment }). `appointment` is an AppointmentOut-shaped object.
// Blocks are pre-populated from appointment.items grouped by operator; product / extra service /
// gift-card lines can be added. If deposit_status === 'paid' the deposit is deducted from the
// amount due (the API enforces Σ payments == total − deposit ±0.01, else 422).
// Submit → POST /api/sales/checkout/{appointment_id} → shows CheckoutOut.breakdown.
// Optional `onDone(checkoutOut)` prop lets the caller refetch its data.
import React, { useEffect, useMemo, useState } from 'react';
import { api, ApiError, Avatar, Icon, NumInput } from '@youty/shared';
import DkModal from '../../../ui/DkModal.jsx';
import { useDash } from '../../../ctx.jsx';
import PaymentsPanel from '../PaymentsPanel.jsx';
import {
  emptyPayments, inputCss, lineAmount, methodLabel, money, opName, paymentsError,
  resolvePayments, round2, svcLabel,
} from '../lib.js';

function SellModal({ appointment, onDone, onClose }) {
  const { t, lang, services, operators, opColors, fireToast, hasScope } = useDash();
  const appt = appointment || null;
  const canSell = hasScope('sales');

  /* ---- lines, pre-populated from the appointment items ---- */
  // line: { key, operator_id, line_type, service_id|product_id, name, unit_price, qty,
  //         discount_pct, is_gift, value, recipient_name, extra }
  const [lines, setLines] = useState(() => (appt?.items || []).map((it, i) => ({
    key: 'ai' + (it.id ?? i) + '_' + i,
    operator_id: it.operator_id,
    line_type: 'service',
    service_id: it.service_id,
    name: it.service_name,
    unit_price: Number(it.price),
    qty: 1, discount_pct: 0, is_gift: false, extra: false,
  })));
  const blockIds = useMemo(
    () => [...new Set((appt?.items || []).map((it) => it.operator_id))],
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const blockNames = useMemo(() => {
    const m = {};
    (appt?.items || []).forEach((it) => { if (!(it.operator_id in m)) m[it.operator_id] = it.operator_name; });
    return m;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- products for the per-block picker ---- */
  const [products, setProducts] = useState(null);
  useEffect(() => {
    let dead = false;
    api.get('/api/inventory/products', { params: { limit: 100 } })
      .then((r) => { if (!dead) setProducts((r.items || []).filter((p) => Number(p.sale_price) > 0)); })
      .catch(() => { if (!dead) setProducts([]); });
    return () => { dead = true; };
  }, []);

  /* ---- UI state ---- */
  const [pick, setPick] = useState(null);       // { opId, type: 'product' | 'service' }
  const [pickQ, setPickQ] = useState('');
  const [giftForm, setGiftForm] = useState(null); // { opId, amt, name }
  const [pay, setPay] = useState(emptyPayments());
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);   // CheckoutOut { sale, breakdown }
  const [confirmOpen, setConfirmOpen] = useState(false); // conferma prima di finalizzare

  if (!appt) return null;

  /* ---- helpers ---- */
  const opOf = (opId) => operators.find((o) => o.id === opId) || null;
  const opLabel = (opId) => { const o = opOf(opId); return o ? opName(o) : (blockNames[opId] || '#' + opId); };
  const opColor = (opId) => opColors[opId] || 'var(--clay)';
  const opInitials = (opId) => {
    const o = opOf(opId);
    if (o?.initials) return o.initials;
    return (opLabel(opId).split(' ').map((w) => w[0]).join('') || '?').slice(0, 2).toUpperCase();
  };
  const linesOf = (opId) => lines.filter((l) => l.operator_id === opId);
  const patchLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key) => setLines((ls) => ls.filter((l) => l.key !== key));

  const addProduct = (opId, p) => {
    setLines((ls) => [...ls, {
      key: 'pl' + Date.now() + Math.round(Math.random() * 1e4), operator_id: opId,
      line_type: 'product', product_id: p.id, name: p.name, unit_price: Number(p.sale_price),
      qty: 1, discount_pct: 0, is_gift: false, extra: true,
    }]);
    setPick(null); setPickQ('');
  };
  const addService = (opId, s) => {
    setLines((ls) => [...ls, {
      key: 'sl' + Date.now() + Math.round(Math.random() * 1e4), operator_id: opId,
      line_type: 'service', service_id: s.id, name: svcLabel(s, lang), unit_price: Number(s.price),
      qty: 1, discount_pct: 0, is_gift: false, extra: true,
    }]);
    setPick(null); setPickQ('');
  };
  const addGiftCard = () => {
    const v = round2(giftForm?.amt);
    if (!(v > 0)) return;
    setLines((ls) => [...ls, {
      key: 'gl' + Date.now(), operator_id: giftForm.opId, line_type: 'gift_card',
      name: 'Gift card · €' + v, value: v, recipient_name: (giftForm.name || '').trim(),
      qty: 1, discount_pct: 0, is_gift: false, extra: true,
    }]);
    setGiftForm(null);
  };

  /* ---- totals & deposit rule ---- */
  const opSubtotal = (opId) => round2(linesOf(opId).reduce((s, l) => s + lineAmount(l), 0));
  const gross = round2(blockIds.reduce((s, oid) => s + opSubtotal(oid), 0));
  const deposit = appt.deposit_status === 'paid' ? round2(appt.deposit_amount) : 0;
  const due = round2(gross - deposit);
  const dueOk = due >= 0;
  const payErr = paymentsError(pay, due, t);

  /* ---- submit ---- */
  const submit = async () => {
    if (saving || !dueOk) return;
    if (payErr) { fireToast({ msg: payErr, icon: 'alert' }); return; }
    setSaving(true);
    try {
      const body = {
        blocks: blockIds.map((opId) => ({
          operator_id: opId,
          lines: linesOf(opId).map((l) => (l.line_type === 'gift_card'
            ? { line_type: 'gift_card', value: Number(l.value).toFixed(2), ...(l.recipient_name ? { recipient_name: l.recipient_name } : {}) }
            : {
              line_type: l.line_type,
              ...(l.line_type === 'service' ? { service_id: l.service_id } : { product_id: l.product_id }),
              qty: l.qty, unit_price: Number(l.unit_price).toFixed(2),
              discount_pct: l.is_gift ? 0 : (l.discount_pct || 0), is_gift: !!l.is_gift,
            })),
        })),
        payments: resolvePayments(pay, due),
      };
      const res = await api.post(`/api/sales/checkout/${appt.id}`, body);
      setResult(res);
      fireToast({ msg: t('Check-out registrato', 'Check-out recorded'), icon: 'check' });
      if (onDone) onDone(res);
    } catch (err) {
      // 400 "Appuntamento già incassato", 422 payments mismatch / gift card balance, ...
      setConfirmOpen(false);
      fireToast({ msg: err instanceof ApiError ? err.message : t('Errore di rete', 'Network error'), icon: 'alert' });
    } finally {
      setSaving(false);
    }
  };

  /* ---- completion state: sale summary + per-operator breakdown ---- */
  if (result) {
    const { sale, breakdown } = result;
    return (
      <DkModal open onClose={onClose} title={t('Check-out completato', 'Check-out complete')} sub={appt.client?.full_name} width={520}
        foot={<button className="dk-btn dk-btn--clay" onClick={onClose}><Icon name="check" size={16} color="#fff" />{t('Chiudi', 'Close')}</button>}>
        <div style={{ textAlign: 'center', padding: '10px 0 6px' }}>
          <div style={{ width: 62, height: 62, borderRadius: 99, background: 'var(--ok-tint)', display: 'grid', placeItems: 'center', margin: '0 auto 14px' }}>
            <Icon name="check" size={30} color="var(--ok)" stroke={2.4} />
          </div>
          <div className="t-num" style={{ fontSize: 28, fontWeight: 800 }}>{money(sale.total, lang)}</div>
          {Number(sale.deposit_deducted) > 0 && (
            <div className="t-sm" style={{ color: 'var(--ok)', fontWeight: 700, marginTop: 4 }}>
              {t('Caparra detratta', 'Deposit deducted')} −{money(sale.deposit_deducted, lang)}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {sale.payments.map((p) => (
              <span key={p.id} style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)', background: 'var(--surface-2)', border: '1px solid var(--hair)', padding: '4px 10px', borderRadius: 99 }}>
                {methodLabel(p.method, t)} · {money(p.amount, lang)}
              </span>
            ))}
          </div>
        </div>
        <div className="t-meta" style={{ margin: '18px 0 8px' }}>{t('Ripartizione per operatrice', 'Split by stylist')}</div>
        <div style={{ border: '1px solid var(--hair)', borderRadius: 12, padding: '4px 14px', marginBottom: 8 }}>
          {breakdown.map((b, i) => (
            <div key={b.operator_id ?? i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: i ? '1px solid var(--hair)' : 'none' }}>
              <Avatar initials={opInitials(b.operator_id)} size={28} color={opColor(b.operator_id)} />
              <span style={{ flex: 1, fontWeight: 600, fontSize: 13.5 }}>{b.operator_name || opLabel(b.operator_id)}</span>
              <span className="t-num" style={{ fontWeight: 700 }}>{money(b.amount, lang)}</span>
            </div>
          ))}
        </div>
      </DkModal>
    );
  }

  /* ---- pickers ---- */
  const pickerList = pick?.type === 'product'
    ? (products || []).filter((p) => !pickQ || p.name.toLowerCase().includes(pickQ.toLowerCase()))
    : pick
      ? services.filter((s) => s.active !== false && (!pickQ || svcLabel(s, lang).toLowerCase().includes(pickQ.toLowerCase())))
      : [];

  const renderPicker = (opId) => (
    <div style={{ position: 'relative', marginTop: 10 }}>
      <div className="dk-search" style={{ width: '100%', height: 36 }}>
        <Icon name="search" size={15} color="var(--muted-2)" />
        <input autoFocus value={pickQ} onChange={(e) => setPickQ(e.target.value)}
          placeholder={pick.type === 'product' ? t('Cerca un prodotto…', 'Search a product…') : t('Cerca un servizio…', 'Search a service…')} />
        <button onClick={() => { setPick(null); setPickQ(''); }} style={{ cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
          <Icon name="x" size={14} color="var(--muted-2)" />
        </button>
      </div>
      <div className="dk-card scroll" style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 20, padding: 6, boxShadow: 'var(--sh-pop)', maxHeight: 200, overflowY: 'auto' }}>
        {pick.type === 'product' && products === null && <div style={{ padding: 6 }}>{[0, 1].map((i) => <div key={i} className="skel" style={{ height: 32, borderRadius: 8, marginBottom: i === 0 ? 6 : 0 }} />)}</div>}
        {pickerList.map((x) => (
          <button key={x.id} className="dk-row" onClick={() => (pick.type === 'product' ? addProduct(opId, x) : addService(opId, x))}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 10px', borderRadius: 8, textAlign: 'left', cursor: 'pointer' }}>
            <Icon name={pick.type === 'product' ? 'box' : 'scissors'} size={15} color="var(--muted-2)" />
            <span style={{ flex: 1, fontWeight: 600, fontSize: 13.5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {pick.type === 'product' ? x.name : svcLabel(x, lang)}
            </span>
            <span className="t-num" style={{ fontSize: 13, color: 'var(--muted)' }}>{money(pick.type === 'product' ? x.sale_price : x.price, lang)}</span>
          </button>
        ))}
        {!pickerList.length && (pick.type !== 'product' || products !== null) && (
          <div className="t-sm" style={{ color: 'var(--muted-2)', padding: 12, textAlign: 'center' }}>
            {pick.type === 'product' ? t('Nessun prodotto', 'No products') : t('Nessun servizio', 'No services')}
          </div>
        )}
      </div>
    </div>
  );

  const renderGiftForm = () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, border: '1px solid var(--hair)', borderRadius: 9, padding: '7px 9px', background: 'var(--surface)', width: 84, boxSizing: 'border-box' }}>
        <span style={{ color: 'var(--muted-2)', fontWeight: 700 }}>€</span>
        <MutationNumInput autoFocus min={1} value={giftForm.amt}
          onChange={(amt) => setGiftForm((g) => ({ ...g, amt }))}
          style={{ border: 'none', outline: 'none', background: 'transparent', fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: 13.5, width: '100%' }} />
      </div>
      <input value={giftForm.name} onChange={(e) => setGiftForm((g) => ({ ...g, name: e.target.value }))}
        placeholder={t('Destinatario (facolt.)', 'Recipient (optional)')} style={{ ...inputCss, flex: 1, minWidth: 120 }} />
      <button className="dk-btn dk-btn--ghost" style={{ height: 34, fontSize: 12.5, padding: '0 11px' }} disabled={!(round2(giftForm.amt) > 0)} onClick={addGiftCard}>
        <Icon name="plus" size={13} />{t('Aggiungi', 'Add')}
      </button>
      <button className="dk-iconbtn" style={{ width: 30, height: 30 }} onClick={() => setGiftForm(null)}><Icon name="x" size={14} /></button>
    </div>
  );

  const lineIcon = (l) => (l.line_type === 'gift_card' ? 'gift' : l.line_type === 'product' ? 'box' : 'scissors');

  return (
    <>
    <DkModal open onClose={onClose} width={900}
      title={t('Check-out · incasso e vendita', 'Check-out · payment & sale')}
      sub={(appt.client?.full_name || '') + ' · ' + t('ogni operatrice registra la sua vendita, poi un unico pagamento', 'each stylist records her sale, then one payment')}
      foot={(
        <>
          <button className="dk-btn dk-btn--ghost" onClick={onClose} disabled={saving}>{t('Annulla', 'Cancel')}</button>
          <MutationButton className="dk-btn dk-btn--clay" disabled={saving || !canSell || !dueOk || !!payErr} onClick={() => setConfirmOpen(true)}
            title={!canSell ? t('Permesso "vendite" mancante', 'Missing "sales" permission') : (payErr || undefined)}>
            <Icon name="check" size={17} color="#fff" />
            {saving ? t('Registrazione…', 'Recording…') : <>{t('Incassa', 'Take payment')} {money(Math.max(0, due), lang)}</>}
          </MutationButton>
        </>
      )}>

      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 22, alignItems: 'start' }}>
        {/* LEFT — sale grouped by operator */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {blockIds.map((oid) => {
            const blockLines = linesOf(oid);
            const sub = opSubtotal(oid);
            return (
              <div key={oid} style={{ border: '1px solid var(--hair)', borderRadius: 14 }}>
                {/* operator header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderRadius: '13px 13px 0 0', background: `color-mix(in srgb, ${opColor(oid)} 14%, var(--surface))` }}>
                  <Avatar initials={opInitials(oid)} size={30} color={opColor(oid)} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{opLabel(oid)}</div>
                    <div className="t-sm" style={{ color: 'var(--muted)' }}>{t('Vendita accreditata', 'Sale credited')}</div>
                  </div>
                  <span className="t-num" style={{ fontWeight: 700, fontSize: 15 }}>{money(sub, lang)}</span>
                </div>

                <div style={{ padding: '4px 14px 12px' }}>
                  {blockLines.map((l) => (
                    <div key={l.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--hair)' }}>
                      <Icon name={lineIcon(l)} size={14} color="var(--muted-2)" style={{ flexShrink: 0 }} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: l.is_gift ? 'var(--ok)' : 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {l.name}{l.line_type === 'gift_card' && l.recipient_name ? ' · ' + l.recipient_name : ''}
                      </span>
                      {l.line_type === 'product' && !l.is_gift && (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 1, border: '1px solid var(--hair)', borderRadius: 8, padding: '3px 6px', height: 26, boxSizing: 'border-box', background: 'var(--surface)', flexShrink: 0 }} title={t('Sconto prodotto', 'Product discount')}>
                          <MutationNumInput integer min={0} max={100} value={l.discount_pct}
                            onChange={(discount_pct) => patchLine(l.key, { discount_pct })}
                            style={{ width: 24, textAlign: 'right', border: 'none', outline: 'none', background: 'transparent', fontSize: 12.5, fontWeight: 700, fontFamily: 'ui-monospace, monospace' }} />
                          <span className="t-sm" style={{ color: 'var(--muted-2)', fontWeight: 700 }}>%</span>
                        </div>
                      )}
                      {l.line_type !== 'gift_card' && (
                        <button onClick={() => patchLine(l.key, { is_gift: !l.is_gift })} title={t('Ometti pagamento', 'Comp this item')} className="dk-iconbtn"
                          style={{ width: 26, height: 26, flexShrink: 0, background: l.is_gift ? 'var(--ok-tint)' : 'transparent', borderRadius: 7 }}>
                          <Icon name="gift" size={14} color={l.is_gift ? 'var(--ok)' : 'var(--muted-2)'} />
                        </button>
                      )}
                      {l.extra && (
                        <button onClick={() => removeLine(l.key)} className="dk-iconbtn" style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 7 }}>
                          <Icon name="x" size={13} color="var(--muted-2)" />
                        </button>
                      )}
                      <span className="t-num" style={{ minWidth: 54, textAlign: 'right', fontSize: 13, flexShrink: 0 }}>
                        {l.is_gift
                          ? <span style={{ color: 'var(--ok)', fontWeight: 700, fontSize: 12 }}>{t('Omaggio', 'Free')}</span>
                          : money(lineAmount(l), lang)}
                      </span>
                    </div>
                  ))}

                  {/* add lines to this block */}
                  {pick && pick.opId === oid ? renderPicker(oid)
                    : giftForm && giftForm.opId === oid ? renderGiftForm()
                      : (
                        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                          {[
                            ['box', t('Prodotto', 'Product'), () => { setPick({ opId: oid, type: 'product' }); setPickQ(''); setGiftForm(null); }],
                            ['scissors', t('Servizio extra', 'Extra service'), () => { setPick({ opId: oid, type: 'service' }); setPickQ(''); setGiftForm(null); }],
                            ['gift', t('Gift card', 'Gift card'), () => { setGiftForm({ opId: oid, amt: '50', name: '' }); setPick(null); }],
                          ].map(([ic, l, onClick]) => (
                            <button key={ic} onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 12px', borderRadius: 9, border: '1px dashed var(--hair)', background: 'var(--surface)', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: 'var(--clay-ink)' }}>
                              <Icon name="plus" size={13} color="var(--clay-ink)" /><Icon name={ic} size={14} color="var(--clay-ink)" />{l}
                            </button>
                          ))}
                        </div>
                      )}
                </div>
              </div>
            );
          })}
        </div>

        {/* RIGHT — single shared payment */}
        <div>
          <PaymentsPanel value={pay} onChange={setPay} due={Math.max(0, due)} t={t} lang={lang} compact />

          {/* totals — per operator + deposit + grand */}
          <div style={{ borderRadius: 12, padding: '14px 16px', border: '1px solid var(--hair)', background: 'var(--surface)', marginTop: 16 }}>
            {blockIds.length > 1 && blockIds.map((oid) => (
              <div key={oid} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                <span className="t-sm" style={{ color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 99, background: opColor(oid) }} />{opLabel(oid)}
                </span>
                <span className="t-num" style={{ fontSize: 13 }}>{money(opSubtotal(oid), lang)}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
              <span className="t-sm" style={{ color: 'var(--muted)' }}>{t('Totale lordo', 'Gross total')}</span>
              <span className="t-num" style={{ fontSize: 13 }}>{money(gross, lang)}</span>
            </div>
            {deposit > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', color: 'var(--ok)' }}>
                <span className="t-sm" style={{ fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="wallet" size={14} color="var(--ok)" />{t('Caparra detratta', 'Deposit deducted')}
                </span>
                <span className="t-num" style={{ fontWeight: 700, fontSize: 13 }}>−{money(deposit, lang)}</span>
              </div>
            )}
            <div style={{ height: 1, background: 'var(--hair)', margin: '7px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontWeight: 700 }}>{deposit > 0 ? t('Saldo da incassare', 'Balance due') : t('Totale da incassare', 'Total due')}</span>
              <span className="t-num" style={{ fontSize: 24, fontWeight: 800 }}>{money(Math.max(0, due), lang)}</span>
            </div>
            {!dueOk && (
              <div className="t-sm" style={{ color: 'var(--warn)', fontWeight: 600, marginTop: 8 }}>
                {t('Il totale è inferiore alla caparra versata: rimuovi qualche omaggio per procedere.', 'The total is below the paid deposit: remove some comps to proceed.')}
              </div>
            )}
          </div>
        </div>
      </div>
    </DkModal>

    {/* conferma prima di finalizzare il check-out */}
    <DkModal open={confirmOpen} onClose={() => { if (!saving) setConfirmOpen(false); }}
      title={t('Conferma pagamento', 'Confirm payment')} width={440}
      foot={(
        <>
          <button className="dk-btn dk-btn--ghost" onClick={() => setConfirmOpen(false)} disabled={saving}>{t('Torna indietro', 'Go back')}</button>
          <MutationButton className="dk-btn dk-btn--clay" onClick={submit} disabled={saving}>
            <Icon name="check" size={16} color="#fff" />{saving ? t('Registrazione…', 'Recording…') : t('Conferma', 'Confirm')}
          </MutationButton>
        </>
      )}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
        {t('Sei sicura di voler completare il pagamento?', 'Are you sure you want to complete the payment?')}
      </div>
      <div className="t-sm" style={{ color: 'var(--muted)' }}>
        {money(Math.max(0, due), lang)}{appt.client?.full_name ? ' · ' + appt.client.full_name : ''}
      </div>
    </DkModal>
    </>
  );
}

export default withPortalForm(SellModal);
