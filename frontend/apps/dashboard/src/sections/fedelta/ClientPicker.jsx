import { MutationButton } from '@youty/shared';
import React, { useEffect, useState } from 'react';
import { api, ApiError, Icon } from '@youty/shared';
import { useDash } from '../../ctx.jsx';

/** Client search-picker (predictive) with inline "new client" creation.
 * `client` is null or `{id, full_name}`. Used by GiftCardModal (buyer/recipient)
 * and CouponEditModal. Debounced search on GET /api/clients/?q=; new clients via
 * POST /api/clients/ (gated on the `clients` scope) without leaving the flow. */
export default function ClientPicker({ client, onChange, placeholder, t }) {
  const { hasScope, canMutate, fireToast } = useDash();
  const canCreate = hasScope('clients');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  /* inline new-client form */
  const [adding, setAdding] = useState(false);
  const [nf, setNf] = useState({ first_name: '', last_name: '', phone: '' });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open || !q.trim()) { setResults([]); return; }
    let alive = true;
    setLoading(true);
    const tm = setTimeout(() => {
      api.get('/api/clients/', { params: { q, limit: 8 } })
        .then((res) => { if (alive) setResults(res.items || []); })
        .catch(() => { if (alive) setResults([]); })
        .finally(() => { if (alive) setLoading(false); });
    }, 250);
    return () => { alive = false; clearTimeout(tm); };
  }, [q, open]);

  const close = () => { setOpen(false); setAdding(false); setNf({ first_name: '', last_name: '', phone: '' }); };

  const startAdd = () => {
    // prefill the name from what was typed (first token → first name)
    const typed = q.trim();
    const parts = typed.split(/\s+/);
    setNf({ first_name: parts[0] || '', last_name: parts.slice(1).join(' ') || '', phone: '' });
    setAdding(true);
  };

  const createClient = async () => {
    if (creating || !nf.first_name.trim() || !nf.phone.trim()) return;
    setCreating(true);
    try {
      const created = await api.post('/api/clients/', {
        first_name: nf.first_name.trim(), last_name: nf.last_name.trim(), phone: nf.phone.trim(),
      });
      onChange(created); // { id, full_name, ... }
      fireToast({ msg: t('Cliente creata', 'Client created'), icon: 'check' });
      setQ(''); close();
    } catch (err) {
      fireToast({ msg: err instanceof ApiError ? err.message : t('Errore di rete', 'Network error'), icon: 'alert' });
    } finally {
      setCreating(false);
    }
  };

  if (client) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--hair)', borderRadius: 10, padding: '0 12px', height: 42, background: 'var(--surface)' }}>
        <Icon name="user" size={15} color="var(--muted-2)" />
        <span style={{ flex: 1, fontWeight: 600, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{client.full_name}</span>
        <button onClick={() => onChange(null)} style={{ cursor: 'pointer', display: 'grid', placeItems: 'center' }}><Icon name="x" size={14} color="var(--muted-2)" /></button>
      </div>
    );
  }

  const nfInput = { border: '1px solid var(--hair)', borderRadius: 8, outline: 'none', fontSize: 13, padding: '8px 10px', fontFamily: 'var(--sans)', background: 'var(--surface)', width: '100%', boxSizing: 'border-box' };

  return (
    <div style={{ position: 'relative' }}>
      <div className="dk-search" style={{ width: '100%' }}>
        <Icon name="search" size={16} color="var(--muted-2)" />
        <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); setAdding(false); }} onFocus={() => setOpen(true)} placeholder={placeholder} />
        {q && <button onClick={() => { setQ(''); close(); }} style={{ cursor: 'pointer', display: 'grid', placeItems: 'center' }}><Icon name="x" size={14} color="var(--muted-2)" /></button>}
      </div>
      {open && (adding || q.trim()) && (
        <React.Fragment>
          <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
          <div className="dk-card" style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, padding: 6, zIndex: 61, maxHeight: 300, overflowY: 'auto', boxShadow: 'var(--sh-pop)' }}>
            {adding ? (
              <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="t-meta">{t('Nuova cliente', 'New client')}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input autoFocus value={nf.first_name} onChange={(e) => setNf((f) => ({ ...f, first_name: e.target.value }))} placeholder={t('Nome', 'First name')} style={nfInput} />
                  <input value={nf.last_name} onChange={(e) => setNf((f) => ({ ...f, last_name: e.target.value }))} placeholder={t('Cognome', 'Last name')} style={nfInput} />
                </div>
                <input value={nf.phone} onChange={(e) => setNf((f) => ({ ...f, phone: e.target.value }))} placeholder={t('Telefono', 'Phone')} style={nfInput} />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 2 }}>
                  <button className="dk-btn dk-btn--ghost" style={{ height: 34, fontSize: 12.5 }} onClick={() => setAdding(false)}>{t('Indietro', 'Back')}</button>
                  <MutationButton className="dk-btn dk-btn--clay" style={{ height: 34, fontSize: 12.5 }} disabled={creating || !nf.first_name.trim() || !nf.phone.trim()} onClick={createClient}>
                    <Icon name="check" size={14} color="#fff" />{creating ? t('Creazione…', 'Creating…') : t('Crea e seleziona', 'Create & select')}
                  </MutationButton>
                </div>
              </div>
            ) : (
              <React.Fragment>
                {loading ? (
                  <div className="t-sm" style={{ padding: 10, color: 'var(--muted)' }}>{t('Ricerca…', 'Searching…')}</div>
                ) : results.length ? results.map((c) => (
                  <button key={c.id} className="dk-row" onClick={() => { onChange(c); close(); setQ(''); }}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', width: '100%', padding: '8px 10px', borderRadius: 9, textAlign: 'left' }}>
                    <span style={{ fontWeight: 600, fontSize: 13.5 }}>{c.full_name}</span>
                    <span className="t-sm" style={{ color: 'var(--muted)' }}>{c.phone}</span>
                  </button>
                )) : <div className="t-sm" style={{ padding: 10, color: 'var(--muted)' }}>{t('Nessun risultato', 'No results')}</div>}
                {canCreate && (
                  <button className="dk-row" onClick={startAdd} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 10px', borderRadius: 9, textAlign: 'left', borderTop: results.length ? '1px solid var(--hair)' : 'none', color: 'var(--clay-ink)', fontWeight: 600, fontSize: 13 }}>
                    <Icon name="plus" size={14} color="var(--clay-ink)" />{t('Aggiungi nuova cliente', 'Add new client')}
                  </button>
                )}
              </React.Fragment>
            )}
          </div>
        </React.Fragment>
      )}
    </div>
  );
}
