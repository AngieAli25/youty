import { MutationButton } from '@youty/shared';
// NavBar.jsx — bottom navigation (Home / Prenotazioni / Prenota FAB / Wallet / Profilo).
import React from 'react';
import { Icon } from '@youty/shared';
import { useApp } from './ctx.jsx';

/** Views where the bottom nav is visible. */
export const NAV_VIEWS = ['home', 'prenotazioni', 'wallet', 'profilo', 'waitlist', 'pacchetti', 'giftcard'];

export default function NavBar() {
  const { t, view, setView, session } = useApp();
  const full = [
    { key: 'home', icon: 'home', label: t('Home', 'Home') },
    { key: 'prenotazioni', icon: 'calendar', label: t('Prenotazioni', 'Bookings') },
    { key: 'prenota', icon: 'plus', label: t('Prenota', 'Book'), center: true },
    { key: 'wallet', icon: 'wallet', label: t('Portafoglio', 'Wallet') },
    { key: 'profilo', icon: 'user', label: t('Profilo', 'Profile') },
  ];
  const slim = [
    { key: 'home', icon: 'home', label: t('Home', 'Home') },
    { key: 'prenota', icon: 'plus', label: t('Prenota', 'Book'), center: true },
  ];
  const items = session ? full : slim;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 60, paddingBottom: 'var(--safe-bottom)', background: 'rgba(255,255,255,0.94)', backdropFilter: 'blur(16px)', borderTop: '1px solid var(--hair)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', padding: '8px 8px 6px' }}>
        {items.map((it) => {
          const on = view === it.key || (it.key === 'profilo' && ['waitlist'].includes(view)) || (it.key === 'wallet' && ['giftcard'].includes(view));
          if (it.center) {
            return (
              <div key={it.key} style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
                <MutationButton className="press" onClick={() => setView('prenota')} style={{ width: 54, height: 54, marginTop: -22, borderRadius: 18, background: 'var(--brand)', boxShadow: '0 8px 20px color-mix(in srgb, var(--brand) 45%, transparent)', display: 'grid', placeItems: 'center' }}>
                  <Icon name="plus" size={26} color="var(--brand-on)" stroke={2.4} />
                </MutationButton>
              </div>
            );
          }
          return (
            <button key={it.key} className="press" onClick={() => setView(it.key)} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '4px 0', background: 'transparent', border: 'none', cursor: 'pointer' }}>
              <Icon name={it.icon} size={22} color={on ? 'var(--brand-ink)' : 'var(--muted-2)'} stroke={on ? 2 : 1.7} />
              <span style={{ fontSize: 10.5, fontWeight: on ? 700 : 600, color: on ? 'var(--brand-ink)' : 'var(--muted-2)' }}>{it.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
