import { MutationButton } from '@youty/shared';
import { MutationToggle } from '@youty/shared';
// ServiziSub.jsx — services grouped by category, one card per service.
import React, { useState } from 'react';
import { Icon, Toggle, fmtEur, fmtDur, EmptyState } from '@youty/shared';
import { GroupedFilterMenu } from '../../ui/index.js';
import { CategoryDot, OperatorAvatarStack, SearchToolbar } from './parts.jsx';

function catName(cat, lang) {
  if (!cat) return '';
  return lang === 'en' && cat.name_en ? cat.name_en : cat.name_it;
}
function svcName(s, lang) {
  return lang === 'en' && s.name_en ? s.name_en : s.name_it;
}
// the "other" language label, shown small under the primary name
function svcNameAlt(s, lang) {
  return lang === 'en' ? s.name_it : s.name_en || '';
}

export default function ServiziSub({ services, loading, categories, operators, canEdit, onCats, onEdit, onNew, onToggleActive, t, lang }) {
  const [q, setQ] = useState('');
  const [catF, setCatF] = useState('all');
  const [statusF, setStatusF] = useState('all');

  const opsFor = (serviceId) => operators.filter((o) => (o.service_ids || []).includes(serviceId));

  const filtered = services.filter((s) => {
    const okCat = catF === 'all' || catF === String(s.category_id);
    const okStatus = statusF === 'all' || (statusF === 'active' && s.active) || (statusF === 'paused' && !s.active);
    const okQ = !q || svcName(s, lang).toLowerCase().includes(q.toLowerCase());
    return okCat && okStatus && okQ;
  });

  const groups = [...categories]
    .sort((a, b) => a.order - b.order)
    .map((cat) => ({
      cat,
      items: filtered
        .filter((s) => s.category_id === cat.id)
        .sort((a, b) => a.order - b.order || svcName(a, lang).localeCompare(svcName(b, lang))),
    }))
    .filter((g) => g.items.length);

  if (loading) {
    return (
      <div style={{ display: 'grid', gap: 22 }}>
        {[...Array(2)].map((_, i) => (
          <div key={i}>
            <div className="skel" style={{ height: 16, width: 140, marginBottom: 12, borderRadius: 6 }} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
              {[...Array(3)].map((__, j) => <div key={j} className="skel" style={{ height: 150, borderRadius: 16 }} />)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <React.Fragment>
      <SearchToolbar
        q={q} setQ={setQ} placeholder={t('Cerca un servizio…', 'Search a service…')}
        onAdd={onNew} addLabel={t('Nuovo servizio', 'New service')} canAdd={canEdit}
        extra={(
          <React.Fragment>
            <GroupedFilterMenu
              t={t}
              groups={[
                { label: t('Categoria', 'Category'), value: catF, set: setCatF, opts: [['all', t('Tutte', 'All')], ...categories.map((c) => [String(c.id), catName(c, lang)])] },
                { label: t('Stato', 'Status'), value: statusF, set: setStatusF, opts: [['all', t('Tutti', 'All')], ['active', t('Attivi', 'Active')], ['paused', t('In pausa', 'Paused')]] },
              ]}
            />
            <button className="dk-btn dk-btn--ghost" onClick={onCats} style={{ flexShrink: 0 }}>
              <Icon name="tag" size={16} />{t('Categorie', 'Categories')}
            </button>
          </React.Fragment>
        )}
      />

      {groups.length === 0 ? (
        <div className="dk-card" style={{ padding: '12px 0' }}>
          <EmptyState icon="search" title={t('Nessun servizio', 'No services')} sub={t('Prova un altro filtro o termine di ricerca.', 'Try another filter or search term.')} />
        </div>
      ) : groups.map(({ cat, items }) => (
        <div key={cat.id} style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <CategoryDot color={cat.color} size={11} />
            <span className="t-meta" style={{ fontSize: 12 }}>{catName(cat, lang)}</span>
            <span className="t-sm" style={{ color: 'var(--muted-2)' }}>· {items.length}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
            {items.map((s) => {
              const alt = svcNameAlt(s, lang);
              return (
                <div
                  key={s.id} className="dk-card dk-hovercard" style={{ padding: 16, opacity: s.active ? 1 : 0.55, cursor: canEdit ? 'pointer' : 'default' }}
                  onClick={canEdit ? () => onEdit(s) : undefined}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.25 }}>{svcName(s, lang)}</div>
                      {alt && <div className="t-sm" style={{ color: 'var(--muted-2)', marginTop: 2 }}>{alt}</div>}
                    </div>
                    {canEdit && (
                      <MutationButton className="dk-iconbtn" style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0 }} onClick={(e) => { e.stopPropagation(); onEdit(s); }}>
                        <Icon name="edit" size={14} />
                      </MutationButton>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 16 }}>
                    <div>
                      <div className="t-sm" style={{ color: 'var(--muted)' }}>{fmtDur(s.duration_min)}</div>
                      <div className="t-num" style={{ fontSize: 21 }}>{fmtEur(Number(s.price), lang)}</div>
                    </div>
                    <OperatorAvatarStack ops={opsFor(s.id)} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--hair)' }}>
                    <span className="t-sm" style={{ color: s.active ? 'var(--ok)' : 'var(--muted)', fontWeight: 600 }}>
                      {s.active ? t('Attivo', 'Active') : t('In pausa', 'Paused')}
                    </span>
                    {canEdit && (
                      <div onClick={(e) => e.stopPropagation()}>
                        <MutationToggle on={s.active} onChange={(v) => onToggleActive(s, v)} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </React.Fragment>
  );
}
