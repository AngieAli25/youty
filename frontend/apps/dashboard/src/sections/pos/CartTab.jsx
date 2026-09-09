import { MutationNumInput } from '@youty/shared';
import { MutationSelect } from '@youty/shared';
import { MutationInput } from '@youty/shared';
import { MutationButton } from '@youty/shared';
// CartTab — "Prodotti": quick counter sale (walk-in POS), not tied to an appointment.
// Products from GET /api/inventory/products (retail = sale_price), submit → POST /api/sales/pos.
import React, { useEffect, useMemo, useState } from 'react';
import { api, ApiError, Avatar, Icon, NumInput } from '@youty/shared';
import { useDash } from '../../ctx.jsx';
import ClientPicker from './ClientPicker.jsx';
import PaymentsPanel from './PaymentsPanel.jsx';
import DkModal from '../../ui/DkModal.jsx';
import {
  emptyPayments, lineAmount, methodLabel, money, opName, paymentsError, resolvePayments, round2,
} from './lib.js';

const stockMeta = (state, t) => {
  if (state === 'low') return { label: t('Scorta bassa', 'Low stock'), color: 'var(--danger)', tint: 'var(--danger-tint)' };
  if (state === 'warning') return { label: t('In esaurimento', 'Running low'), color: 'var(--warn)', tint: 'var(--warn-tint)' };
  return { label: t('Disponibile', 'In stock'), color: 'var(--muted)', tint: 'var(--paper-2)' };
};

