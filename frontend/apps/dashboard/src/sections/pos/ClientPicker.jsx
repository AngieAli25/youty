import { withPortalForm } from '@youty/shared';
// ClientPicker — optional client for a walk-in sale. Debounced search on GET /api/clients/?q=.
import React, { useEffect, useRef, useState } from 'react';
import { api, Avatar, Icon } from '@youty/shared';

const initialsOf = (c) => ((c.first_name?.[0] || '') + (c.last_name?.[0] || '')).toUpperCase() || '?';

function ClientPicker({ value, onChange, t }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(null); // null = loading
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    let dead = false;
    setList(null);
    const tm = setTimeout(() => {
      api.get('/api/clients/', { params: { q: query || null, is_active: true, limit: 20 } })
        .then((r) => { if (!dead) setList(r.items || []); })
        .catch(() => { if (!dead) setList([]); });
    }, 250);
    return () => { dead = true; clearTimeout(tm); };
  }, [query, open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (value) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 12, background: 'var(--surface-2)' }}>
        <Avatar initials={initialsOf(value)} size={32} color="var(--clay)" />
        <span style={{ flex: 1, fontWeight: 700, fontSize: 14, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value.full_name}</span>
        <button className="dk-iconbtn" style={{ width: 30, height: 30 }} onClick={() => { onChange(null); setQuery(''); }} title={t('Rimuovi cliente', 'Remove client')}>
          <Icon name="x" size={15} />
        </button>
      </div>
    );
  }

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <div className="dk-search" style={{ width: '100%', height: 40 }}>
        <Icon name="search" size={16} color="var(--muted-2)" />
        <input value={query} onChange={(e) => { setQuery(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
          placeholder={t('Cerca o scegli dall\'elenco · "da banco"', 'Search or pick from list · "walk-in"')} />
        <button onClick={() => setOpen((v) => !v)} style={{ cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
          <Icon name="chevD" size={15} color="var(--muted-2)" />
        </button>
      </div>
      {open && (
        <div className="dk-card scroll" style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 20, padding: 6, boxShadow: 'var(--sh-pop)', maxHeight: 220, overflowY: 'auto' }}>
          {list === null && <div style={{ padding: 6 }}>{[0, 1, 2].map((i) => <div key={i} className="skel" style={{ height: 34, borderRadius: 9, marginBottom: i < 2 ? 6 : 0 }} />)}</div>}
          {list !== null && list.map((c) => (
            <button key={c.id} className="dk-row" onClick={() => { onChange(c); setOpen(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 10px', borderRadius: 9, textAlign: 'left', cursor: 'pointer' }}>
              <Avatar initials={initialsOf(c)} size={28} color="var(--clay)" />
              <span style={{ flex: 1, fontWeight: 600, fontSize: 13.5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.full_name}</span>
              <span className="t-sm" style={{ color: 'var(--muted-2)', flexShrink: 0 }}>{c.phone}</span>
            </button>
          ))}
          {list !== null && !list.length && <div className="t-sm" style={{ color: 'var(--muted-2)', padding: 12, textAlign: 'center' }}>{t('Nessuna cliente', 'No client found')}</div>}
        </div>
      )}
    </div>
  );
}

export default withPortalForm(ClientPicker, { preview: () => true, framed: false, overlay: false });
