import { withPortalForm, PortalFormBody } from '@youty/shared';
import { MutationButton } from '@youty/shared';
// AnalystDrawer.jsx — "Ask Youty" chat drawer, ported from DkAnalyst in
// desktop-insight.jsx. Rendered as ctx.drawer content (the shell wraps it in
// <DkDrawer>) — this component owns no scrim/host chrome of its own.
//
// Real wiring: POST /api/insights/ask always answers 501 "Chiedi a Youty sarà
// disponibile nella fase 2" today — there are no canned fake answers here, the
// 501 message is rendered inline as the assistant's reply with a "Fase 2" badge.
import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError, Icon, Avatar } from '@youty/shared';

const ASK_CHIPS = [
  { it: 'Qual è il giorno più scarico?', en: 'Which day is quietest?' },
  { it: "Com'è andato l'incasso questo mese?", en: 'How was revenue this month?' },
  { it: 'Chi sono le mie clienti migliori?', en: 'Who are my top clients?' },
  { it: 'Quante clienti sono a rischio abbandono?', en: 'How many clients are at churn risk?' },
];

function AnalystDrawer({ t, lang, fireToast, onClose, initialQuestion }) {
  const [msgs, setMsgs] = useState([]);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const scroller = useRef(null);
  const firedInitial = useRef(false);

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [msgs, typing]);

  useEffect(() => {
    if (initialQuestion && !firedInitial.current) {
      firedInitial.current = true;
      ask(initialQuestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  async function ask(question) {
    const q = question.trim();
    if (!q) return;
    setMsgs((m) => [...m, { role: 'user', text: q }]);
    setText('');
    setTyping(true);
    try {
      await api.post('/api/insights/ask', { question: q });
      // The endpoint always 501s today; if it ever succeeds, show a plain reply.
      setMsgs((m) => [...m, { role: 'ai', phase2: false, text: t('Risposta ricevuta.', 'Answer received.') }]);
    } catch (err) {
      if (err instanceof ApiError && err.status === 501) {
        setMsgs((m) => [...m, { role: 'ai', phase2: true, text: err.message || t('Chiedi a Youty sarà disponibile nella fase 2', 'Ask Youty will be available in phase 2') }]);
      } else if (err instanceof ApiError) {
        fireToast({ msg: err.message, icon: 'alert' });
      } else {
        fireToast({ msg: t('Errore di rete', 'Network error'), icon: 'alert' });
      }
    } finally {
      setTyping(false);
    }
  }

  function sendTyped() { if (text.trim()) ask(text); }

  return (
    <React.Fragment>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '20px 22px', borderBottom: '1px solid var(--hair)' }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--clay-tint)', display: 'grid', placeItems: 'center' }}>
          <Icon name="sparkle" size={20} color="var(--clay-ink)" />
        </div>
        <div style={{ flex: 1 }}>
          <div className="t-h3">Youty</div>
          <div className="t-sm" style={{ color: 'var(--muted)' }}>{t('Il tuo analista AI', 'Your AI analyst')}</div>
        </div>
        <button className="dk-iconbtn" onClick={onClose}><Icon name="x" size={18} /></button>
      </div>

      <div ref={scroller} className="scroll" style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
        {!msgs.length && (
          <div>
            <div className="t-sm" style={{ color: 'var(--muted)', marginBottom: 12, lineHeight: 1.5 }}>
              {t('Ciao, sono Youty 👋 Chiedimi qualsiasi cosa sui tuoi numeri.', 'Hi, I’m Youty 👋 Ask me anything about your numbers.')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ASK_CHIPS.map((c, i) => (
                <MutationButton key={i} className="dk-row" onClick={() => ask(c[lang] || c.it)} style={{ textAlign: 'left', padding: '12px 14px', borderRadius: 12, border: '1px solid var(--hair)', fontWeight: 600, fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 9 }}>
                  <Icon name="search" size={14} color="var(--clay)" />{c[lang] || c.it}
                </MutationButton>
              ))}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {msgs.map((m, i) => m.role === 'user'
            ? (
              <div key={i} style={{ alignSelf: 'flex-end', maxWidth: '85%', background: 'var(--ink)', color: '#fff', padding: '10px 14px', borderRadius: '16px 16px 4px 16px', fontSize: 14, fontWeight: 500 }}>
                {m.text}
              </div>
            )
            : <PhaseTwoBubble key={i} msg={m} t={t} />)}
          {typing && (
            <div style={{ alignSelf: 'flex-start', background: 'var(--surface-2)', border: '1px solid var(--hair)', padding: '12px 14px', borderRadius: '16px 16px 16px 4px', display: 'flex', gap: 5, alignItems: 'center' }}>
              <span className="t-sm" style={{ color: 'var(--muted)', marginRight: 3 }}>{t('Sto pensando', 'Thinking')}</span>
              <span className="tdot" /><span className="tdot" /><span className="tdot" />
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: '12px 18px 16px', borderTop: '1px solid var(--hair)' }}><PortalFormBody>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="dk-search" style={{ flex: 1, width: 'auto', paddingRight: 6 }}>
            <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendTyped()} placeholder={t('Scrivi una domanda…', 'Type a question…')} />
            <MutationButton onClick={sendTyped} style={{ width: 32, height: 32, borderRadius: 99, background: text.trim() ? 'var(--clay)' : 'var(--paper-2)', display: 'grid', placeItems: 'center', cursor: 'pointer', flexShrink: 0 }}>
              <Icon name="send" size={15} color={text.trim() ? '#fff' : 'var(--muted-2)'} />
            </MutationButton>
          </div>
        </div>
      </PortalFormBody></div>
    </React.Fragment>
  );
}

function PhaseTwoBubble({ msg, t }) {
  return (
    <div style={{ alignSelf: 'flex-start', maxWidth: '92%', background: 'var(--surface)', border: '1px solid var(--hair)', borderRadius: '16px 16px 16px 4px', padding: 15, boxShadow: 'var(--sh-sm)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: msg.phase2 ? 9 : 0 }}>
        <Avatar initials="Y" size={26} color="var(--clay-tint)" />
        <div style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--ink-2)' }}>{msg.text}</div>
      </div>
      {msg.phase2 && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 800, color: '#7C3AED', background: 'var(--clay-tint)', padding: '4px 10px', borderRadius: 99 }}>
          <Icon name="sparkle" size={11} color="#7C3AED" />{t('Fase 2', 'Phase 2')}
        </span>
      )}
    </div>
  );
}

export default withPortalForm(AnalystDrawer, { preview: () => true, framed: true, overlay: false });
