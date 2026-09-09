import { MutationButton } from '@youty/shared';
import React, { useEffect, useState } from 'react';
import { api, ApiError, fmtEur, parseISO, toDateStr, Icon, EmptyState } from '@youty/shared';
import { useDash } from '../../ctx.jsx';
import { GroupedFilterMenu } from '../../ui/index.js';
import Pager from './Pager.jsx';
import CouponEditModal from './modals/CouponEditModal.jsx';
import { COUPON_ORIGIN_META, COUPON_STATUS_META } from './meta.js';

const LIMIT = 24;

function couponValueLabel(c, lang) {
  if (!c) return '';
  return c.kind === 'amount' ? '-' + fmtEur(Number(c.value), lang) : '-' + c.value + '%';
}

export default function CouponSub() {
  const { t, lang, hasScope, canMutate, fireToast } = useDash();
  const canWrite = hasScope('marketing');

  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [originF, setOriginF] = useState('all');
  const [statusF, setStatusF] = useState('all');
  const [offset, setOffset] = useState(0);

  const [items, setItems] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState(null);

  // debounce the search box into `query`, resetting to page 1
  useEffect(() => {
    const tm = setTimeout(() => { setQuery(q); setOffset(0); }, 300);
    return () => clearTimeout(tm);
  }, [q]);

  useEffect(() => { setOffset(0); }, [originF, statusF]);

  const reload = () => {
    let alive = true;
    setLoading(true);
    api.get('/api/marketing/coupons', {
      params: {
        origin: originF === 'all' ? undefined : originF,
        status: statusF === 'all' ? undefined : statusF,
        q: query || undefined,
        limit: LIMIT, offset,
      },
    }).then((res) => {
      if (!alive) return;
      setItems(res.items || []);
      setCount(res.count || 0);
    }).catch((err) => {
      if (!alive) return;
      setItems([]); setCount(0);
      fireToast({ msg: err instanceof ApiError ? err.message : t('Errore di rete', 'Network error'), icon: 'alert' });
    }).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  };

  useEffect(reload, [originF, statusF, query, offset]);

  const blank = () => ({ _new: true, kind: 'percent', value: 10, client: null, expires_at: null });

  const openNew = () => setEdit(blank());
  const openExisting = (c) => setEdit({
    ...c,
    client: c.client_id ? { id: c.client_id, full_name: c.client_name } : null,
    // normalise the API's ISO datetime to a YYYY-MM-DD string for the modal's date input
    expires_at: c.expires_at ? toDateStr(parseISO(c.expires_at)) : null,
  });

  const handleSaved = (msg) => {
    setEdit(null);
    fireToast({ msg, icon: 'check' });
    reload();
  };

  const handleDeleted = () => {
    setEdit(null);
    fireToast({ msg: t('Coupon eliminato', 'Coupon deleted'), icon: 'x' });
    reload();
  };

  return (
    <React.Fragment>
      <div className="t-sm" style={{ color: 'var(--muted)', marginBottom: 16 }}>
        {t('Crea coupon manuali e assegnali ai clienti dalla loro scheda. Quelli con origine “Fedeltà” nascono dal riscatto di un premio.', 'Create manual coupons and assign them from each client’s profile. “Loyalty”-origin ones are minted when a reward is redeemed.')}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <div className="dk-search" style={{ flex: 1, minWidth: 0, width: 'auto' }}>
          <Icon name="search" size={18} color="var(--muted-2)" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Cerca per codice o cliente…', 'Search by code or client…')} />
          {q && <button onClick={() => setQ('')} style={{ cursor: 'pointer', display: 'grid', placeItems: 'center' }}><Icon name="x" size={15} color="var(--muted-2)" /></button>}
        </div>
        <GroupedFilterMenu t={t} groups={[
          { label: t('Origine', 'Origin'), value: originF, set: setOriginF, opts: [['all', t('Tutte', 'All')], ['manual', t('Manuale', 'Manual')], ['auto', t('Automatico', 'Automatic')], ['loyalty', t('Da fedeltà', 'From loyalty')]] },
          { label: t('Stato', 'Status'), value: statusF, set: setStatusF, opts: [['all', t('Tutti', 'All')], ['active', t('Attivi', 'Active')], ['redeemed', t('Utilizzati', 'Redeemed')], ['expired', t('Scaduti', 'Expired')]] },
        ]} />
        {canWrite && <MutationButton className="dk-btn dk-btn--clay" onClick={openNew} style={{ flexShrink: 0 }}><Icon name="plus" size={17} color="#fff" />{t('Nuovo coupon', 'New coupon')}</MutationButton>}
      </div>

      {loading && !items.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {[...Array(6)].map((_, i) => <div key={i} className="skel" style={{ height: 128, borderRadius: 16 }} />)}
        </div>
      ) : items.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {items.map((c) => {
            const om = COUPON_ORIGIN_META[c.origin] || COUPON_ORIGIN_META.manual;
            const sm = COUPON_STATUS_META[c.status] || COUPON_STATUS_META.active;
            return (
              <div key={c.id} className="dk-card dk-hovercard" onClick={() => openExisting(c)}
                style={{ padding: 18, opacity: c.status === 'active' ? 1 : 0.72, borderLeft: '3px solid ' + (c.status === 'active' ? 'var(--clay)' : 'var(--faint)') }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--clay-tint)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                    <Icon name="coupon" size={21} color="var(--clay-ink)" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--ink)', background: 'var(--paper-2)', padding: '3px 9px', borderRadius: 6, display: 'inline-block' }}>{c.code}</span>
                    <div className="t-sm" style={{ color: 'var(--muted)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Icon name="user" size={13} color="var(--muted-2)" />
                      {c.client_name || t('Nessun cliente assegnato', 'No client assigned')}
                    </div>
                  </div>
                  <div className="t-num" style={{ fontSize: 20, color: 'var(--clay-ink)' }}>{couponValueLabel(c, lang)}</div>
                </div>
                <div className="t-sm" style={{ color: 'var(--muted)', marginTop: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Icon name="calendar" size={13} color="var(--muted-2)" />
                  {c.expires_at ? t('Scade il ', 'Expires ') + parseISO(c.expires_at).toLocaleDateString(lang === 'en' ? 'en-GB' : 'it-IT') : t('Nessuna scadenza', 'No expiry')}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--hair)' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color: om.color, background: om.bg, padding: '3px 9px', borderRadius: 99 }}>
                    <Icon name={om.icon} size={12} color={om.color} />{om[lang]}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 700, color: sm.color, background: sm.bg, padding: '2px 8px', borderRadius: 99 }}>{sm[lang]}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState icon="coupon" title={t('Nessun coupon', 'No coupons')} sub={t('Crea il tuo primo coupon.', 'Create your first coupon.')}
          mutationAction action={canWrite ? t('Nuovo coupon', 'New coupon') : null} onAction={openNew} />
      )}

      <Pager count={count} limit={LIMIT} offset={offset} setOffset={setOffset} t={t} />

      {edit && (
        <CouponEditModal
          draft={edit} setDraft={setEdit} onClose={() => setEdit(null)}
          onSaved={handleSaved} onDeleted={handleDeleted} onRedeemed={reload}
          canWrite={canWrite} t={t} lang={lang} fireToast={fireToast}
        />
      )}
    </React.Fragment>
  );
}
