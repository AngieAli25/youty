import { MutationButton } from '@youty/shared';
// Topbar.jsx — real date, section title, client search, notifications, "Nuova" menu, avatar.
import React, { useState } from 'react';
import { Avatar, EmptyState, Icon, fmtDateIt } from '@youty/shared';
import { useDash } from '../ctx.jsx';

const TITLES = {
  agenda: ['Agenda', 'Agenda'],
  pos: ['Punto Vendita', 'Point of Sale'],
  clienti: ['Clienti', 'Clients'],
  insight: ['Analisi dati', 'Insights'],
  automazioni: ['Automazioni', 'Automations'],
  servizi: ['Servizi', 'Services'],
  magazzino: ['Magazzino', 'Inventory'],
  fedelta: ['Promozioni', 'Promotions'],
  comunicazioni: ['Comunicazioni', 'Communications'],
  staff: ['Staff', 'Staff'],
  impostazioni: ['Impostazioni', 'Settings'],
  profile: ['Profilo titolare', 'Owner profile'],
};

export default function Topbar() {
  const { t, tab, setTab, search, setSearch, openModal, session } = useDash();
  const [notifOpen, setNotifOpen] = useState(false);
  const [newMenu, setNewMenu] = useState(false);

  const title = t(...(TITLES[tab] || TITLES.agenda));
  const initials = (session?.user?.name || '?')
    .split(/\s+/).map((w) => w.charAt(0)).slice(0, 2).join('').toUpperCase();

  return (
    <header className="dk-top">
      <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div className="t-meta" style={{ color: 'var(--clay-ink)', fontSize: 10.5, whiteSpace: 'nowrap' }}>{fmtDateIt(new Date())}</div>
        <div style={{ fontFamily: 'var(--serif)', fontSize: 24, fontWeight: 500, lineHeight: 1.05, marginTop: 3 }}>{title}</div>
      </div>
      <div style={{ flex: 1 }} />

      {/* shared search — jumps to Clienti */}
      <div className="dk-search">
        <Icon name="search" size={18} color="var(--muted-2)" />
        <input value={search}
          onChange={(e) => { setSearch(e.target.value); if (tab !== 'clienti') setTab('clienti'); }}
          placeholder={t('Cerca clienti…', 'Search clients…')} />
        {search && <button onClick={() => setSearch('')} style={{ cursor: 'pointer', display: 'grid', placeItems: 'center' }}><Icon name="x" size={15} color="var(--muted-2)" /></button>}
      </div>

      {/* notifications */}
      <div style={{ position: 'relative' }}>
        <button className="dk-iconbtn" onClick={() => setNotifOpen((o) => !o)} style={{ background: notifOpen ? 'var(--surface-2)' : 'var(--surface)', borderColor: notifOpen ? 'var(--line-strong)' : 'var(--hair)' }}>
          <Icon name="bell" size={19} />
        </button>
        {notifOpen && <NotifPanel onClose={() => setNotifOpen(false)} t={t} />}
      </div>

      {/* "Nuova" quick-create menu */}
      <div style={{ position: 'relative' }}>
        <MutationButton className="dk-btn dk-btn--clay" onClick={() => setNewMenu((o) => !o)}>
          <Icon name="plus" size={18} color="#fff" />{t('Nuova', 'New')}
          <Icon name="chevD" size={15} color="#fff" style={{ marginLeft: 2, transform: newMenu ? 'rotate(180deg)' : 'none', transition: 'transform 140ms' }} />
        </MutationButton>
        {newMenu && (
          <React.Fragment>
            <div onClick={() => setNewMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 70 }} />
            <div className="dk-card" style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 71, width: 280, padding: 6, boxShadow: 'var(--sh-pop)' }}>
              {[
                { icon: 'calendar', title: t('Nuovo appuntamento', 'New appointment'), sub: t('Prenotazione telefonica in agenda', 'Phone booking in the agenda'), act: () => openModal('newappt') },
                { icon: 'user', title: t('Nuovo cliente', 'New client'), sub: t('Inserimento manuale in anagrafica', 'Manual entry in the client book'), act: () => openModal('newclient') },
              ].map((o, i) => (
                <MutationButton key={i} className="dk-row" onClick={() => { setNewMenu(false); o.act(); }} style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', padding: '11px 11px', borderRadius: 10, textAlign: 'left' }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--clay-tint)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name={o.icon} size={18} color="var(--clay-ink)" /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{o.title}</div>
                    <div className="t-sm" style={{ color: 'var(--muted)' }}>{o.sub}</div>
                  </div>
                  <Icon name="chevR" size={15} color="var(--faint)" />
                </MutationButton>
              ))}
            </div>
          </React.Fragment>
        )}
      </div>

      <div style={{ width: 1, height: 30, background: 'var(--hair)' }} />
      <button onClick={() => setTab('profile')} title={t('Profilo', 'Profile')} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, borderRadius: 99 }}>
        <Avatar initials={initials} size={40} color="var(--clay-tint2)" ring />
      </button>
    </header>
  );
}

/* Empty for now — real notifications will be wired to backend events later. */
function NotifPanel({ onClose, t }) {
  return (
    <React.Fragment>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
      <div className="dk-card" style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 340, padding: 8, boxShadow: 'var(--sh-pop)', zIndex: 61 }}>
        <div style={{ padding: '6px 10px 0' }}>
          <span className="t-meta">{t('Notifiche', 'Notifications')}</span>
        </div>
        <EmptyState icon="bell" title={t('Nessuna notifica', 'No notifications')}
          sub={t('Qui vedrai conferme, scorte e promemoria.', 'Confirmations, stock alerts and reminders will show up here.')} />
      </div>
    </React.Fragment>
  );
}
