import { MutationTextarea } from '@youty/shared';
import { MutationNumInput } from '@youty/shared';
import { MutationSelect } from '@youty/shared';
import { MutationInput } from '@youty/shared';
import { MutationButton } from '@youty/shared';
// ApptDetailModal — full appointment detail: lifecycle actions, note edit, margin,
// reschedule via availability + move, freed-slot waitlist hand-off on cancel/no-show.
import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError, Avatar, Icon, fmtEur, fmtDur, timeLabel, minutesOfDay, fmtDateIt, todayStr, statusMeta, depositMeta, NumInput, parseISO } from '@youty/shared';
import DkModal from '../../../ui/DkModal.jsx';
import FlowSteps from '../FlowSteps.jsx';
import { useDash } from '../../../ctx.jsx';
import { aStartMin, aEndMin, initialsOf, toastErr, fmtMoney, wlMatches, noShowSteps, cancelSteps } from '../lib.js';

const NOSHOW_REASONS = [['cliente', 'Mancata presenza', 'No-show'], ['salute', 'Malattia / imprevisto', 'Illness / emergency'], ['altro', 'Altro', 'Other']];
const CANCEL_REASONS = [['cliente', 'Richiesta cliente', 'Client request'], ['salute', 'Malattia', 'Illness'], ['agenda', 'Sovrapposizione', 'Schedule clash'], ['altro', 'Altro', 'Other']];

