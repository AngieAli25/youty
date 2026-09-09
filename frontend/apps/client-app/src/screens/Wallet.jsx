import { MutationButton } from '@youty/shared';
// Wallet.jsx — gift cards (balance/initial/code), coupons (kind/value/origin/
// expiry), loyalty programs (points/threshold/progress bar).
// Data: GET /api/marketing/client/wallet. Gift card detail → view 'giftcard'.
import React from 'react';
import { Icon, ProgressBar, api, fmtEur, parseISO } from '@youty/shared';
import { useApp } from '../ctx.jsx';
import { ClientSubHead, DashedEmpty, errToast } from './lib.jsx';

export function fmtExpiry(iso, lang, t) {
  if (!iso) return t('Senza scadenza', 'No expiry');
  const d = parseISO(iso);
  const s = d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'it-IT', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '');
  return t('Scade il ', 'Expires ') + s;
}

export function couponLabel(c, lang, t) {
  return c.kind === 'percent'
    ? t(`Sconto del ${Math.round(Number(c.value))}%`, `${Math.round(Number(c.value))}% off`)
    : t(`Buono da ${fmtEur(Number(c.value), lang)}`, `${fmtEur(Number(c.value), lang)} voucher`);
}

export function couponOrigin(origin, t) {
  return origin === 'loyalty' ? t('Premio fedeltà', 'Loyalty reward') : t('Sconto', 'Discount');
}

