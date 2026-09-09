import { MutationTextarea } from '@youty/shared';
import { MutationNumInput } from '@youty/shared';
import { MutationButton } from '@youty/shared';
// OrdiniSub.jsx — purchase orders: GET /api/inventory/orders, generate drafts from
// below-threshold products, edit draft lines (PUT, qty 0 deletes), send (POST /send),
// receive with per-line quantities (POST /receive → discrepancies).
// Line prices/VAT are not stored on order lines — they are enriched client-side from
// the products snapshot (purchase price net of supplier discount).
import React, { useEffect, useMemo, useState } from 'react';
import { api, EmptyState, fmtEur, Icon, NumInput } from '@youty/shared';
import { useDash } from '../../ctx.jsx';
import { ORDER_METHODS, ORDER_STATUS_META, STOCK_META, errMsg, fmtQty, fmtWhen, num, openOrderPrint, orderLineMath, parseRestockCsv, unitCost } from './lib.js';
import { Pager, SkelRows, inputCss } from './bits.jsx';

const PAGE = 20;

export default function OrdiniSub({ suppliers, allProds, canWrite, refreshShared }) {
  const { t, lang, fireToast, salon } = useDash();

  const [statusF, setStatusF] = useState('all');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState(null); // {items, count}
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [generating, setGenerating] = useState(false);

  const prodById = useMemo(() => {
    const m = new Map();
    (allProds || []).forEach((p) => m.set(p.id, p));
    return m;
  }, [allProds]);
  const supById = useMemo(() => {
    const m = new Map();
    (suppliers || []).forEach((s) => m.set(s.id, s));
    return m;
  }, [suppliers]);

  useEffect(() => {
    let dead = false;
    setLoading(true);
    api.get('/api/inventory/orders', { params: { status: statusF !== 'all' ? statusF : undefined, limit: PAGE, offset } })
      .then((r) => { if (!dead) setData(r); })
      .catch((err) => { if (!dead) { setData({ items: [], count: 0 }); fireToast({ msg: errMsg(err, t), icon: 'alert' }); } })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [statusF, offset, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => setTick((n) => n + 1);
  const replaceOrder = (order) => setData((d) => (d ? { ...d, items: d.items.map((o) => (o.id === order.id ? order : o)) } : d));

  const generate = async () => {
    if (!canWrite || generating) return;
    setGenerating(true);
    try {
      const orders = await api.post('/api/inventory/orders/generate');
      if (orders.length) {
        fireToast({ msg: t(`${orders.length} bozze d'ordine generate dai prodotti sotto soglia`, `${orders.length} order drafts generated from below-threshold products`), icon: 'check' });
        setStatusF('all'); setOffset(0); refresh();
      } else {
        fireToast({ msg: t('Nessun riordino necessario · tutti i prodotti sono sopra soglia', 'No reorders needed · all products are above threshold'), icon: 'check' });
      }
    } catch (err) {
      fireToast({ msg: errMsg(err, t), icon: 'alert' });
    } finally {
      setGenerating(false);
    }
  };

  const chips = [['all', t('Tutti', 'All')], ['draft', t('Bozze', 'Drafts')], ['sent', t('Inviati', 'Sent')], ['partial', t('Parziali', 'Partial')], ['received', t('Ricevuti', 'Received')]];
  const items = data?.items || [];

  return (
    <React.Fragment>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 18 }}>
        <div className="t-sm" style={{ color: 'var(--muted)', flex: 1 }}>
          {t("Bozze d'ordine generate automaticamente dai prodotti sotto soglia, raggruppate per fornitore. Regola le quantità, invia con il metodo preferito o scarica il PDF da inoltrare.", 'Purchase-order drafts auto-generated from below-threshold products, grouped by supplier. Adjust quantities, send via the preferred method or download the PDF to forward.')}
        </div>
        {canWrite && <MutationButton className="dk-btn dk-btn--clay" onClick={generate} disabled={generating} style={{ flexShrink: 0 }}><Icon name="refresh" size={16} color="#fff" />{t('Genera ordini', 'Generate orders')}</MutationButton>}
      </div>

      <div style={{ display: 'flex', gap: 7, marginBottom: 18, flexWrap: 'wrap' }}>
        {chips.map(([k, l]) => {
          const on = statusF === k;
          return <button key={k} onClick={() => { setStatusF(k); setOffset(0); }} style={{ padding: '7px 14px', borderRadius: 99, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: '1px solid ' + (on ? 'var(--ink)' : 'var(--hair)'), background: on ? 'var(--ink)' : 'var(--surface)', color: on ? '#fff' : 'var(--ink-2)' }}>{l}</button>;
        })}
      </div>

      {data === null && loading ? (
        <SkelRows n={3} height={150} />
      ) : !items.length ? (
        <div className="dk-card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '40px 22px' }}>
            <EmptyState icon="check" title={statusF === 'all' ? t('Nessun ordine', 'No orders') : t('Nessun ordine in questo stato', 'No orders with this status')}
              sub={t('Genera le bozze dai prodotti sotto soglia.', 'Generate drafts from below-threshold products.')}
              mutationAction action={canWrite ? t('Genera ordini', 'Generate orders') : undefined} onAction={canWrite ? generate : undefined} />
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, opacity: loading ? 0.55 : 1, transition: 'opacity 120ms' }}>
          {items.map((o) => (
            <OrderCard key={o.id} order={o} prodById={prodById} supplier={supById.get(o.supplier_id)} salonName={salon?.name}
              canWrite={canWrite} t={t} lang={lang} fireToast={fireToast}
              onChanged={replaceOrder} onStockChanged={refreshShared} />
          ))}
        </div>
      )}
      {data && <Pager count={data.count} offset={offset} limit={PAGE} onPage={setOffset} t={t} />}
    </React.Fragment>
  );
}

