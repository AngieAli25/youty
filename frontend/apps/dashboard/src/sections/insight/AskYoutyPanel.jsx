import { MutationInput } from '@youty/shared';
import { useMutationAction } from '@youty/shared';
import { MutationButton } from '@youty/shared';
// AskYoutyPanel.jsx — right column of the Insight page: the gradient "Ask Youty"
// bar (ports the prompt input from desktop-insight.jsx) + a single static card
// explaining that AI-generated suggestions (the prototype's `INSIGHTS` mock cards)
// land in fase 2. No canned/fake suggestion content is rendered.
import React, { useState } from 'react';
import { Icon } from '@youty/shared';

export default function AskYoutyPanel({ t, onOpenAnalyst }) {
  const [askText, setAskText] = useState('');

  const mutation = useMutationAction();
  const submit = mutation(() => {
    onOpenAnalyst(askText.trim() || undefined);
    setAskText('');
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ padding: 16, borderRadius: '24px 24px 24px 10px', background: 'linear-gradient(120deg, #A78BFA, #C9B8F2)', boxShadow: '0 12px 30px rgba(167,139,250,0.32)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{ width: 34, height: 34, borderRadius: '12px 12px 6px 12px', background: 'rgba(255,255,255,0.28)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon name="sparkle" size={18} color="#fff" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', lineHeight: 1.1 }}>{t('Chiedi a Youty', 'Ask Youty')}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.9)', marginTop: 1 }}>{t('Interroga i tuoi dati a parole', 'Query your data in plain words')}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, background: '#fff', borderRadius: 12, padding: '5px 5px 5px 14px', alignItems: 'center' }}>
          <MutationInput
            value={askText}
            onChange={(e) => setAskText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder={t('es. Qual è il giorno più scarico?', 'e.g. Which day is quietest?')}
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13.5, fontFamily: 'var(--sans)', minWidth: 0 }}
          />
          <MutationButton onClick={submit} style={{ width: 34, height: 34, borderRadius: 99, background: 'var(--ink)', display: 'grid', placeItems: 'center', cursor: 'pointer', flexShrink: 0 }}>
            <Icon name="send" size={15} color="#fff" />
          </MutationButton>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="t-meta">{t('Suggerimenti', 'Suggestions')}</span>
      </div>
      <div style={{ background: 'linear-gradient(135deg, #C9B8F2, #DDD6FE)', borderRadius: '28px 14px 28px 14px', boxShadow: '0 10px 26px rgba(201,184,242,0.45)', padding: 22 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ width: 38, height: 38, borderRadius: '14px 10px 14px 10px', background: 'rgba(255,255,255,0.55)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon name="bulb" size={19} color="#7C3AED" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 15.5, lineHeight: 1.38, color: '#2A2150' }}>
              {t('I suggerimenti generati dall’AI arriveranno nella fase 2', 'AI-generated suggestions are coming in phase 2')}
            </div>
            <div style={{ marginTop: 9, fontSize: 13, color: '#473b6e', lineHeight: 1.5 }}>
              {t('Qui vedrai consigli automatici su cosa fare per far crescere il salone, basati sui tuoi numeri reali — es. clienti da riattivare, giorni scarichi da promuovere, prodotti da rilanciare.', 'You’ll see automatic suggestions on what to do to grow the salon, based on your real numbers — e.g. clients to win back, quiet days to promote, products to push.')}
            </div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 12, fontSize: 11, fontWeight: 800, color: '#7C3AED', background: 'rgba(255,255,255,0.55)', padding: '5px 12px', borderRadius: 99 }}>
              <Icon name="sparkle" size={11} color="#7C3AED" />{t('Fase 2', 'Phase 2')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