export default function Wallet() {
  const { t, lang, brand, setView, fireToast } = useApp();
  const [wallet, setWallet] = React.useState(null);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    let alive = true;
    api.get('/api/marketing/client/wallet')
      .then((d) => { if (alive) setWallet(d); })
      .catch((e) => { if (alive) { setError(e); errToast(e, fireToast, t); } });
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loading = !wallet && !error;
  const cards = wallet?.gift_cards || [];
  const coupons = wallet?.coupons || [];
  const loyalty = wallet?.loyalty || [];
  const totBal = cards.reduce((s, g) => s + Number(g.balance || 0), 0);

  return (
    <div style={{ paddingBottom: 30 }}>
      <ClientSubHead brand={brand} title={t('Portafoglio', 'Wallet')} onBack={() => setView('home')} />
      <div style={{ padding: '8px 22px' }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="skel" style={{ height: 88, borderRadius: 'var(--r-lg)' }} />
            <div className="skel" style={{ height: 74, borderRadius: 'var(--r-md)' }} />
            <div className="skel" style={{ height: 74, borderRadius: 'var(--r-md)' }} />
          </div>
        ) : (
          <React.Fragment>
            {/* ---- GIFT CARD — saldo prepagato ---- */}
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
              <div className="t-meta">{t('Gift card', 'Gift cards')}</div>
              <span className="t-sm" style={{ color: 'var(--muted-2)', fontWeight: 700 }}>{cards.length}</span>
            </div>
            <div className="t-sm" style={{ color: 'var(--muted)', marginBottom: 12 }}>{t('Saldo prepagato spendibile in salone.', 'Prepaid balance to spend in the salon.')}</div>
            {cards.length ? (
              <React.Fragment>
                <MutationButton className="press" onClick={() => setView('giftcard')} style={{ width: '100%', textAlign: 'left', borderRadius: 'var(--r-lg, 20px)', padding: '16px 18px', background: 'var(--brand)', color: 'var(--brand-on)', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.82, letterSpacing: '0.04em' }}>{t('Saldo totale', 'Total balance')}</div>
                      <div className="t-num" style={{ fontSize: 30, fontWeight: 800, marginTop: 2 }}>{fmtEur(totBal, lang)}</div>
                    </div>
                    <Icon name="chevR" size={20} color="var(--brand-on)" />
                  </div>
                </MutationButton>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }} className="stagger">
                  {cards.map((g) => {
                    const initial = Number(g.initial_value || 0);
                    const used = initial > 0 ? Math.round((1 - Number(g.balance) / initial) * 100) : 0;
                    return (
                      <MutationButton key={g.id} className="card press" onClick={() => setView('giftcard')} style={{ padding: 14, boxShadow: 'none', border: '1px solid var(--hair)', textAlign: 'left', width: '100%' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: used > 0 ? 10 : 0 }}>
                          <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--brand-tint)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                            <Icon name="gift" size={19} color="var(--brand-ink)" />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 14.5 }}>
                              {fmtEur(Number(g.balance), lang)} <span className="t-sm" style={{ color: 'var(--muted-2)', fontWeight: 600 }}>/ {fmtEur(initial, lang)}</span>
                            </div>
                            <div className="t-sm" style={{ color: 'var(--muted)' }}>
                              {(g.recipient_name ? t(`Per ${g.recipient_name}`, `For ${g.recipient_name}`) + ' · ' : '') + fmtExpiry(g.expires_at, lang, t)}
                            </div>
                          </div>
                          <span className="tabnum" style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', background: 'var(--paper-2)', padding: '4px 8px', borderRadius: 8, flexShrink: 0 }}>{g.code}</span>
                        </div>
                        {used > 0 && <ProgressBar value={used} color="var(--brand)" />}
                      </MutationButton>
                    );
                  })}
                </div>
              </React.Fragment>
            ) : (
              <DashedEmpty style={{ marginBottom: 14 }}>{t('Nessuna gift card attiva.', 'No active gift cards.')}</DashedEmpty>
            )}
            <MutationButton className="press" onClick={() => setView('giftcard')}
              style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: 11, borderRadius: 'var(--r-pill)', background: 'var(--brand-tint)', color: 'var(--brand-ink)', fontWeight: 700, fontSize: 14, marginBottom: 28 }}>
              <Icon name="gift" size={16} color="var(--brand-ink)" />{t('Acquista o regala una gift card', 'Buy or gift a gift card')}
            </MutationButton>

            {/* ---- COUPON — sconti/omaggi una tantum ---- */}
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
              <div className="t-meta">{t('I tuoi coupon', 'Your coupons')}</div>
              <span className="t-sm" style={{ color: 'var(--muted-2)', fontWeight: 700 }}>{coupons.length}</span>
            </div>
            <div className="t-sm" style={{ color: 'var(--muted)', marginBottom: 12 }}>{t('Sconti e omaggi da usare una volta.', 'Discounts and gifts to use once.')}</div>
            {coupons.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }} className="stagger">
                {coupons.map((c) => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderRadius: 'var(--r-md)', border: '1.5px dashed var(--brand)', background: 'var(--paper-0)' }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--brand-tint)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                      <Icon name={c.origin === 'loyalty' ? 'gift' : 'coupon'} size={20} color="var(--brand-ink)" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14.5 }}>{couponLabel(c, lang, t)}</div>
                      <div className="t-sm" style={{ color: 'var(--muted)' }}>{c.code} · {fmtExpiry(c.expires_at, lang, t)}</div>
                    </div>
                    <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 99, background: 'var(--brand-tint)', color: 'var(--brand-ink)' }}>{couponOrigin(c.origin, t)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <DashedEmpty style={{ marginBottom: 28 }}>{t('Nessun coupon attivo al momento.', 'No active coupons right now.')}</DashedEmpty>
            )}

            {/* ---- FEDELTÀ — accumulo verso un premio ---- */}
            {loyalty.length > 0 && (
              <React.Fragment>
                <div className="t-meta" style={{ marginBottom: 4 }}>{t('Programmi fedeltà', 'Loyalty programs')}</div>
                <div className="t-sm" style={{ color: 'var(--muted)', marginBottom: 12 }}>{t('Accumuli a ogni visita e sblocchi un premio.', 'Build up each visit and unlock a reward.')}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} className="stagger">
                  {loyalty.map((p) => {
                    const done = Math.min(100, Math.round(Number(p.progress_pct || 0)));
                    const reached = Number(p.points) >= Number(p.threshold);
                    return (
                      <div key={p.program_id} className="card" style={{ padding: 16, boxShadow: 'none', border: '1px solid var(--hair)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                          <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--brand-tint)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                            <Icon name={p.type === 'points' ? 'star' : 'check'} size={17} color="var(--brand-ink)" />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 14 }}>{p.program_name}</div>
                            <div className="t-sm" style={{ color: 'var(--muted)' }}>{t('Raggiungi la soglia e ottieni il premio', 'Reach the threshold to unlock the reward')}</div>
                          </div>
                          <div className="t-num" style={{ fontSize: 15 }}>
                            {Math.round(Number(p.points))}<span style={{ color: 'var(--muted-2)', fontSize: 12 }}>/{Math.round(Number(p.threshold))}</span>
                          </div>
                        </div>
                        <ProgressBar value={done} color={p.color || 'var(--brand)'} />
                        {reached && (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 8, fontSize: 12, fontWeight: 700, color: 'var(--ok)' }}>
                            <Icon name="check" size={13} color="var(--ok)" stroke={2.4} />{t('Premio raggiunto!', 'Reward unlocked!')}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </React.Fragment>
            )}
          </React.Fragment>
        )}
      </div>
    </div>
  );
}
