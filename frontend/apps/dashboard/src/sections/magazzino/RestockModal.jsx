import { withPortalForm } from '@youty/shared';
import { MutationButton } from '@youty/shared';
// RestockModal.jsx — batch "Carico merce": pick existing products and/or paste a CSV,
// then POST /api/inventory/load-csv (matches sku→name; creates missing products when a
// supplier is set). Shows the per-row results/errors returned by the API.
import React, { useMemo, useState } from 'react';
import { api, EmptyState, Icon } from '@youty/shared';
import { useDash } from '../../ctx.jsx';
import { DkModal } from '../../ui/index.js';
import { errMsg, fmtQty, num, parseRestockCsv } from './lib.js';
import { NumBox, inputCss } from './bits.jsx';

let keySeq = 0;
const nextKey = () => 'k' + (keySeq++) + '_' + Date.now();

function RestockModal({ allProds, suppliers, onClose, onDone }) {
  const { t, lang, fireToast } = useDash();
  const [lines, setLines] = useState([]);       // {key, product?, name, sku, qty, isNew}
  const [pickQ, setPickQ] = useState('');
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [supplierId, setSupplierId] = useState(''); // for products created from the CSV
  const [results, setResults] = useState(null);     // LoadCsvOut after apply
  const [busy, setBusy] = useState(false);

  const activeProds = useMemo(() => (allProds || []).filter((p) => p.active), [allProds]);
  const available = activeProds.filter((p) =>
    !lines.some((l) => l.product && l.product.id === p.id) &&
    (!pickQ || p.name.toLowerCase().includes(pickQ.toLowerCase()) || (p.sku || '').toLowerCase().includes(pickQ.toLowerCase())));

  const addExisting = (p) => {
    setLines((ls) => [...ls, { key: nextKey(), product: p, name: p.name, sku: p.sku || '', qty: 1, isNew: false }]);
    setPickQ('');
  };
  const setLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const rmLine = (key) => setLines((ls) => ls.filter((l) => l.key !== key));

  const importCsv = () => {
    const rows = parseRestockCsv(csvText);
    if (!rows.length) {
      fireToast({ msg: t('Nessuna riga valida nel testo incollato', 'No valid rows in the pasted text'), icon: 'alert' });
      return;
    }
    const parsed = rows.map((r) => {
      const key = r.key.toLowerCase();
      const match = activeProds.find((p) => (p.sku || '').toLowerCase() === key) ||
        activeProds.find((p) => p.name.toLowerCase() === key);
      return match
        ? { key: nextKey(), product: match, name: match.name, sku: match.sku || '', qty: r.qty, isNew: false }
        : { key: nextKey(), product: null, name: r.key, sku: '', qty: r.qty, isNew: true };
    });
    setLines((ls) => [...ls, ...parsed]);
    setCsvText('');
    setCsvOpen(false);
    fireToast({ msg: t(`${parsed.length} righe importate`, `${parsed.length} rows imported`), icon: 'check' });
  };

  const totalUnits = lines.reduce((s, l) => s + (parseInt(l.qty, 10) || 0), 0);
  const validLines = lines.filter((l) => (parseInt(l.qty, 10) || 0) > 0 && (l.name || '').trim());
  const hasNew = validLines.some((l) => l.isNew);
  const canApply = validLines.length > 0 && !busy && !(hasNew && !supplierId);

  const apply = async () => {
    if (!canApply) return;
    setBusy(true);
    try {
      const body = {
        rows: validLines.map((l) => ({ name: l.sku ? '' : l.name.trim(), sku: l.sku, qty: parseInt(l.qty, 10) || 0 })),
        supplier_id: supplierId ? Number(supplierId) : null,
      };
      const res = await api.post('/api/inventory/load-csv', body);
      setResults(res);
      const itMsg = `Carico registrato · ${res.loaded} righe` +
        (res.created ? ` · ${res.created} ${res.created === 1 ? 'nuovo prodotto' : 'nuovi prodotti'}` : '') +
        (res.errors ? ` · ${res.errors} errori` : '');
      const enMsg = `Stock received · ${res.loaded} rows` +
        (res.created ? ` · ${res.created} new ${res.created === 1 ? 'product' : 'products'}` : '') +
        (res.errors ? ` · ${res.errors} errors` : '');
      fireToast({ msg: t(itMsg, enMsg), icon: res.errors ? 'alert' : 'check' });
      onDone();
    } catch (err) {
      fireToast({ msg: errMsg(err, t), icon: 'alert' });
    } finally {
      setBusy(false);
    }
  };

  const RESULT_META = {
    loaded:  { it: 'Caricato', en: 'Loaded',  color: 'var(--ok)',     tint: 'var(--ok-tint)' },
    created: { it: 'Creato',   en: 'Created', color: 'var(--clay-ink)', tint: 'var(--clay-tint)' },
    error:   { it: 'Errore',   en: 'Error',   color: 'var(--danger)', tint: 'var(--danger-tint)' },
  };

  return (
    <DkModal open onClose={onClose} title={t('Carico merce', 'Receive stock')}
      sub={results
        ? t('Esito del carico', 'Restock outcome')
        : t('Seleziona i prodotti e indica le quantità in arrivo — si sommano alle scorte attuali', 'Pick products and enter incoming quantities — they add to current stock')}
      width={680}
      foot={results ? (
        <button className="dk-btn dk-btn--clay" onClick={onClose}><Icon name="check" size={17} color="#fff" />{t('Chiudi', 'Close')}</button>
      ) : (
        <React.Fragment>
          <div style={{ marginRight: 'auto', display: 'flex', alignItems: 'baseline', gap: 5 }}>
            <span className="t-sm" style={{ color: 'var(--muted)' }}>{t('Totale in arrivo', 'Total incoming')}</span>
            <span className="t-num" style={{ fontSize: 18 }}>{totalUnits > 0 ? '+' : ''}{totalUnits}</span>
          </div>
          <button className="dk-btn dk-btn--ghost" onClick={onClose}>{t('Annulla', 'Cancel')}</button>
          <MutationButton className="dk-btn dk-btn--clay" disabled={!canApply} onClick={apply}><Icon name="check" size={17} color="#fff" />{t('Conferma carico', 'Confirm restock')}</MutationButton>
        </React.Fragment>
      )}>

      {results ? (
        /* ---- results view (LoadCsvOut) ---- */
        <React.Fragment>
          <div style={{ display: 'flex', gap: 14, marginBottom: 14 }}>
            {[[t('Caricati', 'Loaded'), results.loaded], [t('Creati', 'Created'), results.created], [t('Errori', 'Errors'), results.errors]].map(([l, v], i) => (
              <div key={i} className="dk-card" style={{ flex: 1, padding: '12px 16px', boxShadow: 'none', border: '1px solid var(--hair)' }}>
                <div className="t-meta" style={{ marginBottom: 4 }}>{l}</div>
                <div className="t-num" style={{ fontSize: 22, color: l === t('Errori', 'Errors') && v ? 'var(--danger)' : 'var(--ink)' }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ border: '1px solid var(--hair)', borderRadius: 12, overflow: 'hidden' }}>
            {results.results.map((r, i) => {
              const meta = RESULT_META[r.status] || RESULT_META.error;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderTop: i ? '1px solid var(--hair)' : 'none' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: meta.color, background: meta.tint, padding: '3px 9px', borderRadius: 99, flexShrink: 0 }}>{meta[lang]}</span>
                  <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name || t('Riga', 'Row') + ' ' + r.row}</span>
                  {r.error && <span className="t-sm" style={{ color: 'var(--danger)', flexShrink: 0 }}>{r.error}</span>}
                </div>
              );
            })}
          </div>
        </React.Fragment>
      ) : (
        <React.Fragment>
          {/* search an existing product / open the CSV panel */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <div className="dk-search" style={{ flex: 1, width: 'auto' }}>
              <Icon name="search" size={17} color="var(--muted-2)" />
              <input value={pickQ} autoFocus onChange={(e) => setPickQ(e.target.value)} placeholder={t('Cerca un prodotto da ricaricare…', 'Search a product to restock…')} />
              {pickQ && <button className="press" onClick={() => setPickQ('')} style={{ cursor: 'pointer', display: 'grid', placeItems: 'center' }}><Icon name="x" size={14} color="var(--muted-2)" /></button>}
            </div>
            <button className="dk-btn dk-btn--ghost" onClick={() => setCsvOpen((v) => !v)} style={{ flexShrink: 0, ...(csvOpen ? { background: 'var(--surface-2)' } : {}) }}><Icon name="list" size={15} />CSV</button>
          </div>

          {/* CSV paste panel */}
          {csvOpen ? (
            <div style={{ padding: '16px 18px', background: 'var(--surface-2)', borderRadius: 12, marginBottom: 12, border: '1px solid var(--hair)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}><Icon name="info" size={15} color="var(--muted)" /><span style={{ fontWeight: 600, fontSize: 13.5 }}>{t('Importazione da CSV', 'CSV import')}</span></div>
              <div className="t-sm" style={{ color: 'var(--muted)', lineHeight: 1.55, marginBottom: 8 }}>
                {t('Una riga per prodotto: nome o SKU, quantità. I prodotti già presenti vengono ricaricati, quelli nuovi creati (serve il fornitore) — mai sovrascritti.', 'One row per product: name or SKU, quantity. Existing products are restocked, new ones created (supplier required) — never overwritten.')}
              </div>
              <textarea value={csvText} onChange={(e) => setCsvText(e.target.value)} rows={5} placeholder={'Base coat, 50\nGEL-RD-001, 12'} style={{ ...inputCss, fontFamily: 'var(--mono, monospace)', fontSize: 13, resize: 'vertical' }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                <button className="dk-btn dk-btn--ghost" style={{ height: 36 }} onClick={() => { setCsvOpen(false); setCsvText(''); }}>{t('Annulla', 'Cancel')}</button>
                <button className="dk-btn dk-btn--clay" style={{ height: 36 }} disabled={!csvText.trim()} onClick={importCsv}><Icon name="check" size={15} color="#fff" />{t('Aggiungi righe', 'Add rows')}</button>
              </div>
            </div>
          ) : (
            /* product picker */
            <React.Fragment>
              <div className="t-meta" style={{ marginBottom: 8 }}>{pickQ ? t('Risultati', 'Results') : t('Tutti i prodotti', 'All products')}</div>
              <div className="dk-card" style={{ padding: 6, marginBottom: lines.length ? 14 : 0, maxHeight: 220, overflowY: 'auto', boxShadow: 'none', border: '1px solid var(--hair)' }}>
                {available.length === 0 && <div className="t-sm" style={{ color: 'var(--muted-2)', padding: '10px 12px' }}>{pickQ ? t('Nessun prodotto trovato con questo nome.', 'No product found with this name.') : t('Tutti i prodotti sono già in lista.', 'All products are already on the list.')}</div>}
                {available.map((p) => {
                  const lowItem = p.stock_state === 'low';
                  return (
                    <button key={p.id} className="dk-row" onClick={() => addExisting(p)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 11px', borderRadius: 8, textAlign: 'left' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{p.name}</div>
                        <div className="t-sm" style={{ color: lowItem ? 'var(--warn)' : 'var(--muted-2)', fontWeight: lowItem ? 700 : 400 }}>{t('Attuale', 'Current')}: {fmtQty(p.stock_qty, lang)} {p.package_unit || t('unità', 'units')}{lowItem ? ' · ' + t('sottoscorta', 'low stock') : ''}</div>
                      </div>
                      <Icon name="plus" size={15} color="var(--clay-ink)" />
                    </button>
                  );
                })}
              </div>
            </React.Fragment>
          )}

          {/* selected lines */}
          {lines.length > 0 && (
            <React.Fragment>
              <div className="t-meta" style={{ marginBottom: 8 }}>{t('In arrivo', 'Incoming')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {lines.map((l) => {
                  const cur = l.product ? num(l.product.stock_qty) : 0;
                  const result = cur + (parseInt(l.qty, 10) || 0);
                  const unit = (l.product && l.product.package_unit) || t('unità', 'units');
                  return (
                    <div key={l.key} className="dk-card" style={{ padding: '12px 14px', boxShadow: 'none', border: '1px solid var(--hair)', display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 14.5, display: 'flex', alignItems: 'center', gap: 8 }}>
                          {l.name}
                          {l.isNew && <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--clay-ink)', background: 'var(--clay-tint)', padding: '2px 8px', borderRadius: 99 }}>{t('Nuovo', 'New')}</span>}
                        </div>
                        <div className="t-sm" style={{ color: 'var(--muted-2)', marginTop: 1 }}>
                          {l.product
                            ? <React.Fragment>{t('Attuale', 'Current')}: {fmtQty(cur, lang)} {unit} <span style={{ color: 'var(--clay-ink)', fontWeight: 700 }}>→ {fmtQty(result, lang)} {unit}</span></React.Fragment>
                            : t('Nuovo prodotto dal CSV', 'New product from CSV')}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                        <span className="t-sm" style={{ color: 'var(--muted-2)', fontWeight: 700 }}>+</span>
                        <NumBox value={parseInt(l.qty, 10) || 0} onChange={(v) => setLine(l.key, { qty: v })} width={104} />
                      </div>
                      <button className="dk-iconbtn" onClick={() => rmLine(l.key)} style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, color: 'var(--muted-2)' }}><Icon name="x" size={15} /></button>
                    </div>
                  );
                })}
              </div>
            </React.Fragment>
          )}

          {/* shipment supplier — required when the CSV introduces new products */}
          {hasNew && (
            <div style={{ marginTop: 14 }}>
              <div className="t-meta" style={{ marginBottom: 6 }}>{t('Fornitore del carico', 'Shipment supplier')} <span style={{ color: 'var(--clay)' }}>*</span></div>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} style={{ ...inputCss, cursor: 'pointer' }}>
                <option value="">{t('Seleziona fornitore…', 'Pick a supplier…')}</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <div className="t-sm" style={{ color: 'var(--muted-2)', marginTop: 5 }}>{t('Assegnato ai nuovi prodotti creati dal CSV.', 'Assigned to the new products created from the CSV.')}</div>
            </div>
          )}

          {!lines.length && !csvOpen && !activeProds.length && (
            <div style={{ padding: '24px 0' }}><EmptyState icon="box" title={t('Nessun prodotto', 'No products')} sub={t('Crea prima un prodotto o importa un CSV.', 'Create a product first or import a CSV.')} /></div>
          )}
        </React.Fragment>
      )}
    </DkModal>
  );
}

export default withPortalForm(RestockModal);