/* ─────────────────────── single order card ─────────────────────── */
function OrderCard({ order, prodById, supplier, salonName, canWrite, t, lang, fireToast, onChanged, onStockChanged }) {
  const isDraft = order.status === 'draft';
  const isSent = order.status === 'sent';
  const isDone = order.status === 'received' || order.status === 'partial';
  const statusMeta = ORDER_STATUS_META[order.status] || ORDER_STATUS_META.draft;

  const [method, setMethod] = useState(order.sent_method || supplier?.order_method || 'email');
  const [qtyDraft, setQtyDraft] = useState({});   // lineId → qty (edited)
  const [busy, setBusy] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [recv, setRecv] = useState({});           // lineId → received qty
  const [recvCsv, setRecvCsv] = useState(null);   // string | null

  /* enrich lines with product data (price net of discount, VAT, unit, stock) */
  const lines = order.lines.map((l) => {
    const p = prodById.get(l.product_id);
    return {
      ...l,
      qty: qtyDraft[l.id] != null ? qtyDraft[l.id] : num(l.qty_ordered),
      cost: unitCost(p),
      vat: p ? num(p.vat_rate) : 0,
      unit: p?.package_unit || '',
      stock: p ? num(p.stock_qty) : null,
      min: p ? num(p.min_threshold) : null,
      lowItem: p ? p.stock_state === 'low' : false,
    };
  });
  const dirty = Object.keys(qtyDraft).some((id) => {
    const l = order.lines.find((x) => String(x.id) === String(id));
    return l && num(l.qty_ordered) !== qtyDraft[id];
  });
  const grandNet = lines.reduce((a, l) => a + orderLineMath(l.qty, l.cost, l.vat).net, 0);
  const grandVat = lines.reduce((a, l) => a + orderLineMath(l.qty, l.cost, l.vat).vat, 0);
  const contact = supplier ? (method === 'whatsapp' ? (supplier.phone || supplier.email) : (supplier.email || supplier.phone)) : '';

  /* ---- draft line editing (PUT, qty 0 deletes) ---- */
  const saveLines = async (extra) => {
    const changed = order.lines
      .filter((l) => qtyDraft[l.id] != null && qtyDraft[l.id] !== num(l.qty_ordered))
      .map((l) => ({ id: l.id, qty_ordered: qtyDraft[l.id] }));
    const payload = extra ? [...changed.filter((c) => c.id !== extra.id), extra] : changed;
    if (!payload.length) return order;
    const updated = await api.put(`/api/inventory/orders/${order.id}`, { lines: payload });
    setQtyDraft({});
    onChanged(updated);
    return updated;
  };
  const onSaveLines = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await saveLines();
      fireToast({ msg: t('Quantità aggiornate', 'Quantities updated'), icon: 'check' });
    } catch (err) {
      fireToast({ msg: errMsg(err, t), icon: 'alert' });
    } finally { setBusy(false); }
  };
  const removeLine = async (l) => {
    if (busy) return;
    setBusy(true);
    try {
      await saveLines({ id: l.id, qty_ordered: 0 });
      fireToast({ msg: t('Riga rimossa', 'Line removed'), icon: 'x' });
    } catch (err) {
      fireToast({ msg: errMsg(err, t), icon: 'alert' });
    } finally { setBusy(false); }
  };

  /* ---- send ---- */
  const send = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await saveLines(); // persist pending edits first
      const updated = await api.post(`/api/inventory/orders/${order.id}/send`, { method });
      onChanged(updated);
      const meta = ORDER_METHODS[method] || ORDER_METHODS.email;
      fireToast({ msg: t(`Ordine inviato a ${order.supplier_name} via ${meta.it}`, `Order sent to ${order.supplier_name} via ${meta.en}`), icon: 'check' });
    } catch (err) {
      fireToast({ msg: errMsg(err, t), icon: 'alert' });
    } finally { setBusy(false); }
  };

  /* ---- PDF (dependency-free print window) ---- */
  const onPdf = () => {
    const ok = openOrderPrint({ salonName, order, supplier, lines, lang });
    fireToast({
      msg: ok ? t('PDF ordine generato · pronto da inoltrare', 'Order PDF generated · ready to forward') : t('Consenti i popup per scaricare il PDF', 'Allow popups to download the PDF'),
      icon: ok ? 'check' : 'alert',
    });
  };

  /* ---- receive flow ---- */
  const startReceive = () => {
    const init = {};
    order.lines.forEach((l) => { init[l.id] = num(l.qty_ordered); });
    setRecv(init); setRecvCsv(null); setReceiving(true);
  };
  const setRecvQty = (id, q) => setRecv((r) => ({ ...r, [id]: Math.max(0, parseInt(q, 10) || 0) }));
  const applyRecvCsv = () => {
    const rows = parseRestockCsv(recvCsv || '');
    let matched = 0;
    const next = { ...recv };
    rows.forEach((r) => {
      const key = r.key.toLowerCase();
      const hit = order.lines.find((l) => l.product_name.toLowerCase() === key || (l.sku || '').toLowerCase() === key);
      if (hit) { next[hit.id] = r.qty; matched++; }
    });
    setRecv(next); setRecvCsv(null);
    fireToast({ msg: matched ? t(`${matched} righe aggiornate dal CSV`, `${matched} rows updated from CSV`) : t('Nessuna corrispondenza trovata', 'No matches found'), icon: matched ? 'check' : 'alert' });
  };
  const confirmReceive = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api.post(`/api/inventory/orders/${order.id}/receive`, {
        lines: order.lines.map((l) => ({ id: l.id, qty_received: recv[l.id] != null ? recv[l.id] : 0 })),
      });
      onChanged(res.order);
      setReceiving(false); setRecv({}); setRecvCsv(null);
      onStockChanged();
      const nDisc = res.discrepancies.length;
      fireToast({
        msg: nDisc
          ? t(`Consegna registrata · ${nDisc} discrepanze`, `Delivery recorded · ${nDisc} discrepancies`)
          : t('Consegna registrata · magazzino aggiornato', 'Delivery recorded · stock updated'),
        icon: 'check',
      });
    } catch (err) {
      fireToast({ msg: errMsg(err, t), icon: 'alert' });
    } finally { setBusy(false); }
  };

  const recvTotal = order.lines.reduce((a, l) => a + (recv[l.id] != null ? recv[l.id] : 0), 0);
  const discCount = isDone ? order.lines.filter((l) => num(l.qty_received) !== num(l.qty_ordered)).length : 0;

  return (
    <div className="dk-card" style={{ overflow: 'hidden', opacity: isDone ? 0.85 : 1 }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px', borderBottom: '1px solid var(--hair)', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--serif)', fontSize: 18, fontWeight: 500 }}>{order.supplier_name}</span>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--clay-ink)', background: 'var(--clay-tint)', padding: '2px 9px', borderRadius: 99 }}>#{order.id} · {order.lines.length} {t('articoli', 'items')}</span>
            {!isDraft && (
              <span style={{ fontSize: 11.5, fontWeight: 700, color: statusMeta.color, background: statusMeta.tint, padding: '2px 9px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Icon name={isDone ? 'box' : 'check'} size={12} color={statusMeta.color} stroke={2.4} />
                {statusMeta[lang]}{isSent && order.sent_at ? ' · ' + fmtWhen(order.sent_at, lang) : ''}{discCount ? ` · ${discCount} ${t('discrepanze', 'discrepancies')}` : ''}
              </span>
            )}
          </div>
          <div className="t-sm" style={{ color: 'var(--muted)', marginTop: 3 }}>
            {t('Creato', 'Created')} {fmtWhen(order.created_at, lang)}
            {order.sent_method ? <React.Fragment> · {(ORDER_METHODS[order.sent_method] || ORDER_METHODS.email)[lang]}{contact ? ' · ' + contact : ''}</React.Fragment> : contact ? ' · ' + contact : ''}
          </div>
        </div>
        {/* send-method selector (draft only) */}
        {isDraft && !receiving && (
          <div style={{ display: 'flex', gap: 4, background: 'var(--surface-2)', borderRadius: 10, padding: 4, flexShrink: 0 }}>
            {Object.entries(ORDER_METHODS).map(([k, meta]) => {
              const on = method === k;
              return (
                <MutationButton key={k} onClick={() => canWrite && setMethod(k)} title={meta[lang]} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: 'none', background: on ? 'var(--surface)' : 'transparent', color: on ? 'var(--ink)' : 'var(--muted)', boxShadow: on ? 'var(--sh-card)' : 'none' }}>
                  <Icon name={meta.icon} size={15} color={on ? 'var(--clay-ink)' : 'var(--muted)'} />{meta[lang]}
                </MutationButton>
              );
            })}
          </div>
        )}
      </div>

      {receiving ? (
        /* ───── delivery receiving mode ───── */
        <React.Fragment>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 20px', background: 'var(--clay-tint)' }}>
            <Icon name="box" size={16} color="var(--clay-ink)" />
            <span style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--clay-ink)', flex: 1 }}>{t('Registra consegna · inserisci le quantità ricevute', 'Record delivery · enter received quantities')}</span>
            <MutationButton onClick={() => setRecvCsv(recvCsv == null ? '' : null)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 8, border: '1px solid var(--clay)', background: 'var(--surface)', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, color: 'var(--clay-ink)' }}><Icon name="arrowUp" size={14} color="var(--clay-ink)" />{t('Importa CSV', 'Import CSV')}</MutationButton>
          </div>
          {recvCsv != null && (
            <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--hair)', background: 'var(--surface-2)' }}>
              <div className="t-sm" style={{ color: 'var(--muted)', marginBottom: 8 }}>{t('Una riga per prodotto: nome o SKU, quantità ricevuta — es. "Base coat, 10"', 'One row per product: name or SKU, received qty — e.g. "Base coat, 10"')}</div>
              <MutationTextarea value={recvCsv} onChange={(e) => setRecvCsv(e.target.value)} rows={4} placeholder={'Base coat, 10\nGEL-RD-001, 12'} style={{ ...inputCss, fontFamily: 'var(--mono, monospace)', fontSize: 13, resize: 'vertical' }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
                <button className="dk-btn dk-btn--ghost" style={{ height: 34 }} onClick={() => setRecvCsv(null)}>{t('Annulla', 'Cancel')}</button>
                <MutationButton className="dk-btn dk-btn--clay" style={{ height: 34 }} onClick={applyRecvCsv}><Icon name="check" size={15} color="#fff" />{t('Applica', 'Apply')}</MutationButton>
              </div>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '2.6fr 1fr 1.1fr 1.1fr', gap: 10, padding: '11px 20px', background: 'var(--surface-2)' }}>
            {[t('Prodotto', 'Product'), t('Ordinato', 'Ordered'), t('Ricevuto', 'Received'), t('Esito', 'Status')].map((h, i) => <div key={i} className="t-meta" style={{ textAlign: i === 1 || i === 2 ? 'right' : 'left' }}>{h}</div>)}
          </div>
          {lines.map((l) => {
            const rq = recv[l.id] != null ? recv[l.id] : 0;
            const diff = rq - num(l.qty_ordered);
            return (
              <div key={l.id} style={{ display: 'grid', gridTemplateColumns: '2.6fr 1fr 1.1fr 1.1fr', gap: 10, padding: '10px 20px', alignItems: 'center', borderTop: '1px solid var(--hair)' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.product_name}</div>
                  {l.sku && <div className="t-sm" style={{ color: 'var(--muted-2)' }}>{l.sku}</div>}
                </div>
                <div className="t-num" style={{ textAlign: 'right', fontSize: 13.5, color: 'var(--muted)' }}>{fmtQty(l.qty_ordered, lang)}</div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}><MutationNumInput integer min={0} value={rq} onChange={(v) => setRecvQty(l.id, v)} style={{ ...inputCss, width: 66, textAlign: 'right', fontWeight: 700, fontFamily: 'var(--mono, monospace)', borderColor: 'var(--clay)' }} /></div>
                <div>{diff === 0
                  ? <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ok)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="check" size={13} color="var(--ok)" stroke={2.4} />{t('Completo', 'Complete')}</span>
                  : <span style={{ fontSize: 11.5, fontWeight: 700, color: STOCK_META.low.color, background: STOCK_META.low.tint, padding: '2px 9px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="alert" size={12} color={STOCK_META.low.color} />{diff > 0 ? '+' : ''}{diff} {diff > 0 ? t('in più', 'over') : t('mancanti', 'short')}</span>}
                </div>
              </div>
            );
          })}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', borderTop: '1px solid var(--hair)', background: 'var(--surface-2)' }}>
            <span className="t-sm" style={{ color: 'var(--muted)', flex: 1 }}>{t('Totale ricevuto', 'Total received')}: <b style={{ color: 'var(--ink)' }}>{recvTotal}</b> {t('unità', 'units')} · {t('alla conferma il magazzino viene aggiornato', 'on confirm the stock is updated')}</span>
            <button className="dk-btn dk-btn--ghost" onClick={() => { setReceiving(false); setRecv({}); setRecvCsv(null); }} style={{ flexShrink: 0 }}>{t('Annulla', 'Cancel')}</button>
            <MutationButton className="dk-btn dk-btn--clay" onClick={confirmReceive} disabled={busy} style={{ flexShrink: 0 }}><Icon name="check" size={16} color="#fff" />{t('Conferma consegna', 'Confirm delivery')}</MutationButton>
          </div>
        </React.Fragment>
      ) : (
        <React.Fragment>
          {/* line table */}
          <div style={{ display: 'grid', gridTemplateColumns: isDone ? '2.4fr 0.95fr 0.95fr 0.95fr 1fr' : '2.4fr 0.8fr 0.95fr 0.9fr 0.6fr 0.95fr 34px', gap: 10, padding: '11px 20px', background: 'var(--surface-2)' }}>
            {(isDone
              ? [t('Prodotto', 'Product'), t('Ordinato', 'Ordered'), t('Ricevuto', 'Received'), t('Esito', 'Status'), t('Totale', 'Total')]
              : [t('Prodotto', 'Product'), t('Scorta', 'Stock'), t('Da ordinare', 'To order'), t('Prezzo un.', 'Unit price'), 'IVA', t('Totale', 'Total'), '']
            ).map((h, i) => <div key={i} className="t-meta" style={{ textAlign: isDone ? (i === 0 || i === 3 ? 'left' : 'right') : (i >= 1 && i <= 5 ? 'right' : 'left') }}>{h}</div>)}
          </div>

          {lines.map((l) => {
            const mth = orderLineMath(isDone ? num(l.qty_received) : l.qty, l.cost, l.vat);
            if (isDone) {
              const diff = num(l.qty_received) - num(l.qty_ordered);
              return (
                <div key={l.id} style={{ display: 'grid', gridTemplateColumns: '2.4fr 0.95fr 0.95fr 0.95fr 1fr', gap: 10, padding: '10px 20px', alignItems: 'center', borderTop: '1px solid var(--hair)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.product_name}</div>
                    {l.sku && <div className="t-sm" style={{ color: 'var(--muted-2)' }}>{l.sku}</div>}
                  </div>
                  <div className="t-num" style={{ textAlign: 'right', fontSize: 13, color: 'var(--muted)' }}>{fmtQty(l.qty_ordered, lang)}</div>
                  <div className="t-num" style={{ textAlign: 'right', fontSize: 13.5, fontWeight: 700 }}>{fmtQty(l.qty_received, lang)}</div>
                  <div>{diff === 0
                    ? <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ok)' }}>{t('Completo', 'Complete')}</span>
                    : <span style={{ fontSize: 11.5, fontWeight: 700, color: STOCK_META.low.color, background: STOCK_META.low.tint, padding: '2px 8px', borderRadius: 99 }}>{diff > 0 ? '+' : ''}{fmtQty(diff, lang)}</span>}</div>
                  <div className="t-num" style={{ textAlign: 'right', fontSize: 13 }}>{fmtEur(mth.total, lang)}</div>
                </div>
              );
            }
            return (
              <div key={l.id} style={{ display: 'grid', gridTemplateColumns: '2.4fr 0.8fr 0.95fr 0.9fr 0.6fr 0.95fr 34px', gap: 10, padding: '10px 20px', alignItems: 'center', borderTop: '1px solid var(--hair)' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.product_name}</div>
                  {l.sku && <div className="t-sm" style={{ color: 'var(--muted-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.sku}</div>}
                </div>
                <div className="t-num" style={{ textAlign: 'right', fontSize: 13, color: l.lowItem ? STOCK_META.low.color : 'var(--muted)', fontWeight: l.lowItem ? 700 : 500 }}>{l.stock != null ? `${fmtQty(l.stock, lang)}/${fmtQty(l.min, lang)}` : '—'}</div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <MutationNumInput integer min={0} value={l.qty} disabled={!isDraft || !canWrite}
                    onChange={(v) => setQtyDraft((d) => ({ ...d, [l.id]: v }))}
                    style={{ ...inputCss, width: 62, textAlign: 'right', fontWeight: 700, fontFamily: 'var(--mono, monospace)', borderColor: isDraft ? 'var(--clay)' : 'var(--hair)', background: isDraft && canWrite ? 'var(--surface)' : 'var(--surface-2)' }} />
                </div>
                <div className="t-num" style={{ textAlign: 'right', fontSize: 13 }}>{fmtEur(l.cost, lang)}</div>
                <div className="t-num" style={{ textAlign: 'right', fontSize: 13, color: 'var(--muted)' }}>{num(l.vat)}%</div>
                <div className="t-num" style={{ textAlign: 'right', fontSize: 13.5, fontWeight: 700 }}>{fmtEur(mth.total, lang)}</div>
                {isDraft && canWrite
                  ? <MutationButton className="dk-iconbtn" style={{ width: 30, height: 30, borderRadius: 8 }} onClick={() => removeLine(l)} title={t('Rimuovi', 'Remove')}><Icon name="x" size={14} color="var(--muted)" /></MutationButton>
                  : <span />}
              </div>
            );
          })}
          {!lines.length && <div className="t-sm" style={{ color: 'var(--muted-2)', padding: '16px 20px', borderTop: '1px solid var(--hair)' }}>{t('Nessuna riga · rigenera gli ordini per riproporre i prodotti sotto soglia.', 'No lines · regenerate orders to re-propose below-threshold products.')}</div>}

          {/* footer totals + actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '14px 20px', borderTop: '1px solid var(--hair)', background: 'var(--surface-2)', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 20, flex: 1, flexWrap: 'wrap' }}>
              <div><span className="t-meta">{t('Imponibile', 'Net')}</span><div className="t-num" style={{ fontSize: 15, marginTop: 2 }}>{fmtEur(grandNet, lang)}</div></div>
              <div><span className="t-meta">IVA</span><div className="t-num" style={{ fontSize: 15, marginTop: 2 }}>{fmtEur(grandVat, lang)}</div></div>
              <div><span className="t-meta">{t('Totale ordine', 'Order total')}</span><div className="t-num" style={{ fontSize: 19, marginTop: 2, fontWeight: 800 }}>{fmtEur(grandNet + grandVat, lang)}</div></div>
            </div>
            <button className="dk-btn dk-btn--ghost" onClick={onPdf} disabled={!lines.length} style={{ flexShrink: 0 }}><Icon name="arrowDn" size={16} />{t('Scarica PDF', 'Download PDF')}</button>
            {isDraft && canWrite && dirty && <MutationButton className="dk-btn dk-btn--ghost" onClick={onSaveLines} disabled={busy} style={{ flexShrink: 0 }}><Icon name="check" size={16} />{t('Salva quantità', 'Save quantities')}</MutationButton>}
            {isDraft && canWrite && (
              <MutationButton className="dk-btn dk-btn--clay" onClick={send} disabled={!lines.length || busy} style={{ flexShrink: 0 }}>
                <Icon name={(ORDER_METHODS[method] || ORDER_METHODS.email).icon} size={16} color="#fff" />{t('Conferma e invia', 'Confirm & send')} · {(ORDER_METHODS[method] || ORDER_METHODS.email)[lang]}
              </MutationButton>
            )}
            {isSent && canWrite && (
              <MutationButton className="dk-btn dk-btn--clay" onClick={startReceive} style={{ flexShrink: 0 }}><Icon name="box" size={16} color="#fff" />{t('Registra consegna', 'Receive delivery')}</MutationButton>
            )}
          </div>
        </React.Fragment>
      )}
    </div>
  );
}
