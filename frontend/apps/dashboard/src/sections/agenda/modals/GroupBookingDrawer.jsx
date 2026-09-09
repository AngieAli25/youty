import { withPortalForm, PortalFormBody } from '@youty/shared';
import { MutationButton } from '@youty/shared';
// GroupBookingDrawer — book MULTIPLE clients in one session while the agenda stays visible.
// Right-side live drawer (no dark backdrop): each row = one client + services + a chosen start,
// so staff can stagger times against the live grid. Submits each row sequentially to
// POST /api/agenda/appointments, tracks per-row status, and never aborts the batch on one failure.
import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError, Avatar, Icon, fmtEur, fmtDur, timeLabel, minutesOfDay, todayStr } from '@youty/shared';
import { useDash } from '../../../ctx.jsx';
import { initialsOf, toastErr, fmtMoney } from '../lib.js';

function GroupBookingDrawer({ date, onClose, onCreated }) {
  const { t, lang, services, serviceCategories, operators, fireToast, hasScope, canMutate } = useDash();
  const canWrite = hasScope('agenda');
  const baseDate = date || todayStr();

  const seq = useRef(1);
  const newRow = () => ({
    key: 'r' + seq.current++,
    client: null, q: '',
    items: [],          // [{ key, service_id, operator_id }]
    date: baseDate,
    selStart: null,     // ISO string of chosen slot
    reloadKey: 0,       // bump → force availability refetch
    status: 'pending',  // pending | creating | done | error
    error: '',
    created: null,      // AppointmentOut after success
  });

  const [rows, setRows] = useState(() => [newRow()]);
  const [batchRunning, setBatchRunning] = useState(false);

  const patchRow = (key, partial) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...(typeof partial === 'function' ? partial(r) : partial) } : r)));
  const addRow = () => setRows((rs) => [...rs, newRow()]);
  const removeRow = (key) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));
  const resetAll = () => { seq.current = 1; setRows([newRow()]); };

  const isReady = (r) => r.client && r.items.length > 0 && r.selStart && r.status !== 'done';
  const readyCount = rows.filter(isReady).length;
  const doneCount = rows.filter((r) => r.status === 'done').length;
  const allDone = rows.length > 0 && rows.every((r) => r.status === 'done');

  /* ---- sequential batch create — one failure never aborts the rest ---- */
  async function createAll() {
    if (batchRunning || !canWrite) return;
    const snapshot = rows.filter((r) => r.status !== 'done' && r.client && r.items.length && r.selStart);
    if (!snapshot.length) return;
    setBatchRunning(true);
    for (const row of snapshot) {
      patchRow(row.key, { status: 'creating', error: '' });
      try {
        const res = await api.post('/api/agenda/appointments', {
          client_id: row.client.id,
          items: row.items.map((i) => ({ service_id: i.service_id, operator_id: i.operator_id })),
          start: row.selStart,
        });
        patchRow(row.key, { status: 'done', created: res });
        onCreated?.(); // refresh the agenda behind so the next slot picks against updated availability
      } catch (err) {
        const msg = err instanceof ApiError && err.status === 409
          ? t('Orario non più disponibile', 'Time no longer available')
          : (err instanceof ApiError ? err.message : t('Errore di rete', 'Network error'));
        // 409 → the slot is gone: clear it and force a fresh availability fetch so staff can re-pick
        patchRow(row.key, (r) => ({
          status: 'error', error: msg,
          selStart: err instanceof ApiError && err.status === 409 ? null : r.selStart,
          reloadKey: r.reloadKey + 1,
        }));
        if (!(err instanceof ApiError)) toastErr(err, t, fireToast);
      }
    }
    setBatchRunning(false);
    onCreated?.();
  }

  /* ---- drawer chrome ---- */
  const shell = (body, footer) => (
    <div
      role="dialog"
      aria-label={t('Prenotazione di gruppo', 'Group booking')}
      style={{
        position: 'fixed', top: 'var(--top-h)', right: 0, bottom: 0,
        width: 520, maxWidth: '94vw', background: 'var(--surface)',
        borderLeft: '1px solid var(--hair)', boxShadow: 'var(--sh-pop)',
        zIndex: 120, display: 'flex', flexDirection: 'column',
        animation: 'dkSlideR 280ms var(--ease-emph)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 20px 14px', borderBottom: '1px solid var(--hair)', flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="t-title" style={{ fontSize: 19 }}>{t('Prenotazione di gruppo', 'Group booking')}</div>
          <div className="t-sm" style={{ color: 'var(--muted)', marginTop: 2 }}>{t('Prenota più clienti in una sola sessione', 'Book several clients in one session')}</div>
        </div>
        <button className="dk-iconbtn" style={{ flexShrink: 0 }} onClick={onClose} aria-label={t('Chiudi', 'Close')}><Icon name="x" size={18} /></button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 20px' }}><PortalFormBody onClose={onClose}>{body}</PortalFormBody></div>
      {footer && (
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--hair)', background: 'var(--surface-2)', display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
          {footer}
        </div>
      )}
    </div>
  );

  /* ---- read-only gate ---- */
  if (!canWrite) {
    return shell(
      <div style={{ textAlign: 'center', padding: '40px 20px', border: '1.5px dashed var(--line-strong)', borderRadius: 14, color: 'var(--muted)' }}>
        <Icon name="lock" size={26} color="var(--muted-2)" style={{ margin: '0 auto 10px' }} />
        <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)', marginBottom: 4 }}>{t('Sola lettura', 'Read only')}</div>
        <div className="t-sm">{t('Non hai i permessi per creare prenotazioni.', 'You do not have permission to create bookings.')}</div>
      </div>,
      <button className="dk-btn dk-btn--ghost" style={{ marginLeft: 'auto' }} onClick={onClose}>{t('Chiudi', 'Close')}</button>
    );
  }

  /* ---- all done: summary ---- */
  if (allDone) {
    return shell(
      <React.Fragment>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 16px', borderRadius: 14, background: 'var(--ok-tint)', marginBottom: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--ok)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name="check" size={20} color="#fff" stroke={2.6} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{t(`${doneCount} prenotazioni create`, `${doneCount} bookings created`)}</div>
            <div className="t-sm" style={{ color: 'var(--muted)' }}>{t('Il gruppo è stato inserito in agenda.', 'The group has been added to the agenda.')}</div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((r) => (
            <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, background: 'var(--surface-2)' }}>
              <Avatar initials={initialsOf(r.client?.full_name)} size={30} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.client?.full_name}</div>
                <div className="t-sm" style={{ color: 'var(--muted)' }}>{(r.created?.items || r.items).map((i) => i.service_name || (services || []).find((s) => s.id === i.service_id)?.[lang === 'en' ? 'name_en' : 'name_it']).filter(Boolean).join(' + ')}</div>
              </div>
              {r.created?.start && <span className="t-num" style={{ fontSize: 14, fontWeight: 700 }}>{timeLabel(minutesOfDay(r.created.start))}</span>}
              <Icon name="check" size={16} color="var(--ok)" stroke={2.6} />
            </div>
          ))}
        </div>
      </React.Fragment>,
      <React.Fragment>
        <MutationButton className="dk-btn dk-btn--ghost" onClick={resetAll}><Icon name="plus" size={16} />{t('Nuovo gruppo', 'New group')}</MutationButton>
        <button className="dk-btn dk-btn--clay" style={{ marginLeft: 'auto' }} onClick={onClose}><Icon name="check" size={16} color="#fff" />{t('Chiudi', 'Close')}</button>
      </React.Fragment>
    );
  }

  /* ---- normal: list of client rows ---- */
  return shell(
    <React.Fragment>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {rows.map((row, i) => (
          <GroupRow
            key={row.key}
            row={row}
            index={i}
            canRemove={rows.length > 1}
            busy={batchRunning}
            onPatch={(partial) => patchRow(row.key, partial)}
            onRemove={() => removeRow(row.key)}
          />
        ))}
      </div>
      <button
        onClick={addRow}
        disabled={batchRunning}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', marginTop: 14, padding: '12px', borderRadius: 12, border: '1.5px dashed var(--line-strong)', background: 'transparent', color: 'var(--clay-ink)', fontWeight: 700, fontSize: 13.5, cursor: batchRunning ? 'default' : 'pointer', opacity: batchRunning ? 0.5 : 1 }}
      >
        <Icon name="plus" size={16} color="var(--clay-ink)" />{t('Aggiungi cliente', 'Add client')}
      </button>
    </React.Fragment>,
    <React.Fragment>
      <div style={{ flex: 1, minWidth: 0, color: 'var(--muted)' }}>
        {doneCount > 0 && (
          <span className="t-sm" style={{ fontWeight: 700, color: 'var(--ok)' }}>
            <Icon name="check" size={14} color="var(--ok)" stroke={2.6} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            {t(`${doneCount} create`, `${doneCount} created`)}
          </span>
        )}
      </div>
      <button className="dk-btn dk-btn--ghost" onClick={onClose} disabled={batchRunning}>{t('Annulla', 'Cancel')}</button>
      <MutationButton className="dk-btn dk-btn--clay" disabled={batchRunning || readyCount === 0} onClick={createAll}>
        <Icon name="plus" size={16} color="#fff" />
        {batchRunning
          ? t('Creazione…', 'Creating…')
          : t(`Crea ${readyCount} prenotazion${readyCount === 1 ? 'e' : 'i'}`, `Create ${readyCount} booking${readyCount === 1 ? '' : 's'}`)}
      </MutationButton>
    </React.Fragment>
  );
}

