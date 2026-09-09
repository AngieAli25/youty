import { MutationInput } from '@youty/shared';
import { MutationButton } from '@youty/shared';
// RolesDrawer.jsx — port of RolesManager on /api/auth/roles (scope 'team').
// Scope checkboxes come from the known API scope list; system roles read-only.
// Keeps the prototype's local "revenue summary visible" UI toggle (ctx showRevenue).
import React, { useCallback, useEffect, useState } from 'react';
import { api, Icon } from '@youty/shared';
import DkDrawer from '../../ui/DkDrawer.jsx';
import { useDash } from '../../ctx.jsx';
import { inputCss, toastErr, LockNote } from './lib.jsx';

// known scopes (common/permissions.py) with bilingual labels
export const SCOPES = [
  { id: 'agenda', it: 'Agenda e appuntamenti', en: 'Agenda & appointments' },
  { id: 'clients', it: 'Schede cliente', en: 'Client records' },
  { id: 'sales', it: 'Vendite e checkout', en: 'Sales & checkout' },
  { id: 'inventory', it: 'Magazzino e rettifiche', en: 'Inventory & adjustments' },
  { id: 'pricing', it: 'Listino e prezzi', en: 'Pricing & price list' },
  { id: 'marketing', it: 'Coupon, fedeltà e marketing', en: 'Coupons, loyalty & marketing' },
  { id: 'team', it: 'Team e permessi', en: 'Team & permissions' },
  { id: 'activity_log', it: 'Registro attività', en: 'Activity log' },
  { id: 'insights', it: 'Analisi dati', en: 'Insights' },
];

