import { MutationButton } from '@youty/shared';
// WaitlistModal — full waiting list (GET /api/agenda/waitlist), ranked presentation,
// "Contattato" → POST /waitlist/{id}/contacted, "Proponi" → newappt prefill.
// NOTE: entries are created by clients from the app — no staff add-form (API is client-only).
import React, { useEffect, useState } from 'react';
import { api, Avatar, Icon, fmtDateIt } from '@youty/shared';
import DkDrawer from '../../../ui/DkDrawer.jsx';
import { useDash } from '../../../ctx.jsx';
import { initialsOf, prefLabel, toastErr, wlDaysWaiting } from '../lib.js';

export default function WaitlistModal({ onClose }) {
  const { t, fireToast, openModal, hasScope, canMutate } = useDash();
  const canWrite = hasScope('agenda');
  const [list, setList] = useState(null); // null = loading
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get('/api/agenda/waitlist')
      .then((rows) => { if (alive) setList(rows); })
      .catch((err) => { if (alive) { setList([]); toastErr(err, t, fireToast); } });
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function markContacted(w) {
    if (busyId) return;
    setBusyId(w.id);
    try {
      const res = await api.post(`/api/agenda/waitlist/${w.id}/contacted`);
      setList((l) => l.map((x) => (x.id === w.id ? res : x)));
      fireToast({ msg: t(`${w.client_name.split(' ')[0]} segnata come contattata`, `${w.client_name.split(' ')[0]} marked as contacted`), icon: 'whatsapp' });
    } catch (err) { toastErr(err, t, fireToast); }
    finally { setBusyId(null); }
  }

  function propose(w) {
    onClose();
    setTimeout(() => openModal('newappt', {
      prefill: { clientId: w.client_id, clientName: w.client_name, serviceIds: [w.service_id], operatorId: w.operator_id || undefined },
    }), 150);
  }

  /* ranking presentation: active first, then longest-waiting first */
  const ordered = [...(list || [])].sort((a, b) => {
    const st = (x) => (x.status === 'active' ? 0 : x.status === 'contacted' ? 1 : 2);
    if (st(a) !== st(b)) return st(a) - st(b);
    return new Date(a.created_at) - new Date(b.created_at);
  });

  return (
    <DkDrawer open onClose={onClose}>
      <div style={{ padding: '22px 22px 0', borderBottom: '1px solid var(--hair)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--serif)', fontSize: 20, fontWeight: 500 }}>{t("Lista d'attesa", 'Waiting list')}</div>
            <div className="t-sm" style={{ color: 'var(--muted)', marginTop: 3 }}>
              {t('Quando si libera uno slot compatibile, proponi o contatta la prima cliente in lista. L’invio WhatsApp è gestito da Yourang.', 'When a matching slot frees up, propose it or contact the first client in line. WhatsApp sending is handled by Yourang.')}
            </div>
          </div>
          <button className="dk-iconbtn" onClick={onClose} style={{ flexShrink: 0 }}><Icon name="x" size={19} /></button>
        </div>
      </div>
      <div className="scroll" style={{ flex: 1, overflowY: 'auto', padding: '16px 22px' }}>
        {list === null && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[...Array(4)].map((_, i) => <div key={i} className="skel" style={{ height: 110, borderRadius: 14 }} />)}
          </div>
        )}
        {list && !list.length && (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <Icon name="clients" size={28} color="var(--muted-2)" style={{ margin: '0 auto 10px' }} />
            <div className="t-sm" style={{ color: 'var(--muted-2)' }}>{t("Nessuna cliente in lista d'attesa. Le richieste arrivano dall'app clienti.", 'No clients on the waiting list. Requests come from the client app.')}</div>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          {ordered.map((w, pos) => {
            const days = wlDaysWaiting(w);
            const contacted = w.status === 'contacted';
            return (
              <div key={w.id} className="dk-card" style={{ padding: 14, boxShadow: 'none', border: '1px solid ' + (pos === 0 && !contacted ? 'var(--clay)' : 'var(--hair)'), display: 'flex', gap: 12 }}>
                <span className="t-num" style={{ fontSize: 14, fontWeight: 700, color: pos === 0 ? 'var(--clay-ink)' : 'var(--muted)', paddingTop: 8, flexShrink: 0, width: 18, textAlign: 'center' }}>{pos + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <Avatar initials={initialsOf(w.client_name)} size={36} color="var(--clay)" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>{w.client_name}</span>
                        {pos === 0 && !contacted && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--clay-ink)', background: 'var(--clay-tint)', padding: '1px 7px', borderRadius: 99 }}>{t('Prossima', 'Next up')}</span>}
                        {contacted && <span style={{ fontSize: 10, fontWeight: 700, color: '#2E7D44', background: '#E7F3EA', padding: '1px 7px', borderRadius: 99 }}>{t('Contattata', 'Contacted')}</span>}
                      </div>
                      <div className="t-sm" style={{ color: 'var(--muted)' }}>
                        {w.service_name}{w.operator_name ? ' · ' + t('con', 'with') + ' ' + w.operator_name.split(' ')[0] : ''}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 10 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: 'var(--ink-2)', background: 'var(--surface-2)', padding: '3px 8px', borderRadius: 99 }}>
                      <Icon name="clock" size={11} color="var(--muted-2)" />{prefLabel(w, t)}
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: 'var(--muted)', background: 'var(--surface-2)', padding: '3px 8px', borderRadius: 99 }}>
                      {t('Dal', 'Since')} {fmtDateIt(w.created_at.slice(0, 10), { weekday: false })}{days > 0 ? ` · ${days}g` : ''}
                    </span>
                  </div>
                  {canWrite && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <MutationButton className="dk-btn dk-btn--clay" style={{ flex: 1, height: 36, fontSize: 13 }} onClick={() => propose(w)}>
                        <Icon name="calendar" size={15} color="#fff" />{t('Proponi', 'Propose')}
                      </MutationButton>
                      {!contacted && (
                        <MutationButton className="dk-btn dk-btn--ghost" disabled={busyId === w.id} style={{ flex: 1, height: 36, fontSize: 13 }} onClick={() => markContacted(w)}>
                          <Icon name="whatsapp" size={15} color="#3F9D58" />{t('Contattato', 'Contacted')}
                        </MutationButton>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ flexShrink: 0, padding: '12px 22px', borderTop: '1px solid var(--hair)', background: 'var(--surface)' }}>
        <div className="t-sm" style={{ color: 'var(--muted-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="info" size={14} color="var(--muted-2)" />
          {t("Le clienti si iscrivono alla lista dall'app di prenotazione.", 'Clients join the list from the booking app.')}
        </div>
      </div>
    </DkDrawer>
  );
}
