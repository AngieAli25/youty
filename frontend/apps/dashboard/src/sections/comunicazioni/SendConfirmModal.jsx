import { withPortalForm } from '@youty/shared';
import { MutationButton } from '@youty/shared';
// SendConfirmModal.jsx — confirm dialog for POST /api/marketing/communications/{id}/send.
// Sends now, or schedules (optional scheduled_at): either way the event is queued in the
// outbox and the actual WhatsApp delivery is handled by Yourang.
import React, { useState } from 'react';
import { api, ApiError, Icon } from '@youty/shared';
import { DkModal } from '../../ui/index.js';
import { useDash } from '../../ctx.jsx';
import { audienceSummary, dtLocalToIso, isoToDtLocal } from './helpers.js';

const inputCss = {
  border: '1px solid var(--hair)', borderRadius: 9, outline: 'none', fontSize: 14,
  padding: '10px 12px', fontFamily: 'var(--sans)', background: 'var(--surface)',
  width: '100%', boxSizing: 'border-box',
};

function SendConfirmModal({ comm, onClose, onSent }) {
  const { t, clientCategories, fireToast } = useDash();
  const [mode, setMode] = useState(comm.scheduled_at ? 'schedule' : 'now'); // 'now' | 'schedule'
  const [when, setWhen] = useState(isoToDtLocal(comm.scheduled_at));
  const [sending, setSending] = useState(false);

  const canConfirm = mode === 'now' || !!when;

  const confirm = async () => {
    if (!canConfirm || sending) return;
    setSending(true);
    try {
      if (mode === 'now' && comm.scheduled_at) {
        // The backend falls back to the stored scheduled_at when the send body has none
        // (`scheduled_at or comm.scheduled_at`) — clear it first so "send now" really sends now.
        await api.put(`/api/marketing/communications/${comm.id}`, {
          title: comm.title, body: comm.body,
          cta_label: comm.cta_label || '', cta_url: comm.cta_url || '',
          audience_type: comm.audience_type, audience: comm.audience || [],
          scheduled_at: null,
        });
      }
      const body = mode === 'schedule' ? { scheduled_at: dtLocalToIso(when) } : { scheduled_at: null };
      const updated = await api.post(`/api/marketing/communications/${comm.id}/send`, body);
      fireToast({
        msg: updated.status === 'scheduled'
          ? t('Invio programmato', 'Send scheduled')
          : t('Comunicazione inviata', 'Communication sent'),
        icon: 'check',
      });
      onSent(updated);
    } catch (err) {
      fireToast({ msg: err instanceof ApiError ? err.message : t('Errore di rete', 'Network error'), icon: 'alert' });
      setSending(false);
    }
  };

  const modes = [
    { key: 'now', label: t('Invia subito', 'Send now'), icon: 'send' },
    { key: 'schedule', label: t('Programma invio', 'Schedule'), icon: 'clock' },
  ];

  return (
    <DkModal
      open
      onClose={onClose}
      width={480}
      title={t('Invia comunicazione', 'Send communication')}
      sub={comm.title}
      foot={
        <React.Fragment>
          <button className="dk-btn dk-btn--ghost" onClick={onClose}>{t('Annulla', 'Cancel')}</button>
          <MutationButton className="dk-btn dk-btn--clay" disabled={!canConfirm || sending} onClick={confirm}>
            <Icon name="send" size={16} color="#fff" />
            {mode === 'schedule' ? t('Programma', 'Schedule') : t('Invia ora', 'Send now')}
          </MutationButton>
        </React.Fragment>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
        {modes.map((m) => {
          const on = mode === m.key;
          return (
            <button key={m.key} onClick={() => setMode(m.key)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', borderRadius: 10, cursor: 'pointer', textAlign: 'left', border: '1px solid ' + (on ? 'var(--clay)' : 'var(--hair)'), background: on ? 'var(--clay-tint)' : 'var(--surface)' }}>
              <span style={{ width: 16, height: 16, borderRadius: 99, border: '1.8px solid ' + (on ? 'var(--clay)' : 'var(--faint)'), background: on ? 'var(--clay)' : 'transparent', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                {on && <Icon name="check" size={10} color="#fff" stroke={2.6} />}
              </span>
              <Icon name={m.icon} size={16} color={on ? 'var(--clay-ink)' : 'var(--muted)'} />
              <span style={{ fontWeight: 700, fontSize: 13.5, color: on ? 'var(--clay-ink)' : 'var(--ink)' }}>{m.label}</span>
            </button>
          );
        })}
      </div>

      {mode === 'schedule' && (
        <div style={{ marginBottom: 14 }}>
          <div className="t-meta" style={{ marginBottom: 5 }}>{t('Data e ora', 'Date & time')}</div>
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} style={inputCss} />
          <div className="t-sm" style={{ color: 'var(--muted-2)', marginTop: 6 }}>
            {t('Es. la mattina di un cambio stagione o di un lancio.', 'E.g. the morning of a season change or a launch.')}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '11px 13px', background: 'var(--surface-2)', borderRadius: 12, marginBottom: 10 }}>
        <Icon name="clients" size={15} color="var(--muted)" />
        <span className="t-sm" style={{ color: 'var(--ink-2)', lineHeight: 1.45 }}>
          {t('Destinatari', 'Recipients')}: <b>{audienceSummary(comm, clientCategories, t)}</b>
          {' — '}{t('solo clienti con consenso marketing.', 'marketing-consent clients only.')}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '11px 13px', background: 'var(--clay-tint)', borderRadius: 12 }}>
        <Icon name="whatsapp" size={15} color="var(--clay-ink)" />
        <span className="t-sm" style={{ color: 'var(--clay-ink)', lineHeight: 1.45 }}>
          {t('L’invio WhatsApp è gestito da Yourang: confermando, l’evento viene messo in coda (outbox) e consegnato nella lingua preferita di ogni cliente.',
             'WhatsApp delivery is handled by Yourang: on confirm, the event is queued (outbox) and delivered in each client’s preferred language.')}
        </span>
      </div>
    </DkModal>
  );
}

export default withPortalForm(SendConfirmModal);
