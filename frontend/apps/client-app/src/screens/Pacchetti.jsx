import { MutationButton } from '@youty/shared';
// Pacchetti.jsx — public packages with included services + price and the
// phone-only booking CTA (as prototype).
// Data: GET /api/catalog/public/packages (+ public services to compute the
// original price → discount badge). NOTE: public branding exposes no salon
// phone number, so the tel: CTA has no number (API gap, see report).
import React from 'react';
import { Icon, api, fmtEur } from '@youty/shared';
import { useApp, SALON_SLUG } from '../ctx.jsx';
import { headFont } from '../theme.js';
import { ClientSubHead, DashedEmpty, usePublicServices, svcLangName, errToast } from './lib.jsx';

export default function Pacchetti() {
  const { t, lang, brand, setView, fireToast } = useApp();
  const { cats } = usePublicServices(SALON_SLUG);
  const [pkgs, setPkgs] = React.useState(null);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    let alive = true;
    api.get('/api/catalog/public/packages', { params: { salon: SALON_SLUG }, auth: false })
      .then((d) => { if (alive) setPkgs(d); })
      .catch((e) => { if (alive) { setError(e); errToast(e, fireToast, t); } });
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* price lookup: service_id → price (from the public price list) */
  const priceById = React.useMemo(() => {
    const m = {};
    (cats || []).forEach((c) => c.services.forEach((s) => { m[s.id] = Number(s.price); }));
    return m;
  }, [cats]);

  const loading = !pkgs && !error;
  const list = pkgs || [];

  return (
    <div style={{ paddingBottom: 30 }}>
      <ClientSubHead brand={brand} title={t('Pacchetti & offerte', 'Packages & offers')} onBack={() => setView('prenota')} />
      <div style={{ padding: '4px 22px' }}>
        {/* nota: solo telefonicamente */}
        <div style={{ display: 'flex', gap: 11, alignItems: 'center', padding: '13px 15px', borderRadius: 'var(--r-md)', background: 'var(--brand-tint)', marginBottom: 20 }}>
          <Icon name="phone" size={19} color="var(--brand-ink)" />
          <div style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--brand-ink)', fontWeight: 600 }}>
            {t('I pacchetti si prenotano chiamando il salone.', 'Packages are booked by calling the salon.')}
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="skel" style={{ height: 220, borderRadius: 'var(--r-md)' }} />
            <div className="skel" style={{ height: 220, borderRadius: 'var(--r-md)' }} />
          </div>
        ) : list.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }} className="stagger">
            {list.map((p) => {
              const price = Number(p.price);
              const orig = (p.items || []).reduce((s, it) => s + (priceById[it.service_id] || 0) * (it.qty || 1), 0);
              const off = orig > price ? Math.round((1 - price / orig) * 100) : 0;
              return (
                <div key={p.id} className="card" style={{ padding: 18, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 4 }}>
                    <div style={{ fontFamily: headFont(brand), fontSize: 19, fontWeight: brand.type === 'serif' ? 500 : 700, lineHeight: 1.15, flex: 1, minWidth: 0 }}>{p.name}</div>
                    {off > 0 && <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 800, color: 'var(--brand-on)', background: 'var(--brand)', padding: '4px 10px', borderRadius: 99 }}>-{off}%</span>}
                  </div>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color: 'var(--brand-ink)', background: 'var(--brand-tint)', padding: '3px 10px', borderRadius: 99 }}>
                    <Icon name="sparkle" size={12} color="var(--brand-ink)" />{t('Pacchetto', 'Package')}
                  </span>

                  {p.description && <div className="t-sm" style={{ color: 'var(--muted)', margin: '13px 0', lineHeight: 1.5 }}>{p.description}</div>}

                  {/* servizi inclusi */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '13px 0', borderTop: '1px solid var(--hair)', borderBottom: '1px solid var(--hair)', marginTop: p.description ? 0 : 13 }}>
                    {(p.items || []).map((it, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <Icon name="check" size={15} color="var(--brand)" stroke={2.4} />
                        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-2)' }}>
                          {svcLangName(it, lang)}{(it.qty || 1) > 1 ? ` ×${it.qty}` : ''}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* prezzo */}
                  <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', margin: '14px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
                      <span className="t-num" style={{ fontSize: 26, color: 'var(--brand-ink)' }}>{fmtEur(price, lang)}</span>
                      {off > 0 && <span className="t-sm" style={{ color: 'var(--muted-2)', textDecoration: 'line-through' }}>{fmtEur(orig, lang)}</span>}
                    </div>
                    {off > 0 && <span className="t-sm" style={{ color: 'var(--ok)', fontWeight: 700 }}>{t(`Risparmi ${fmtEur(orig - price, lang)}`, `Save ${fmtEur(orig - price, lang)}`)}</span>}
                  </div>

                  <a href="tel:" style={{ textDecoration: 'none' }}>
                    <div className="btn btn--brand btn--block press">
                      <Icon name="phone" size={17} color="var(--brand-on)" />{t('Chiama per prenotare', 'Call to book')}
                    </div>
                  </a>
                </div>
              );
            })}
          </div>
        ) : (
          <DashedEmpty>
            {t('Nessun pacchetto disponibile al momento: torna a trovarci presto!', 'No packages available right now: check back soon!')}
            <div style={{ marginTop: 12 }}>
              <MutationButton className="press" onClick={() => setView('prenota')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 18px', borderRadius: 99, background: 'var(--brand-tint)', color: 'var(--brand-ink)', fontWeight: 700, fontSize: 13.5 }}>
                <Icon name="calendar" size={15} color="var(--brand-ink)" />{t('Prenota un servizio singolo', 'Book a single service')}
              </MutationButton>
            </div>
          </DashedEmpty>
        )}
      </div>
    </div>
  );
}
