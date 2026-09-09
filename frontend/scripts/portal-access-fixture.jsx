// Isolated component QA fixture. No requests, users, credentials or settlement.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LangProvider, PortalAccessProvider, PortalAccessNotice, PortalFormGate, MutationButton } from '@youty/shared';
import DkModal from '../apps/dashboard/src/ui/DkModal.jsx';
import { SearchToolbar } from '../apps/dashboard/src/sections/servizi/parts.jsx';
import '../apps/dashboard/src/styles/styles.css';
import '../apps/dashboard/src/styles/desktop.css';
import '../apps/dashboard/src/styles/app.css';
function Draft({ onClose }) {
  const [name, setName] = useState('');
  return <DkModal open title="Nuovo cliente" sub="Fixture di verifica locale" onClose={onClose} foot={<><button className="dk-btn dk-btn--ghost" onClick={onClose}>Annulla</button><MutationButton className="dk-btn dk-btn--clay">Salva</MutationButton></>}>
    <label>Nome del cliente<input id="draft-name" value={name} onChange={(e) => setName(e.target.value)} style={{ display: 'block', padding: 12, border: '1px solid #ddd', borderRadius: 10, width: '100%', marginTop: 8 }} /></label>
  </DkModal>;
}
function Fixture() {
  const [status, setStatus] = useState('subscription_required');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('Clienti');
  const access = { status, operational_access: status === 'active', checked_at: new Date().toISOString(), valid_until: new Date(Date.now() + 60000).toISOString(), purchase_url: '#fixture-purchase-only' };
  return <LangProvider><PortalAccessProvider access={access} refresh={() => setStatus('active')}>
    <div style={{ fontFamily: 'var(--sans)', padding: 40, maxWidth: 1000, margin: 'auto' }}>
      <div style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 9999, background: '#fff', border: '1px solid #ddd', padding: 12, borderRadius: 12 }}>
        <strong>QA fixture · nessun dato reale</strong><div style={{ display: 'flex', gap: 8, marginTop: 8 }}>{['subscription_required', 'unavailable', 'active'].map((s) => <button id={s} key={s} className="dk-btn dk-btn--ghost" onClick={() => setStatus(s)}>{s}</button>)}</div>
      </div>
      <h1 style={{ fontFamily: 'var(--serif)', marginBottom: 24 }}>Beauty · {tab}</h1>
      <nav style={{ display: 'flex', gap: 10, marginBottom: 20 }}>{['Clienti', 'Agenda', 'Impostazioni'].map((t) => <button className="dk-btn dk-btn--ghost" key={t} onClick={() => setTab(t)}>{t}</button>)}</nav>
      <PortalAccessNotice access={access} refresh={() => setStatus('active')} />
      <div style={{ marginTop: 24 }}><SearchToolbar q={q} setQ={setQ} placeholder="Cerca clienti…" addLabel="Nuovo cliente" onAdd={() => setOpen(true)} /></div>
      {['Giulia Rossi', 'Sofia Bianchi'].filter((n) => n.toLowerCase().includes(q.toLowerCase())).map((n) => <div className="dk-card" key={n} style={{ padding: 20, marginBottom: 12 }}>{n}</div>)}
      {open && <PortalFormGate framed overlay onClose={() => setOpen(false)}><Draft onClose={() => setOpen(false)} /></PortalFormGate>}
    </div>
  </PortalAccessProvider></LangProvider>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
