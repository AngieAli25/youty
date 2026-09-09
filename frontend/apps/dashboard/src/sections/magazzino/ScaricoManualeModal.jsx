import { withPortalForm } from '@youty/shared';
import { MutationButton } from '@youty/shared';
// ScaricoManualeModal.jsx — module-level manual issue (scarico) of one OR MORE products.
// Each line: searchable product picker + quantità + causale (the 4 SCARICO_REASONS);
// one optional operatrice for the whole session. On submit each line is POSTed
// sequentially to /products/{id}/unload; per-line status pending→✓/error, one failure
// does not abort the rest, failed lines stay editable. onDone() runs after the batch.
import React, { useState } from 'react';
import { api, ApiError, Icon, Avatar } from '@youty/shared';
import { useDash } from '../../ctx.jsx';
import { DkModal } from '../../ui/index.js';
import { errMsg, fmtQty, num } from './lib.js';
import { NumBox, inputCss } from './bits.jsx';
import { SCARICO_REASONS } from './AdjModal.jsx';

let keySeq = 0;
const nextKey = () => 'sc' + (keySeq++) + '_' + Date.now();
const blankLine = () => ({ key: nextKey(), product: null, q: '', qty: 1, reason: null, status: 'idle', error: null });

function ScaricoManualeModal({ products, onClose, onDone }) {
  const { t, lang, fireToast, hasScope, canMutate, operators } = useDash();
  const locked = !hasScope('inventory');
  const list = products || [];

  const [lines, setLines] = useState([blankLine()]);
  const [opId, setOpId] = useState(null);      // shared operatrice (optional)
  const [openKey, setOpenKey] = useState(null); // which line's picker dropdown is open
  const [busy, setBusy] = useState(false);

  const setLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, blankLine()]);
  const rmLine = (key) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));

  const validLines = lines.filter((l) => l.product && (parseInt(l.qty, 10) || 0) > 0 && l.reason);
  const totalUnits = validLines.reduce((s, l) => s + (parseInt(l.qty, 10) || 0), 0);
  const hasRun = lines.some((l) => l.status === 'done' || l.status === 'error');
  const canApply = !locked && !busy && validLines.some((l) => l.status !== 'done');

  const lineErr = (err) =>
    err instanceof ApiError && err.status === 422 ? t('Giacenza insufficiente', 'Insufficient stock') : errMsg(err, t);

  const apply = async () => {
    if (!canApply) return;
    setBusy(true);
    setOpenKey(null);
    // snapshot the targets: valid lines not already registered
    const targets = lines.filter((l) => l.product && (parseInt(l.qty, 10) || 0) > 0 && l.reason && l.status !== 'done');
    let failed = 0;
    for (const line of targets) {
      setLine(line.key, { status: 'pending', error: null });
      try {
        await api.post(`/api/inventory/products/${line.product.id}/unload`, {
          qty: parseInt(line.qty, 10) || 0,
          kind: line.reason.kind,
          reason: line.reason[lang],
          operator_id: opId,
        });
        setLine(line.key, { status: 'done', error: null });
      } catch (err) {
        failed += 1;
        setLine(line.key, { status: 'error', error: lineErr(err) });
      }
    }
    const ok = targets.length - failed;
    fireToast(
      failed
        ? { msg: t(`${ok} scarichi registrati · ${failed} errori`, `${ok} issues recorded · ${failed} errors`), icon: 'alert' }
        : { msg: t(`${ok} scarichi registrati`, `${ok} issues recorded`), icon: 'check' },
    );
    setBusy(false);
    onDone();
  };

  const STATUS = {
    pending: { it: 'In corso…', en: 'Working…', color: 'var(--muted)',  tint: 'var(--surface-2)' },
    done:    { it: 'Registrato', en: 'Recorded', color: 'var(--ok)',    tint: 'var(--ok-tint)' },
    error:   { it: 'Errore',     en: 'Error',    color: 'var(--danger)', tint: 'var(--danger-tint)' },
  };

  return (
    <DkModal open onClose={onClose} title={t('Scarico manuale', 'Manual issue')}
      sub={t('Scarica uno o più prodotti — uso interno, consumo, rettifica o danni', 'Issue one or more products — internal use, consumption, adjustment or damage')}
      width={720}
      foot={<React.Fragment>
        <div style={{ marginRight: 'auto', display: 'flex', alignItems: 'baseline', gap: 5 }}>
          <span className="t-sm" style={{ color: 'var(--muted)' }}>{t('Totale da scaricare', 'Total to issue')}</span>
          <span className="t-num" style={{ fontSize: 18 }}>{totalUnits > 0 ? '−' : ''}{totalUnits}</span>
        </div>
        <button className="dk-btn dk-btn--ghost" onClick={onClose}>{hasRun ? t('Chiudi', 'Close') : t('Annulla', 'Cancel')}</button>
        <MutationButton className="dk-btn dk-btn--clay" disabled={!canApply} onClick={apply}>
          <Icon name="check" size={17} color="#fff" />{t('Registra scarico', 'Confirm issue')}
        </MutationButton>
      </React.Fragment>}>

      {locked && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 14px', background: 'var(--warn-tint)', borderRadius: 12, marginBottom: 16 }}>
          <Icon name="alert" size={17} color="var(--warn)" />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)' }}>{t('Non hai i permessi per movimentare il magazzino.', "You don't have permission to move stock.")}</span>
        </div>
      )}

      {/* shared operatrice for the whole batch (optional) */}
      {operators.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div className="t-meta" style={{ marginBottom: 8 }}>
            {t('Operatrice', 'Operator')}
            <span style={{ color: 'var(--muted-2)', fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}> · {t('opzionale, per tutte le righe', 'optional, for all lines')}</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            <button
              onClick={() => setOpId(null)} disabled={locked}
              style={{ padding: '6px 14px', borderRadius: 99, fontSize: 13, fontWeight: 600, cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? 0.55 : 1, border: '1.5px solid ' + (opId == null ? 'var(--clay)' : 'var(--hair)'), background: opId == null ? 'var(--clay-tint)' : 'var(--surface)', color: opId == null ? 'var(--clay-ink)' : 'var(--ink-2)' }}
            >{t('Nessuna', 'None')} · —</button>
            {operators.map((o) => {
              const on = opId === o.id;
              return (
                <button
                  key={o.id} onClick={() => setOpId(o.id)} disabled={locked}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 12px 5px 5px', borderRadius: 99, cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? 0.55 : 1, border: '1.5px solid ' + (on ? o.color : 'var(--hair)'), background: on ? `color-mix(in srgb, ${o.color} 12%, transparent)` : 'var(--surface)' }}
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

      {/* product lines */}
      <div className="t-meta" style={{ marginBottom: 8 }}>{t('Prodotti da scaricare', 'Products to issue')}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {lines.map((line) => {
          const st = STATUS[line.status];
          const stock = line.product ? num(line.product.stock_qty) : 0;
          const unit = (line.product && line.product.package_unit) || t('unità', 'units');
          const insufficient = line.product && (parseInt(line.qty, 10) || 0) > stock;
          const chosenIds = new Set(lines.filter((l) => l.product && l.key !== line.key).map((l) => l.product.id));
          const q = (line.q || '').toLowerCase();
          const matches = list
            .filter((p) => !chosenIds.has(p.id) && (!q || p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)))
            .slice(0, 8);
          const borderCol = line.status === 'error' ? 'var(--danger)' : line.status === 'done' ? 'var(--ok)' : 'var(--hair)';

          return (
            <div key={line.key} className="dk-card" style={{ padding: '12px 14px', boxShadow: 'none', border: '1px solid ' + borderCol }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                {/* product picker */}
                <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
                  {line.product ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{line.product.name}</div>
                        <div className="t-sm" style={{ color: insufficient ? 'var(--danger)' : 'var(--muted-2)', fontWeight: insufficient ? 700 : 400 }}>
                          {t('Disponibili', 'Available')}: {fmtQty(stock, lang)} {unit}{insufficient ? ' · ' + t('insufficiente', 'insufficient') : ''}
                        </div>
                      </div>
                      {line.status !== 'done' && !busy && (
                        <button className="dk-iconbtn" onClick={() => { setLine(line.key, { product: null, q: '', status: 'idle', error: null }); setOpenKey(line.key); }} style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, color: 'var(--muted-2)' }} title={t('Cambia prodotto', 'Change product')}><Icon name="edit" size={14} /></button>
                      )}
                    </div>
                  ) : (
                    <React.Fragment>
                      <div className="dk-search" style={{ width: 'auto' }}>
                        <Icon name="search" size={16} color="var(--muted-2)" />
                        <input
                          value={line.q} disabled={locked}
                          onFocus={() => setOpenKey(line.key)}
                          onBlur={() => setTimeout(() => setOpenKey((k) => (k === line.key ? null : k)), 150)}
                          onChange={(e) => { setLine(line.key, { q: e.target.value }); setOpenKey(line.key); }}
                          placeholder={t('Cerca prodotto o SKU…', 'Search product or SKU…')}
                        />
                      </div>
                      {openKey === line.key && !locked && (
                        <div className="dk-card" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, marginTop: 6, padding: 6, maxHeight: 240, overflowY: 'auto', border: '1px solid var(--hair)' }}>
                          {matches.length === 0 && <div className="t-sm" style={{ color: 'var(--muted-2)', padding: '10px 12px' }}>{t('Nessun prodotto trovato.', 'No product found.')}</div>}
                          {matches.map((p) => {
                            const low = p.stock_state === 'low';
                            return (
                              <button key={p.id} className="dk-row" onMouseDown={(e) => e.preventDefault()} onClick={() => { setLine(line.key, { product: p, q: '' }); setOpenKey(null); }} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 11px', borderRadius: 8, textAlign: 'left' }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontWeight: 600, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                                  <div className="t-sm" style={{ color: low ? 'var(--warn)' : 'var(--muted-2)', fontWeight: low ? 700 : 400 }}>
                                    {[p.sku, `${fmtQty(p.stock_qty, lang)} ${p.package_unit || t('unità', 'units')}`].filter(Boolean).join(' · ')}{low ? ' · ' + t('sottoscorta', 'low stock') : ''}
                                  </div>
                                </div>
                                <Icon name="plus" size={15} color="var(--clay-ink)" />
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </React.Fragment>
                  )}
                </div>

                {/* status + remove */}
                {st && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: st.color, background: st.tint, padding: '4px 9px', borderRadius: 99, flexShrink: 0, whiteSpace: 'nowrap' }}>
                    {line.status === 'done' && <Icon name="check" size={12} color={st.color} stroke={2.6} />}
                    {st[lang]}
                  </span>
                )}
                <button className="dk-iconbtn" disabled={busy || lines.length <= 1} onClick={() => rmLine(line.key)} style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, color: 'var(--muted-2)', opacity: lines.length <= 1 ? 0.4 : 1 }} title={t('Rimuovi riga', 'Remove line')}><Icon name="x" size={15} /></button>
              </div>

              {/* qty + causale */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                <NumBox value={parseInt(line.qty, 10) || 0} onChange={(v) => setLine(line.key, { qty: v })} suffix={unit} width={148} disabled={locked || busy} />
                <select
                  value={line.reason ? SCARICO_REASONS.indexOf(line.reason) : ''}
                  disabled={locked || busy}
                  onChange={(e) => setLine(line.key, { reason: e.target.value === '' ? null : SCARICO_REASONS[Number(e.target.value)] })}
                  style={{ ...inputCss, flex: 1, cursor: locked || busy ? 'not-allowed' : 'pointer', height: 42, padding: '0 12px' }}
                >
                  <option value="">{t('Causale…', 'Reason…')}</option>
                  {SCARICO_REASONS.map((r, i) => <option key={i} value={i}>{r[lang]}</option>)}
                </select>
              </div>

              {line.status === 'error' && line.error && (
                <div className="t-sm" style={{ color: 'var(--danger)', fontWeight: 700, marginTop: 8 }}>{line.error}</div>
              )}
            </div>
          );
        })}
      </div>

      <button className="dk-btn dk-btn--ghost" disabled={locked || busy} onClick={addLine} style={{ marginTop: 10 }}>
        <Icon name="plus" size={16} />{t('Aggiungi prodotto', 'Add product')}
      </button>
    </DkModal>
  );
}

export default withPortalForm(ScaricoManualeModal);
