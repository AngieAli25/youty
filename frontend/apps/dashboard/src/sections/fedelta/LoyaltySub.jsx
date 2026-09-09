import { MutationButton } from '@youty/shared';
import React, { useEffect, useState } from 'react';
import { api, ApiError, Icon, EmptyState } from '@youty/shared';
import { useDash } from '../../ctx.jsx';
import LoyaltyEditModal from './modals/LoyaltyEditModal.jsx';
import LoyaltyMembersDrawer from './LoyaltyMembersDrawer.jsx';
import { LOYALTY_TYPES, composeReward } from './meta.js';

export default function LoyaltySub() {
  const { t, lang, hasScope, canMutate, fireToast, services, setDrawer } = useDash();
  const canWrite = hasScope('marketing');

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState(null);

  const reload = () => {
    setLoading(true);
    api.get('/api/marketing/loyalty-programs')
      .then((res) => setItems(res || []))
      .catch((err) => {
        setItems([]);
        fireToast({ msg: err instanceof ApiError ? err.message : t('Errore di rete', 'Network error'), icon: 'alert' });
      })
      .finally(() => setLoading(false));
  };

  useEffect(reload, []);

  const blank = () => ({
    _new: true, name: '', type: 'points', earn_metric: 'per_euro', earn_ratio: 1,
    reward_type: 'coupon_amount', reward_value: 10, reward_service_id: null,
    threshold: 100, enrollment: 'auto', points_expiry_months: 0, bonus: {},
    color: '#6366F1', active: true,
  });

  const openNew = () => setEdit(blank());
  const openExisting = (p) => setEdit({ ...p, bonus: { ...(p.bonus || {}) } });

  const handleSaved = (msg) => {
    setEdit(null);
    fireToast({ msg, icon: 'check' });
    reload();
  };

  const handleDeactivated = () => {
    setEdit(null);
    fireToast({ msg: t('Programma disattivato', 'Program deactivated'), icon: 'x' });
    reload();
  };

  const openMembers = (p) => setDrawer(
    <LoyaltyMembersDrawer program={p} onClose={() => setDrawer(null)} t={t} lang={lang} fireToast={fireToast} />
  );

  const serviceName = (id) => {
    const s = services.find((x) => x.id === id);
    return s ? (lang === 'en' ? (s.name_en || s.name_it) : s.name_it) : null;
  };

  return (
    <React.Fragment>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div className="t-sm" style={{ color: 'var(--muted)', maxWidth: 560 }}>
          {t('Crea percorsi fedeltà a punti, timbri, livelli o membership. Il progresso di ogni cliente è visibile nella sua scheda.', 'Create points, stamps, tier or membership loyalty paths. Each client’s progress shows on their profile.')}
        </div>
        {canWrite && <MutationButton className="dk-btn dk-btn--clay" onClick={openNew} style={{ flexShrink: 0 }}><Icon name="plus" size={17} color="#fff" />{t('Nuovo programma', 'New program')}</MutationButton>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 16px', background: 'var(--clay-tint)', borderRadius: 12, marginBottom: 18 }}>
        <Icon name="star" size={17} color="var(--clay-ink)" />
        <div style={{ fontSize: 13.5, color: 'var(--clay-ink)', lineHeight: 1.45 }}>
          <strong>{t('Premio raggiunto = coupon.', 'Reward reached = coupon.')}</strong> {t('Quando accumula abbastanza punti/timbri, il sistema genera un coupon con origine “Fedeltà” per la cliente.', 'Once enough points/stamps are earned, the system mints a coupon with origin “Loyalty” for the client.')}
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
          {[...Array(3)].map((_, i) => <div key={i} className="skel" style={{ height: 210, borderRadius: 16 }} />)}
        </div>
      ) : items.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
          {items.map((p) => {
            const typeMeta = LOYALTY_TYPES.find((x) => x.k === p.type) || LOYALTY_TYPES[0];
            const unit = (p.type === 'points' || p.type === 'tiers' || p.type === 'membership') ? 'pt' : t('timbri', 'stamps');
            const rewardLabel = composeReward(p.reward_type, p.reward_value, serviceName(p.reward_service_id), lang);
            return (
              <div key={p.id} className="dk-card dk-hovercard" onClick={() => openExisting(p)} style={{ padding: 20, opacity: p.active ? 1 : 0.6 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: `color-mix(in srgb, ${p.color || 'var(--clay-ink)'} 16%, transparent)`, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                    <Icon name={typeMeta.icon} size={22} color={p.color || 'var(--clay-ink)'} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{p.name}</div>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 5, fontSize: 11.5, fontWeight: 700, color: 'var(--ink-2)', background: 'var(--paper-2)', padding: '3px 9px', borderRadius: 99 }}>{typeMeta[lang]}</span>
                  </div>
                  {!p.active && <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', background: 'var(--paper-2)', padding: '2px 8px', borderRadius: 99 }}>{t('Off', 'Off')}</span>}
                </div>

                <button className="t-sm" onClick={(e) => { e.stopPropagation(); openMembers(p); }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, color: 'var(--ink-2)', background: 'var(--surface-2)', padding: '5px 11px', borderRadius: 99, marginBottom: 14, cursor: 'pointer' }}>
                  <Icon name="clients" size={13} color="var(--muted-2)" />
                  {p.accounts_count} {p.accounts_count === 1 ? t('cliente iscritta', 'enrolled client') : t('clienti iscritte', 'enrolled clients')}
                  <Icon name="chevR" size={11} color="var(--muted-2)" />
                </button>

                <div style={{ display: 'flex', gap: 10 }}>
                  <div style={{ flex: 1, background: 'var(--surface-2)', borderRadius: 10, padding: '10px 12px' }}>
                    <div className="t-meta" style={{ fontSize: 9.5, marginBottom: 3 }}>{t('Traguardo', 'Threshold')}</div>
                    <div className="t-num" style={{ fontSize: 17 }}>{p.threshold} {unit}</div>
                  </div>
                  <div style={{ flex: 1.4, background: 'var(--surface-2)', borderRadius: 10, padding: '10px 12px' }}>
                    <div className="t-meta" style={{ fontSize: 9.5, marginBottom: 3 }}>{t('Premio', 'Reward')}</div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{rewardLabel}</div>
                  </div>
                </div>
                <div className="t-sm" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, paddingTop: 11, borderTop: '1px solid var(--hair)', color: 'var(--muted)' }}>
                  <Icon name="coupon" size={13} color="var(--clay-ink)" />{t('Al riscatto → genera un coupon (origine “Fedeltà”)', 'On redemption → generates a coupon (origin “Loyalty”)')}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState icon="star" title={t('Nessun programma', 'No programs')} sub={t('Crea il primo percorso fedeltà.', 'Create your first loyalty path.')}
          mutationAction action={canWrite ? t('Nuovo programma', 'New program') : null} onAction={openNew} />
      )}

      {edit && (
        <LoyaltyEditModal
          draft={edit} setDraft={setEdit} onClose={() => setEdit(null)}
          onSaved={handleSaved} onDeactivated={handleDeactivated}
          canWrite={canWrite} t={t} lang={lang} fireToast={fireToast} services={services}
        />
      )}
    </React.Fragment>
  );
}
