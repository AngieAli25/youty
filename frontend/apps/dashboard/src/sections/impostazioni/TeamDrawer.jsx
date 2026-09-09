import { MutationInput } from '@youty/shared';
import { MutationSelect } from '@youty/shared';
import { MutationButton } from '@youty/shared';
// TeamDrawer.jsx — port of TeamManager on the real accounts API.
// Members: GET /api/auth/members, POST /members/{id}/role, DELETE /members/{id}.
// Invitations: GET/POST /api/auth/invitations — delivery is Yourang (phase 2),
// so the invite token is displayed with a copy button only.
// Requires scope 'team' (owner bypasses).
import React, { useCallback, useEffect, useState } from 'react';
import { api, Icon, Avatar } from '@youty/shared';
import DkDrawer from '../../ui/DkDrawer.jsx';
import { useDash } from '../../ctx.jsx';
import { inputCss, toastErr, LockNote, CopyField } from './lib.jsx';

const initialsOf = (name, email) => {
  const src = (name || '').trim() || (email || '');
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase() || '?';
};

export default function TeamDrawer({ onClose, onRoles }) {
  const { t, lang, hasScope, canMutate, session, fireToast } = useDash();
  const canTeam = hasScope('team');
  const [members, setMembers] = useState(null);
  const [roles, setRoles] = useState([]);
  const [invitations, setInvitations] = useState(null);
  const [inviting, setInviting] = useState(false);
  const [inv, setInv] = useState({ email: '', role_id: null });
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, r, i] = await Promise.all([
        api.get('/api/auth/members'),
        api.get('/api/auth/roles'),
        api.get('/api/auth/invitations'),
      ]);
      setMembers(m); setRoles(r); setInvitations(i);
      setInv((f) => ({ ...f, role_id: f.role_id ?? (r[0]?.id ?? null) }));
    } catch (err) { toastErr(err, fireToast, t); setMembers([]); setInvitations([]); }
  }, [fireToast, t]);
  useEffect(() => { if (canTeam) load(); }, [canTeam, load]);

  const setRole = async (memberId, roleId) => {
    try {
      const upd = await api.post(`/api/auth/members/${memberId}/role`, { role_id: roleId });
      setMembers((l) => l.map((m) => (m.id === memberId ? upd : m)));
      fireToast({ msg: t('Ruolo aggiornato', 'Role updated'), icon: 'check' });
    } catch (err) { toastErr(err, fireToast, t); }
  };

  const removeMember = async (m) => {
    try {
      await api.del(`/api/auth/members/${m.id}`);
      setMembers((l) => l.filter((x) => x.id !== m.id));
      fireToast({ msg: t('Membro rimosso', 'Member removed'), icon: 'x' });
    } catch (err) { toastErr(err, fireToast, t); } // 400 if owner
  };

  const sendInvite = async () => {
    const email = inv.email.trim();
    if (!email || !inv.role_id || sending) return;
    setSending(true);
    try {
      const created = await api.post('/api/auth/invitations', { email, role_id: inv.role_id });
      setInvitations((l) => [created, ...(l || [])]);
      setInviting(false);
      setInv({ email: '', role_id: roles[0]?.id ?? null });
      fireToast({ msg: t('Invito creato per ', 'Invite created for ') + email, icon: 'check' });
    } catch (err) { toastErr(err, fireToast, t); }
    finally { setSending(false); }
  };

  const pending = (invitations || []).filter((i) => i.status === 'pending');

  return (
    <DkDrawer open onClose={onClose}>
      <div style={{ padding: '22px 22px 18px', borderBottom: '1px solid var(--hair)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--serif)', fontSize: 21, fontWeight: 500 }}>{t('Membri del team', 'Team members')}</div>
          <div className="t-sm" style={{ color: 'var(--muted)', marginTop: 2 }}>
            {members ? members.length + ' ' + t('membri · ruolo e accesso', 'members · role and access') : t('Ruolo e accesso', 'Role and access')}
          </div>
        </div>
        <button className="dk-iconbtn" onClick={onClose}><Icon name="x" size={19} /></button>
      </div>

      <div className="scroll" style={{ flex: 1, overflowY: 'auto', padding: '16px 22px' }}>
        {!hasScope("team") ? (
          <LockNote t={t} msg={t('Ti serve il permesso "Team" per gestire i membri.', 'You need the "Team" permission to manage members.')} />
        ) : members === null ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {[0, 1, 2].map((i) => <div key={i} className="skel" style={{ height: 66, borderRadius: 14 }} />)}
          </div>
        ) : (
          <React.Fragment>
            {/* members */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {members.map((m) => (
                <div key={m.id} className="dk-card" style={{ padding: 13, boxShadow: 'none', border: '1px solid var(--hair)', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Avatar initials={initialsOf(m.user.name, m.user.email)} size={40} color={m.is_owner ? 'var(--clay)' : 'var(--paper-2)'} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{m.user.name || m.user.email}</span>
                      {m.is_owner && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--clay-ink)', background: 'var(--clay-tint)', padding: '1px 7px', borderRadius: 99 }}>{t('titolare', 'owner')}</span>}
                    </div>
                    <div className="t-sm" style={{ color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.user.email}</div>
                  </div>
                  {m.is_owner ? (
                    <span className="t-sm" style={{ color: 'var(--muted-2)', fontWeight: 600, flexShrink: 0 }}>{t('Accesso totale', 'Full access')}</span>
                  ) : (
                    <React.Fragment>
                      <MutationSelect value={m.role?.id ?? ''} onChange={(e) => setRole(m.id, e.target.value ? Number(e.target.value) : null)}
                        style={{ border: '1px solid var(--hair)', borderRadius: 9, outline: 'none', fontSize: 13, fontWeight: 600, padding: '7px 10px', fontFamily: 'var(--sans)', background: 'var(--surface)', cursor: 'pointer', flexShrink: 0, color: 'var(--ink)' }}>
                        <option value="">{t('Nessun ruolo', 'No role')}</option>
                        {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </MutationSelect>
                      {m.user.id !== session?.user?.id && (
                        <MutationButton className="dk-iconbtn" title={t('Rimuovi membro', 'Remove member')} onClick={() => removeMember(m)} style={{ width: 30, height: 30, borderRadius: 8 }}><Icon name="x" size={14} color="var(--danger)" /></MutationButton>
                      )}
                    </React.Fragment>
                  )}
                </div>
              ))}
            </div>

            {/* pending invitations */}
            {pending.length > 0 && (
              <React.Fragment>
                <div className="t-meta" style={{ margin: '18px 0 9px' }}>{t('Inviti in attesa', 'Pending invitations')}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {pending.map((i) => (
                    <div key={i.id} className="dk-card" style={{ padding: 13, boxShadow: 'none', border: '1px dashed var(--hair)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9 }}>
                        <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--warn-tint)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name="mail" size={15} color="var(--warn)" /></div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.email}</div>
                          <div className="t-sm" style={{ color: 'var(--muted)' }}>
                            {(i.role?.name || '—')} · {t('scade', 'expires')} {new Date(i.expires_at).toLocaleDateString(lang === 'en' ? 'en-GB' : 'it-IT')}
                          </div>
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--warn)', background: 'var(--warn-tint)', padding: '1px 7px', borderRadius: 99, flexShrink: 0 }}>{t('in attesa', 'pending')}</span>
                      </div>
                      <CopyField value={i.token} t={t} fireToast={fireToast} />
                      <div className="t-sm" style={{ color: 'var(--muted-2)', marginTop: 6 }}>{t('L’invio automatico arriva con Yourang (fase 2): per ora condividi il codice manualmente.', 'Automatic delivery ships with Yourang (phase 2): for now share the code manually.')}</div>
                    </div>
                  ))}
                </div>
              </React.Fragment>
            )}

            {/* invite form */}
            {inviting ? (
              <div className="dk-card" style={{ padding: 15, border: '1px solid var(--clay)', boxShadow: 'none', marginTop: 12 }}>
                <div className="t-meta" style={{ marginBottom: 10 }}>{t('Invita un membro', 'Invite a member')}</div>
                <MutationInput value={inv.email} onChange={(e) => setInv((f) => ({ ...f, email: e.target.value }))} type="email" placeholder="email@salone.it" style={{ ...inputCss, width: '100%', boxSizing: 'border-box', marginBottom: 9 }} />
                <MutationSelect value={inv.role_id ?? ''} onChange={(e) => setInv((f) => ({ ...f, role_id: Number(e.target.value) }))} style={{ ...inputCss, width: '100%', fontWeight: 600, cursor: 'pointer', marginBottom: 12 }}>
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </MutationSelect>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="dk-btn dk-btn--ghost" style={{ flex: 1 }} onClick={() => setInviting(false)}>{t('Annulla', 'Cancel')}</button>
                  <MutationButton className="dk-btn dk-btn--clay" style={{ flex: 1 }} disabled={!inv.email.trim() || !inv.role_id || sending} onClick={sendInvite}><Icon name="check" size={16} color="#fff" />{t('Crea invito', 'Create invite')}</MutationButton>
                </div>
              </div>
            ) : (
              <MutationButton className="dk-btn dk-btn--ghost" style={{ width: '100%', borderStyle: 'dashed', marginTop: 12 }} onClick={() => setInviting(true)}><Icon name="plus" size={16} />{t('Invita un membro', 'Invite a member')}</MutationButton>
            )}

            {/* link to roles */}
            <button className="dk-row" onClick={onRoles} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '13px 14px', borderRadius: 12, marginTop: 16, background: 'var(--surface-2)', textAlign: 'left', cursor: 'pointer', border: 'none' }}>
              <Icon name="settings" size={17} color="var(--muted)" />
              <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 13.5 }}>{t('Ruoli e permessi', 'Roles & permissions')}</div><div className="t-sm" style={{ color: 'var(--muted)' }}>{t('Definisci cosa può fare ogni ruolo', 'Define what each role can do')}</div></div>
              <Icon name="chevR" size={16} color="var(--muted-2)" />
            </button>
          </React.Fragment>
        )}
      </div>
    </DkDrawer>
  );
}
