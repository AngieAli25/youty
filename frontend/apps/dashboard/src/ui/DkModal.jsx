import React from 'react';
import { Icon, PortalFormBody } from '@youty/shared';

export default function DkModal({ open, onClose, title, sub, children, width, foot }) {
  if (!open) return null;
  return (
    <div className="dk-scrim" onClick={onClose}>
      <div className="dk-modal" style={{ width }} onClick={(e) => e.stopPropagation()}>
        <div className="dk-modalhead">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="t-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
            {sub && <div className="t-sm" style={{ color: 'var(--muted)', marginTop: 4 }}>{sub}</div>}
          </div>
          <button className="dk-iconbtn" style={{ flexShrink: 0, marginLeft: 12 }} onClick={onClose}><Icon name="x" size={18} /></button>
        </div>
        <div className="dk-modalbody"><PortalFormBody onClose={onClose}>{children}</PortalFormBody></div>
        {foot && <div style={{ padding: '16px 24px', borderTop: '1px solid var(--hair)', display: 'flex', gap: 12, justifyContent: 'flex-end', background: 'var(--surface-2)' }}>{foot}</div>}
      </div>
    </div>
  );
}