export default function ApptDetailModal({ appointment, onMutate, onClose }) {
  const { t, lang, operators, opColors, services, serviceCategories, settings, fireToast, openModal, setTab, setSelClient, hasScope, canMutate } = useDash();
  const canWrite = hasScope('agenda');
  const [appt, setAppt] = useState(appointment);
  const [flow, setFlow] = useState(null); // 'reschedule' | 'noshow' | 'cancel'
  const [reason, setReason] = useState(null);
  const [reasonNote, setReasonNote] = useState('');
  const [busy, setBusy] = useState(false);

  /* conteggio lista d'attesa compatibile per il passo ④ della timeline (anteprima) */
  const [matchCount, setMatchCount] = useState(null);
  useEffect(() => {
    if (flow !== 'noshow' && flow !== 'cancel') return;
    setMatchCount(null);
    api.get('/api/agenda/waitlist')
      .then((wl) => setMatchCount(wlMatches(wl, appt).length))
      .catch(() => setMatchCount(null));
  }, [flow]); // eslint-disable-line react-hooks/exhaustive-deps

  /* cancellazione "tardiva" (caparra trattenuta) se manca meno della soglia salone */
  const cancelMinH = settings?.cancel_min_hours ?? 24;
  const lateCancel = !!appt && parseISO(appt.start).getTime() - Date.now() < cancelMinH * 3600000;

  /* enrich with client stats (visits, spend, categories, deposit_always) */
  const [clientDetail, setClientDetail] = useState(null);
  useEffect(() => {
    if (appt?.client?.id) api.get(`/api/clients/${appt.client.id}`).then(setClientDetail).catch(() => {});
  }, [appt?.client?.id]);

  /* note edit */
  const [note, setNote] = useState(appointment?.note || '');
  const [savingNote, setSavingNote] = useState(false);
  const noteDirty = note !== (appt?.note || '');

  /* services edit → PUT /appointments/{id} with the full items list */
  const itemSeq = useRef(1);
  const mkEditItems = (list) => (list || []).map((it) => ({
    key: 'e' + (itemSeq.current++),
    id: it.id,                        // existing item id (undefined for new lines → creates)
    service_id: it.service_id,
    operator_id: it.operator_id ?? null,
    duration_min: it.duration_min,
    price: Number(it.price) || 0,
    name: it.service_name,
  }));
  const [editItems, setEditItems] = useState(() => mkEditItems(appointment?.items));
  const [addingSvc, setAddingSvc] = useState(false);
  const [savingItems, setSavingItems] = useState(false);
  useEffect(() => { setEditItems(mkEditItems(appt?.items)); setAddingSvc(false); }, [appt]); // eslint-disable-line react-hooks/exhaustive-deps

  /* margin (behind a small toggle) */
  const [showMargin, setShowMargin] = useState(false);
  const [margin, setMargin] = useState(null);
  useEffect(() => {
    if (showMargin && !margin && appt?.id) {
      api.get(`/api/agenda/appointments/${appt.id}/margin`).then(setMargin).catch((err) => { toastErr(err, t, fireToast); setShowMargin(false); });
    }
  }, [showMargin]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!appt) return null;
  const o = operators.find((x) => x.id === appt.operator_id);
  const col = opColors[appt.operator_id] || 'var(--clay)';
  const sm = statusMeta(appt.status, t);
  const dm = depositMeta(appt.deposit_status, t);
  const startMin = aStartMin(appt), endMin = aEndMin(appt);
  const dateStr = appt.start.slice(0, 10);
  const terminal = ['closed', 'no_show', 'cancelled'].includes(appt.status);

  /* ---- editable services (only when live + can write) ---- */
  const itemsEditable = !terminal && canWrite;
  const svcOf = (id) => (services || []).find((s) => s.id === id);
  const activeServices = (services || []).filter((s) => s.active !== false);
  const catColor = (catId) => (serviceCategories || []).find((c) => c.id === catId)?.color || 'var(--clay)';
  const eligibleOps = (serviceId) => operators.filter((op) => (op.service_ids || []).includes(serviceId));
  const svcDisplayName = (it) => { const s = svcOf(it.service_id); return s ? (lang === 'en' && s.name_en ? s.name_en : s.name_it) : (it.name || it.service_name || ''); };
  const itemsSig = (list) => JSON.stringify((list || []).map((i) => [i.id ?? null, i.service_id, i.operator_id ?? null, Number(i.duration_min) || 0]));
  const itemsDirty = itemsSig(editItems) !== itemsSig(appt.items);
  const editTotal = editItems.reduce((s, it) => s + Number(it.price || 0), 0);

  const addServiceItem = (sid) => {
    const s = svcOf(sid);
    setEditItems((l) => [...l, { key: 'e' + (itemSeq.current++), id: undefined, service_id: sid, operator_id: null, duration_min: s?.duration_min ?? 30, price: Number(s?.price) || 0, name: s ? (lang === 'en' && s.name_en ? s.name_en : s.name_it) : '' }]);
  };
  const removeServiceItem = (key) => setEditItems((l) => l.filter((x) => x.key !== key));
  const setItemDuration = (key, raw) => setEditItems((l) => l.map((x) => (x.key === key ? { ...x, duration_min: raw === '' ? '' : Math.max(0, parseInt(raw, 10) || 0) } : x)));
  const clampItemDuration = (key) => setEditItems((l) => l.map((x) => (x.key === key ? { ...x, duration_min: Math.max(5, parseInt(x.duration_min, 10) || 5) } : x)));
  const setItemOperator = (key, opId) => setEditItems((l) => l.map((x) => (x.key === key ? { ...x, operator_id: opId } : x)));

  async function saveItems() {
    if (savingItems || !editItems.length) return;
    setSavingItems(true);
    try {
      const res = await api.put(`/api/agenda/appointments/${appt.id}`, {
        items: editItems.map((it) => ({
          ...(it.id != null ? { id: it.id } : {}),   // existing → id; new → omitted; omitted rows → removed
          service_id: it.service_id,
          operator_id: it.operator_id ?? null,
          duration_min: Math.max(5, parseInt(it.duration_min, 10) || 5),
        })),
      });
      setAppt(res);
      fireToast({ msg: t('Appuntamento aggiornato', 'Appointment updated'), icon: 'check' });
      onMutate?.();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) fireToast({ msg: t('Orario non più disponibile', 'Time no longer available'), icon: 'alert' });
      else toastErr(err, t, fireToast);
    } finally { setSavingItems(false); }
  }

  const openClient = () => { setSelClient(appt.client.id); setTab('clienti'); onClose(); };

  async function saveNote() {
    setSavingNote(true);
    try {
      const res = await api.put(`/api/agenda/appointments/${appt.id}`, { note });
      setAppt(res);
      fireToast({ msg: t('Nota salvata', 'Note saved'), icon: 'check' });
    } catch (err) { toastErr(err, t, fireToast); }
    finally { setSavingNote(false); }
  }

  async function lifecycle(action, body, toastMsg, icon) {
    if (busy) return false;
    setBusy(true);
    try {
      await api.post(`/api/agenda/appointments/${appt.id}/${action}`, body || {});
      fireToast({ msg: toastMsg, icon });
      return true;
    } catch (err) { toastErr(err, t, fireToast); return false; }
    finally { setBusy(false); }
  }

  const checkIn = async () => { if (await lifecycle('check-in', null, t('Check-in registrato', 'Checked in'), 'check')) onClose(); };
  const startAppt = async () => { if (await lifecycle('start', null, t('Trattamento avviato', 'Treatment started'), 'clock')) onClose(); };

  /* cancel / no-show → then offer the freed slot to matching waitlist entries */
  async function destroy(kind) {
    const reasons = kind === 'no-show' ? NOSHOW_REASONS : CANCEL_REASONS;
    const label = (reasons.find((r) => r[0] === reason) || [])[1] || '';
    const fullReason = [label, reasonNote].filter(Boolean).join(' — ');
    const ok = await lifecycle(
      kind, { reason: fullReason },
      kind === 'no-show' ? t('No-show registrato · slot liberato', 'No-show recorded · slot freed') : t('Appuntamento cancellato · slot liberato', 'Appointment cancelled · slot freed'),
      kind === 'no-show' ? 'alert' : 'x'
    );
    if (!ok) return;
    try {
      const wl = await api.get('/api/agenda/waitlist');
      const matches = wlMatches(wl, appt);
      if (matches.length) { openModal('freedslot', { appointment: appt, matches }); return; }
    } catch { /* ignore — just close */ }
    onClose();
  }

  /* ---- reason picker (shared by no-show + cancel) ---- */
  const ReasonPicker = ({ reasons }) => (
    <div>
      <div className="t-meta" style={{ marginBottom: 9 }}>{t('Motivazione (per le statistiche)', 'Reason (for statistics)')}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {reasons.map(([k, it, en]) => {
          const on = reason === k;
          return <MutationButton key={k} onClick={() => setReason(k)} style={{ padding: '8px 14px', borderRadius: 99, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: '1.5px solid ' + (on ? 'var(--ink)' : 'var(--hair)'), background: on ? 'var(--ink)' : 'var(--surface)', color: on ? '#fff' : 'var(--ink-2)' }}>{t(it, en)}</MutationButton>;
        })}
      </div>
      <div className="t-meta" style={{ marginBottom: 8 }}>{t('Nota (facoltativa)', 'Note (optional)')}</div>
      <MutationTextarea value={reasonNote} onChange={(e) => setReasonNote(e.target.value)} placeholder={t('Aggiungi un dettaglio…', 'Add a detail…')} rows={2}
        style={{ width: '100%', border: '1px solid var(--hair)', borderRadius: 12, padding: '10px 12px', fontSize: 13.5, fontFamily: 'var(--sans)', resize: 'vertical', outline: 'none', boxSizing: 'border-box', background: 'var(--surface)' }} />
    </div>
  );

  /* ---- RESCHEDULE flow ---- */
  if (flow === 'reschedule') {
    return (
      <RescheduleFlow appt={appt} t={t} lang={lang} fireToast={fireToast} busy={busy} setBusy={setBusy}
        onBack={() => setFlow(null)} onClose={onClose} onDone={onClose} />
    );
  }

  /* ---- NO-SHOW flow ---- */
  if (flow === 'noshow') {
    return (
      <DkModal open onClose={onClose} title={t('Segna no-show', 'Mark no-show')} sub={`${appt.client?.full_name} · ${timeLabel(startMin)}`} width={460}
        foot={
          <React.Fragment>
            <button className="dk-btn dk-btn--ghost" onClick={() => setFlow(null)}>{t('Indietro', 'Back')}</button>
            <MutationButton className="dk-btn" disabled={busy} onClick={() => destroy('no-show')} style={{ background: 'var(--danger)', color: '#fff' }}>
              <Icon name="alert" size={16} color="#fff" />{t('Conferma no-show', 'Confirm no-show')}
            </MutationButton>
          </React.Fragment>
        }>
        <div className="t-meta" style={{ marginBottom: 12 }}>{t('Cosa succederà', 'What will happen')}</div>
        <div style={{ padding: '16px 16px 14px', borderRadius: 14, background: 'var(--surface-2)', marginBottom: 18 }}>
          <FlowSteps steps={noShowSteps(appt, matchCount, t, lang)} />
        </div>
        <ReasonPicker reasons={NOSHOW_REASONS} />
      </DkModal>
    );
  }

  /* ---- CANCEL flow ---- */
  if (flow === 'cancel') {
    return (
      <DkModal open onClose={onClose} title={t('Cancella appuntamento', 'Cancel appointment')} sub={`${appt.client?.full_name} · ${timeLabel(startMin)}`} width={460}
        foot={
          <React.Fragment>
            <button className="dk-btn dk-btn--ghost" onClick={() => { setFlow(null); setReason(null); setReasonNote(''); }}>{t('Indietro', 'Back')}</button>
            <MutationButton className="dk-btn" disabled={!reason || busy} onClick={() => destroy('cancel')} style={{ background: 'var(--danger)', color: '#fff', opacity: reason ? 1 : 0.4 }}>
              <Icon name="x" size={16} color="#fff" />{t('Conferma cancellazione', 'Confirm cancellation')}
            </MutationButton>
          </React.Fragment>
        }>
        <div className="t-meta" style={{ marginBottom: 12 }}>{t('Cosa succederà', 'What will happen')}</div>
        <div style={{ padding: '16px 16px 14px', borderRadius: 14, background: 'var(--surface-2)', marginBottom: 18 }}>
          <FlowSteps steps={cancelSteps(appt, lateCancel, matchCount, t, lang)} />
        </div>
        <ReasonPicker reasons={CANCEL_REASONS} />
      </DkModal>
    );
  }

  /* ---- DETAIL (default) ---- */
  return (
    <DkModal open onClose={onClose} title={appt.client?.full_name} sub={`${fmtDateIt(dateStr)} · ${timeLabel(startMin)}–${timeLabel(endMin)}`} width={840}>
      {/* client meta bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Avatar initials={initialsOf(appt.client?.full_name)} size={40} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: sm.color, background: sm.tint, padding: '3px 9px', borderRadius: 99 }}>{sm.label}</span>
            {(clientDetail?.categories || []).slice(0, 2).map((c) => (
              <span key={c.id} style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-2)', background: c.color || 'var(--surface-2)', padding: '3px 9px', borderRadius: 99 }}>{c.name}</span>
            ))}
            {clientDetail && <span className="t-sm" style={{ color: 'var(--muted)' }}>{clientDetail.visits} {t('visite', 'visits')} · {fmtMoney(clientDetail.total_spent, lang)}</span>}
          </div>
          {appt.client?.phone && <a href={'tel:' + appt.client.phone} className="tabnum" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', textDecoration: 'none' }}>{appt.client.phone}</a>}
        </div>
        <div style={{ flex: 1 }} />
        <button className="dk-btn dk-btn--soft" style={{ height: 38, fontSize: 13, padding: '0 14px' }} onClick={openClient}>{t('Apri scheda cliente', 'Open client')}</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, alignItems: 'start' }}>
        {/* LEFT — who */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* operator hero */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 16, background: `color-mix(in srgb, ${col} 26%, #FFFFFF)` }}>
            <Avatar initials={o?.initials || initialsOf((appt.items || [])[0]?.operator_name)} size={50} color={col} ring />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="t-meta" style={{ fontSize: 10, color: 'var(--ink-2)', opacity: 0.7, marginBottom: 1 }}>{t('Operatrice', 'Stylist')}</div>
              <div style={{ fontFamily: 'var(--serif)', fontSize: 22, fontWeight: 500, lineHeight: 1.05 }}>{o ? o.first_name : (appt.items || [])[0]?.operator_name}</div>
              {o?.role_title && <div className="t-sm" style={{ color: 'var(--ink-2)', opacity: 0.75 }}>{o.role_title}</div>}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="tabnum" style={{ fontWeight: 700, fontSize: 15 }}>{timeLabel(startMin)}</div>
              <div className="t-sm" style={{ color: 'var(--ink-2)', opacity: 0.7 }}>{fmtDur(appt.total_duration_min, lang)}</div>
            </div>
          </div>

          {/* deposit status */}
          {dm && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 14px', borderRadius: 12, background: appt.deposit_status === 'paid' ? 'var(--ok-tint)' : 'var(--warn-tint)', border: '1px solid color-mix(in srgb, ' + dm.color + ' 28%, transparent)' }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: appt.deposit_status === 'paid' ? 'var(--ok)' : 'var(--surface)', border: appt.deposit_status === 'paid' ? 'none' : '1.5px dashed ' + dm.color, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <Icon name={appt.deposit_status === 'paid' ? 'check' : 'wallet'} size={16} color={appt.deposit_status === 'paid' ? '#fff' : dm.color} stroke={appt.deposit_status === 'paid' ? 3 : 1.7} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: dm.color }}>{dm.label}</div>
                <div className="t-sm" style={{ color: 'var(--ink-2)' }}>{fmtEur(Number(appt.deposit_amount), lang)}</div>
              </div>
            </div>
          )}

          {/* note edit → PUT /appointments/{id} */}
          <div>
            <div className="t-meta" style={{ marginBottom: 6 }}>{t('Nota appuntamento', 'Appointment note')}</div>
            <MutationTextarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={t('Aggiungi una nota…', 'Add a note…')}
              style={{ width: '100%', border: '1px solid var(--hair)', borderRadius: 12, padding: '10px 12px', fontSize: 13.5, fontFamily: 'var(--sans)', resize: 'vertical', outline: 'none', boxSizing: 'border-box', background: 'var(--surface)' }} />
            {noteDirty && (
              <MutationButton className="dk-btn dk-btn--soft" disabled={savingNote || !canWrite} style={{ height: 34, fontSize: 12.5, marginTop: 6 }} onClick={saveNote}>
                <Icon name="check" size={14} />{savingNote ? t('Salvataggio…', 'Saving…') : t('Salva nota', 'Save note')}
              </MutationButton>
            )}
          </div>

          {/* margin — behind a small toggle */}
          <div>
            <button onClick={() => setShowMargin((v) => !v)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', background: 'transparent', border: 'none', fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', padding: 0 }}>
              <Icon name="insights" size={14} color="var(--muted)" />{showMargin ? t('Nascondi margine', 'Hide margin') : t('Mostra margine', 'Show margin')}
              <Icon name="chevD" size={12} color="var(--muted)" style={{ transform: showMargin ? 'rotate(180deg)' : 'none', transition: 'transform 140ms' }} />
            </button>
            {showMargin && (
              !margin ? <div className="skel" style={{ height: 96, borderRadius: 12, marginTop: 8 }} /> : (
                <div style={{ background: 'var(--surface-2)', borderRadius: 12, padding: '11px 14px', marginTop: 8 }}>
                  {[[t('Ricavo', 'Revenue'), margin.revenue, false], [t('Costo prodotti', 'Product cost'), margin.product_cost, true], [t('Costo fornitori', 'Supplier cost'), margin.supplier_cost, true], [t('Costo lavoro', 'Labour cost'), margin.labor_cost, true]].map(([l, v, neg], i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                      <span className="t-sm" style={{ color: 'var(--muted)' }}>{l}</span>
                      <span className="tabnum" style={{ fontSize: 12.5 }}>{neg ? '− ' : ''}{fmtEur(Number(v), lang)}</span>
                    </div>
                  ))}
                  <div className="hr" style={{ margin: '6px 0' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontWeight: 700, fontSize: 13.5 }}>{t('Margine stimato', 'Estimated margin')}</span>
                    <span className="t-num" style={{ fontWeight: 800, fontSize: 16, color: Number(margin.margin) >= 0 ? 'var(--ok)' : 'var(--danger)' }}>{fmtEur(Number(margin.margin), lang)} · {margin.margin_pct}%</span>
                  </div>
                </div>
              )
            )}
          </div>
        </div>

        {/* RIGHT — what & actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 16, borderRadius: 16, border: '1px solid var(--hair)', background: 'color-mix(in srgb, var(--surface-2) 45%, transparent)' }}>
          {/* services — read-only when terminal / no write scope, editable otherwise */}
          {!itemsEditable ? (
            <div style={{ background: 'var(--surface-2)', borderRadius: 14, padding: 14 }}>
              {(appt.items || []).map((it) => (
                <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{it.service_name}</span>
                  <span className="t-sm" style={{ color: 'var(--muted)' }}>{fmtDur(it.duration_min, lang)} · {fmtEur(Number(it.price), lang)}</span>
                </div>
              ))}
              <div className="hr" style={{ margin: '8px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                <span>{t('Totale', 'Total')}</span>
                <span className="t-num" style={{ fontSize: 17 }}>{fmtMoney(appt.total_price, lang)}</span>
              </div>
            </div>
          ) : (
            <div style={{ background: 'var(--surface-2)', borderRadius: 14, padding: 14 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {editItems.map((it) => {
                  const s = svcOf(it.service_id);
                  const color = catColor(s?.category_id);
                  const isNew = it.id == null;
                  const eligible = isNew ? eligibleOps(it.service_id) : [];
                  return (
                    <div key={it.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 99, background: color, flexShrink: 0 }} />
                        <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{svcDisplayName(it)}</span>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                          <MutationNumInput integer min={5} value={it.duration_min} emptyValue=""
                            onChange={(v) => setItemDuration(it.key, v)} onBlur={() => clampItemDuration(it.key)}
                            aria-label={t('Durata in minuti', 'Duration in minutes')}
                            style={{ width: 48, border: '1px solid var(--hair)', borderRadius: 8, padding: '4px 6px', fontSize: 12.5, fontFamily: 'var(--sans)', textAlign: 'right', outline: 'none', background: 'var(--surface)', color: 'var(--ink)' }} />
                          <span className="t-sm" style={{ color: 'var(--muted)' }}>{t('min', 'min')}</span>
                        </div>
                        <span className="t-num" style={{ fontSize: 13, fontWeight: 700, flexShrink: 0, minWidth: 46, textAlign: 'right' }}>{fmtEur(Number(it.price), lang)}</span>
                        <MutationButton className="dk-iconbtn" title={t('Rimuovi servizio', 'Remove service')} onClick={() => removeServiceItem(it.key)} style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0 }}>
                          <Icon name="x" size={14} />
                        </MutationButton>
                      </div>
                      {isNew && eligible.length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 16 }}>
                          <Icon name="sparkle" size={12} color="var(--muted-2)" />
                          <MutationSelect value={it.operator_id ?? ''} onChange={(e) => setItemOperator(it.key, e.target.value ? Number(e.target.value) : null)}
                            style={{ border: '1px solid var(--hair)', borderRadius: 8, padding: '4px 6px', fontSize: 12, fontFamily: 'var(--sans)', background: 'var(--surface)', color: 'var(--ink-2)', outline: 'none', cursor: 'pointer' }}>
                            <option value="">{t('Prima disponibile', 'First available')}</option>
                            {eligible.map((op) => <option key={op.id} value={op.id}>{op.first_name}</option>)}
                          </MutationSelect>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* add a service */}
              <div style={{ marginTop: 10 }}>
                {!addingSvc ? (
                  <MutationButton onClick={() => setAddingSvc(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', background: 'transparent', border: 'none', fontSize: 12.5, fontWeight: 700, color: 'var(--clay-ink)', padding: 0 }}>
                    <Icon name="plus" size={14} color="var(--clay-ink)" />{t('Aggiungi servizio', 'Add service')}
                  </MutationButton>
                ) : (
                  <div style={{ border: '1px dashed var(--line-strong)', borderRadius: 12, padding: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                      <span className="t-meta" style={{ margin: 0 }}>{t('Scegli un servizio', 'Choose a service')}</span>
                      <button onClick={() => setAddingSvc(false)} className="dk-iconbtn" style={{ width: 24, height: 24, borderRadius: 7, marginLeft: 'auto' }}><Icon name="x" size={13} /></button>
                    </div>
                    {activeServices.length ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {activeServices.map((s) => (
                          <MutationButton key={s.id} onClick={() => { addServiceItem(s.id); setAddingSvc(false); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid var(--hair)', background: 'var(--surface)', color: 'var(--ink-2)' }}>
                            <span style={{ width: 7, height: 7, borderRadius: 99, background: catColor(s.category_id) }} />
                            {lang === 'en' && s.name_en ? s.name_en : s.name_it}
                            <Icon name="plus" size={12} color="var(--muted-2)" />
                          </MutationButton>
                        ))}
                      </div>
                    ) : (
                      <div className="t-sm" style={{ color: 'var(--muted-2)' }}>{t('Nessun servizio disponibile', 'No service available')}</div>
                    )}
                  </div>
                )}
              </div>

              <div className="hr" style={{ margin: '10px 0 8px' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                <span>{t('Totale', 'Total')}</span>
                <span className="t-num" style={{ fontSize: 17 }}>{fmtMoney(editTotal, lang)}</span>
              </div>
              {itemsDirty && (
                <MutationButton className="dk-btn dk-btn--soft" disabled={savingItems || !editItems.length} onClick={saveItems} style={{ height: 36, fontSize: 12.5, marginTop: 10, width: '100%' }}>
                  <Icon name="check" size={14} />{savingItems ? t('Salvataggio…', 'Saving…') : t('Salva modifiche', 'Save changes')}
                </MutationButton>
              )}
            </div>
          )}

          {/* lifecycle actions */}
          {!terminal && canWrite && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {appt.status === 'confirmed' && (
                <MutationButton className="dk-btn dk-btn--clay" disabled={busy} style={{ gridColumn: '1 / -1', height: 48 }} onClick={checkIn}>
                  <Icon name="check" size={18} color="#fff" />{t('Check-in', 'Check in')}
                </MutationButton>
              )}
              {appt.status === 'checked_in' && (
                <MutationButton className="dk-btn dk-btn--clay" disabled={busy} style={{ gridColumn: '1 / -1', height: 48 }} onClick={startAppt}>
                  <Icon name="play" size={17} color="#fff" />{t('Inizia trattamento', 'Start treatment')}
                </MutationButton>
              )}
              <MutationButton className={'dk-btn ' + (appt.status === 'in_progress' ? 'dk-btn--clay' : 'dk-btn--ghost')} style={{ gridColumn: '1 / -1', height: appt.status === 'in_progress' ? 48 : 44 }} onClick={() => openModal('sell', { appointment: appt, onDone: onMutate })}>
                <Icon name="wallet" size={17} color={appt.status === 'in_progress' ? '#fff' : undefined} />{t('Vai al checkout', 'Go to checkout')}
              </MutationButton>
              <MutationButton className="dk-btn dk-btn--soft" style={{ gridColumn: '1 / -1' }} onClick={() => setFlow('reschedule')}>
                <Icon name="calendar" size={16} />{t('Riprogramma', 'Reschedule')}
              </MutationButton>
            </div>
          )}
          {terminal && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 13px', borderRadius: 12, background: sm.tint }}>
              <Icon name={sm.icon} size={16} color={sm.color} />
              <span style={{ fontWeight: 700, fontSize: 13.5, color: sm.color }}>{sm.label}</span>
              {appt.cancel_reason && <span className="t-sm" style={{ color: 'var(--muted)', marginLeft: 'auto' }}>{appt.cancel_reason}</span>}
            </div>
          )}
        </div>
      </div>

      {/* downgraded destructive actions */}
      {!terminal && canWrite && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18, paddingTop: 14, marginTop: 14, borderTop: '1px solid var(--hair)' }}>
          <MutationButton onClick={() => { setFlow('noshow'); setReason(NOSHOW_REASONS[0][0]); setReasonNote(''); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--muted)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '6px 8px' }}>
            <Icon name="alert" size={15} color="var(--muted)" />No-show
          </MutationButton>
          <span style={{ width: 1, height: 16, background: 'var(--hair)' }} />
          <MutationButton onClick={() => { setFlow('cancel'); setReason(null); setReasonNote(''); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--muted)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '6px 8px' }}>
            <Icon name="x" size={15} color="var(--muted)" />{t('Cancella appuntamento', 'Cancel appointment')}
          </MutationButton>
        </div>
      )}
    </DkModal>
  );
}

/* ---- Riprogramma: pick a new slot via availability, then POST /move ---- */
function RescheduleFlow({ appt, t, lang, fireToast, busy, setBusy, onBack, onClose, onDone }) {
  const [date, setDate] = useState(appt.start.slice(0, 10) >= todayStr() ? appt.start.slice(0, 10) : todayStr());
  const [slots, setSlots] = useState(null);
  const [selStart, setSelStart] = useState(null);
  const items = (appt.items || []).map((it) => ({ service_id: it.service_id, operator_id: it.operator_id }));

  useEffect(() => {
    let alive = true;
    setSlots(null); setSelStart(null);
    api.get('/api/agenda/availability', { params: { date, items } })
      .then((res) => { if (alive) setSlots(res); })
      .catch((err) => { if (alive) { setSlots([]); toastErr(err, t, fireToast); } });
    return () => { alive = false; };
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  async function move() {
    if (!selStart || busy) return;
    setBusy(true);
    try {
      await api.post(`/api/agenda/appointments/${appt.id}/move`, { start: selStart });
      fireToast({ msg: t('Appuntamento riprogrammato alle ' + timeLabel(minutesOfDay(selStart)), 'Rescheduled to ' + timeLabel(minutesOfDay(selStart))), icon: 'calendar' });
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        fireToast({ msg: t('Orario non più disponibile', 'Time no longer available'), icon: 'alert' });
        setSelStart(null);
        api.get('/api/agenda/availability', { params: { date, items } }).then(setSlots).catch(() => {});
      } else toastErr(err, t, fireToast);
    } finally { setBusy(false); }
  }

  return (
    <DkModal open onClose={onClose} title={t('Riprogramma', 'Reschedule')} sub={`${appt.client?.full_name} · ${t('attuale', 'currently')} ${fmtDateIt(appt.start.slice(0, 10), { weekday: false })} ${timeLabel(aStartMin(appt))}`} width={560}
      foot={
        <React.Fragment>
          <button className="dk-btn dk-btn--ghost" onClick={onBack}>{t('Indietro', 'Back')}</button>
          <MutationButton className="dk-btn dk-btn--clay" disabled={!selStart || busy} onClick={move}>
            <Icon name="calendar" size={16} color="#fff" />{t('Sposta qui', 'Move here')}{selStart ? ' · ' + timeLabel(minutesOfDay(selStart)) : ''}
          </MutationButton>
        </React.Fragment>
      }>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, padding: '11px 14px', borderRadius: 12, border: '1px solid var(--hair)', background: 'var(--surface)' }}>
        <Icon name="calendar" size={17} color="var(--clay-ink)" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="t-meta" style={{ fontSize: 9.5, marginBottom: 1 }}>{t('Nuova data', 'New date')}</div>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>{fmtDateIt(date)}</div>
        </div>
        <MutationInput type="date" value={date} min={todayStr()} onChange={(e) => setDate(e.target.value || todayStr())} style={{ border: '1px solid var(--hair)', borderRadius: 8, padding: '6px 8px', fontSize: 12.5, fontFamily: 'var(--sans)', outline: 'none', cursor: 'pointer', color: 'var(--ink)' }} />
      </div>
      <div className="t-meta" style={{ marginBottom: 9 }}>{t('Orari disponibili', 'Available times')}</div>
      {slots === null ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {[...Array(12)].map((_, i) => <div key={i} className="skel" style={{ width: 56, height: 30, borderRadius: 8 }} />)}
        </div>
      ) : slots.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {slots.map((s) => {
            const sel = s.start === selStart;
            return (
              <MutationButton key={s.start} onClick={() => setSelStart(s.start)} className="tabnum" style={{ padding: '5px 9px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: '1.5px solid ' + (sel ? 'var(--ink)' : 'var(--hair)'), background: sel ? 'var(--ink)' : 'var(--surface)', color: sel ? '#fff' : 'var(--ink)' }}>
                {timeLabel(minutesOfDay(s.start))}
              </MutationButton>
            );
          })}
        </div>
      ) : (
        <div className="t-sm" style={{ color: 'var(--danger)', fontWeight: 600 }}>{t('Nessuno slot libero in questa data', 'No free slot on this date')}</div>
      )}
    </DkModal>
  );
}
