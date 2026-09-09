import { MutationTextarea } from '@youty/shared';
import { MutationButton } from '@youty/shared';
// NotesTab.jsx — client notes (GET/POST/DELETE /api/clients/{id}/notes).
// The prototype's "AI visibility" maps to the API `visibility` field:
// shared = visible to the AI assistant, private = staff-only. Visibility is
// chosen at creation — the API has no note-update route, so existing notes
// display their visibility without a toggle.
import React, { useEffect, useState } from 'react';
import { api, ApiError, EmptyState, Icon } from '@youty/shared';
import { useDash } from '../../../ctx.jsx';
import { dateTimeLabel } from '../helpers.js';

export default function NotesTab({ clientId }) {
  const { t, lang, fireToast, hasScope, canMutate } = useDash();
  const canWrite = hasScope('clients');
  const [notes, setNotes] = useState(null);
  const [draft, setDraft] = useState('');
  const [draftShared, setDraftShared] = useState(false);
  const [saving, setSaving] = useState(false);

  const toastErr = (err) => fireToast({ msg: err instanceof ApiError ? err.message : t('Errore di rete', 'Network error'), icon: 'alert' });

  useEffect(() => {
    let dead = false;
    setNotes(null);
    api.get(`/api/clients/${clientId}/notes`)
      .then((rows) => { if (!dead) setNotes(rows); })
      .catch((err) => { if (!dead) { setNotes([]); toastErr(err); } });
    return () => { dead = true; };
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      const n = await api.post(`/api/clients/${clientId}/notes`, { text: draft.trim(), visibility: draftShared ? 'shared' : 'private' });
      setNotes((l) => [n, ...(l || [])]);
      setDraft(''); setDraftShared(false);
      fireToast({ msg: t('Nota aggiunta', 'Note added'), icon: 'check' });
    } catch (err) { toastErr(err); } finally { setSaving(false); }
  };

  const remove = async (id) => {
    try {
      await api.del(`/api/clients/${clientId}/notes/${id}`);
      setNotes((l) => l.filter((n) => n.id !== id));
      fireToast({ msg: t('Nota eliminata', 'Note deleted'), icon: 'x' });
    } catch (err) { toastErr(err); }
  };

  const aiCount = (notes || []).filter((n) => n.visibility === 'shared').length;

  return (
    <div style={{ maxWidth: 640 }}>
      {/* add */}
      {canWrite && (
        <div className="dk-card" style={{ padding: 16, marginBottom: 16, boxShadow: 'none', border: '1px solid var(--hair)' }}>
          <MutationTextarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} placeholder={t('Aggiungi una nota su questo cliente…', 'Add a note about this client…')} style={{ width: '100%', border: 'none', outline: 'none', resize: 'none', fontSize: 14.5, lineHeight: 1.5, fontFamily: 'var(--sans)', background: 'transparent', color: 'var(--ink)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, paddingTop: 12, borderTop: '1px solid var(--hair)' }}>
            <VisibilityToggle shared={draftShared} onChange={setDraftShared} t={t} />
            <div style={{ flex: 1 }} />
            <MutationButton className="dk-btn dk-btn--clay" style={{ height: 40, opacity: draft.trim() && !saving ? 1 : 0.4 }} disabled={!draft.trim() || saving} onClick={add}>
              <Icon name="plus" size={16} color="#fff" />{t('Aggiungi nota', 'Add note')}
            </MutationButton>
          </div>
        </div>
      )}

      {/* ai context hint */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, padding: '10px 14px', background: 'var(--clay-tint)', borderRadius: 12 }}>
        <Icon name="sparkle" size={16} color="var(--clay-ink)" />
        <span className="t-sm" style={{ color: 'var(--ink-2)', fontWeight: 600 }}>
          {aiCount > 0 ? t(`${aiCount} note visibili all'assistente AI`, `${aiCount} notes visible to the AI assistant`) : t("Nessuna nota condivisa con l'AI", 'No notes shared with the AI')}
        </span>
      </div>

      {/* list */}
      {notes == null ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[...Array(2)].map((_, i) => <div key={i} className="skel" style={{ height: 86, borderRadius: 12 }} />)}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {notes.map((n) => {
            const shared = n.visibility === 'shared';
            return (
              <div key={n.id} className="dk-card" style={{ padding: 16, boxShadow: 'none', border: '1px solid ' + (shared ? 'color-mix(in srgb, var(--clay) 35%, var(--hair))' : 'var(--hair)') }}>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, display: 'grid', placeItems: 'center', background: shared ? 'var(--clay-tint)' : 'var(--paper-2)' }}>
                    <Icon name={shared ? 'sparkle' : 'lock'} size={16} color={shared ? 'var(--clay-ink)' : 'var(--muted)'} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}>{n.text}</div>
                    <div className="t-sm" style={{ color: 'var(--muted-2)', marginTop: 6 }}>{n.author_name || '—'} · {dateTimeLabel(n.created_at, lang)}</div>
                  </div>
                  {canWrite && (
                    <MutationButton className="dk-iconbtn" style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0 }} title={t('Elimina nota', 'Delete note')} onClick={() => remove(n.id)}><Icon name="x" size={14} /></MutationButton>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--hair)' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 99, fontSize: 12, fontWeight: 700, background: shared ? 'var(--clay-tint)' : 'var(--paper-2)', color: shared ? 'var(--clay-ink)' : 'var(--muted)' }}>
                    <Icon name={shared ? 'sparkle' : 'lock'} size={12} color={shared ? 'var(--clay-ink)' : 'var(--muted)'} />
                    {shared ? t("Visibile all'AI", 'Visible to AI') : t('Privata', 'Private')}
                  </span>
                  <span className="t-sm" style={{ color: 'var(--muted-2)' }}>
                    {shared ? t("L'AI può usarla nei suggerimenti", 'AI may use it in suggestions') : t('Visibile solo allo staff', 'Staff-only')}
                  </span>
                </div>
              </div>
            );
          })}
          {!notes.length && <EmptyState icon="edit" title={t('Nessuna nota', 'No notes')} sub={t('Aggiungi la prima nota su questo cliente.', 'Add the first note about this client.')} />}
        </div>
      )}
    </div>
  );
}

export function VisibilityToggle({ shared, onChange, t }) {
  return (
    <div style={{ display: 'inline-flex', background: 'var(--paper-2)', borderRadius: 99, padding: 3, gap: 2 }}>
      <MutationButton onClick={() => onChange(false)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 99, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: 'none', background: !shared ? 'var(--surface)' : 'transparent', color: !shared ? 'var(--ink)' : 'var(--muted)', boxShadow: !shared ? 'var(--sh-sm)' : 'none' }}>
        <Icon name="lock" size={13} color={!shared ? 'var(--ink)' : 'var(--muted)'} />{t('Privata', 'Private')}
      </MutationButton>
      <MutationButton onClick={() => onChange(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 99, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: 'none', background: shared ? 'var(--surface)' : 'transparent', color: shared ? 'var(--clay-ink)' : 'var(--muted)', boxShadow: shared ? 'var(--sh-sm)' : 'none' }}>
        <Icon name="sparkle" size={13} color={shared ? 'var(--clay-ink)' : 'var(--muted)'} />{t("Visibile all'AI", 'Visible to AI')}
      </MutationButton>
    </div>
  );
}
