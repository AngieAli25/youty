import { MutationNumInput } from '@youty/shared';
import { withPortalForm } from '@youty/shared';
import { MutationButton } from '@youty/shared';
import React, { useState } from 'react';
import { api, ApiError, Icon, Toggle, NumInput } from '@youty/shared';
import { DkModal, HexInput } from '../../../ui/index.js';
import { inputCss, numCss, segBtn, pillBtn } from '../formStyles.js';
import { LOYALTY_TYPES, EARN_METRICS, REWARD_TYPES, ENROLLMENTS, BONUS_KEYS, LOYALTY_COLORS, composeReward } from '../meta.js';

/** Create/edit a loyalty program mapped to the REAL LoyaltyProgramIn fields:
 * name, type, earn_metric, earn_ratio, reward_type, reward_value, reward_service_id,
 * threshold, enrollment, points_expiry_months, bonus (dict), color, active.
 * Prototype-only concepts with no API fields (audience tags/clients, custom icon,
 * membership fee €, earn "valid on services/products", free-text reward/description)
 * are omitted — listed as gaps in the section report. DELETE is a soft-deactivate. */
function LoyaltyEditModal({ draft, setDraft, onClose, onSaved, onDeactivated, canWrite, t, lang, fireToast, services }) {
  const [saving, setSaving] = useState(false);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const isNew = !!draft._new;
  const isPts = draft.type === 'points';
  const svcName = (s) => (lang === 'en' ? (s.name_en || s.name_it) : s.name_it);
  const rewardServiceName = () => {
    const s = services.find((x) => x.id === draft.reward_service_id);
    return s ? svcName(s) : null;
  };
  const rewardLabel = composeReward(draft.reward_type, draft.reward_value, rewardServiceName(), lang);
  const needsService = draft.reward_type === 'free_service';
  const needsValue = draft.reward_type === 'coupon_amount' || draft.reward_type === 'discount_pct' || draft.reward_type === 'gift_card';
  const canSave = canWrite && draft.name.trim() && Number(draft.threshold) >= 1
    && (!needsService || !!draft.reward_service_id)
    && (!needsValue || Number(draft.reward_value) > 0);

  const buildPayload = () => ({
    name: draft.name.trim(),
    type: draft.type,
    earn_metric: draft.earn_metric,
    earn_ratio: Number(draft.earn_ratio || 1).toFixed(2),
    reward_type: draft.reward_type,
    reward_value: needsValue ? Number(draft.reward_value || 0).toFixed(2) : '0.00',
    reward_service_id: needsService ? draft.reward_service_id : null,
    threshold: Math.max(1, Math.round(Number(draft.threshold) || 1)),
    enrollment: draft.enrollment,
    points_expiry_months: Number(draft.points_expiry_months) || 0,
    bonus: draft.bonus || {},
    color: draft.color || '#6366F1',
    active: !!draft.active,
  });

  const save = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      if (isNew) {
        await api.post('/api/marketing/loyalty-programs', buildPayload());
      } else {
        await api.put(`/api/marketing/loyalty-programs/${draft.id}`, buildPayload());
      }
      onSaved(isNew ? t('Programma creato', 'Program created') : t('Programma aggiornato', 'Program updated'));
    } catch (err) {
      fireToast({ msg: err instanceof ApiError ? err.message : t('Errore di rete', 'Network error'), icon: 'alert' });
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await api.del(`/api/marketing/loyalty-programs/${draft.id}`);
      onDeactivated();
    } catch (err) {
      fireToast({ msg: err instanceof ApiError ? err.message : t('Errore di rete', 'Network error'), icon: 'alert' });
      setSaving(false);
    }
  };

  const toggleBonus = (k) => set({ bonus: { ...(draft.bonus || {}), [k]: !(draft.bonus || {})[k] } });
  const unit = draft.type === 'stamps' ? t('timbri', 'stamps') : 'pt';

  return (
    <DkModal open onClose={onClose} title={isNew ? t('Nuovo programma fedeltà', 'New loyalty program') : t('Modifica programma', 'Edit program')}
      sub={t('Regole di accumulo e premio', 'Earning rules and reward')} width={820}
      foot={<React.Fragment>
        {!isNew && canWrite && draft.active && (
          <MutationButton className="dk-btn dk-btn--ghost" style={{ color: 'var(--danger)', borderColor: 'color-mix(in srgb, var(--danger) 40%, var(--hair))', marginRight: 'auto' }} onClick={deactivate} disabled={saving}>
            <Icon name="x" size={16} color="var(--danger)" />{t('Disattiva', 'Deactivate')}
          </MutationButton>
        )}
        <button className="dk-btn dk-btn--ghost" onClick={onClose}>{t('Annulla', 'Cancel')}</button>
        {canWrite && <MutationButton className="dk-btn dk-btn--clay" disabled={!canSave || saving} onClick={save}><Icon name="check" size={17} color="#fff" />{t('Salva', 'Save')}</MutationButton>}
      </React.Fragment>}>

      <input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder={t('Nome programma', 'Program name')}
        style={{ border: 'none', borderBottom: '2px solid var(--hair)', outline: 'none', fontSize: 20, fontWeight: 700, fontFamily: 'var(--serif)', padding: '6px 0', background: 'transparent', width: '100%', marginBottom: 16 }} />

      <div className="t-meta" style={{ marginBottom: 8 }}>{t('Tipo di programma', 'Program type')}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
        {LOYALTY_TYPES.map((tp) => {
          const on = draft.type === tp.k;
          return (
            <button key={tp.k} onClick={() => set({ type: tp.k })}
              style={{ textAlign: 'left', padding: '13px', borderRadius: 12, cursor: 'pointer', border: '1.5px solid ' + (on ? 'var(--clay)' : 'var(--hair)'), background: on ? 'var(--clay-tint)' : 'var(--surface)' }}>
              <Icon name={tp.icon} size={19} color={on ? 'var(--clay-ink)' : 'var(--muted)'} />
              <div style={{ fontWeight: 700, fontSize: 13.5, marginTop: 6 }}>{tp[lang]}</div>
              <div className="t-sm" style={{ color: 'var(--muted)', marginTop: 2, lineHeight: 1.35 }}>{tp.hint[lang]}</div>
            </button>
          );
        })}
      </div>

      {isPts && (
        <div style={{ marginBottom: 16 }}>
          <div className="t-meta" style={{ marginBottom: 8 }}>{t('I punti si accumulano per', 'Points are earned per')}</div>
          <div style={{ display: 'flex', gap: 7 }}>
            {EARN_METRICS.map((m) => (
              <button key={m.k} onClick={() => set({ earn_metric: m.k })} style={{ ...segBtn(draft.earn_metric === m.k), padding: '9px', fontSize: 12.5, borderRadius: 9 }}>{m[lang]}</button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: isPts && draft.earn_metric === 'per_euro' ? '1fr 1fr' : '1fr', gap: 12, marginBottom: 16 }}>
        {isPts && draft.earn_metric === 'per_euro' && (
          <div>
            <div className="t-meta" style={{ marginBottom: 6 }}>{t('Punti per €1', 'Points per €1')}</div>
            <div style={numCss}>
              <MutationNumInput min={0} value={draft.earn_ratio} onChange={(earn_ratio) => set({ earn_ratio })}
                style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 16, fontWeight: 700, width: 60 }} />
              <span className="t-sm" style={{ color: 'var(--muted-2)', fontWeight: 600 }}>pt/€</span>
            </div>
          </div>
        )}
        <div>
          <div className="t-meta" style={{ marginBottom: 6 }}>
            {draft.type === 'tiers' ? t('Soglia primo livello', 'First tier threshold')
              : draft.type === 'membership' ? t('Soglia vantaggio', 'Perk threshold')
                : isPts ? t('Punti per il premio', 'Points for reward') : t('Timbri per il premio', 'Stamps for reward')}
          </div>
          <div style={numCss}>
            <MutationNumInput integer min={1} value={draft.threshold} onChange={(threshold) => set({ threshold })}
              style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 16, fontWeight: 700, width: 70 }} />
            <span className="t-sm" style={{ color: 'var(--muted-2)', fontWeight: 600 }}>{unit}</span>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div className="t-meta" style={{ marginBottom: 8 }}>{t('Tipo di premio', 'Reward type')}</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {REWARD_TYPES.map((rk) => (
            <button key={rk.k} onClick={() => set({ reward_type: rk.k })} style={{ ...segBtn(draft.reward_type === rk.k), padding: '9px', fontSize: 13 }}>{rk[lang]}</button>
          ))}
        </div>
        {needsService ? (
          <select value={draft.reward_service_id || ''} onChange={(e) => set({ reward_service_id: e.target.value ? Number(e.target.value) : null })} style={{ ...inputCss, cursor: 'pointer' }}>
            <option value="">{t('Scegli il servizio in omaggio…', 'Pick the free service…')}</option>
            {services.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{svcName(s)}</option>)}
          </select>
        ) : needsValue ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={numCss}>
              {draft.reward_type !== 'discount_pct' && <span className="t-sm" style={{ color: 'var(--muted-2)', fontWeight: 700 }}>€</span>}
              <MutationNumInput min={0} max={draft.reward_type === 'discount_pct' ? 100 : undefined} value={draft.reward_value} onChange={(reward_value) => set({ reward_value })}
                style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 16, fontWeight: 700, width: 64 }} />
              {draft.reward_type === 'discount_pct' && <span className="t-sm" style={{ color: 'var(--muted-2)', fontWeight: 700 }}>%</span>}
            </div>
            <div className="t-sm" style={{ color: 'var(--muted)' }}>{t('Mostrato come', 'Shown as')}: <b style={{ color: 'var(--clay-ink)' }}>{rewardLabel}</b></div>
          </div>
        ) : (
          <div className="t-sm" style={{ color: 'var(--muted)' }}>{t('Mostrato come', 'Shown as')}: <b style={{ color: 'var(--clay-ink)' }}>{rewardLabel}</b></div>
        )}
        <div className="t-sm" style={{ color: 'var(--muted-2)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
          <Icon name="coupon" size={12} color="var(--muted-2)" />{t('Al riscatto, il premio genera un coupon con origine “Fedeltà”.', 'On redemption, the reward generates a coupon with origin “Loyalty”.')}
        </div>
      </div>

      {/* visual presentation — colour + live preview */}
      <div style={{ padding: '16px', background: 'var(--surface-2)', borderRadius: 12, marginBottom: 16 }}>
        <div className="t-meta" style={{ marginBottom: 3 }}>{t('Presentazione visiva', 'Visual presentation')}</div>
        <div className="t-sm" style={{ color: 'var(--muted)', marginBottom: 13 }}>{t('Come appare la tessera fedeltà alla cliente.', 'How the loyalty card looks to the client.')}</div>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="t-sm" style={{ fontWeight: 700, color: 'var(--muted)', marginBottom: 7 }}>{t('Colore', 'Colour')}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <label title={t('Ruota dei colori', 'Colour wheel')} style={{ position: 'relative', width: 34, height: 34, borderRadius: 9, cursor: 'pointer', overflow: 'hidden', flexShrink: 0, border: '1px solid var(--hair)', background: draft.color || LOYALTY_COLORS[0] }}>
                <input type="color" value={draft.color || LOYALTY_COLORS[0]} onChange={(e) => set({ color: e.target.value })} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
              </label>
              <HexInput value={draft.color || LOYALTY_COLORS[0]} onChange={(c) => set({ color: c })} width={70} />
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 280 }}>
              {LOYALTY_COLORS.map((c) => {
                const on = (draft.color || '').toLowerCase() === c.toLowerCase();
                return <button key={c} onClick={() => set({ color: c })} title={c}
                  style={{ width: 24, height: 24, borderRadius: 6, background: c, cursor: 'pointer', border: '1px solid transparent', outline: on ? '2px solid var(--ink)' : 'none', outlineOffset: 1, flexShrink: 0 }} />;
              })}
            </div>
          </div>
          <div style={{ width: 210, flexShrink: 0 }}>
            <div className="t-sm" style={{ fontWeight: 700, color: 'var(--muted)', marginBottom: 7 }}>{t('Anteprima', 'Preview')}</div>
            <div style={{ borderRadius: 14, padding: 16, color: '#fff', background: `linear-gradient(135deg, ${draft.color || LOYALTY_COLORS[0]}, color-mix(in srgb, ${draft.color || LOYALTY_COLORS[0]} 70%, #000))` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <Icon name="star" size={20} color="#fff" />
                <span style={{ fontWeight: 700, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{draft.name || t('Programma fedeltà', 'Loyalty program')}</span>
              </div>
              <div style={{ height: 6, borderRadius: 99, background: 'rgba(255,255,255,0.3)', overflow: 'hidden', marginBottom: 8 }}>
                <div style={{ height: '100%', width: '60%', background: '#fff', borderRadius: 99 }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, opacity: 0.9 }}>
                <span>{Math.round((Number(draft.threshold) || 100) * 0.6)}/{draft.threshold || 100} {unit}</span>
                <span style={{ fontWeight: 700 }}>{rewardLabel}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* general rules */}
      <div style={{ padding: '14px 16px', background: 'var(--surface-2)', borderRadius: 12, marginBottom: 16 }}>
        <div className="t-meta" style={{ marginBottom: 11 }}>{t('Regole generali', 'General rules')}</div>
        <div className="t-sm" style={{ fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>{t('Iscrizione', 'Enrollment')}</div>
        <div style={{ display: 'flex', gap: 7, marginBottom: 13 }}>
          {ENROLLMENTS.map((e) => (
            <button key={e.k} onClick={() => set({ enrollment: e.k })} style={{ ...segBtn(draft.enrollment === e.k), padding: '8px', fontSize: 12.5, borderRadius: 9 }}>{e[lang]}</button>
          ))}
        </div>
        <div className="t-sm" style={{ fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>{t('Scadenza punti', 'Points expiry')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 14 }}>
          {[[0, t('Mai', 'Never')], [6, t('6 mesi', '6 months')], [12, t('12 mesi', '12 months')], [24, t('24 mesi', '24 months')]].map(([m, l]) => (
            <button key={m} onClick={() => set({ points_expiry_months: m })} style={pillBtn(Number(draft.points_expiry_months) === m)}>{l}</button>
          ))}
        </div>
        <div className="t-sm" style={{ fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>{t('Punti bonus', 'Bonus points')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {BONUS_KEYS.map((b) => {
            const on = !!(draft.bonus || {})[b.k];
            return (
              <button key={b.k} onClick={() => toggleBonus(b.k)} style={{ ...pillBtn(on), display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {on && <Icon name="check" size={12} color="var(--clay-ink)" />}{b[lang]}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: 'var(--surface-2)', borderRadius: 12 }}>
        <div style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{t('Programma attivo', 'Program active')}</div>
        <Toggle on={!!draft.active} onChange={(v) => set({ active: v })} />
      </div>
    </DkModal>
  );
}

export default withPortalForm(LoyaltyEditModal, { preview: ({ draft }) => !!draft?.id });
