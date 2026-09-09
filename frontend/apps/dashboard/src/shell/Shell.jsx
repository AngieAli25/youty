import { MutationButton } from '@youty/shared';
// Shell.jsx — dashboard chrome: sidebar + topbar + section outlet + global hosts
// (toast, modal dispatcher, drawer). Section agents NEVER edit this file.
import React, { Suspense, lazy, useEffect, useState } from 'react';
import { EmptyState, Icon, PortalAccessNotice } from '@youty/shared';
import { useDash } from '../ctx.jsx';
import { SECTIONS } from '../sections/registry.js';
import DkModals from '../modals/DkModals.jsx';
import { DkToast, DkDrawer } from '../ui/index.js';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';

const AnalystDrawer = lazy(() => import('../sections/insight/AnalystDrawer.jsx'));

export default function Shell() {
  const { tab, drawer, setDrawer, toastProps, t, lang, session, fireToast, portalAccess, refreshPortalAccess, operationalAccess } = useDash();

  const [sideCollapsed, setSideCollapsed] = useState(() => {
    try { return localStorage.getItem('dk-side-collapsed') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('dk-side-collapsed', sideCollapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [sideCollapsed]);

  const Section = SECTIONS[tab];

  return (
    <div className={'dk-root' + (sideCollapsed ? ' dk-side-collapsed' : '')}>
      <Sidebar collapsed={sideCollapsed} onToggleCollapse={() => setSideCollapsed((c) => !c)} />

      <div className="dk-main">
        <Topbar />
        <PortalAccessNotice access={portalAccess} refresh={refreshPortalAccess} />
        <div className="dk-content" key={tab}>
          <Suspense fallback={<SectionSkeleton />}>
            {Section
              ? <Section />
              : <div className="dk-page"><EmptyState icon="sparkle" title={tab} sub="—" /></div>}
          </Suspense>
        </div>
      </div>

      {/* global AI FAB — insights ask is owner-only, so gate it */}
      {session?.is_owner && (
        <MutationButton
          type="button"
          className="press"
          aria-label={t('Chiedi a Youty', 'Ask Youty')}
          title={t('Chiedi a Youty', 'Ask Youty')}
          onClick={() => setDrawer(
            <Suspense fallback={null}>
              <AnalystDrawer t={t} lang={lang} fireToast={fireToast} onClose={() => setDrawer(null)} />
            </Suspense>
          )}
          style={{
            position: 'fixed', right: 22, bottom: 22, zIndex: 40,
            width: 52, height: 52, borderRadius: '50%', border: 'none', cursor: 'pointer',
            background: 'linear-gradient(135deg, var(--clay), color-mix(in srgb, var(--clay) 60%, #7c6cf0))',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: 'var(--shadow-lg, 0 10px 28px rgba(0,0,0,.22))',
          }}
        >
          <Icon name="sparkle" size={22} />
        </MutationButton>
      )}

      {/* global hosts */}
      <DkToast {...toastProps} />
      <DkModals />
      <DkDrawer open={!!drawer} onClose={() => setDrawer(null)}>{drawer}</DkDrawer>
    </div>
  );
}

function SectionSkeleton() {
  return (
    <div className="dk-page">
      <div className="skel" style={{ height: 26, width: 260, marginBottom: 18 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 22 }}>
        {[...Array(3)].map((_, i) => <div key={i} className="skel" style={{ height: 90, borderRadius: 16 }} />)}
      </div>
      <div className="skel" style={{ height: 320, borderRadius: 16 }} />
    </div>
  );
}
