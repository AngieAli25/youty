import { withPortalForm } from '@youty/shared';
import { MutationNumInput } from '@youty/shared';
import { MutationToggle } from '@youty/shared';
import { MutationButton } from '@youty/shared';
// DepositRules.jsx — CRUD on /api/core/deposit-rules (owner-only, read included).
// Port of DkDepositRules / DkDepositRuleCard with the API conditions model:
// { op: 'and'|'or', rules: [{ field, cmp, value }] } + amount_type pct|fixed.
import React, { useCallback, useEffect, useState } from 'react';
import { api, Icon, Toggle, NumInput } from '@youty/shared';
import DkSeg from '../../ui/DkSeg.jsx';
import { useDash } from '../../ctx.jsx';
import { DkCondRow, depositFields, ruleSentence, inputCss, toastErr, LockNote } from './lib.jsx';

function DepositRules() {
  const { t, lang, session, operationalAccess, clientCategories, fireToast } = useDash();
  const isOwner = !!session?.is_owner;
  const [rules, setRules] = useState(null);   // null = loading
  const [openId, setOpenId] = useState(null);
  const fields = depositFields(clientCategories, t, lang);

  const load = useCallback(async () => {
    try { setRules(await api.get('/api/core/deposit-rules')); }
    catch (err) { toastErr(err, fireToast, t); setRules([]); }
  }, [fireToast, t]);
  useEffect(() => { if (isOwner) load(); }, [isOwner, load]);

  if (!isOwner) {
    return (
      <div style={{ padding: '14px 16px' }}>
        <LockNote t={t} msg={t('Le regole deposito sono riservate al titolare.', 'Deposit rules are reserved to the owner.')} />
      </div>
    );
  }

  const add = async () => {
    try {
      const created = await api.post('/api/core/deposit-rules', {
        name: t('Nuova regola', 'New rule'),
        conditions: { op: 'and', rules: [{ field: 'reliability', cmp: 'lt', value: 60 }] },
        amount_type: 'pct',
        amount: '30.00',
        priority: (rules || []).length,
        active: true,
      });
      setRules((l) => [...(l || []), created]);
      setOpenId(created.id);
    } catch (err) { toastErr(err, fireToast, t); }
  };

  const save = async (id, payload) => {
    try {
      const upd = await api.put(`/api/core/deposit-rules/${id}`, payload);
      setRules((l) => l.map((r) => (r.id === id ? upd : r)));
      return upd;
    } catch (err) { toastErr(err, fireToast, t); return null; }
  };

  const del = async (id) => {
    try {
      await api.del(`/api/core/deposit-rules/${id}`);
      setRules((l) => l.filter((r) => r.id !== id));
      if (openId === id) setOpenId(null);
      fireToast({ msg: t('Regola eliminata', 'Rule deleted'), icon: 'x' });
    } catch (err) { toastErr(err, fireToast, t); }
  };

  return (
    <div style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 14 }}>
        <Icon name="coupon" size={19} color="var(--muted)" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14.5 }}>{t('Regole deposito', 'Deposit rules')}</div>
          <div className="t-sm" style={{ color: 'var(--muted)' }}>{t('A chi richiedere un acconto. Si applicano in automatico alla prenotazione.', 'Who is asked for a deposit. Applied automatically at booking.')}</div>
        </div>
        <MutationButton className="dk-btn dk-btn--clay" style={{ flexShrink: 0 }} onClick={add}><Icon name="plus" size={16} color="#fff" />{t('Nuova regola deposito', 'New deposit rule')}</MutationButton>
      </div>

      {rules === null ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[0, 1].map((i) => <div key={i} className="skel" style={{ height: 54, borderRadius: 12 }} />)}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rules.map((r) => (
            <RuleCard key={r.id} rule={r} fields={fields} open={openId === r.id}
              onToggleOpen={() => setOpenId(openId === r.id ? null : r.id)}
              onSave={(payload) => save(r.id, payload)} onDelete={() => del(r.id)}
              t={t} lang={lang} fireToast={fireToast} />
          ))}
          {!rules.length && <div className="t-sm" style={{ color: 'var(--muted-2)', padding: '10px 2px' }}>{t('Nessuna regola. Creane una per proporre acconti in automatico.', 'No rules yet. Create one to suggest deposits automatically.')}</div>}
        </div>
      )}

      <div className="t-sm" style={{ color: 'var(--muted-2)', marginTop: 12, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <Icon name="info" size={13} color="var(--muted-2)" style={{ marginTop: 1, flexShrink: 0 }} />
        <span>{t('Vince la prima regola attiva in ordine di priorità (0 = più alta); le clienti con "deposito sempre" usano comunque la prima regola attiva. L’acconto resta modificabile sul singolo appuntamento.', 'The first active rule by priority wins (0 = highest); clients flagged "always deposit" use the first active rule anyway. The deposit can still be changed on each appointment.')}</span>
      </div>
    </div>
  );
}

