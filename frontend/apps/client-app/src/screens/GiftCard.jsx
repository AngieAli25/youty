import { MutationNumInput } from '@youty/shared';
import { MutationButton } from '@youty/shared';
// GiftCard.jsx — gift-card balance detail + "Regala una gift card" purchase
// form (POST /api/marketing/client/gift-cards — unpaid, si paga in salone;
// Stripe checkout arriverà in fase 2).
import React from 'react';
import { Icon, ProgressBar, api, fmtEur, NumInput } from '@youty/shared';
import { useApp } from '../ctx.jsx';
import { headFont } from '../theme.js';
import { ClientSubHead, DashedEmpty, errToast } from './lib.jsx';
import { fmtExpiry } from './Wallet.jsx';

const PRESETS = [25, 50, 75, 100];

export default function GiftCard() {
  const { t, lang, brand, setView, fireToast } = useApp();
  const [wallet, setWallet] = React.useState(null);
  const [error, setError] = React.useState(null);
  /* purchase form */
  const [buying, setBuying] = React.useState(false);
  const [amount, setAmount] = React.useState(50);
  const [custom, setCustom] = React.useState('');
  const [recipient, setRecipient] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [bought, setBought] = React.useState(null); // GiftCardOut

  const load = React.useCallback(() => {
    api.get('/api/marketing/client/wallet')
      .then(setWallet)
      .catch((e) => { setError(e); errToast(e, fireToast, t); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { load(); }, [load]);

  const loading = !wallet && !error;
  const cards = wallet?.gift_cards || [];
  const totBal = cards.reduce((s, g) => s + Number(g.balance || 0), 0);
  const value = custom !== '' ? Number(custom) : amount;
  const valid = Number.isFinite(value) && value >= 5 && value <= 1000;

  const buy = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const card = await api.post('/api/marketing/client/gift-cards', {
        value: Number(value).toFixed(2),
        recipient_name: recipient.trim(),
      });
      setBought(card);
      setBuying(false);
      setRecipient('');
      setCustom('');
      fireToast({ msg: t('Gift card creata!', 'Gift card created!'), icon: 'gift' });
      load();
    } catch (err) {
      errToast(err, fireToast, t);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ paddingBottom: 30 }}>
      <ClientSubHead brand={brand} title={t('Gift card', 'Gift cards')} onBack={() => setView('wallet')} />
      <div style={{ padding: '8px 22px' }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="skel" style={{ height: 110, borderRadius: 'var(--r-lg)' }} />
            <div className="skel" style={{ height: 90, borderRadius: 'var(--r-md)' }} />
          </div>
        ) : (
          <React.Fragment>
            {/* saldo totale */}
            <div style={{ borderRadius: 'var(--r-lg, 20px)', padding: '20px 22px', background: 'var(--brand)', color: 'var(--brand-on)', marginBottom: 20 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, opacity: 0.82, letterSpacing: '0.04em' }}>{t('Saldo gift card', 'Gift card balance')}</div>
              <div className="t-num" style={{ fontSize: 38, fontWeight: 800, marginTop: 4 }}>{fmtEur(totBal, lang)}</div>
              <div style={{ fontSize: 12.5, opacity: 0.82, marginTop: 2 }}>
                {cards.length} {t('carte attive', 'active cards')} · {t('spendibili in salone', 'spend in salon')}
              </div>
            </div>

            {/* conferma acquisto appena fatto */}
            {bought && (
              <div className="pop-in" style={{ display: 'flex', gap: 12, padding: 15, background: 'var(--ok-tint)', borderRadius: 'var(--r-md)', marginBottom: 20 }}>
                <Icon name="check" size={20} color="var(--ok)" stroke={2.4} />
                <div style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink-2)', flex: 1 }}>
                  {t(`Gift card da ${fmtEur(Number(bought.initial_value), lang)} creata`, `${fmtEur(Number(bought.initial_value), lang)} gift card created`)}
                  {bought.recipient_name ? t(` per ${bought.recipient_name}`, ` for ${bought.recipient_name}`) : ''} · <b className="tabnum">{bought.code}</b>.{' '}
                  {t('Si paga in salone alla prossima visita.', 'Pay in the salon at your next visit.')}
                </div>
              </div>
            )}

            {/* le tue carte */}
            <div className="t-meta" style={{ marginBottom: 12 }}>{t('Le tue carte', 'Your cards')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 26 }} className="stagger">
              {cards.map((g) => {
                const initial = Number(g.initial_value || 0);
                const used = initial > 0 ? Math.round((1 - Number(g.balance) / initial) * 100) : 0;
                return (
                  <div key={g.id} className="card" style={{ padding: 16, boxShadow: 'none', border: '1px solid var(--hair)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                      <div style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--brand-tint)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                        <Icon name="gift" size={21} color="var(--brand-ink)" />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>
                          {fmtEur(Number(g.balance), lang)} <span className="t-sm" style={{ color: 'var(--muted-2)', fontWeight: 600 }}>/ {fmtEur(initial, lang)}</span>
                        </div>
                        {g.recipient_name && <div className="t-sm" style={{ color: 'var(--muted)' }}>{t(`Per ${g.recipient_name}`, `For ${g.recipient_name}`)}</div>}
                      </div>
                      <span className="tabnum" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', background: 'var(--paper-2)', padding: '4px 9px', borderRadius: 8, letterSpacing: '0.04em' }}>{g.code}</span>
                    </div>
                    {used > 0 && <ProgressBar value={used} color="var(--brand)" />}
                    <div className="t-sm" style={{ color: 'var(--muted-2)', marginTop: 8 }}>{fmtExpiry(g.expires_at, lang, t)}</div>
                  </div>
                );
              })}
              {!cards.length && <DashedEmpty>{t('Nessuna gift card attiva.', 'No active gift cards.')}</DashedEmpty>}
            </div>

            {/* acquista / regala */}
            <div className="t-meta" style={{ marginBottom: 12 }}>{t('Regala o ricarica', 'Gift or top up')}</div>
            {!buying ? (
              <React.Fragment>
                <button className="btn btn--brand btn--block press" style={{ marginBottom: 10 }} onClick={() => { setBought(null); setBuying(true); }}>
                  <Icon name="gift" size={17} color="var(--brand-on)" />{t('Regala una gift card', 'Gift a gift card')}
                </button>
                <div className="t-sm" style={{ color: 'var(--muted-2)', textAlign: 'center' }}>
                  {t('Scegli l’importo: si paga in salone.', 'Choose an amount: pay in the salon.')}
                </div>
              </React.Fragment>
            ) : (
              <div className="card slide-up" style={{ padding: 18, boxShadow: 'none', border: '1px solid var(--hair)' }}>
                <div style={{ fontFamily: headFont(brand), fontSize: 18, fontWeight: brand.type === 'serif' ? 500 : 700, marginBottom: 14 }}>
                  {t('Nuova gift card', 'New gift card')}
                </div>
                {/* amount presets */}
                <div className="t-meta" style={{ marginBottom: 10 }}>{t('Importo', 'Amount')}</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                  {PRESETS.map((v) => {
                    const on = custom === '' && amount === v;
                    return (
                      <button key={v} className="press tabnum" onClick={() => { setAmount(v); setCustom(''); }}
                        style={{ flex: 1, minWidth: 64, padding: '12px 0', borderRadius: 12, fontWeight: 700, fontSize: 15, border: '1.5px solid ' + (on ? 'var(--brand)' : 'var(--hair)'), background: on ? 'var(--brand)' : 'var(--paper-0)', color: on ? 'var(--brand-on)' : 'var(--ink)' }}>
                        €{v}
                      </button>
                    );
                  })}
                </div>
                <MutationNumInput className="ca-input" max={1000} placeholder={t('Altro importo (€)', 'Other amount (€)')}
                  value={custom} emptyValue="" onChange={setCustom} style={{ marginBottom: 14 }} />
                {/* recipient */}
                <div className="t-meta" style={{ marginBottom: 10 }}>{t('Per chi è?', 'Who is it for?')}</div>
                <input className="ca-input" placeholder={t('Nome della destinataria (facoltativo)', 'Recipient name (optional)')}
                  value={recipient} onChange={(e) => setRecipient(e.target.value)} style={{ marginBottom: 14 }} />
                {/* pay-in-salon notice */}
                <div style={{ display: 'flex', gap: 10, padding: '12px 14px', borderRadius: 'var(--r-md)', background: 'var(--brand-tint)', marginBottom: 16 }}>
                  <Icon name="info" size={18} color="var(--brand-ink)" />
                  <div style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--brand-ink)', fontWeight: 600 }}>
                    {t('La gift card si paga in salone. Il pagamento online arriverà presto.', 'The gift card is paid in the salon. Online payment is coming soon.')}
                  </div>
                </div>
                <MutationButton className="btn btn--brand btn--block press" disabled={!valid || busy} style={{ opacity: !valid || busy ? 0.5 : 1 }} onClick={buy}>
                  <Icon name="gift" size={17} color="var(--brand-on)" />
                  {busy ? t('Creazione…', 'Creating…') : t('Conferma', 'Confirm') + (valid ? ' · ' + fmtEur(value, lang) : '')}
                </MutationButton>
                <button className="btn btn--ghost btn--block press" style={{ marginTop: 10 }} onClick={() => setBuying(false)}>
                  {t('Annulla', 'Cancel')}
                </button>
              </div>
            )}
          </React.Fragment>
        )}
      </div>
    </div>
  );
}
