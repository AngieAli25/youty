import { MutationButton } from '@youty/shared';
// clienti/index.jsx — CLIENTI section: category summary cards + searchable,
// filterable, paginated client list (left) and full client profile (right).
// Ported from desktop-clienti.jsx (DkClienti) onto the real API.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, Avatar, EmptyState, Icon } from '@youty/shared';
import { GroupedFilterMenu } from '../../ui/index.js';
import { useDash } from '../../ctx.jsx';
import ClientProfile from './ClientProfile.jsx';
import { CatChip, RelBadge } from './components.jsx';
import { initialsOf, relRange } from './helpers.js';

const PAGE = 50;

export default function ClientiSection() {
  const { t, search, setSearch, selClient, setSelClient, clientCategories, openModal, modal, fireToast } = useDash();

  const [seg, setSeg] = useState('all');          // 'all' | '__active' | category id (number)
  const [relFilt, setRelFilt] = useState('all');  // 'all' | 'good' | 'watch' | 'risk'
  const [items, setItems] = useState(null);       // null = loading skeleton
  const [count, setCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [catCounts, setCatCounts] = useState(null); // { __active: n, [catId]: n }
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  /* debounce the shared topbar search before hitting the API */
  const [q, setQ] = useState(search);
  useEffect(() => {
    const tm = setTimeout(() => setQ(search), 250);
    return () => clearTimeout(tm);
  }, [search]);

  const listParams = useMemo(() => ({
    q: q.trim() || undefined,
    category_id: typeof seg === 'number' ? seg : undefined,
    is_active: true, // the API default includes soft-deleted clients
    ...relRange(relFilt),
  }), [q, seg, relFilt]);

  /* ---- client list (server-side filters, {items,count} pagination) ---- */
  useEffect(() => {
    let dead = false;
    setItems(null);
    api.get('/api/clients/', { params: { ...listParams, limit: PAGE, offset: 0 } })
      .then((res) => { if (!dead) { setItems(res.items); setCount(res.count); } })
      .catch((err) => {
        if (dead) return;
        setItems([]); setCount(0);
        fireToast({ msg: err instanceof ApiError ? err.message : t('Errore di rete', 'Network error'), icon: 'alert' });
      });
    return () => { dead = true; };
  }, [listParams, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const res = await api.get('/api/clients/', { params: { ...listParams, limit: PAGE, offset: items.length } });
      setItems((l) => [...l, ...res.items]);
      setCount(res.count);
    } catch (err) {
      fireToast({ msg: err instanceof ApiError ? err.message : t('Errore di rete', 'Network error'), icon: 'alert' });
    } finally { setLoadingMore(false); }
  };

  /* ---- category summary counts ----
   * One `limit=1` request per card, reading the pagination `count`: payloads
   * stay tiny and the number of requests is bounded by the category catalog
   * (small), while a full unfiltered fetch would grow with the client base
   * and duplicate the paginated list query. All counts are active-only. */
  useEffect(() => {
    let dead = false;
    const cards = [{ key: '__active', params: {} }, ...clientCategories.map((c) => ({ key: c.id, params: { category_id: c.id } }))];
    Promise.all(cards.map((c) => api.get('/api/clients/', { params: { ...c.params, is_active: true, limit: 1 } }).then((r) => [c.key, r.count]).catch(() => [c.key, null])))
      .then((pairs) => { if (!dead) setCatCounts(Object.fromEntries(pairs)); });
    return () => { dead = true; };
  }, [clientCategories, refreshKey]);

  /* ---- refetch after globally-hosted clienti modals close (topbar "Nuova",
   * bulk import) — mutations happen inside the modal components. ---- */
  const prevModal = useRef(null);
  useEffect(() => {
    const prev = prevModal.current;
    prevModal.current = modal;
    if (prev && !modal && ['newclient', 'bulkimport'].includes(prev.name)) bump();
  }, [modal, bump]);

  const segOpts = [
    ['all', t('Tutti', 'All')],
    ['__active', t('Attivi', 'Active')],
    ...clientCategories.map((cc) => [cc.id, cc.name]),
  ];
  const activeLabel = (segOpts.find((s) => s[0] === seg) || segOpts[0])[1];
  const catCards = [
    { key: '__active', label: t('Attivi', 'Active'), color: '#C2E8CB' },
    ...clientCategories.map((cc) => ({ key: cc.id, label: cc.name, color: cc.color || 'var(--hair)' })),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* category summary cards — client category catalog (+ always-on Attivi) */}
      <div className="scroll" style={{ display: 'flex', gap: 12, padding: '20px 24px 4px', overflowX: 'auto', flexShrink: 0 }}>
        {catCards.map((cc) => {
          const on = seg === cc.key;
          const n = catCounts ? catCounts[cc.key] : null;
          return (
            <button key={cc.key} onClick={() => setSeg(on ? 'all' : cc.key)} style={{ width: 150, flexShrink: 0, textAlign: 'left', cursor: 'pointer', background: 'var(--surface)', border: '1px solid ' + (on ? cc.color : 'var(--hair)'), borderRadius: 16, padding: '14px 16px', boxShadow: 'var(--sh-sm)', position: 'relative', overflow: 'hidden' }}>
              <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: cc.color }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: 99, background: cc.color, flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cc.label}</span>
              </div>
              {n == null
                ? <div className="skel" style={{ height: 26, width: 44, marginTop: 8, borderRadius: 8 }} />
                : <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--ink)', marginTop: 6 }}>{n}</div>}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* list */}
        <div style={{ width: 360, flexShrink: 0, borderRight: '1px solid var(--hair)', display: 'flex', flexDirection: 'column', background: 'var(--paper)' }}>
          <div style={{ padding: '18px 20px 12px' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div className="dk-search" style={{ flex: 1, width: 'auto' }}>
                <Icon name="search" size={18} color="var(--muted-2)" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Cerca cliente…', 'Search client…')} />
                {search && <button onClick={() => setSearch('')} style={{ cursor: 'pointer', display: 'grid', placeItems: 'center' }}><Icon name="x" size={15} color="var(--muted-2)" /></button>}
              </div>
              <GroupedFilterMenu t={t} groups={[
                { label: t('Categoria', 'Category'), value: seg, set: setSeg, opts: segOpts },
                { label: t('Affidabilità', 'Reliability'), value: relFilt, set: setRelFilt, opts: [['all', t('Tutte', 'All')], ['good', t('Ottima', 'Excellent')], ['watch', t('Da seguire', 'Watch')], ['risk', t('A rischio', 'At risk')]] },
              ]} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
              <span className="t-sm" style={{ color: 'var(--muted)', fontWeight: 600 }}>
                {items == null ? '…' : count} {t('clienti', 'clients')}{seg !== 'all' ? ' · ' + activeLabel : ''}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {(seg !== 'all' || relFilt !== 'all') && <button onClick={() => { setSeg('all'); setRelFilt('all'); }} style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 700, color: 'var(--clay-ink)', background: 'transparent', border: 'none' }}>{t('Azzera', 'Clear')}</button>}
                <MutationButton className="dk-btn dk-btn--ghost" style={{ height: 34, fontSize: 12.5, padding: '0 11px' }} onClick={() => openModal('bulkimport')}><Icon name="arrowDn" size={15} />{t('Importa', 'Import')}</MutationButton>
                <MutationButton className="dk-btn dk-btn--clay" style={{ height: 34, fontSize: 12.5, padding: '0 13px' }} onClick={() => openModal('newclient')}><Icon name="plus" size={15} color="#fff" />{t('Nuovo', 'New')}</MutationButton>
              </div>
            </div>
          </div>

          <div className="scroll" style={{ flex: 1, overflowY: 'auto', padding: '0 12px 16px' }}>
            {items == null && [...Array(7)].map((_, i) => <div key={i} className="skel" style={{ height: 74, borderRadius: 12, marginBottom: 6 }} />)}
            {items != null && items.map((cl) => {
              const on = cl.id === selClient;
              return (
                <button key={cl.id} className="dk-row" onClick={() => setSelClient(cl.id)} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '11px 12px', borderRadius: 12, width: '100%', textAlign: 'left', background: on ? 'var(--surface)' : 'transparent', boxShadow: on ? 'var(--sh-sm)' : 'none', marginBottom: 2, border: 'none' }}>
                  <Avatar initials={initialsOf(cl.full_name)} size={42} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 700, fontSize: 14.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cl.full_name}</span>
                      {cl.deposit_always && <Icon name="coupon" size={13} color="var(--warn)" />}
                    </div>
                    <div className="t-sm" style={{ color: 'var(--muted)', marginTop: 1 }}>{cl.phone || '—'}{cl.lang === 'en' ? ' · EN' : ''}</div>
                    <div style={{ display: 'flex', gap: 5, marginTop: 7, flexWrap: 'wrap' }}>
                      <RelBadge score={cl.reliability} t={t} sm />
                      {(cl.categories || []).slice(0, 2).map((cat) => <CatChip key={cat.id} cat={cat} sm />)}
                    </div>
                  </div>
                </button>
              );
            })}
            {items != null && !items.length && (
              <div style={{ padding: '30px 12px' }}>
                <EmptyState icon="search" title={t('Nessun cliente', 'No clients')} sub={t('Prova un altro filtro o nome.', 'Try another filter or name.')} />
              </div>
            )}
            {items != null && items.length < count && (
              <button className="dk-btn dk-btn--ghost" style={{ width: '100%', marginTop: 8 }} disabled={loadingMore} onClick={loadMore}>
                {loadingMore ? t('Carico…', 'Loading…') : t(`Mostra altri (${count - items.length})`, `Show more (${count - items.length})`)}
              </button>
            )}
          </div>
        </div>

        {/* detail */}
        <div className="scroll" style={{ flex: 1, overflowY: 'auto', minWidth: 0, padding: '20px 24px 24px', background: 'var(--paper)' }}>
          {selClient ? (
            <div className="dk-card" style={{ background: 'var(--surface)', borderRadius: 18, border: '1px solid var(--hair)', boxShadow: 'var(--sh-card)', minHeight: '100%' }}>
              <ClientProfile key={selClient} clientId={selClient}
                onChanged={bump}
                onDeleted={() => { setSelClient(null); bump(); }} />
            </div>
          ) : (
            <EmptyState icon="clients" title={t('Seleziona un cliente', 'Select a client')} sub={t('Scegli un cliente dalla lista per aprire la scheda.', 'Pick a client from the list to open the profile.')} />
          )}
        </div>
      </div>
    </div>
  );
}
