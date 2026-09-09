import { MutationButton } from '@youty/shared';
// ProdottiSub.jsx — paginated product table from GET /api/inventory/products.
// Filters (q, category_id, supplier_id, brand, usage, stock_state) are server-side;
// the server already sorts below-threshold products first.
import React, { useEffect, useMemo, useState } from 'react';
import { api, EmptyState, fmtEur, Icon } from '@youty/shared';
import { useDash } from '../../ctx.jsx';
import { GroupedFilterMenu } from '../../ui/index.js';
import { STOCK_META, USAGE_META, errMsg, eur0, fmtQty, num, unitCost } from './lib.js';
import { MiniMetric, Pager, SearchToolbar, SkelRows, useDebounced } from './bits.jsx';
import ProductDrawer from './ProductDrawer.jsx';
import AdjModal from './AdjModal.jsx';
import RestockModal from './RestockModal.jsx';
import ScaricoManualeModal from './ScaricoManualeModal.jsx';

const PAGE = 30;

export default function ProdottiSub({ cats, suppliers, allProds, canWrite, refreshShared }) {
  const { t, lang, fireToast } = useDash();

  /* ---- server-side filters ---- */
  const [q, setQ] = useState('');
  const qDeb = useDebounced(q, 300);
  const [catF, setCatF] = useState('all');
  const [supF, setSupF] = useState('all');
  const [brandF, setBrandF] = useState('all');
  const [usageF, setUsageF] = useState('all');
  const [stockF, setStockF] = useState('all');
  const [offset, setOffset] = useState(0);
  const resetPage = (setter) => (v) => { setter(v); setOffset(0); };

  /* ---- paginated list ---- */
  const [data, setData] = useState(null); // {items, count}
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const refresh = () => { setTick((n) => n + 1); refreshShared(); };

  useEffect(() => {
    let dead = false;
    setLoading(true);
    api.get('/api/inventory/products', {
      params: {
        q: qDeb || undefined,
        category_id: catF !== 'all' ? catF : undefined,
        supplier_id: supF !== 'all' ? supF : undefined,
        brand: brandF !== 'all' ? brandF : undefined,
        usage: usageF !== 'all' ? usageF : undefined,
        stock_state: stockF !== 'all' ? stockF : undefined,
        limit: PAGE, offset,
      },
    })
      .then((r) => { if (!dead) setData(r); })
      .catch((err) => { if (!dead) { setData({ items: [], count: 0 }); fireToast({ msg: errMsg(err, t), icon: 'alert' }); } })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [qDeb, catF, supF, brandF, usageF, stockF, offset, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- header metrics from the shared full snapshot ---- */
  const active = useMemo(() => (allProds || []).filter((p) => p.active), [allProds]);
  const totalValue = active.reduce((s, p) => s + num(p.stock_qty) * unitCost(p), 0);
  const lowCount = active.filter((p) => p.stock_state === 'low').length;
  const brands = useMemo(() => [...new Set(active.map((p) => p.brand).filter(Boolean))].sort(), [active]);

  const clearFilters = () => { setCatF('all'); setSupF('all'); setBrandF('all'); setUsageF('all'); setStockF('all'); setOffset(0); };

  const filterGroups = [
    { label: t('Categoria', 'Category'), value: catF, set: resetPage(setCatF), opts: [['all', t('Tutte', 'All')], ...cats.map((c) => [c.id, c.name])] },
    { label: t('Fornitore', 'Supplier'), value: supF, set: resetPage(setSupF), opts: [['all', t('Tutti', 'All')], ...suppliers.map((s) => [s.id, s.name])] },
    ...(brands.length ? [{ label: t('Brand', 'Brand'), value: brandF, set: resetPage(setBrandF), opts: [['all', t('Tutti', 'All')], ...brands.map((b) => [b, b])] }] : []),
    { label: t("Tipologia d'uso", 'Usage type'), value: usageF, set: resetPage(setUsageF), opts: [['all', t('Tutte', 'All')], ['internal', t('Solo uso interno', 'In-salon only')], ['retail', t('Solo vendita', 'Retail only')], ['mixed', t('Misto', 'Mixed')]] },
    { label: t('Stato scorte', 'Stock status'), value: stockF, set: resetPage(setStockF), opts: [['all', t('Tutti', 'All')], ['low', t('Sotto soglia', 'Below threshold')], ['warning', t('Vicino alla soglia', 'Near threshold')], ['ok', t('Nella norma', 'In stock')]] },
  ];

  /* ---- drawer / modals ---- */
  const [selProd, setSelProd] = useState(null);   // ProductOut | {_new:true}
  const [adj, setAdj] = useState(null);           // { prod, type }
  const [restock, setRestock] = useState(false);
  const [scaricoOpen, setScaricoOpen] = useState(false); // scarico manuale multi-prodotto

  /* #1 — colore della categoria configurabile dalla scheda prodotto (resta un attributo della categoria) */
  const setCatColor = async (catId, color) => {
    const c = (cats || []).find((x) => x.id === catId);
    if (!c) return;
    try {
      await api.put(`/api/inventory/categories/${catId}`, { name: c.name, order: c.order, color });
      refreshShared();
    } catch (err) { fireToast({ msg: errMsg(err, t), icon: 'alert' }); }
  };

  /* after a movement, refresh the open drawer's product from the API */
  const afterMovement = async () => {
    refresh();
    if (selProd && !selProd._new && adj && adj.prod.id === selProd.id) {
      try { setSelProd(await api.get(`/api/inventory/products/${selProd.id}`)); } catch { /* list refresh will catch up */ }
    }
  };

  const items = data?.items || [];

  return (
    <React.Fragment>
      {/* metrics */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 14 }}>
        <MiniMetric label={t('Valore magazzino', 'Stock value')} value={eur0(totalValue, lang, fmtEur)} />
        <MiniMetric label={t('Sottoscorta', 'Low stock')} value={lowCount} active={stockF === 'low'} onClick={() => { clearFilters(); setStockF('low'); }} />
        <MiniMetric label={t('Prodotti', 'Products')} value={active.length} onClick={clearFilters} />
      </div>

      {/* low-stock banner */}
      {lowCount > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 16px', background: 'var(--warn-tint)', borderRadius: 12, marginBottom: 16 }}>
          <Icon name="alert" size={18} color="var(--warn)" />
          <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-2)' }}>{lowCount} {t('prodotti sotto la scorta minima · ricordati di riordinare', 'products below minimum · remember to reorder')}</span>
        </div>
      )}

      <SearchToolbar q={q} setQ={resetPage(setQ)} placeholder={t('Cerca prodotto, brand o SKU…', 'Search product, brand or SKU…')}
        onAdd={canWrite ? () => setSelProd({ _new: true }) : undefined} addLabel={t('Nuovo prodotto', 'New product')}
        extra={<React.Fragment>
          <GroupedFilterMenu t={t} groups={filterGroups} />
          {canWrite && <MutationButton className="dk-btn dk-btn--ghost" onClick={() => setScaricoOpen(true)} style={{ flexShrink: 0 }}><Icon name="arrowDn" size={16} />{t('Scarico manuale', 'Manual issue')}</MutationButton>}
          {canWrite && <MutationButton className="dk-btn dk-btn--ghost" onClick={() => setRestock(true)} style={{ flexShrink: 0 }}><Icon name="box" size={16} />{t('Carico merce', 'Receive stock')}</MutationButton>}
        </React.Fragment>} />

      {/* table */}
      <div className="dk-card" style={{ overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '16px 2.1fr 0.85fr 1fr 0.8fr 118px 40px', gap: 12, padding: '13px 20px', borderBottom: '1px solid var(--hair)', background: 'var(--surface-2)' }}>
          {['', t('Prodotto', 'Product'), t('Uso', 'Usage'), t('Scorta', 'Stock'), t('Valore', 'Value'), t('Movimenta', 'Move'), ''].map((h, i) => <div key={i} className="t-meta">{h}</div>)}
        </div>

        {data === null && loading ? (
          <SkelRows n={6} />
        ) : (
          <React.Fragment>
            <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity 120ms' }}>
              {items.map((p) => {
                const st = STOCK_META[p.stock_state] || STOCK_META.ok;
                const lowItem = p.stock_state === 'low';
                const usage = USAGE_META[p.usage];
                const qtyN = num(p.stock_qty);
                const sub = [p.category_name, p.brand, p.sku].filter(Boolean).join(' · ') || p.supplier_name || '';
                return (
                  <div key={p.id} className="dk-row" onClick={() => setSelProd(p)} style={{ display: 'grid', gridTemplateColumns: '16px 2.1fr 0.85fr 1fr 0.8fr 118px 40px', gap: 12, padding: '12px 20px', alignItems: 'center', borderTop: '1px solid var(--hair)', cursor: 'pointer' }}>
                    <span title={st[lang]} style={{ width: 9, height: 9, borderRadius: 99, background: st.color }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                      <div className="t-sm" style={{ color: 'var(--muted-2)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>
                    </div>
                    <div>{usage
                      ? <span style={{ fontSize: 11, fontWeight: 700, color: usage.color, background: usage.tint, padding: '3px 8px', borderRadius: 99, whiteSpace: 'nowrap' }}>{usage[lang]}</span>
                      : <span className="t-sm" style={{ color: 'var(--muted-2)' }}>—</span>}</div>
                    <div style={{ whiteSpace: 'nowrap' }}>
                      <div style={{ fontSize: 13.5, fontWeight: lowItem ? 700 : 600, color: lowItem ? st.color : 'var(--ink)' }}>{fmtQty(qtyN, lang)} <span style={{ fontWeight: 400, color: lowItem ? st.color : 'var(--muted)' }}>{p.package_unit || 'u'}</span></div>
                      <div className="t-sm" style={{ color: 'var(--muted-2)' }}>min {fmtQty(p.min_threshold, lang)}</div>
                    </div>
                    <div className="t-num" style={{ fontSize: 14 }}>{eur0(qtyN * unitCost(p), lang, fmtEur)}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }} onClick={(e) => e.stopPropagation()}>
                      <MutationButton className="dk-iconbtn" disabled={!canWrite} style={{ width: 30, height: 30, borderRadius: 9, fontSize: 19, fontWeight: 600, border: '1px solid var(--hair)', opacity: canWrite ? 1 : 0.4 }} onClick={() => setAdj({ prod: p, type: 'scarico' })} title={t('Scarico', 'Issue')}>−</MutationButton>
                      <span className="t-num" style={{ fontSize: 14.5, minWidth: 24, textAlign: 'center' }}>{fmtQty(qtyN, lang)}</span>
                      <MutationButton className="dk-iconbtn" disabled={!canWrite} style={{ width: 30, height: 30, borderRadius: 9, fontSize: 19, fontWeight: 600, border: 'none', background: 'var(--clay)', color: '#fff', opacity: canWrite ? 1 : 0.4 }} onClick={() => setAdj({ prod: p, type: 'carico' })} title={t('Carico', 'Receive')}>+</MutationButton>
                    </div>
                    <MutationButton className="dk-iconbtn" style={{ width: 32, height: 32, borderRadius: 9 }} onClick={(e) => { e.stopPropagation(); setSelProd(p); }}><Icon name="edit" size={15} /></MutationButton>
                  </div>
                );
              })}
            </div>
            {!items.length && <div style={{ padding: '36px 22px' }}><EmptyState icon="search" title={t('Nessun prodotto', 'No products')} sub={t('Prova un altro filtro o termine di ricerca.', 'Try another filter or search term.')} /></div>}
            <Pager count={data?.count || 0} offset={offset} limit={PAGE} onPage={setOffset} t={t} />
          </React.Fragment>
        )}
      </div>

      {/* drawer + modals (rendered after the drawer so they stack on top) */}
      {selProd && (
        <ProductDrawer prod={selProd} cats={cats} suppliers={suppliers} canWrite={canWrite}
          onClose={() => setSelProd(null)} onSaved={refresh} onDeleted={refresh}
          onAdj={(p, type) => setAdj({ prod: p, type })} onCatColor={setCatColor} />
      )}
      {adj && <AdjModal prod={adj.prod} type={adj.type} onClose={() => setAdj(null)} onDone={afterMovement} />}
      {restock && <RestockModal allProds={allProds} suppliers={suppliers} onClose={() => setRestock(false)} onDone={refresh} />}
      {scaricoOpen && <ScaricoManualeModal products={allProds} onClose={() => setScaricoOpen(false)} onDone={refresh} />}
    </React.Fragment>
  );
}
