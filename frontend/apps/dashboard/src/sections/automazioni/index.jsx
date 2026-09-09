import { MutationToggle } from '@youty/shared';
import { MutationButton } from '@youty/shared';
// Automazioni — two-pane section (prototype DkAuto port, API-backed).
// Left: rules from GET /api/automations/ (toggle POST /{id}/toggle, delete with
// confirm). Right: builder (POST / PUT /api/automations/). Events, condition
// fields and operators come from GET /api/automations/events-catalog.
import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError, Icon, Toggle, EmptyState } from '@youty/shared';
import { DkModal } from '../../ui/index.js';
import { useDash } from '../../ctx.jsx';
import Builder from './Builder.jsx';
import { eventIcon, offsetPhrase, catLabel } from './catalog.js';

export default function AutomazioniSection() {
  const { t, lang, fireToast, hasScope, canMutate } = useDash();
  const canWrite = hasScope('marketing');

  const [rules, setRules] = useState(null);      // null = loading
  const [catalog, setCatalog] = useState(null);  // { events, operators, fields }
  const [loadError, setLoadError] = useState(false);
  const [sel, setSel] = useState(null);          // rule id | 'new' | null
  const [confirmDel, setConfirmDel] = useState(null); // rule pending deletion
  const [deleting, setDeleting] = useState(false);

  const toastErr = useCallback((err) => {
    if (err instanceof ApiError) fireToast({ msg: err.message, icon: 'alert' });
    else fireToast({ msg: t('Errore di rete', 'Network error'), icon: 'alert' });
  }, [fireToast, t]);

  const refetch = useCallback(async () => {
    const list = await api.get('/api/automations/');
    setRules(list);
    return list;
  }, []);

  /* ---- initial load: rules + events catalog in parallel ---- */
  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const [list, cat] = await Promise.all([
        api.get('/api/automations/'),
        api.get('/api/automations/events-catalog'),
      ]);
      setRules(list);
      setCatalog(cat);
      setSel((s) => (s != null ? s : (list[0] ? list[0].id : null)));
    } catch (err) {
      setLoadError(true);
      toastErr(err);
    }
  }, [toastErr]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- toggle active (optimistic, then refetch) ---- */
  const toggle = async (rule) => {
    if (!canWrite) return;
    setRules((l) => l.map((r) => (r.id === rule.id ? { ...r, active: !r.active } : r)));
    try {
      await api.post(`/api/automations/${rule.id}/toggle`);
      await refetch();
    } catch (err) {
      toastErr(err);
      try { await refetch(); } catch { /* list already shown */ }
    }
  };

  /* ---- delete (confirm modal first) ---- */
  const doDelete = async () => {
    const rule = confirmDel;
    if (!rule) return;
    setDeleting(true);
    try {
      await api.del(`/api/automations/${rule.id}`);
      setConfirmDel(null);
      const list = await refetch();
      setSel((s) => (s === rule.id ? (list[0] ? list[0].id : null) : s));
      fireToast({ msg: t('Automazione eliminata', 'Automation deleted'), icon: 'check' });
    } catch (err) {
      toastErr(err);
    } finally {
      setDeleting(false);
    }
  };

  /* ---- after save in the builder: refetch + select the saved rule ---- */
  const onSaved = async (saved) => {
    try {
      await refetch();
      setSel(saved.id);
    } catch (err) {
      toastErr(err);
    }
  };

  const loading = rules === null || catalog === null;
  const activeCount = (rules || []).filter((r) => r.active).length;
  const curRule = sel !== 'new' ? (rules || []).find((r) => r.id === sel) : null;

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* ---- left: rules list ---- */}
      <div style={{ width: 380, flexShrink: 0, borderRight: '1px solid var(--hair)', display: 'flex', flexDirection: 'column', background: 'var(--paper)' }}>
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--hair)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {loading
                ? <div className="skel" style={{ height: 16, width: 140 }} />
                : <div className="t-meta" style={{ color: 'var(--clay-ink)' }}>{activeCount} {t('attive', 'active')} · {rules.length} {t('totali', 'total')}</div>}
              <div className="t-body" style={{ color: 'var(--muted)', marginTop: 4 }}>{t('Decidi quando partono e a chi. Canale e messaggio su Yourang.', 'Decide when they fire and to whom. Channel and message on Yourang.')}</div>
            </div>
            {canWrite && !loading && (
              <MutationButton className="dk-btn dk-btn--clay" style={{ height: 38, padding: '0 14px', fontSize: 13.5, flexShrink: 0 }} onClick={() => setSel('new')}>
                <Icon name="plus" size={15} color="#fff" />{t('Nuova', 'New')}
              </MutationButton>
            )}
          </div>
        </div>
        <div className="scroll" style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {loadError ? (
            <EmptyState
              icon="alert"
              title={t('Errore di caricamento', 'Loading error')}
              sub={t('Impossibile caricare le automazioni.', 'Could not load the automations.')}
              action={t('Riprova', 'Retry')}
              onAction={load}
            />
          ) : loading ? (
            [...Array(4)].map((_, i) => <div key={i} className="skel" style={{ height: 76, borderRadius: 14, marginBottom: 8 }} />)
          ) : rules.length === 0 && sel !== 'new' ? (
            <EmptyState
              icon="bolt"
              title={t('Nessuna automazione', 'No automations')}
              sub={t('Crea la prima regola: evento, tempi e filtri.', 'Create your first rule: event, timing and filters.')}
              mutationAction action={canWrite ? t('Nuova automazione', 'New automation') : undefined}
              onAction={() => setSel('new')}
            />
          ) : (
            rules.map((r) => {
              const on = r.id === sel;
              const evItem = catalog.events.find((e) => e.value === r.event);
              return (
                <div key={r.id} className="dk-row" onClick={() => setSel(r.id)} style={{ padding: '13px 14px', borderRadius: 14, marginBottom: 4, background: on ? 'var(--surface)' : 'transparent', boxShadow: on ? 'var(--sh-sm)' : 'none', opacity: r.active ? 1 : 0.68 }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ width: 38, height: 38, borderRadius: 11, background: r.active ? 'var(--clay-tint)' : 'var(--paper-2)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                      <Icon name={eventIcon(r.event)} size={19} color={r.active ? 'var(--clay-ink)' : 'var(--muted)'} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                      <div className="t-sm" style={{ color: 'var(--muted)', marginTop: 1 }}>
                        {catLabel(evItem, lang) || r.event} · {offsetPhrase(r.offset_direction, r.offset_value, r.offset_unit, lang).toLowerCase()}
                      </div>
                      {r.active && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 7, fontSize: 12, fontWeight: 600, color: 'var(--muted-2)' }}>
                          <Icon name="trend" size={13} color="var(--muted-2)" />— · {t('dati da Yourang (fase 2)', 'data from Yourang (phase 2)')}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                      <MutationToggle on={r.active} onChange={() => toggle(r)} />
                      {canWrite && (
                        <MutationButton className="dk-iconbtn" title={t('Elimina', 'Delete')} onClick={() => setConfirmDel(r)} style={{ width: 28, height: 28, borderRadius: 8, color: 'var(--muted)' }}>
                          <Icon name="x" size={14} />
                        </MutationButton>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ---- right: builder ---- */}
      <div className="scroll" style={{ flex: 1, overflowY: 'auto' }}>
        {loadError ? null : loading ? (
          <BuilderSkeleton />
        ) : sel === 'new' ? (
          <Builder key="new" rule={null} catalog={catalog} canWrite={canWrite} onSaved={onSaved} />
        ) : curRule ? (
          <Builder key={curRule.id + ':' + curRule.updated_at} rule={curRule} catalog={catalog} canWrite={canWrite} onSaved={onSaved} />
        ) : (
          <div style={{ padding: '24px 28px' }}>
            <EmptyState icon="bolt" title={t('Seleziona un’automazione', 'Select an automation')} sub={t('Oppure creane una nuova dalla lista.', 'Or create a new one from the list.')} />
          </div>
        )}
      </div>

      {/* ---- delete confirm ---- */}
      <DkModal
        open={!!confirmDel}
        onClose={() => !deleting && setConfirmDel(null)}
        title={t('Eliminare l’automazione?', 'Delete this automation?')}
        sub={confirmDel ? confirmDel.name : ''}
        width={440}
        foot={(
          <React.Fragment>
            <button className="dk-btn dk-btn--ghost" disabled={deleting} onClick={() => setConfirmDel(null)}>{t('Annulla', 'Cancel')}</button>
            <MutationButton className="dk-btn dk-btn--primary" disabled={deleting} onClick={doDelete} style={{ background: 'var(--danger)', opacity: deleting ? 0.6 : 1 }}>
              {deleting ? t('Eliminazione…', 'Deleting…') : t('Elimina', 'Delete')}
            </MutationButton>
          </React.Fragment>
        )}
      >
        <div className="t-body" style={{ color: 'var(--muted)' }}>
          {t('La regola viene rimossa anche da Yourang e smette subito di inviare messaggi. L’azione non è reversibile.', 'The rule is removed from Yourang too and immediately stops sending messages. This cannot be undone.')}
        </div>
      </DkModal>
    </div>
  );
}

function BuilderSkeleton() {
  return (
    <div style={{ padding: '24px 28px 40px', maxWidth: 780 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
        <div className="skel" style={{ width: 48, height: 48, borderRadius: 14 }} />
        <div style={{ flex: 1 }}>
          <div className="skel" style={{ height: 24, width: 260, marginBottom: 8 }} />
          <div className="skel" style={{ height: 14, width: 180 }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 14, marginBottom: 22 }}>
        {[...Array(3)].map((_, i) => <div key={i} className="skel" style={{ height: 74, borderRadius: 14, flex: i === 2 ? 2 : 1 }} />)}
      </div>
      {[...Array(3)].map((_, i) => <div key={i} className="skel" style={{ height: 130, borderRadius: 16, marginBottom: 12 }} />)}
    </div>
  );
}
