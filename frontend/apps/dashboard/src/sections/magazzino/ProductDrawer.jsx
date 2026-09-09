import { withPortalForm } from '@youty/shared';
import { MutationInput } from '@youty/shared';
import { MutationButton } from '@youty/shared';
// ProductDrawer.jsx — unified product card: create/edit form + movement log + quick load/unload.
// Ported from the prototype's ProductDrawer (which superseded ProdEditModal); mock state →
// POST/PUT /api/inventory/products, movements from GET /products/{id}/movements.
import React, { useEffect, useRef, useState } from 'react';
import { api, fmtEur, Icon } from '@youty/shared';
import { useDash } from '../../ctx.jsx';
import { DkModal } from '../../ui/index.js';
import { MOVE_META, STOCK_META, UNIT_OPTIONS, errMsg, eur0, fmtQty, fmtWhen, num, unitCost } from './lib.js';
import { Fld, MoneyBox, NumBox, Sec, inputCss } from './bits.jsx';

/* category colour: fallback + pastel presets offered in the picker */
const CAT_FALLBACK = '#E0E7FF';
const CAT_PRESETS = ['#FDE2E4', '#DBEAFE', '#DCFCE7', '#FEF3C7', '#FCE7F3', '#EDE9FE', '#E0E7FF', '#FEE2E2', '#E0F2FE', '#F1F5F9'];
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const HEX6_RE = /^#[0-9a-fA-F]{6}$/;

/* Compact colour control for the currently-selected category. Keeps a local
 * draft of the hex; commits to the parent via onCatColor only on blur / swatch
 * click / colour-picker close — never on every keystroke. Remount via `key`
 * (parent passes key={cat.id}) resets local state when the selection changes. */
function CatColorControl({ cat, onCatColor, t }) {
  const current = cat.color || CAT_FALLBACK;
  const [hex, setHex] = useState(current);
  const commit = (raw) => {
    let v = String(raw == null ? hex : raw).trim();
    if (v && v[0] !== '#') v = '#' + v;
    if (!HEX_RE.test(v)) { setHex(current); return; }
    setHex(v);
    if (v.toLowerCase() !== current.toLowerCase()) onCatColor(cat.id, v);
  };
  const swatch = HEX6_RE.test(hex) ? hex : (HEX6_RE.test(current) ? current : CAT_FALLBACK);
  return (
    <div style={{ marginTop: 12, padding: 12, border: '1px solid var(--hair)', borderRadius: 10, background: 'var(--surface-2)' }}>
      <div className="t-meta" style={{ marginBottom: 8 }}>{t('Colore di', 'Colour of')} «{cat.name}»</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <MutationInput type="color" value={swatch} onChange={(e) => commit(e.target.value)} title={t('Scegli colore', 'Pick colour')}
          style={{ width: 38, height: 38, padding: 0, border: '1px solid var(--hair)', borderRadius: 9, background: 'var(--surface)', cursor: 'pointer' }} />
        <MutationInput value={hex} onChange={(e) => setHex(e.target.value)} onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(e.target.value); } }}
          placeholder={CAT_FALLBACK} spellCheck={false} maxLength={7}
          style={{ width: 100, border: '1px solid var(--hair)', borderRadius: 9, outline: 'none', fontSize: 13.5, fontFamily: 'var(--mono, ui-monospace, monospace)', padding: '9px 10px', background: 'var(--surface)', textTransform: 'uppercase' }} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {CAT_PRESETS.map((p) => {
            const on = p.toLowerCase() === hex.toLowerCase();
            return (
              <MutationButton key={p} onClick={() => commit(p)} title={p}
                style={{ width: 22, height: 22, borderRadius: 99, cursor: 'pointer', background: p, border: '1px solid rgba(0,0,0,0.08)', boxShadow: on ? '0 0 0 2px var(--surface-2), 0 0 0 3px var(--ink)' : 'none' }} />
            );
          })}
        </div>
      </div>
      <div className="t-sm" style={{ color: 'var(--muted-2)', marginTop: 8 }}>{t('Vale per tutti i prodotti di questa categoria · usato anche altrove.', 'Applies to every product in this category · used elsewhere too.')}</div>
    </div>
  );
}

/* Searchable predictive supplier picker over the in-memory `suppliers` list.
 * Matches the platform's client search (dk-search input + results dropdown).
 * Filters client-side by name; click to select; selected shows a change/clear affordance. */