export default function RolesDrawer({ onClose }) {
  const { t, lang, hasScope, canMutate, showRevenue, setShowRevenue, fireToast } = useDash();
  const canTeam = hasScope('team');
  const [roles, setRoles] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [drafts, setDrafts] = useState({}); // roleId → {name, scopes}

  const load = useCallback(async () => {
    try {
      const r = await api.get('/api/auth/roles');
      setRoles(r);
      setDrafts(Object.fromEntries(r.map((x) => [x.id, { name: x.name, scopes: [...x.scopes] }])));
    } catch (err) { toastErr(err, fireToast, t); setRoles([]); }
  }, [fireToast, t]);
  useEffect(() => { if (canTeam) load(); }, [canTeam, load]);

  const addRole = async () => {
    try {
      const created = await api.post('/api/auth/roles', { name: t('Nuovo ruolo', 'New role'), scopes: ['agenda'] });
      setRoles((l) => [...l, created]);
      setDrafts((d) => ({ ...d, [created.id]: { name: created.name, scopes: [...created.scopes] } }));
      setOpenId(created.id);
      fireToast({ msg: t('Ruolo creato · imposta i permessi', 'Role created · set permissions'), icon: 'check' });
    } catch (err) { toastErr(err, fireToast, t); }
  };

  const saveRole = async (role) => {
    const d = drafts[role.id];
    if (!d || !d.name.trim()) return;
    try {
      const upd = await api.put(`/api/auth/roles/${role.id}`, { name: d.name.trim(), scopes: d.scopes });
      setRoles((l) => l.map((r) => (r.id === role.id ? upd : r)));
      setDrafts((ds) => ({ ...ds, [role.id]: { name: upd.name, scopes: [...upd.scopes] } }));
      fireToast({ msg: t('Permessi salvati per ', 'Permissions saved for ') + upd.name, icon: 'check' });
    } catch (err) { toastErr(err, fireToast, t); }
  };

  const delRole = async (role) => {
    try {
      await api.del(`/api/auth/roles/${role.id}`);
      setRoles((l) => l.filter((r) => r.id !== role.id));
      if (openId === role.id) setOpenId(null);
      fireToast({ msg: t('Ruolo eliminato', 'Role deleted'), icon: 'x' });
    } catch (err) { toastErr(err, fireToast, t); } // 400 if system
  };

  const toggleScope = (roleId, sid) => setDrafts((ds) => {
    const d = ds[roleId];
    const scopes = d.scopes.includes(sid) ? d.scopes.filter((x) => x !== sid) : [...d.scopes, sid];
    return { ...ds, [roleId]: { ...d, scopes } };
  });

  return (
    <DkDrawer open onClose={onClose}>
      <div style={{ padding: '22px 22px 18px', borderBottom: '1px solid var(--hair)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--serif)', fontSize: 21, fontWeight: 500 }}>{t('Ruoli e permessi', 'Roles & permissions')}</div>
          <div className="t-sm" style={{ color: 'var(--muted)', marginTop: 2 }}>{t('Cosa può vedere e fare ogni ruolo', 'What each role can see and do')}</div>
        </div>
        <button className="dk-iconbtn" onClick={onClose}><Icon name="x" size={19} /></button>
      </div>

      <div className="scroll" style={{ flex: 1, overflowY: 'auto', padding: '16px 22px' }}>
        {!hasScope("team") ? (
          <LockNote t={t} msg={t('Ti serve il permesso "Team" per gestire i ruoli.', 'You need the "Team" permission to manage roles.')} />
        ) : (
          <React.Fragment>
            {/* local UI pref: revenue summary visibility (agenda box) */}
            <div className="dk-card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', boxShadow: 'none', border: '1px solid var(--hair)', marginBottom: 14 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--ink)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name="wallet" size={17} color="#fff" /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{t('Riepilogo incassi visibile', 'Revenue summary visible')}</div>
                <div className="t-sm" style={{ color: 'var(--muted)' }}>{t('Mostra la box "Vendite totali" in agenda su questo dispositivo.', 'Shows the "Total sales" box in the agenda on this device.')}</div>
              </div>
              <button onClick={() => setShowRevenue(!showRevenue)} style={{ position: 'relative', width: 42, height: 24, borderRadius: 99, cursor: 'pointer', border: 'none', background: showRevenue ? 'var(--clay)' : 'var(--hair)', transition: 'background 140ms', flexShrink: 0 }}>
                <span style={{ position: 'absolute', top: 2, left: showRevenue ? 20 : 2, width: 20, height: 20, borderRadius: 99, background: '#fff', transition: 'left 140ms', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }} />
              </button>
            </div>

            {roles === null ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[0, 1, 2].map((i) => <div key={i} className="skel" style={{ height: 62, borderRadius: 14 }} />)}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {roles.map((r) => {
                  const open = openId === r.id;
                  const d = drafts[r.id] || { name: r.name, scopes: r.scopes };
                  const dirty = d.name !== r.name || d.scopes.length !== r.scopes.length || d.scopes.some((s) => !r.scopes.includes(s));
                  return (
                    <div key={r.id} className="dk-card" style={{ boxShadow: 'none', border: '1px solid ' + (open ? 'var(--clay)' : 'var(--hair)'), overflow: 'hidden' }}>
                      <button className="dk-row" onClick={() => setOpenId(open ? null : r.id)} style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', padding: '13px 15px', textAlign: 'left', cursor: 'pointer', border: 'none', background: 'transparent' }}>
                        <div style={{ width: 34, height: 34, borderRadius: 9, background: r.is_system ? 'var(--clay-tint)' : 'var(--surface-2)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name={r.is_system ? 'sparkle' : 'user'} size={16} color={r.is_system ? 'var(--clay-ink)' : 'var(--muted)'} /></div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>
                            {r.name}
                            {r.is_system && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--clay-ink)', background: 'var(--clay-tint)', padding: '1px 7px', borderRadius: 99, marginLeft: 7 }}>{t('di sistema', 'system')}</span>}
                          </div>
                          <div className="t-sm" style={{ color: 'var(--muted)' }}>{r.scopes.length}/{SCOPES.length} {t('permessi', 'permissions')}</div>
                        </div>
                        <Icon name="chevD" size={16} color="var(--muted-2)" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 160ms', flexShrink: 0 }} />
                      </button>
                      {open && (
                        <div style={{ padding: '4px 15px 15px', borderTop: '1px solid var(--hair)' }}>
                          {r.is_system && <div className="t-sm" style={{ color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6, padding: '10px 0 4px' }}><Icon name="lock" size={13} color="var(--muted)" />{t('Ruolo di sistema: permessi non modificabili.', 'System role: permissions cannot be changed.')}</div>}
                          {SCOPES.map((p) => {
                            const on = d.scopes.includes(p.id);
                            const locked = r.is_system;
                            return (
                              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--hair)' }}>
                                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 500, color: on ? 'var(--ink)' : 'var(--muted)' }}>{p[lang] || p.it}</span>
                                <MutationButton onClick={() => !locked && toggleScope(r.id, p.id)} disabled={locked} style={{ width: 40, height: 23, borderRadius: 99, border: 'none', cursor: locked ? 'default' : 'pointer', background: on ? 'var(--clay)' : 'var(--hair)', opacity: locked ? 0.5 : 1, position: 'relative', transition: 'background 160ms', flexShrink: 0 }}>
                                  <span style={{ position: 'absolute', top: 2, left: on ? 19 : 2, width: 19, height: 19, borderRadius: 99, background: '#fff', transition: 'left 160ms' }} />
                                </MutationButton>
                              </div>
                            );
                          })}
                          {!r.is_system && (
                            <React.Fragment>
                              <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
                                <MutationInput value={d.name} onChange={(e) => setDrafts((ds) => ({ ...ds, [r.id]: { ...ds[r.id], name: e.target.value } }))} placeholder={t('Nome ruolo', 'Role name')} style={{ ...inputCss, flex: 1, fontSize: 13, padding: '8px 11px' }} />
                                <MutationButton className="dk-btn dk-btn--clay" disabled={!dirty || !d.name.trim()} style={{ height: 38, fontSize: 13, opacity: dirty && d.name.trim() ? 1 : 0.5 }} onClick={() => saveRole(r)}><Icon name="check" size={15} color="#fff" />{t('Salva', 'Save')}</MutationButton>
                              </div>
                              <MutationButton onClick={() => delRole(r)} style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 12.5, fontWeight: 700, padding: 0 }}>
                                <Icon name="x" size={13} color="var(--danger)" />{t('Elimina ruolo', 'Delete role')}
                              </MutationButton>
                            </React.Fragment>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <MutationButton className="dk-btn dk-btn--ghost" style={{ width: '100%', borderStyle: 'dashed', marginTop: 12 }} onClick={addRole}><Icon name="plus" size={16} />{t('Crea un nuovo ruolo', 'Create a new role')}</MutationButton>
          </React.Fragment>
        )}
      </div>
    </DkDrawer>
  );
}
