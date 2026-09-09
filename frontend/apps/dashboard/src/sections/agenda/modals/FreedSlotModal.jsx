import { MutationButton } from '@youty/shared';
// FreedSlotModal — after a staff cancel/no-show: matching waitlist entries for the freed
// slot, ranked client-side, with WhatsApp-suggestion copy (display only — Yourang sends).
import React, { useState } from 'react';
import { api, Avatar, Icon, timeLabel } from '@youty/shared';
import DkModal from '../../../ui/DkModal.jsx';
import { useDash } from '../../../ctx.jsx';
import { aStartMin, aEndMin, initialsOf, prefLabel, svcLabel, toastErr, wlRank, wlDaysWaiting, wlWhatsAppMsg } from '../lib.js';

export default function FreedSlotModal({ appointment, matches: rawMatches, onClose }) {
  const { t, lang, salon, fireToast, openModal, hasScope, canMutate } = useDash();
  const canWrite = hasScope('agenda');
  const [entries, setEntries] = useState(() => wlRank(rawMatches || [], appointment));
  const [busyId, setBusyId] = useState(null);
  if (!appointment) return null;

  const slotLabel = timeLabel(aStartMin(appointment)) + '–' + timeLabel(aEndMin(appointment));
  const best = entries[0];

  const reasonsFor = (w) => {
    const parts = [t('servizio compatibile', 'service matches')];
    const hour = Math.floor(aStartMin(appointment) / 60);
    if (w.preference === 'morning' && hour < 13) parts.push(t('preferisce mattina ✓', 'prefers morning ✓'));
    if (w.preference === 'afternoon' && hour >= 13) parts.push(t('preferisce pomeriggio ✓', 'prefers afternoon ✓'));
    if (w.operator_id && w.operator_id === appointment.operator_id) parts.push(t('operatrice richiesta ✓', 'requested stylist ✓'));
    const days = wlDaysWaiting(w);
    if (days >= 2) parts.push(t(`in lista da ${days} giorni`, `on list for ${days} days`));
    return parts.join(' · ');
  };

  const propose = (w) => {
    onClose();
    setTimeout(() => openModal('newappt', {
      prefill: {
        clientId: w.client_id, clientName: w.client_name,
        serviceIds: [w.service_id], operatorId: w.operator_id || appointment.operator_id,
        start: appointment.start, date: appointment.start.slice(0, 10),
      },
    }), 150);
  };

  async function markContacted(w) {
    if (busyId) return;
    setBusyId(w.id);
    try {
      await api.post(`/api/agenda/waitlist/${w.id}/contacted`);
      setEntries((l) => l.map((x) => (x.id === w.id ? { ...x, status: 'contacted' } : x)));
      fireToast({ msg: t(`${w.client_name.split(' ')[0]} segnata come contattata · l'invio è gestito da Yourang`, `${w.client_name.split(' ')[0]} marked as contacted · sending handled by Yourang`), icon: 'whatsapp' });
    } catch (err) { toastErr(err, t, fireToast); }
    finally { setBusyId(null); }
  }

  return (
    <DkModal open onClose={onClose} title={t('Slot liberato', 'Slot freed up')} sub={svcLabel(appointment) + ' · ' + slotLabel} width={520}
      foot={<button className="dk-btn dk-btn--ghost" onClick={onClose}>{t('Chiudi', 'Close')}</button>}>

      {/* best match */}
      {best && (
        <div style={{ padding: '14px 16px', borderRadius: 14, background: 'var(--clay-tint)', border: '1.5px solid var(--clay)', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
            <Icon name="sparkle" size={15} color="var(--clay-ink)" />
            <span style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--clay-ink)' }}>{t('Miglior corrispondenza in lista d’attesa', 'Best waiting-list match')}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <Avatar initials={initialsOf(best.client_name)} size={40} color="var(--clay)" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15.5 }}>{best.client_name}</div>
              <div className="t-sm" style={{ color: 'var(--clay-ink)', opacity: 0.75, marginTop: 2 }}>{reasonsFor(best)}</div>
            </div>
            {best.status === 'contacted' && <span style={{ fontSize: 10, fontWeight: 700, color: '#2E7D44', background: '#E7F3EA', padding: '2px 8px', borderRadius: 99, flexShrink: 0 }}>{t('Contattata', 'Contacted')}</span>}
          </div>
          {/* WhatsApp suggestion — display only, Yourang does the sending */}
          <div style={{ background: '#E7DED3', borderRadius: 12, padding: 10, margin: '12px 0 0' }}>
            <div style={{ background: '#fff', borderRadius: '4px 12px 12px 12px', padding: '9px 12px', fontSize: 13, lineHeight: 1.45, color: 'var(--ink-2)', boxShadow: '0 1px 1px rgba(0,0,0,0.08)' }}>
              {wlWhatsAppMsg(best, appointment, lang, salon?.name)}
            </div>
            <div className="t-sm" style={{ color: 'var(--muted)', fontSize: 10.5, marginTop: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
              <Icon name="ext" size={11} color="var(--muted)" />{t('Suggerimento messaggio · l’invio WhatsApp è gestito da Yourang', 'Message suggestion · WhatsApp sending is handled by Yourang')}
            </div>
          </div>
          {canWrite && (
            <div style={{ display: 'flex', gap: 9, marginTop: 13 }}>
              <button className="dk-btn dk-btn--clay" style={{ flex: 2, height: 42 }} onClick={() => propose(best)}>
                <Icon name="calendar" size={16} color="#fff" />{t('Proponi lo slot', 'Propose the slot')}
              </button>
              {best.status !== 'contacted' && (
                <MutationButton className="dk-btn dk-btn--ghost" disabled={busyId === best.id} style={{ flex: 1, height: 42 }} onClick={() => markContacted(best)}>
                  <Icon name="whatsapp" size={16} color="#3F9D58" />{t('Contattato', 'Contacted')}
                </MutationButton>
              )}
            </div>
          )}
        </div>
      )}

      {/* other matches */}
      {entries.length > 1 && (
        <React.Fragment>
          <div className="t-meta" style={{ marginBottom: 10 }}>{t('Altre clienti in lista', 'Other clients on the list')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {entries.slice(1).map((w) => (
              <div key={w.id} className="dk-card" style={{ padding: '11px 13px', display: 'flex', gap: 10, alignItems: 'center', boxShadow: 'none', border: '1px solid var(--hair)' }}>
                <Avatar initials={initialsOf(w.client_name)} size={34} color="var(--clay)" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 13.5 }}>{w.client_name}</span>
                    {w.status === 'contacted' && <span style={{ fontSize: 9.5, fontWeight: 700, color: '#2E7D44', background: '#E7F3EA', padding: '1px 6px', borderRadius: 99 }}>{t('Contattata', 'Contacted')}</span>}
                  </div>
                  <div className="t-sm" style={{ color: 'var(--muted)' }}>{w.service_name} · {prefLabel(w, t)}</div>
                </div>
                {canWrite && (
                  <div style={{ display: 'flex', gap: 7, flexShrink: 0 }}>
                    <button className="dk-btn dk-btn--clay" style={{ height: 34, fontSize: 12.5, padding: '0 12px' }} onClick={() => propose(w)}>{t('Proponi', 'Propose')}</button>
                    {w.status !== 'contacted' && (
                      <MutationButton className="dk-btn dk-btn--ghost" disabled={busyId === w.id} title={t('Segna contattata', 'Mark contacted')} style={{ height: 34, fontSize: 12.5, padding: '0 12px' }} onClick={() => markContacted(w)}>
                        <Icon name="whatsapp" size={13} color="#3F9D58" />
                      </MutationButton>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </React.Fragment>
      )}

      {entries.length === 0 && (
        <div className="t-sm" style={{ color: 'var(--muted-2)', textAlign: 'center', padding: 14 }}>{t('Nessuna cliente in lista per questo servizio.', 'No clients on the list for this service.')}</div>
      )}

      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--hair)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon name="plus" size={15} color="var(--muted-2)" />
        <span className="t-sm" style={{ color: 'var(--muted-2)', flex: 1 }}>{t("Vuoi proporre lo slot a un'altra cliente?", 'Want to propose this slot to another client?')}</span>
        <button className="dk-btn dk-btn--ghost" style={{ height: 34, fontSize: 13 }} onClick={() => { onClose(); setTimeout(() => openModal('waitlist'), 150); }}>{t("Apri lista d'attesa", 'Open waiting list')}</button>
        <button className="dk-btn dk-btn--ghost" style={{ height: 34, fontSize: 13 }} onClick={() => { onClose(); setTimeout(() => openModal('newappt', { prefill: { start: appointment.start, operatorId: appointment.operator_id, date: appointment.start.slice(0, 10) } }), 150); }}>{t('Nuova prenotazione', 'New booking')}</button>
      </div>
    </DkModal>
  );
}