export default function CartTab({ onGoHistory }) {
  const { t, lang, operators, opColors, fireToast, hasScope } = useDash();
  const canSell = hasScope('sales');

  /* ---- products ---- */
  const [products, setProducts] = useState(null); // null = loading
  const [q, setQ] = useState('');
  useEffect(() => {
    let dead = false;
    api.get('/api/inventory/products', { params: { limit: 100 } })
      .then((r) => { if (!dead) setProducts((r.items || []).filter((p) => Number(p.sale_price) > 0)); })
      .catch((err) => {
        if (dead) return;
        setProducts([]);
        fireToast({ msg: err instanceof ApiError ? err.message : t('Errore di rete', 'Network error'), icon: 'alert' });
      });
    return () => { dead = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- cart ---- */
  // line: { key, line_type:'product'|'gift_card', product_id, name, unit_price, qty, is_gift, disc, stock, value, recipient_name }
  const [cart, setCart] = useState([]);
  const [globalDisc, setGlobalDisc] = useState(0);
  const [clientSel, setClientSel] = useState(null);
  const [sellerId, setSellerId] = useState(() => operators[0]?.id ?? null);
  const [pay, setPay] = useState(emptyPayments());
  const [giftAmt, setGiftAmt] = useState('50');
  const [giftName, setGiftName] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null); // SaleDetailOut after a successful sale
  const [confirmOpen, setConfirmOpen] = useState(false); // conferma prima di finalizzare

  // ricerca per nome oppure SKU/codice a barre (lo scanner digita il codice) — filtro live
  const prodList = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return products || [];
    return (products || []).filter(
      (p) => p.name.toLowerCase().includes(needle) || (p.sku || '').toLowerCase().includes(needle),
    );
  }, [products, q]);

  const addProduct = (p) => {
    setCart((c) => {
      const existing = c.find((l) => l.line_type === 'product' && l.product_id === p.id);
      const stock = p.stock_qty != null ? Number(p.stock_qty) : null;
      if (existing) {
        if (stock != null && existing.qty >= stock) {
          fireToast({ msg: t('Giacenza insufficiente', 'Not enough stock'), icon: 'alert' });
          return c;
        }
        return c.map((l) => (l === existing ? { ...l, qty: l.qty + 1 } : l));
      }
      if (stock != null && stock < 1) {
        fireToast({ msg: t('Giacenza insufficiente', 'Not enough stock'), icon: 'alert' });
        return c;
      }
      return [...c, {
        key: 'p' + p.id + '_' + Date.now(), line_type: 'product', product_id: p.id,
        name: p.name, unit_price: Number(p.sale_price), qty: 1, is_gift: false, disc: 0, stock,
      }];
    });
  };
  const addGiftCard = () => {
    const v = round2(giftAmt);
    if (!(v > 0)) return;
    setCart((c) => [...c, {
      key: 'g' + Date.now(), line_type: 'gift_card', name: 'Gift card · €' + v,
      value: v, recipient_name: giftName.trim(), qty: 1, is_gift: false, disc: 0,
    }]);
    setGiftName('');
  };
  const patchLine = (key, patch) => setCart((c) => c.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const stepQty = (l, d) => {
    const next = l.qty + d;
    if (next < 1) return;
    if (d > 0 && l.stock != null && next > l.stock) {
      fireToast({ msg: t('Giacenza insufficiente', 'Not enough stock'), icon: 'alert' });
      return;
    }
    patchLine(l.key, { qty: next });
  };
  const removeLine = (key) => setCart((c) => c.filter((l) => l.key !== key));

  /* ---- totals (global discount maps to per-line discount_pct for lines without their own) ---- */
  const effDisc = (l) => (l.line_type !== 'product' || l.is_gift ? 0 : (l.disc > 0 ? l.disc : globalDisc || 0));
  const asApiLine = (l) => (l.line_type === 'gift_card'
    ? { line_type: 'gift_card', value: Number(l.value).toFixed(2), ...(l.recipient_name ? { recipient_name: l.recipient_name } : {}) }
    : { line_type: 'product', product_id: l.product_id, qty: l.qty, unit_price: Number(l.unit_price).toFixed(2), discount_pct: effDisc(l), is_gift: !!l.is_gift });
  const lineVal = (l) => lineAmount({ ...l, discount_pct: effDisc(l) });
  const subtotal = round2(cart.reduce((s, l) => s + lineAmount({ ...l, discount_pct: 0 }), 0));
  const total = round2(cart.reduce((s, l) => s + lineVal(l), 0));
  const discAmt = round2(subtotal - total);
  const itemCount = cart.reduce((s, l) => s + (l.qty || 1), 0);
  const payErr = paymentsError(pay, total, t);
  const seller = operators.find((o) => o.id === Number(sellerId)) || null;

  /* ---- submit ---- */
  const complete = async () => {
    if (saving || !cart.length) return;
    if (payErr) { fireToast({ msg: payErr, icon: 'alert' }); return; }
    setSaving(true);
    try {
      const sale = await api.post('/api/sales/pos', {
        client_id: clientSel ? clientSel.id : null,
        blocks: [{ operator_id: seller ? seller.id : null, lines: cart.map(asApiLine) }],
        payments: resolvePayments(pay, total),
      });
      setDone(sale);
      fireToast({ msg: t(`Vendita registrata · ${money(sale.total, lang)}`, `Sale recorded · ${money(sale.total, lang)}`), icon: 'check' });
    } catch (err) {
      setConfirmOpen(false);
      fireToast({ msg: err instanceof ApiError ? err.message : t('Errore di rete', 'Network error'), icon: 'alert' });
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setCart([]); setClientSel(null); setGlobalDisc(0); setQ('');
    setPay(emptyPayments()); setGiftAmt('50'); setGiftName(''); setDone(null); setConfirmOpen(false);
  };

  /* ---- completion screen ---- */
  if (done) {
    const hasGift = done.lines.some((l) => l.line_type === 'gift_card');
    const methodsUsed = done.payments.map((p) => methodLabel(p.method, t)).join(' + ');
    return (
      <div className="dk-card pop-in" style={{ padding: '44px 36px', textAlign: 'center', maxWidth: 540, margin: '0 auto' }}>
        <div style={{ width: 68, height: 68, borderRadius: 99, background: 'var(--ok-tint)', display: 'grid', placeItems: 'center', margin: '0 auto 18px' }}>
          <Icon name="check" size={34} color="var(--ok)" stroke={2.4} />
        </div>
        <div style={{ fontFamily: 'var(--serif)', fontSize: 26, fontWeight: 500 }}>{t('Vendita completata', 'Sale complete')}</div>
        <div className="t-sm" style={{ color: 'var(--muted)', marginTop: 6 }}>
          {done.lines.reduce((s, l) => s + (l.qty || 1), 0)} {t('articoli', 'items')} · {money(done.total, lang)} · {methodsUsed}
        </div>
        <div className="t-sm" style={{ color: 'var(--muted)', marginTop: 2 }}>
          {seller ? t('Accreditata a', 'Credited to') + ' ' + opName(seller) : ''}
          {done.client_name ? (seller ? ' · ' : '') + done.client_name : (seller ? ' · ' : '') + t('Da banco', 'Walk-in')}
        </div>
        {hasGift && (
          <div className="t-sm" style={{ color: 'var(--ok)', marginTop: 10, fontWeight: 600 }}>
            <Icon name="gift" size={15} color="var(--ok)" style={{ verticalAlign: '-2px', marginRight: 5 }} />
            {t('Gift card emessa', 'Gift card issued')}{done.lines.filter((l) => l.line_type === 'gift_card').map((l) => l.gift_card_code).filter(Boolean).map((c) => ' · ' + c).join('')}
          </div>
        )}
        <button className="dk-btn dk-btn--clay" style={{ marginTop: 24, width: '100%', height: 48 }} onClick={reset}>
          <Icon name="plus" size={18} color="#fff" />{t('Nuova vendita', 'New sale')}
        </button>
        <button className="dk-btn dk-btn--ghost" style={{ marginTop: 10, width: '100%', height: 44 }} onClick={onGoHistory}>
          <Icon name="clock" size={16} />{t('Vedi storico vendite', 'View sales history')}
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 380px', gap: 22, alignItems: 'start' }}>
      {/* LEFT — catalogue */}
      <div>
        <div className="t-sm" style={{ color: 'var(--muted)', marginBottom: 16 }}>
          {t('Vendita rapida da banco, senza appuntamento. Aggiungi prodotti, poi incassa.', 'Quick counter sale, no appointment. Add products, then take payment.')}
        </div>
        <div className="dk-search" style={{ width: '100%', marginBottom: 16 }}>
          <Icon name="search" size={18} color="var(--muted-2)" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Cerca per nome o codice a barre…', 'Search by name or barcode…')} />
          {q && <button onClick={() => setQ('')} style={{ cursor: 'pointer', display: 'grid', placeItems: 'center' }}><Icon name="x" size={15} color="var(--muted-2)" /></button>}
        </div>

        {products === null ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            {[...Array(6)].map((_, i) => <div key={i} className="skel" style={{ height: 128, borderRadius: 16 }} />)}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            {prodList.map((p) => {
              const inCart = cart.find((l) => l.line_type === 'product' && l.product_id === p.id);
              const sm = stockMeta(p.stock_state, t);
              return (
                <MutationButton key={p.id} onClick={() => addProduct(p)} className="dk-card"
                  style={{ padding: 16, textAlign: 'left', cursor: 'pointer', border: '1px solid ' + (inCart ? 'var(--clay)' : 'var(--hair)'), position: 'relative', transition: 'border-color 140ms' }}>
                  {inCart && <span style={{ position: 'absolute', top: 10, right: 10, minWidth: 22, height: 22, padding: '0 6px', borderRadius: 99, background: 'var(--clay)', color: '#fff', fontSize: 12, fontWeight: 700, display: 'grid', placeItems: 'center' }}>{inCart.qty}</span>}
                  <div style={{ width: 40, height: 40, borderRadius: 11, background: 'var(--clay-tint)', display: 'grid', placeItems: 'center', marginBottom: 12 }}>
                    <Icon name="box" size={20} color="var(--clay-ink)" />
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.25 }}>{p.name}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 7 }}>
                    <span className="t-num" style={{ fontSize: 16, fontWeight: 700 }}>{money(p.sale_price, lang)}</span>
                    <span title={sm.label} style={{ fontSize: 11, fontWeight: 700, color: sm.color, background: sm.tint, padding: '2px 8px', borderRadius: 99, marginLeft: 'auto' }}>
                      {Number(p.stock_qty)} {t('pz', 'pcs')}
                    </span>
                  </div>
                </MutationButton>
              );
            })}
            {!prodList.length && <div className="t-sm" style={{ color: 'var(--muted-2)', gridColumn: '1 / -1', textAlign: 'center', padding: 32 }}>{t('Nessun prodotto trovato', 'No products found')}</div>}
          </div>
        )}

        {/* gift-card line builder */}
        <div className="dk-card" style={{ marginTop: 16, padding: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ width: 40, height: 40, borderRadius: 11, background: 'var(--ok-tint)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon name="gift" size={20} color="var(--ok)" />
          </div>
          <div style={{ flex: 1, minWidth: 130 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{t('Gift card', 'Gift card')}</div>
            <div className="t-sm" style={{ color: 'var(--muted)' }}>{t('Emetti una carta prepagata', 'Issue a prepaid card')}</div>
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, border: '1px solid var(--hair)', borderRadius: 10, padding: '8px 10px', background: 'var(--surface)', width: 86, boxSizing: 'border-box' }}>
            <span style={{ color: 'var(--muted-2)', fontWeight: 700 }}>€</span>
            <MutationNumInput min={1} value={giftAmt} onChange={setGiftAmt}
              style={{ border: 'none', outline: 'none', background: 'transparent', fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: 14, width: '100%' }} />
          </div>
          <MutationInput value={giftName} onChange={(e) => setGiftName(e.target.value)} placeholder={t('Destinatario (facolt.)', 'Recipient (optional)')}
            style={{ border: '1px solid var(--hair)', borderRadius: 10, outline: 'none', fontSize: 13, fontWeight: 600, padding: '9px 12px', fontFamily: 'var(--sans)', background: 'var(--surface)', width: 160 }} />
          <MutationButton className="dk-btn dk-btn--ghost" style={{ height: 38 }} disabled={!(round2(giftAmt) > 0)} onClick={addGiftCard}>
            <Icon name="plus" size={15} />{t('Aggiungi', 'Add')}
          </MutationButton>
        </div>
      </div>

      {/* RIGHT — cart / checkout */}
      <div className="dk-card" style={{ position: 'sticky', top: 0, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - var(--top-h) - 68px)', overflow: 'hidden' }}>
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--hair)', display: 'flex', alignItems: 'center', gap: 9 }}>
          <Icon name="wallet" size={19} color="var(--clay-ink)" />
          <div style={{ fontFamily: 'var(--serif)', fontSize: 18, fontWeight: 500, flex: 1 }}>{t('Carrello', 'Cart')}</div>
          {itemCount > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--clay-ink)', background: 'var(--clay-tint)', padding: '3px 10px', borderRadius: 99 }}>{itemCount} {t('art.', 'items')}</span>}
        </div>

        {/* riepilogo totale — in alto */}
        <div style={{ flexShrink: 0, padding: '12px 20px', borderBottom: '1px solid var(--hair)', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          {discAmt > 0 ? (
            <div>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{t('Totale', 'Total')}</span>
              <div className="t-sm" style={{ color: 'var(--clay-ink)', fontWeight: 600 }}>{t('Sconto', 'Discount')} · −{money(discAmt, lang)}</div>
            </div>
          ) : <span style={{ fontWeight: 700, fontSize: 15 }}>{t('Totale', 'Total')}</span>}
          <span className="t-num" style={{ fontSize: 24, fontWeight: 800 }}>{money(total, lang)}</span>
        </div>

        <div className="scroll" style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
          {/* client (optional) */}
          <div className="t-meta" style={{ marginBottom: 7 }}>{t('Cliente (facoltativo)', 'Client (optional)')}</div>
          <div style={{ marginBottom: 16 }}>
            <ClientPicker value={clientSel} onChange={setClientSel} t={t} />
          </div>

          {/* line items */}
          {cart.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '36px 12px', color: 'var(--muted-2)' }}>
              <Icon name="box" size={30} color="var(--faint)" />
              <div className="t-sm" style={{ marginTop: 10 }}>{t('Il carrello è vuoto', 'The cart is empty')}</div>
              <div className="t-sm" style={{ marginTop: 2 }}>{t('Aggiungi prodotti dal catalogo', 'Add products from the catalogue')}</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {cart.map((l) => {
                const val = lineVal(l);
                const d = effDisc(l);
                return (
                  <div key={l.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 12, background: 'var(--surface-2)', border: l.is_gift ? '1px solid var(--ok)' : '1px solid transparent' }}>
                    <div style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--surface)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                      <Icon name={l.line_type === 'gift_card' ? 'gift' : 'box'} size={16} color={l.is_gift ? 'var(--ok)' : 'var(--clay-ink)'} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {l.name}{l.line_type === 'gift_card' && l.recipient_name ? ' · ' + l.recipient_name : ''}
                      </div>
                      <div className="t-sm" style={{ color: l.is_gift ? 'var(--ok)' : 'var(--muted)', fontWeight: l.is_gift ? 700 : 400 }}>
                        {l.is_gift ? t('Omaggio', 'Free gift') : money(val, lang)}
                        {!l.is_gift && d > 0 ? ` · −${d}%` : ''}
                        {!l.is_gift && l.qty > 1 ? ' × ' + l.qty : ''}
                      </div>
                    </div>
                    {l.line_type === 'product' && !l.is_gift && (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 1, border: '1px solid ' + (l.disc > 0 ? 'var(--clay)' : 'var(--hair)'), borderRadius: 7, padding: '2px 5px', background: 'var(--surface)', flexShrink: 0 }} title={t('Sconto riga', 'Line discount')}>
                        <MutationNumInput integer min={0} max={100} value={l.disc}
                          onChange={(disc) => patchLine(l.key, { disc })}
                          style={{ width: 24, textAlign: 'right', border: 'none', outline: 'none', background: 'transparent', fontSize: 12, fontWeight: 700, fontFamily: 'ui-monospace, monospace' }} />
                        <span style={{ color: 'var(--muted-2)', fontWeight: 700, fontSize: 11 }}>%</span>
                      </div>
                    )}
                    {l.line_type === 'product' && (
                      <MutationButton onClick={() => patchLine(l.key, { is_gift: !l.is_gift })} title={t('Ometti pagamento', 'Comp this item')} className="dk-iconbtn"
                        style={{ width: 26, height: 26, flexShrink: 0, background: l.is_gift ? 'var(--ok-tint)' : 'transparent', borderRadius: 7 }}>
                        <Icon name="gift" size={14} color={l.is_gift ? 'var(--ok)' : 'var(--muted-2)'} />
                      </MutationButton>
                    )}
                    {l.line_type === 'product' ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                        <MutationButton className="dk-iconbtn" style={{ width: 26, height: 26, fontSize: 16, fontWeight: 700, lineHeight: 1, color: 'var(--ink-2)' }}
                          onClick={() => (l.qty === 1 ? removeLine(l.key) : stepQty(l, -1))}>
                          {l.qty === 1 ? <Icon name="x" size={13} /> : '−'}
                        </MutationButton>
                        <span className="t-num" style={{ minWidth: 18, textAlign: 'center', fontWeight: 700, fontSize: 13.5 }}>{l.qty}</span>
                        <MutationButton className="dk-iconbtn" style={{ width: 26, height: 26 }} onClick={() => stepQty(l, 1)}><Icon name="plus" size={13} /></MutationButton>
                      </div>
                    ) : (
                      <MutationButton className="dk-iconbtn" style={{ width: 26, height: 26, flexShrink: 0 }} onClick={() => removeLine(l.key)}><Icon name="x" size={13} /></MutationButton>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* seller — credit for productivity */}
          <div className="t-meta" style={{ margin: '18px 0 8px' }}>{t('Operatrice · accredito vendita', 'Stylist · sale credit')}</div>
          <MutationSelect value={sellerId ?? ''} onChange={(e) => setSellerId(Number(e.target.value))}
            style={{ width: '100%', border: '1px solid var(--hair)', borderRadius: 10, outline: 'none', fontSize: 14, fontWeight: 600, padding: '10px 12px', fontFamily: 'var(--sans)', background: 'var(--surface)', cursor: 'pointer', color: 'var(--ink)' }}>
            {operators.map((o) => <option key={o.id} value={o.id}>{opName(o)}</option>)}
          </MutationSelect>
          {seller && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 8 }}>
              <Avatar initials={seller.initials} size={22} color={opColors[seller.id]} />
              <span className="t-sm" style={{ flex: 1, color: 'var(--muted)' }}>{t('Vendita accreditata a', 'Sale credited to')} {opName(seller)}</span>
            </div>
          )}

          {/* sale-level discount */}
          <div className="t-meta" style={{ margin: '18px 0 8px' }}>{t('Sconto sulla vendita', 'Sale discount')}</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {[0, 10, 15, 20].map((p) => {
              const on = globalDisc === p;
              return (
                <MutationButton key={p} onClick={() => setGlobalDisc(p)} style={{ flex: 1, padding: '9px 0', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid ' + (on ? 'var(--clay)' : 'var(--hair)'), background: on ? 'var(--clay-tint)' : 'var(--surface)', color: on ? 'var(--clay-ink)' : 'var(--ink-2)' }}>
                  {p === 0 ? t('No', 'No') : p + '%'}
                </MutationButton>
              );
            })}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, border: '1px solid ' + (globalDisc && ![10, 15, 20].includes(globalDisc) ? 'var(--clay)' : 'var(--hair)'), borderRadius: 9, padding: '0 9px', height: 36, background: 'var(--surface)' }}>
              <MutationNumInput integer min={0} max={100} value={globalDisc}
                onChange={setGlobalDisc}
                style={{ width: 34, textAlign: 'right', border: 'none', outline: 'none', background: 'transparent', fontSize: 13.5, fontWeight: 700, fontFamily: 'ui-monospace, monospace' }} />
              <span className="t-sm" style={{ color: 'var(--muted-2)', fontWeight: 700 }}>%</span>
            </div>
          </div>

          {/* metodo di pagamento — in basso */}
          <div style={{ margin: '18px 0 0' }}>
            <PaymentsPanel value={pay} onChange={setPay} due={total} t={t} lang={lang} compact />
          </div>
        </div>

        {/* footer — solo il pulsante (il totale è in alto) */}
        <div style={{ flexShrink: 0, padding: '14px 20px 16px', borderTop: '1px solid var(--hair)', background: 'var(--surface)' }}>
          <MutationButton className="dk-btn dk-btn--clay" style={{ width: '100%', height: 50, fontSize: 15, fontWeight: 700 }}
            disabled={!cart.length || saving || !canSell || !!payErr} onClick={() => setConfirmOpen(true)}
            title={!canSell ? t('Permesso "vendite" mancante', 'Missing "sales" permission') : (payErr || undefined)}>
            <Icon name="check" size={19} color="#fff" />{t('Completa vendita', 'Complete sale')} · {money(total, lang)}
          </MutationButton>
          <div className="t-sm" style={{ color: 'var(--muted-2)', marginTop: 9, textAlign: 'center' }}>
            {!canSell ? t('Serve il permesso "vendite" per incassare', 'The "sales" permission is required') : t('Registrazione non fiscale', 'Non-fiscal record')}
          </div>
        </div>
      </div>

      {/* conferma prima di finalizzare la vendita */}
      <DkModal open={confirmOpen} onClose={() => { if (!saving) setConfirmOpen(false); }}
        title={t('Conferma pagamento', 'Confirm payment')} width={440}
        foot={(
          <>
            <button className="dk-btn dk-btn--ghost" onClick={() => setConfirmOpen(false)} disabled={saving}>{t('Torna indietro', 'Go back')}</button>
            <MutationButton className="dk-btn dk-btn--clay" onClick={complete} disabled={saving}>
              <Icon name="check" size={16} color="#fff" />{saving ? t('Registrazione…', 'Recording…') : t('Conferma', 'Confirm')}
            </MutationButton>
          </>
        )}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
          {t('Sei sicura di voler completare il pagamento?', 'Are you sure you want to complete the payment?')}
        </div>
        <div className="t-sm" style={{ color: 'var(--muted)' }}>
          {itemCount} {t('articoli', 'items')} · {money(total, lang)}{seller ? ' · ' + opName(seller) : ''}
        </div>
      </DkModal>
    </div>
  );
}