/* ============================================================= *
 *  A single client row: client picker + services + time picker  *
 * ============================================================= */
function GroupRow({ row, index, canRemove, busy, onPatch, onRemove }) {
  const { t, lang, services, serviceCategories, operators, fireToast } = useDash();
  const itemSeq = useRef(1);
  const locked = busy || row.status === 'creating' || row.status === 'done';

  const activeServices = (services || []).filter((s) => s.active !== false);
  const svcOf = (id) => (services || []).find((s) => s.id === id);
  const svcName = (s) => (lang === 'en' && s.name_en ? s.name_en : s.name_it);
  const catColor = (catId) => (serviceCategories || []).find((c) => c.id === catId)?.color || 'var(--clay)';
  const eligibleOps = (serviceId) => (operators || []).filter((o) => (o.service_ids || []).includes(serviceId));

  /* ---- client search (debounced) ---- */
  const [clients, setClients] = useState(null); // null = loading
  useEffect(() => {
    if (row.client) return; // picker closed once a client is chosen
    let alive = true;
    setClients(null);
    const tm = setTimeout(() => {
      api.get('/api/clients/', { params: { q: row.q || undefined, limit: 6 } })
        .then((res) => { if (alive) setClients(res.items || []); })
        .catch(() => { if (alive) setClients([]); });
    }, 220);
    return () => { alive = false; clearTimeout(tm); };
  }, [row.q, row.client]);

  /* ---- items ---- */
  const addItem = (serviceId) => onPatch((r) => ({ items: [...r.items, { key: 'it' + itemSeq.current++, service_id: serviceId, operator_id: null }], selStart: null }));
  const removeItem = (key) => onPatch((r) => ({ items: r.items.filter((x) => x.key !== key), selStart: null }));
  const setItemOp = (key, opId) => onPatch((r) => ({ items: r.items.map((x) => (x.key === key ? { ...x, operator_id: opId } : x)), selStart: null }));

  const totalPrice = row.items.reduce((s, it) => s + Number(svcOf(it.service_id)?.price || 0), 0);
  const totalDur = row.items.reduce((s, it) => s + (svcOf(it.service_id)?.duration_min || 0), 0);

  /* ---- availability ---- */
  const [slots, setSlots] = useState([]); // null = loading, [] = none
  const itemsKey = JSON.stringify(row.items.map((i) => [i.service_id, i.operator_id]));
  useEffect(() => {
    if (!row.items.length || !row.date) { setSlots([]); return; }
    let alive = true;
    setSlots(null);
    api.get('/api/agenda/availability', { params: { date: row.date, items: row.items.map((i) => ({ service_id: i.service_id, operator_id: i.operator_id })) } })
      .then((res) => {
        if (!alive) return;
        setSlots(res);
        if (row.selStart && !res.some((s) => s.start === row.selStart)) onPatch({ selStart: null });
      })
      .catch((err) => { if (alive) { setSlots([]); toastErr(err, t, fireToast); } });
    return () => { alive = false; };
  }, [row.date, itemsKey, row.reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- row header status ---- */
  const statusBadge = () => {
    if (row.status === 'done') return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 700, color: 'var(--ok)', background: 'var(--ok-tint)', padding: '3px 9px', borderRadius: 99 }}><Icon name="check" size={12} color="var(--ok)" stroke={2.6} />{t('Creata', 'Created')}</span>;
    if (row.status === 'creating') return <span className="t-sm" style={{ fontWeight: 700, color: 'var(--clay-ink)' }}>{t('Creazione…', 'Creating…')}</span>;
    if (row.status === 'error') return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 700, color: 'var(--danger)', background: 'var(--danger-tint, rgba(220,80,80,0.12))', padding: '3px 9px', borderRadius: 99 }}><Icon name="alert" size={12} color="var(--danger)" />{t('Errore', 'Error')}</span>;
    return null;
  };

  const done = row.status === 'done';

  /* ---- done rows collapse to a compact confirmed line ---- */
  if (done) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', borderRadius: 14, border: '1px solid var(--ok)', background: 'var(--ok-tint)' }}>
        <Avatar initials={initialsOf(row.client?.full_name)} size={32} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.client?.full_name}</div>
          <div className="t-sm" style={{ color: 'var(--muted)' }}>{row.items.map((it) => { const s = svcOf(it.service_id); return s ? svcName(s) : null; }).filter(Boolean).join(' + ')}</div>
        </div>
        {row.selStart && <span className="t-num" style={{ fontSize: 14, fontWeight: 700 }}>{timeLabel(minutesOfDay(row.selStart))}</span>}
        <Icon name="check" size={17} color="var(--ok)" stroke={2.6} />
      </div>
    );
  }

  return (
    <div style={{ border: '1px solid ' + (row.status === 'error' ? 'var(--danger)' : 'var(--hair)'), borderRadius: 16, overflow: 'hidden', background: 'var(--surface)', opacity: row.status === 'creating' ? 0.7 : 1 }}>
      {/* row header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', background: 'var(--surface-2)', borderBottom: '1px solid var(--hair)' }}>
        <span style={{ width: 22, height: 22, borderRadius: 99, background: 'var(--clay-tint)', color: 'var(--clay-ink)', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{index + 1}</span>
        <span style={{ flex: 1, fontWeight: 700, fontSize: 13.5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: row.client ? 'var(--ink)' : 'var(--muted)' }}>
          {row.client ? row.client.full_name : t('Nuovo cliente', 'New client')}
        </span>
        {statusBadge()}
        {canRemove && !locked && (
          <button className="dk-iconbtn" style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0 }} onClick={onRemove} aria-label={t('Rimuovi riga', 'Remove row')}><Icon name="x" size={14} /></button>
        )}
      </div>

      <div style={{ padding: '13px 14px', pointerEvents: locked ? 'none' : 'auto' }}>
        {/* error message */}
        {row.status === 'error' && row.error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '9px 11px', borderRadius: 10, background: 'var(--danger-tint, rgba(220,80,80,0.12))' }}>
            <Icon name="alert" size={15} color="var(--danger)" />
            <span className="t-sm" style={{ fontWeight: 600, color: 'var(--danger)' }}>{row.error}</span>
          </div>
        )}

        {/* client picker */}
        {row.client ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px', borderRadius: 10, background: 'var(--clay-tint)', marginBottom: 12 }}>
            <Avatar initials={initialsOf(row.client.full_name)} size={30} />
            <span style={{ flex: 1, fontWeight: 700, fontSize: 13.5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.client.full_name}</span>
            <button onClick={() => onPatch({ client: null })} style={{ cursor: 'pointer', border: 'none', background: 'transparent', display: 'grid', placeItems: 'center' }} aria-label={t('Cambia cliente', 'Change client')}><Icon name="x" size={14} color="var(--muted-2)" /></button>
          </div>
        ) : (
          <div style={{ marginBottom: 12 }}>
            <div className="dk-search" style={{ width: '100%', marginBottom: 6, height: 38 }}>
              <Icon name="search" size={16} color="var(--muted-2)" />
              <input value={row.q} onChange={(e) => onPatch({ q: e.target.value })} placeholder={t('Cerca cliente…', 'Search client…')} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {clients === null && [...Array(3)].map((_, i) => <div key={i} className="skel" style={{ height: 42, borderRadius: 10 }} />)}
              {(clients || []).map((cl) => (
                <button key={cl.id} className="dk-row" onClick={() => onPatch({ client: cl })} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 8px', borderRadius: 10, background: 'transparent', textAlign: 'left', border: 'none', cursor: 'pointer' }}>
                  <Avatar initials={initialsOf(cl.full_name)} size={30} />
                  <span style={{ flex: 1, fontWeight: 600, fontSize: 13.5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cl.full_name}</span>
                </button>
              ))}
              {clients && !clients.length && <div className="t-sm" style={{ color: 'var(--muted-2)', padding: '8px 4px' }}>{t('Nessun cliente trovato', 'No client found')}</div>}
            </div>
          </div>
        )}

        {/* services catalogue */}
        <div className="t-meta" style={{ marginBottom: 7 }}>{t('Servizi', 'Services')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: row.items.length ? 12 : 0 }}>
          {activeServices.map((s) => (
            <button key={s.id} onClick={() => addItem(s.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 99, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid var(--hair)', background: 'var(--surface)', color: 'var(--ink-2)' }}>
              <span style={{ width: 7, height: 7, borderRadius: 99, background: catColor(s.category_id) }} />
              {svcName(s)}
              <Icon name="plus" size={12} color="var(--muted-2)" />
            </button>
          ))}
        </div>

        {/* item lines */}
        {row.items.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            {row.items.map((it) => {
              const s = svcOf(it.service_id);
              if (!s) return null;
              const eligible = eligibleOps(it.service_id);
              return (
                <div key={it.key} style={{ border: '1px solid var(--hair)', borderRadius: 12, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 11px', background: `color-mix(in srgb, ${catColor(s.category_id)} 14%, var(--surface))` }}>
                    <span style={{ width: 9, height: 9, borderRadius: 99, background: catColor(s.category_id), flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5, lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{svcName(s)}</div>
                      <div className="t-sm" style={{ color: 'var(--muted)' }}><Icon name="clock" size={11} style={{ verticalAlign: '-2px', marginRight: 3 }} />{fmtDur(s.duration_min, lang)}</div>
                    </div>
                    <span className="t-num" style={{ fontSize: 13.5, fontWeight: 700, flexShrink: 0 }}>{fmtEur(Number(s.price), lang)}</span>
                    <button className="dk-iconbtn" style={{ width: 26, height: 26, borderRadius: 8, flexShrink: 0 }} onClick={() => removeItem(it.key)} aria-label={t('Rimuovi servizio', 'Remove service')}><Icon name="x" size={13} /></button>
                  </div>
                  {/* compact operator picker */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '8px 11px' }}>
                    <button onClick={() => setItemOp(it.key, null)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 99, cursor: 'pointer', border: '1.5px solid ' + (it.operator_id === null ? 'var(--clay)' : 'var(--hair)'), background: it.operator_id === null ? 'var(--clay-tint)' : 'var(--surface)', fontSize: 12, fontWeight: it.operator_id === null ? 700 : 600, color: it.operator_id === null ? 'var(--clay-ink)' : 'var(--ink-2)' }}>
                      <Icon name="sparkle" size={12} color={it.operator_id === null ? 'var(--clay-ink)' : 'var(--muted-2)'} />{t('Prima disp.', 'First avail.')}
                    </button>
                    {eligible.map((o) => {
                      const on = o.id === it.operator_id;
                      return (
                        <button key={o.id} onClick={() => setItemOp(it.key, o.id)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px 3px 4px', borderRadius: 99, cursor: 'pointer', border: '1.5px solid ' + (on ? (o.color || 'var(--clay)') : 'var(--hair)'), background: on ? `color-mix(in srgb, ${o.color || 'var(--clay)'} 18%, var(--surface))` : 'var(--surface)' }}>
                          <Avatar initials={o.initials} size={20} color={o.color || 'var(--clay)'} />
                          <span style={{ fontSize: 12, fontWeight: on ? 700 : 600, whiteSpace: 'nowrap' }}>{o.first_name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 4px' }}>
              <span className="t-sm" style={{ color: 'var(--muted)', fontWeight: 600 }}><Icon name="clock" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />{fmtDur(totalDur, lang)}</span>
              <span className="t-num" style={{ fontWeight: 700 }}>{fmtMoney(totalPrice, lang)}</span>
            </div>
          </div>
        )}

        {/* date + times */}
        {row.items.length > 0 && (
          <React.Fragment>
            <div className="hr" style={{ margin: '4px 0 12px' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div className="t-meta" style={{ margin: 0 }}>{t('Data e orario', 'Date & time')}</div>
              <div style={{ flex: 1 }} />
              <input type="date" value={row.date} min={todayStr()} onChange={(e) => onPatch({ date: e.target.value || todayStr(), selStart: null })} style={{ border: '1px solid var(--hair)', borderRadius: 8, padding: '5px 8px', fontSize: 12.5, fontFamily: 'var(--sans)', outline: 'none', cursor: 'pointer', color: 'var(--ink)' }} />
            </div>
            {slots === null ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {[...Array(8)].map((_, i) => <div key={i} className="skel" style={{ width: 52, height: 28, borderRadius: 8 }} />)}
              </div>
            ) : slots.length ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {slots.map((sl) => {
                  const sel = sl.start === row.selStart;
                  return (
                    <button key={sl.start} onClick={() => onPatch({ selStart: sl.start })} className="tabnum" style={{ padding: '5px 9px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: '1.5px solid ' + (sel ? 'var(--ink)' : 'var(--hair)'), background: sel ? 'var(--ink)' : 'var(--surface)', color: sel ? '#fff' : 'var(--ink)' }}>
                      {timeLabel(minutesOfDay(sl.start))}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="t-sm" style={{ color: 'var(--danger)', fontWeight: 600 }}>{t('Nessuno slot libero — prova un altro giorno o operatrice', 'No free slot — try another day or stylist')}</div>
            )}
          </React.Fragment>
        )}
      </div>
    </div>
  );
}

export default withPortalForm(GroupBookingDrawer);
