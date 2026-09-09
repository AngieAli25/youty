// PacchettiSub.jsx — package cards: included services (qty), savings vs single prices.
import React, { useState } from 'react';
import { Icon, fmtEur, EmptyState } from '@youty/shared';
import { FilterMenu } from '../../ui/index.js';
import { SearchToolbar } from './parts.jsx';

function svcName(s, lang) {
  return lang === 'en' && s.name_en ? s.name_en : s.name_it;
}

/** sum of the included services at their individual prices (qty-weighted) */
export function packageOriginalValue(pkg, servicesById) {
  return (pkg.items || []).reduce((sum, it) => {
    const s = servicesById[it.service_id];
    return sum + (s ? Number(s.price) * (it.qty || 1) : 0);
  }, 0);
}

export default function PacchettiSub({ packages, loading, services, canEdit, onEdit, onNew, t, lang }) {
  const [q, setQ] = useState('');
  const [filt, setFilt] = useState('all');
  const servicesById = Object.fromEntries(services.map((s) => [s.id, s]));

  const list = packages.filter((p) => {
    const okF = filt === 'all' || (filt === 'active' && p.active) || (filt === 'inactive' && !p.active);
    const okQ = !q
      || p.name.toLowerCase().includes(q.toLowerCase())
      || (p.description || '').toLowerCase().includes(q.toLowerCase());
    return okF && okQ;
  });

  if (loading) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 16 }}>
        {[...Array(3)].map((_, i) => <div key={i} className="skel" style={{ height: 190, borderRadius: 16 }} />)}
      </div>
    );
  }

  return (
    <React.Fragment>
      <SearchToolbar
        q={q} setQ={setQ} placeholder={t('Cerca un pacchetto…', 'Search a package…')}
        onAdd={onNew} addLabel={t('Nuovo pacchetto', 'New package')} canAdd={canEdit}
        extra={(
          <FilterMenu
            title={t('Filtra per stato', 'Filter by status')}
            options={[['all', t('Tutti', 'All')], ['active', t('Attivi', 'Active')], ['inactive', t('Non attivi', 'Inactive')]]}
            active={filt} onChange={setFilt}
          />
        )}
      />
      <div className="t-sm" style={{ color: 'var(--muted)', marginBottom: 16 }}>
        {t('Offerte che raggruppano più servizi a prezzo scontato.', 'Bundles of services at a discounted price.')}
      </div>

      {list.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 16 }}>
          {list.map((p) => {
            const orig = packageOriginalValue(p, servicesById);
            const price = Number(p.price);
            const saving = orig - price;
            const off = orig > 0 && saving > 0 ? Math.round((saving / orig) * 100) : 0;
            return (
              <div
                key={p.id} className="dk-card dk-hovercard"
                onClick={canEdit ? () => onEdit(p) : undefined}
                style={{ padding: 18, opacity: p.active ? 1 : 0.6, cursor: canEdit ? 'pointer' : 'default' }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 16 }}>{p.name}</span>
                      {off > 0 && <span style={{ fontSize: 11.5, fontWeight: 800, color: '#fff', background: 'var(--clay)', padding: '2px 8px', borderRadius: 99 }}>-{off}%</span>}
                    </div>
                    {p.description && <div className="t-sm" style={{ color: 'var(--muted)', marginTop: 6, lineHeight: 1.45 }}>{p.description}</div>}
                  </div>
                  {canEdit && <Icon name="edit" size={16} color="var(--muted-2)" />}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, margin: '13px 0 14px' }}>
                  {(p.items || []).map((it) => {
                    const s = servicesById[it.service_id];
                    return (
                      <div key={it.id ?? `${it.service_id}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Icon name="check" size={13} color="var(--ok)" stroke={2.4} />
                        <span className="t-sm" style={{ color: 'var(--ink-2)', flex: 1, minWidth: 0 }}>
                          {s ? svcName(s, lang) : t('Servizio rimosso', 'Removed service')}{it.qty > 1 ? ` ×${it.qty}` : ''}
                        </span>
                        {s && <span className="t-num" style={{ fontSize: 12.5, color: 'var(--muted-2)' }}>{fmtEur(Number(s.price) * (it.qty || 1), lang)}</span>}
                      </div>
                    );
                  })}
                  {!(p.items || []).length && <span className="t-sm" style={{ color: 'var(--muted-2)' }}>{t('Nessun servizio incluso', 'No services included')}</span>}
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', paddingTop: 12, borderTop: '1px solid var(--hair)' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span className="t-num" style={{ fontSize: 24 }}>{fmtEur(price, lang)}</span>
                    {off > 0 && <span className="t-sm" style={{ color: 'var(--muted-2)', textDecoration: 'line-through' }}>{fmtEur(orig, lang)}</span>}
                  </div>
                  {saving > 0 ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: 'var(--ok)', background: 'var(--ok-tint)', padding: '4px 10px', borderRadius: 99 }}>
                      <Icon name="sparkle" size={12} color="var(--ok)" />{t('Risparmio', 'Savings')} {fmtEur(saving, lang)}
                    </span>
                  ) : !p.active ? (
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', background: 'var(--paper-2)', padding: '2px 8px', borderRadius: 99 }}>{t('Non attivo', 'Inactive')}</span>
                  ) : null}
                </div>
                {saving > 0 && !p.active && (
                  <div style={{ marginTop: 10, textAlign: 'right' }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', background: 'var(--paper-2)', padding: '2px 8px', borderRadius: 99 }}>{t('Non attivo', 'Inactive')}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="dk-card" style={{ padding: '12px 0' }}>
          <EmptyState
            icon="gift" title={t('Nessun pacchetto', 'No packages')}
            sub={q || filt !== 'all' ? t('Prova un altro filtro o termine di ricerca.', 'Try another filter or search term.') : t('Crea la prima offerta pacchetto.', 'Create your first package offer.')}
            mutationAction action={canEdit ? t('Nuovo pacchetto', 'New package') : undefined} onAction={onNew}
          />
        </div>
      )}
    </React.Fragment>
  );
}
