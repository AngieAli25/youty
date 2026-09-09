import { MutationButton } from '@youty/shared';
// Waitlist.jsx — the client's active waitlist requests + leave + join CTA.
// Data: GET /api/agenda/client/waitlist, DELETE /api/agenda/client/waitlist/{id}.
import React from 'react';
import { Icon, api } from '@youty/shared';
import { useApp } from '../ctx.jsx';
import { ClientSubHead, Meta, prefLabel, fmtDayMed, errToast } from './lib.jsx';

export default function Waitlist() {
  const { t, lang, brand, setView, fireToast } = useApp();
  const [list, setList] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [removing, setRemoving] = React.useState(null);

  const load = React.useCallback(() => {
    api.get('/api/agenda/client/waitlist')
      .then(setList)
      .catch((e) => { setError(e); errToast(e, fireToast, t); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { load(); }, [load]);

  const remove = async (id) => {
    if (removing) return;
    setRemoving(id);
    try {
      await api.del(`/api/agenda/client/waitlist/${id}`);
      setList((l) => (l || []).filter((w) => w.id !== id));
      fireToast({ msg: t('Richiesta rimossa', 'Request removed'), icon: 'check' });
    } catch (err) {
      errToast(err, fireToast, t);
    } finally {
      setRemoving(null);
    }
  };

  const loading = !list && !error;
  const entries = list || [];

  return (
    <div style={{ paddingBottom: 30 }}>
      <ClientSubHead brand={brand} title={t('Lista d’attesa', 'Waiting list')} onBack={() => setView('profilo')} />
      <div style={{ padding: '8px 22px' }}>
        <div className="t-body" style={{ color: 'var(--muted)', marginBottom: 18 }}>
          {t('Nessuno slot libero quando ti serve? Mettiti in lista: ti avvisiamo su WhatsApp appena si libera un posto.',
            'No free slot when you need it? Join the list: we’ll message you on WhatsApp the moment one opens up.')}
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
            <div className="skel" style={{ height: 110, borderRadius: 'var(--r-md)' }} />
            <div className="skel" style={{ height: 110, borderRadius: 'var(--r-md)' }} />
          </div>
        ) : entries.length > 0 && (
          <React.Fragment>
            <div className="t-meta" style={{ marginBottom: 12 }}>{t('Le tue richieste', 'Your requests')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }} className="stagger">
              {entries.map((w) => (
                <div key={w.id} className="card" style={{ padding: 15, boxShadow: 'none', border: '1px solid var(--hair)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, flex: 1 }}>{w.service_name}</div>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: w.status === 'contacted' ? 'var(--ok-tint)' : 'var(--brand-tint)', color: w.status === 'contacted' ? 'var(--ok)' : 'var(--brand-ink)', flexShrink: 0 }}>
                      {w.status === 'contacted' ? t('Contattata', 'Contacted') : t('In lista', 'Waiting')}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
                    <Meta icon="user" text={w.operator_name || t('Qualsiasi operatrice', 'Any stylist')} />
                    <Meta icon="clock" text={prefLabel(w, t, lang)} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--hair)' }}>
                    <span className="t-sm" style={{ color: 'var(--muted-2)' }}>
                      {t('In lista dal', 'On the list since')} {fmtDayMed(w.created_at, lang)}
                    </span>
                    <MutationButton className="press" onClick={() => remove(w.id)} disabled={removing === w.id}
                      style={{ fontSize: 13, fontWeight: 600, color: 'var(--danger)', opacity: removing === w.id ? 0.5 : 1 }}>
                      {removing === w.id ? t('Rimozione…', 'Removing…') : t('Rimuovi', 'Remove')}
                    </MutationButton>
                  </div>
                </div>
              ))}
            </div>
          </React.Fragment>
        )}

        <MutationButton className="btn btn--brand btn--block press" onClick={() => setView('waitlist-new')}>
          <Icon name="plus" size={17} color="var(--brand-on)" />{t('Aggiungiti alla lista', 'Join the list')}
        </MutationButton>
      </div>
    </div>
  );
}