function SupplierPicker({ suppliers, value, onChange, canWrite, t }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const selected = suppliers.find((s) => s.id === value) || null;

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (selected) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 12, background: 'var(--surface-2)', opacity: canWrite ? 1 : 0.7 }}>
        <span style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--surface)', border: '1px solid var(--hair)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name="box" size={15} color="var(--muted)" /></span>
        <span style={{ flex: 1, fontWeight: 700, fontSize: 14, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.name}</span>
        {canWrite && <button className="dk-iconbtn" style={{ width: 30, height: 30 }} onClick={() => { onChange(null); setQuery(''); setOpen(true); }} title={t('Cambia fornitore', 'Change supplier')}><Icon name="x" size={15} /></button>}
      </div>
    );
  }

  const ql = query.trim().toLowerCase();
  const matches = ql ? suppliers.filter((s) => (s.name || '').toLowerCase().includes(ql)) : suppliers;

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <div className="dk-search" style={{ width: '100%', height: 42 }}>
        <Icon name="search" size={16} color="var(--muted-2)" />
        <input value={query} disabled={!canWrite} onChange={(e) => { setQuery(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
          placeholder={t('Cerca fornitore…', 'Search supplier…')} />
        <button onClick={() => canWrite && setOpen((v) => !v)} style={{ cursor: 'pointer', display: 'grid', placeItems: 'center' }}><Icon name="chevD" size={15} color="var(--muted-2)" /></button>
      </div>
      {open && canWrite && (
        <div className="dk-card scroll" style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 20, padding: 6, boxShadow: 'var(--sh-pop)', maxHeight: 220, overflowY: 'auto' }}>
          {matches.map((s) => (
            <button key={s.id} className="dk-row" onClick={() => { onChange(s.id); setOpen(false); setQuery(''); }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 10px', borderRadius: 9, textAlign: 'left', cursor: 'pointer' }}>
              <span style={{ flex: 1, fontWeight: 600, fontSize: 13.5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
            </button>
          ))}
          {!matches.length && <div className="t-sm" style={{ color: 'var(--muted-2)', padding: 12, textAlign: 'center' }}>{t('Nessun fornitore', 'No supplier found')}</div>}
        </div>
      )}
    </div>
  );
}

function ProductDrawer({ prod, cats, suppliers, canWrite, onClose, onSaved, onDeleted, onAdj, onCatColor }) {
  const { t, lang, fireToast } = useDash();
  const isNew = !!prod._new;
  const [draft, setDraft] = useState(() => (isNew ? {
    name: '', sku: '', brand: '', category_id: cats[0]?.id ?? null, usage: 'internal',
    package_unit: '', package_qty: 1, supplier_id: suppliers[0]?.id ?? null,
    purchase_price: 0, purchase_discount_pct: 0, sale_price: 0, vat_rate: 22,
    min_threshold: 3, reorder_qty: 0, active: true, initial_qty: 0,
  } : {
    name: prod.name, sku: prod.sku || '', brand: prod.brand || '', category_id: prod.category_id,
    usage: prod.usage, package_unit: prod.package_unit || '', package_qty: num(prod.package_qty) || 1,
    supplier_id: prod.supplier_id, purchase_price: num(prod.purchase_price),
    purchase_discount_pct: num(prod.purchase_discount_pct), sale_price: num(prod.sale_price),
    vat_rate: prod.vat_rate, min_threshold: num(prod.min_threshold), reorder_qty: num(prod.reorder_qty),
    active: prod.active,
  }));
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const [busy, setBusy] = useState(false);

  /* live stock comes from the API product (changes only via movements) */
  const qty = isNew ? draft.initial_qty : num(prod.stock_qty);
  const lowItem = !isNew && prod.stock_state === 'low';
  const dot = !isNew ? (STOCK_META[prod.stock_state] || STOCK_META.ok) : null;

  /* ---- movement log (existing products) ---- */
  const [moves, setMoves] = useState(null);
  useEffect(() => {
    if (isNew) return;
    let dead = false;
    api.get(`/api/inventory/products/${prod.id}/movements`, { params: { limit: 8 } })
      .then((r) => { if (!dead) setMoves(r.items || []); })
      .catch(() => { if (!dead) setMoves([]); });
    return () => { dead = true; };
  }, [isNew, prod.id, prod.stock_qty]);

  const canSave = canWrite && draft.name.trim() && draft.supplier_id != null && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    const payload = {
      name: draft.name.trim(), sku: draft.sku.trim(), brand: draft.brand.trim(),
      category_id: draft.category_id, usage: draft.usage,
      package_unit: draft.package_unit, package_qty: draft.package_qty || 1,
      supplier_id: draft.supplier_id,
      purchase_price: (draft.purchase_price || 0).toFixed(2),
      purchase_discount_pct: Math.round(draft.purchase_discount_pct || 0),
      sale_price: (draft.sale_price || 0).toFixed(2),
      vat_rate: draft.vat_rate,
      min_threshold: draft.min_threshold || 0, reorder_qty: draft.reorder_qty || 0,
      active: draft.active !== false,
    };
    try {
      if (isNew) {
        const created = await api.post('/api/inventory/products', payload);
        if (draft.initial_qty > 0) {
          await api.postForm(`/api/inventory/products/${created.id}/load`, {
            qty: draft.initial_qty, reason: t('Scorta iniziale', 'Initial stock'),
          });
        }
        fireToast({ msg: t('Prodotto creato', 'Product created'), icon: 'check' });
      } else {
        await api.put(`/api/inventory/products/${prod.id}`, payload);
        fireToast({ msg: t('Prodotto salvato', 'Product saved'), icon: 'check' });
      }
      onSaved();
      onClose();
    } catch (err) {
      fireToast({ msg: errMsg(err, t), icon: 'alert' });
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    if (!canWrite || busy) return;
    setBusy(true);
    try {
      await api.del(`/api/inventory/products/${prod.id}`);
      fireToast({ msg: t('Prodotto disattivato', 'Product deactivated'), icon: 'x' });
      onDeleted();
      onClose();
    } catch (err) {
      fireToast({ msg: errMsg(err, t), icon: 'alert' });
    } finally {
      setBusy(false);
    }
  };

  const curUnit = draft.package_unit || t('unità', 'units');
  const selCat = cats.find((c) => c.id === draft.category_id) || null;

  return (
    <DkModal open onClose={onClose} title={isNew ? t('Nuovo prodotto', 'New product') : t('Scheda prodotto', 'Product card')} width={580}
      foot={<React.Fragment>
        {!isNew && canWrite && <MutationButton className="dk-btn dk-btn--ghost" style={{ color: 'var(--danger)', borderColor: 'color-mix(in srgb, var(--danger) 40%, var(--hair))', marginRight: 'auto' }} onClick={del} disabled={busy}><Icon name="x" size={16} color="var(--danger)" />{t('Disattiva', 'Deactivate')}</MutationButton>}
        <button className="dk-btn dk-btn--ghost" onClick={onClose}>{t('Annulla', 'Cancel')}</button>
        {canWrite && <MutationButton className="dk-btn dk-btn--clay" disabled={!canSave} onClick={save}><Icon name="check" size={17} color="#fff" />{isNew ? t('Crea prodotto', 'Create product') : t('Salva modifiche', 'Save changes')}</MutationButton>}
      </React.Fragment>}>

      <input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder={t('Nome prodotto', 'Product name')} disabled={!canWrite}
        style={{ border: 'none', borderBottom: '2px solid var(--hair)', outline: 'none', fontSize: 21, fontWeight: 500, fontFamily: 'var(--serif)', padding: '4px 0', background: 'transparent', width: '100%', marginBottom: 8 }} />
      {!isNew && dot && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <span style={{ width: 9, height: 9, borderRadius: 99, background: dot.color }} />
          <span className="t-sm" style={{ fontWeight: 700, color: dot.color }}>{dot[lang]}</span>
          <span className="t-sm" style={{ color: 'var(--muted-2)' }}>· {fmtQty(prod.stock_qty, lang)} {curUnit} · min {fmtQty(prod.min_threshold, lang)}</span>
          {!prod.active && <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', background: 'var(--surface-2)', padding: '2px 8px', borderRadius: 99 }}>{t('Disattivato', 'Inactive')}</span>}
        </div>
      )}

      {/* ── Anagrafica ── */}
      <Sec title={t('Anagrafica', 'Identity')}>
        <Fld label={'SKU / ' + t('Codice', 'Code')}>
          <input value={draft.sku} onChange={(e) => set({ sku: e.target.value })} placeholder="es. GEL-RD-001" disabled={!canWrite} style={inputCss} />
        </Fld>
        <Fld label={t('Brand', 'Brand')}>
          <input value={draft.brand} onChange={(e) => set({ brand: e.target.value })} placeholder={t("es. OPI, L'Oréal Pro…", "e.g. OPI, L'Oréal Pro…")} disabled={!canWrite} style={inputCss} />
        </Fld>
        <Fld label={t('Categoria', 'Category')} hint={t('Il colore vale per tutti i prodotti di questa categoria ed è usato anche altrove. Le altre proprietà si gestiscono nelle Impostazioni.', 'The colour applies to every product in this category and is used elsewhere too. Other properties are managed in Settings.')}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center' }}>
            {cats.map((c) => {
              const on = draft.category_id === c.id;
              return (
                <button key={c.id} onClick={() => canWrite && set({ category_id: on ? null : c.id })} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 13px', borderRadius: 99, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: '1px solid ' + (on ? 'var(--ink)' : 'var(--hair)'), background: on ? 'var(--ink)' : 'var(--surface)', color: on ? '#fff' : 'var(--ink-2)' }}>
                  <span style={{ width: 9, height: 9, borderRadius: 99, background: c.color || CAT_FALLBACK, boxShadow: on ? '0 0 0 1.5px rgba(255,255,255,0.55)' : 'inset 0 0 0 1px rgba(0,0,0,0.08)', flexShrink: 0 }} />
                  {c.name}
                </button>
              );
            })}
            {!cats.length && <span className="t-sm" style={{ color: 'var(--muted-2)' }}>{t('Nessuna categoria', 'No categories')}</span>}
          </div>
          {canWrite && selCat && onCatColor && (
            <CatColorControl key={selCat.id} cat={selCat} onCatColor={onCatColor} t={t} />
          )}
        </Fld>
        <Fld label={t("Tipologia d'uso", 'Usage type')} last>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              ['internal', t('Solo uso interno', 'In-salon only'), t('Consumato nei trattamenti · non al punto cassa · scarico manuale', 'Used in treatments · not at checkout · manual decrement')],
              ['retail', t('Solo vendita al dettaglio', 'Retail only'), t('Venduto alle clienti · scarico automatico al punto cassa', 'Sold to clients · auto-decrement at POS')],
              ['mixed', t('Misto', 'Mixed'), t('Trattamenti + vendita · canali tracciati separatamente', 'Treatments + retail · channels tracked separately')],
            ].map(([v, l, d]) => {
              const on = draft.usage === v;
              return (
                <button key={v} onClick={() => canWrite && set({ usage: v })} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left', padding: '11px 13px', borderRadius: 10, cursor: 'pointer', border: '1px solid ' + (on ? 'var(--clay)' : 'var(--hair)'), background: on ? 'var(--clay-tint)' : 'var(--surface)' }}>
                  <span style={{ width: 18, height: 18, borderRadius: 99, border: '1.8px solid ' + (on ? 'var(--clay)' : 'var(--faint)'), background: on ? 'var(--clay)' : 'transparent', display: 'grid', placeItems: 'center', flexShrink: 0, marginTop: 1 }}>{on && <Icon name="check" size={11} color="#fff" stroke={2.6} />}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5, color: on ? 'var(--clay-ink)' : 'var(--ink)' }}>{l}</span>
                    <span className="t-sm" style={{ color: 'var(--muted)', marginTop: 2, display: 'block', lineHeight: 1.4 }}>{d}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </Fld>
      </Sec>

      {/* ── Confezione ── */}
      <Sec title={t('Confezione', 'Packaging')}>
        <Fld label={t('Unità di misura', 'Unit of measure')}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {UNIT_OPTIONS.map((u) => {
              const on = draft.package_unit === u;
              return (
                <button key={u} onClick={() => canWrite && set({ package_unit: on ? '' : u })} style={{ padding: '6px 13px', borderRadius: 99, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: '1px solid ' + (on ? 'var(--ink)' : 'var(--hair)'), background: on ? 'var(--ink)' : 'var(--surface)', color: on ? '#fff' : 'var(--ink-2)' }}>{u}</button>
              );
            })}
          </div>
        </Fld>
        <Fld label={t('Quantità per confezione', 'Quantity per package')} hint={t('Risulta: ', 'Shows as: ') + (draft.package_qty || 1) + ' ' + curUnit} last>
          <NumBox value={draft.package_qty} onChange={(v) => set({ package_qty: v })} suffix={curUnit} width={170} disabled={!canWrite} />
        </Fld>
      </Sec>

      {/* ── Fornitore ── */}
      <Sec title={<React.Fragment>{t('Fornitore', 'Supplier')} <span style={{ color: 'var(--clay)' }}>*</span></React.Fragment>}>
        <SupplierPicker suppliers={suppliers} value={draft.supplier_id} onChange={(id) => set({ supplier_id: id })} canWrite={canWrite} t={t} />
        {draft.supplier_id == null && <div className="t-sm" style={{ color: 'var(--muted-2)', marginTop: 6 }}>{t('Obbligatorio per la gestione degli ordini.', 'Required for order management.')}</div>}
      </Sec>

      {/* ── Prezzi e IVA ── */}
      <Sec title={t('Prezzi e IVA', 'Pricing & VAT')}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px' }}>
          <div>
            <div className="t-meta" style={{ marginBottom: 6 }}>{t('Prezzo di acquisto', 'Purchase price')}</div>
            <MoneyBox value={draft.purchase_price} onChange={(v) => set({ purchase_price: v })} disabled={!canWrite} />
            <div className="t-sm" style={{ color: 'var(--muted-2)', marginTop: 4 }}>{t('IVA esclusa', 'VAT excl.')}</div>
          </div>
          <div>
            <div className="t-meta" style={{ marginBottom: 6 }}>{t('Sconto', 'Discount')}</div>
            <MoneyBox value={draft.purchase_discount_pct} onChange={(v) => set({ purchase_discount_pct: v })} suffix="%" disabled={!canWrite} />
            <div className="t-sm" style={{ color: 'var(--muted-2)', marginTop: 4 }}>{t('Fornitore o promo', 'Supplier or promo')}</div>
          </div>
          <div>
            <div className="t-meta" style={{ marginBottom: 6 }}>{t('Prezzo di vendita', 'Retail price')}</div>
            <MoneyBox value={draft.sale_price} onChange={(v) => set({ sale_price: v })} disabled={!canWrite} />
            <div className="t-sm" style={{ color: 'var(--muted-2)', marginTop: 4 }}>{t('IVA inclusa', 'VAT incl.')}</div>
          </div>
          <div>
            <div className="t-meta" style={{ marginBottom: 6 }}>{t('Aliquota IVA', 'VAT rate')}</div>
            <select value={draft.vat_rate} onChange={(e) => set({ vat_rate: parseInt(e.target.value, 10) })} disabled={!canWrite} style={{ ...inputCss, cursor: 'pointer' }}>
              {[4, 10, 22].map((v) => <option key={v} value={v}>{v}%</option>)}
            </select>
          </div>
        </div>
        {(() => {
          const net = unitCost(draft);                                  /* purchase_price × (1 − discount%) */
          const buyIncl = net * (1 + num(draft.vat_rate) / 100);        /* net cost + IVA */
          const sale = num(draft.sale_price);                           /* IVA inclusa */
          const margin = sale - net;                                    /* vendita − costo netto */
          const marginPct = sale > 0 ? (margin / sale) * 100 : null;    /* guard divide-by-zero */
          const marginColor = margin > 0 ? 'var(--ok)' : (margin < 0 ? 'var(--danger)' : 'var(--ink)');
          return (
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', background: 'var(--surface-2)', borderRadius: 10 }}>
                <span className="t-sm" style={{ color: 'var(--muted)', fontWeight: 600 }}>{t('Prezzo di acquisto IVA inclusa', 'Purchase price incl. VAT')}</span>
                <span className="t-num" style={{ fontSize: 17 }}>{eur0(buyIncl, lang, fmtEur)}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', background: 'var(--surface-2)', borderRadius: 10 }}>
                <span className="t-sm" style={{ color: 'var(--muted)', fontWeight: 600 }}>{t('Margine', 'Margin')} <span style={{ color: 'var(--muted-2)', fontWeight: 500 }}>· {t('vendita − costo netto', 'sale − net cost')}</span></span>
                <span className="t-num" style={{ fontSize: 17, color: marginColor }}>{eur0(margin, lang, fmtEur)}{marginPct != null ? ' · ' + marginPct.toFixed(0) + '%' : ''}</span>
              </div>
            </div>
          );
        })()}
      </Sec>

      {/* ── Scorte ── */}
      <Sec title={t('Scorte', 'Stock')}>
        {isNew ? (
          <Fld label={t('Scorta iniziale', 'Initial stock')} hint={t('Dopo la creazione cambia solo con Scarico / Carico / Rettifica.', 'After creation it changes only via Issue / Restock / Adjust.')}>
            <NumBox value={draft.initial_qty} onChange={(v) => set({ initial_qty: v })} suffix={curUnit} width={170} disabled={!canWrite} />
          </Fld>
        ) : (
          <Fld label={t('Giacenza attuale', 'Current stock')} hint={t('Ogni movimento richiede una causale e finisce nel registro.', 'Every movement needs a reason and is logged.')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button className="dk-iconbtn" disabled={!canWrite} style={{ width: 36, height: 36, borderRadius: 9, fontSize: 22, fontWeight: 600, border: '1px solid var(--hair)', opacity: canWrite ? 1 : 0.4 }} onClick={() => onAdj(prod, 'scarico')} title={t('Scarico', 'Issue')}>−</button>
              <span className="t-num" style={{ fontSize: 18, minWidth: 30, textAlign: 'center', color: lowItem ? STOCK_META.low.color : 'var(--ink)' }}>{fmtQty(qty, lang)}</span>
              <button className="dk-iconbtn" disabled={!canWrite} style={{ width: 36, height: 36, borderRadius: 9, fontSize: 22, fontWeight: 600, border: 'none', background: 'var(--clay)', color: '#fff', opacity: canWrite ? 1 : 0.4 }} onClick={() => onAdj(prod, 'carico')} title={t('Carico rapido', 'Quick restock')}>+</button>
            </div>
          </Fld>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px', marginBottom: 14 }}>
          <div>
            <div className="t-meta" style={{ marginBottom: 6 }}>{t('Soglia minima', 'Minimum threshold')}</div>
            <NumBox value={draft.min_threshold} onChange={(v) => set({ min_threshold: v })} suffix={curUnit} width="100%" disabled={!canWrite} />
            <div className="t-sm" style={{ color: 'var(--muted-2)', marginTop: 4 }}>{t('Avviso sottoscorta', 'Low-stock alert')}</div>
          </div>
          <div>
            <div className="t-meta" style={{ marginBottom: 6 }}>{t('Quantità di riordino', 'Reorder quantity')}</div>
            <NumBox value={draft.reorder_qty} onChange={(v) => set({ reorder_qty: v })} suffix={curUnit} width="100%" disabled={!canWrite} />
            <div className="t-sm" style={{ color: 'var(--muted-2)', marginTop: 4 }}>{t('Proposta nelle bozze d’ordine', 'Suggested in order drafts')}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 15px', background: 'var(--surface-2)', borderRadius: 10 }}>
          <span className="t-sm" style={{ color: 'var(--muted)', fontWeight: 600 }}>{t('Valore totale a magazzino', 'Total stock value')}</span>
          <span className="t-num" style={{ fontSize: 20 }}>{eur0(qty * unitCost(draft), lang, fmtEur)}</span>
        </div>
      </Sec>

      {/* ── Registro movimenti (existing only) ── */}
      {!isNew && (
        <Sec title={<React.Fragment>{t('Registro movimenti', 'Movement log')} <span className="t-sm" style={{ color: 'var(--muted-2)', fontWeight: 500 }}>· {t('automatico', 'automatic')}</span></React.Fragment>} last>
          {moves === null ? (
            <div className="skel" style={{ height: 90, borderRadius: 10 }} />
          ) : moves.length === 0 ? (
            <div className="t-sm" style={{ color: 'var(--muted-2)' }}>{t('Nessun movimento registrato per questo prodotto.', 'No movements recorded for this product.')}</div>
          ) : (
            <div style={{ border: '1px solid var(--hair)', borderRadius: 10, overflow: 'hidden' }}>
              {moves.map((m, i) => {
                const meta = MOVE_META[m.kind] || MOVE_META.adjustment;
                const d = num(m.qty);
                return (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 14px', borderTop: i ? '1px solid var(--hair)' : 'none' }}>
                    <div style={{ width: 30, height: 30, borderRadius: 9, background: meta.tint, display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name={meta.icon} size={14} color={meta.color} /></div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="t-sm" style={{ fontWeight: 700 }}>{meta[lang]}{m.reason ? ' · ' + m.reason : ''}</div>
                      <div className="t-sm" style={{ color: 'var(--muted-2)' }}>{fmtWhen(m.created_at, lang)}{m.author_name ? ' · ' + m.author_name : ''}</div>
                    </div>
                    <span style={{ fontWeight: 700, fontSize: 14, color: d > 0 ? 'var(--ok)' : 'var(--ink-2)', flexShrink: 0 }}>{d > 0 ? '+' : ''}{fmtQty(d, lang)} {curUnit}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Sec>
      )}
    </DkModal>
  );
}

export default withPortalForm(ProductDrawer, { preview: ({ prod }) => !!prod?.id });