let CID = 1;
const newCondId = () => 'c' + (CID++);

function RuleCard({ rule, fields, open, onToggleOpen, onSave, onDelete, t, lang, fireToast }) {
  // draft: local editable copy (conditions rules get client-side ids for React keys)
  const toDraft = (r) => ({
    name: r.name,
    op: (r.conditions && r.conditions.op) || 'and',
    conds: (((r.conditions && r.conditions.rules) || [])).map((x) => ({ _id: newCondId(), ...x })),
    amount_type: r.amount_type,
    amount: Number(r.amount) || 0,
    priority: r.priority || 0,
  });
  const [draft, setDraft] = useState(() => toDraft(rule));
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setDraft(toDraft(rule)); setDirty(false); }, [rule]); // eslint-disable-line react-hooks/exhaustive-deps

  const upd = (patch) => { setDraft((d) => ({ ...d, ...patch })); setDirty(true); };
  const setConds = (fn) => { setDraft((d) => ({ ...d, conds: fn(d.conds) })); setDirty(true); };
  const addCond = () => setConds((cs) => [...cs, { _id: newCondId(), field: 'reliability', cmp: 'lt', value: 60 }]);
  const updCond = (id, patch) => setConds((cs) => cs.map((c) => (c._id === id ? { ...c, ...patch } : c)));
  const rmCond = (id) => setConds((cs) => cs.filter((c) => c._id !== id));

  const QUICK = [
    [t('A rischio', 'At risk'), { field: 'reliability', cmp: 'lt', value: 60 }],
    [t('Prima visita', 'First visit'), { field: 'visits', cmp: 'lt', value: 1 }],
    [t('Con no-show', 'With no-shows'), { field: 'noshow_count', cmp: 'gte', value: 1 }],
    [t('Deposito sempre', 'Always deposit'), { field: 'deposit_always', cmp: 'eq', value: true }],
  ];
  const quickOn = (c) => draft.conds.length === 1 && draft.conds[0].field === c.field && draft.conds[0].cmp === c.cmp && draft.conds[0].value === c.value;

  const draftConditions = { op: draft.op, rules: draft.conds.map(({ _id, ...rest }) => rest) };
  const sentence = ruleSentence(draftConditions, fields, t, lang);
  const amtTxt = draft.amount_type === 'pct' ? draft.amount + '%' : '€' + draft.amount;

  const toggleActive = async (v) => {
    const upd2 = await onSave({
      name: rule.name, conditions: rule.conditions, amount_type: rule.amount_type,
      amount: rule.amount, priority: rule.priority, active: v,
    });
    if (upd2) fireToast({ msg: v ? t('Regola attivata', 'Rule enabled') : t('Regola disattivata', 'Rule disabled'), icon: 'check' });
  };

  const saveDraft = async () => {
    const upd2 = await onSave({
      name: (draft.name || '').trim() || t('Regola deposito', 'Deposit rule'),
      conditions: draftConditions,
      amount_type: draft.amount_type,
      amount: Number(draft.amount).toFixed(2),
      priority: draft.priority,
      active: rule.active,
    });
    if (upd2) { setDirty(false); fireToast({ msg: t('Regola salvata', 'Rule saved'), icon: 'check' }); }
  };

  return (
    <div className="dk-card" style={{ boxShadow: 'none', border: '1px solid var(--hair)', borderLeft: '3px solid ' + (rule.active ? 'var(--clay)' : 'var(--faint)'), opacity: rule.active ? 1 : 0.65 }}>
      {/* compact row — the rule as a sentence */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 14px', cursor: 'pointer' }} onClick={onToggleOpen}>
        <span onClick={(e) => e.stopPropagation()}><MutationToggle on={rule.active} onChange={toggleActive} /></span>
        <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, lineHeight: 1.45 }}>
          <span style={{ fontWeight: 800, fontSize: 11, letterSpacing: '0.08em', color: 'var(--clay-ink)', background: 'var(--clay-tint)', padding: '2px 7px', borderRadius: 6, marginRight: 7 }}>{t('SE', 'IF')}</span>
          <strong>{sentence}</strong>
          <span style={{ color: 'var(--muted)' }}> → {t('acconto', 'deposit')} {amtTxt} · {t('priorità', 'priority')} {draft.priority}</span>
        </div>
        <MutationButton className="dk-iconbtn" onClick={(e) => { e.stopPropagation(); onDelete(); }} title={t('Elimina regola', 'Delete rule')} style={{ width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center', color: 'var(--muted)', flexShrink: 0 }}><Icon name="x" size={14} /></MutationButton>
        <Icon name="chevD" size={16} color="var(--muted-2)" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 160ms', flexShrink: 0 }} />
      </div>

      {open && (
        <div style={{ padding: '2px 14px 16px', borderTop: '1px solid var(--hair)' }}>
          {/* name */}
          <div className="t-meta" style={{ margin: '13px 0 8px' }}>{t('Nome regola', 'Rule name')}</div>
          <input value={draft.name} onChange={(e) => upd({ name: e.target.value })} placeholder={t('es. Affidabilità bassa', 'e.g. Low reliability')} style={{ ...inputCss, width: '100%', boxSizing: 'border-box' }} />

          {/* conditions */}
          <div className="t-meta" style={{ margin: '16px 0 8px' }}>{t('Condizioni · a chi si applica', 'Conditions · who it applies to')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 12 }}>
            {QUICK.map(([label, cond]) => {
              const on = quickOn(cond);
              return <MutationButton key={label} onClick={() => setConds(() => [{ _id: newCondId(), ...cond }])} style={{ padding: '7px 13px', borderRadius: 99, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', border: '1px solid ' + (on ? 'var(--ink)' : 'var(--hair)'), background: on ? 'var(--ink)' : 'var(--surface)', color: on ? '#fff' : 'var(--ink-2)' }}>{label}</MutationButton>;
            })}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {draft.conds.map((c, i) => (
              <React.Fragment key={c._id}>
                {i > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0' }}>
                    <div className="dk-seg" style={{ padding: 3 }}>
                      {[['and', t('E', 'AND')], ['or', t('O', 'OR')]].map(([k, l]) => (
                        <MutationButton key={k} className={draft.op === k ? 'on' : ''} style={{ height: 26, padding: '0 12px', fontSize: 11.5 }} onClick={() => upd({ op: k })}>{l}</MutationButton>
                      ))}
                    </div>
                    <div style={{ flex: 1, height: 1, background: 'var(--hair)' }} />
                  </div>
                )}
                <DkCondRow rule={c} onChange={(p) => updCond(c._id, p)} onRemove={() => rmCond(c._id)} t={t} lang={lang} fields={fields} />
              </React.Fragment>
            ))}
            {!draft.conds.length && <div className="t-sm" style={{ color: 'var(--muted-2)', padding: '4px 2px' }}>{t('Nessuna condizione: la regola vale per tutte le clienti.', 'No conditions: the rule applies to every client.')}</div>}
          </div>
          <MutationButton className="dk-btn dk-btn--soft" style={{ height: 34, fontSize: 12.5, marginTop: 10 }} onClick={addCond}><Icon name="plus" size={14} />{t('Aggiungi condizione', 'Add condition')}</MutationButton>

          {/* amount */}
          <div className="t-meta" style={{ margin: '18px 0 8px' }}>{t('Importo dell’acconto', 'Deposit amount')}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <DkSeg value={draft.amount_type} onChange={(v) => upd({ amount_type: v })} options={[{ value: 'pct', label: t('% del totale', '% of total') }, { value: 'fixed', label: t('Importo fisso', 'Fixed amount') }]} />
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--hair)', borderRadius: 9, padding: '0 10px', height: 36, background: 'var(--surface)' }}>
              {draft.amount_type === 'fixed' && <span className="t-sm" style={{ color: 'var(--muted-2)', fontWeight: 700 }}>€</span>}
              <MutationNumInput value={draft.amount} min={0} integer={draft.amount_type === 'pct'} max={draft.amount_type === 'pct' ? 100 : undefined} onChange={(amount) => upd({ amount })} style={{ width: 52, border: 'none', outline: 'none', background: 'transparent', fontSize: 14.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }} />
              {draft.amount_type === 'pct' && <span className="t-sm" style={{ color: 'var(--muted-2)', fontWeight: 700 }}>%</span>}
            </div>
          </div>

          {/* priority */}
          <div className="t-meta" style={{ margin: '16px 0 8px' }}>{t('Priorità', 'Priority')}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--hair)', borderRadius: 9, padding: '0 10px', height: 36, background: 'var(--surface)' }}>
              <MutationNumInput integer min={0} value={draft.priority} onChange={(priority) => upd({ priority })} style={{ width: 44, border: 'none', outline: 'none', background: 'transparent', fontSize: 14.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }} />
            </div>
            <span className="t-sm" style={{ color: 'var(--muted)' }}>{t('0 = valutata per prima', '0 = evaluated first')}</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <MutationButton className="dk-btn dk-btn--clay" disabled={!dirty} style={{ opacity: dirty ? 1 : 0.5 }} onClick={saveDraft}><Icon name="check" size={16} color="#fff" />{t('Salva regola', 'Save rule')}</MutationButton>
          </div>
        </div>
      )}
    </div>
  );
}

export default withPortalForm(DepositRules, { preview: () => true, framed: false, overlay: false });
