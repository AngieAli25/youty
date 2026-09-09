import { MutationButton } from '@youty/shared';
// StaffGrid — operator cards with today's availability, month revenue, today's clients.
// Port of prototype DkStaff grid; data = ctx operators (GET /api/staff/ → OperatorStatusOut).
import React, { useEffect, useState } from 'react';
import { Avatar, Icon } from '@youty/shared';
import { useDash } from '../../ctx.jsx';
import { todayStatus, opName, eur } from './lib.js';
import NewOperatorModal from './NewOperatorModal.jsx';

export default function StaffGrid({ onOpen }) {
  const { t, lang, operators, reload, showRevenue, hasScope, canMutate, opColors } = useDash();
  const [newOpen, setNewOpen] = useState(false);
  const canTeam = hasScope('team');

  // refresh today-status / KPI on entry (boot data may be stale)
  useEffect(() => { reload.operators().catch(() => {}); }, [reload]);

  return (
    <div className="dk-page" style={{ maxWidth: 1080 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <div style={{ flex: 1 }}>
          <div className="t-meta">{t('Team', 'Team')} · {operators.length} {t('operatrici', 'stylists')}</div>
        </div>
        {canTeam && (
          <MutationButton className="dk-btn dk-btn--clay" onClick={() => setNewOpen(true)}>
            <Icon name="plus" size={16} color="#fff" />{t('Nuova operatrice', 'New stylist')}
          </MutationButton>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
        {operators.map((o) => {
          const ts = todayStatus(o, t, lang);
          const color = opColors[o.id] || o.color;
          return (
            <div key={o.id} className="dk-card dk-hovercard" onClick={() => onOpen(o.id)} style={{ padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <Avatar initials={o.initials} size={48} color={color} ring />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="t-h3" style={{ fontSize: 16 }}>{opName(o)}</div>
                  <div className="t-sm" style={{ color: 'var(--muted)' }}>{o.role_title || t('Operatrice', 'Stylist')}</div>
                </div>
              </div>
              {/* today's availability — the at-a-glance info */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 13px', borderRadius: 11, background: ts.bg, marginBottom: 14 }}>
                <span style={{ width: 9, height: 9, borderRadius: 99, background: ts.color, flexShrink: 0, boxShadow: ts.key === 'work' ? '0 0 0 3px color-mix(in srgb, ' + ts.color + ' 25%, transparent)' : 'none' }} />
                <span style={{ fontWeight: 700, fontSize: 13.5, color: ts.color }}>{t('Oggi', 'Today')}: {ts.label}</span>
                {ts.hours && <span className="t-num" style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700, color: ts.color }}>{ts.hours}</span>}
              </div>
              <div style={{ display: 'flex', gap: 22 }}>
                <div>
                  <div className="t-meta" style={{ fontSize: 9.5, whiteSpace: 'nowrap' }}>{t('Incasso mese', 'Month revenue')}</div>
                  <div className="t-num" style={{ fontSize: 18, marginTop: 4 }}>{showRevenue ? eur(o.month_revenue, lang) : '•••'}</div>
                </div>
                <div>
                  <div className="t-meta" style={{ fontSize: 9.5, whiteSpace: 'nowrap' }}>{t('Clienti oggi', 'Clients today')}</div>
                  <div className="t-num" style={{ fontSize: 18, marginTop: 4, color: ts.key === 'work' ? 'var(--ink)' : 'var(--muted-2)' }}>{o.today_clients}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {newOpen && <NewOperatorModal onClose={() => setNewOpen(false)} onCreated={(id) => { setNewOpen(false); onOpen(id); }} />}
    </div>
  );
}
