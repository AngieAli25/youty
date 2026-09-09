import { MutationButton } from '../portalAccess.jsx';
// primitives.jsx — shared UI primitives ported from prototype components.jsx + shared.jsx
import React, { useEffect } from 'react';
import { Icon } from './Icon.jsx';

/* ============================== AVATAR ============================== */
export function Avatar({ initials, size = 44, color, ring = false, img }) {
  const base = color || 'var(--paper-2)';
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: img ? `center/cover ${base}` : 'var(--paper-2)',
      backgroundImage: img ? `url(${img})` : undefined,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--ink-2)', fontWeight: 700, fontSize: size * 0.34,
      border: ring ? `2px solid ${base}` : '1px solid var(--hair)',
      letterSpacing: '0.02em',
    }}>{!img && initials}</div>
  );
}

/* ============================== CHIP / SEG ============================== */
export function Chip({ children, active, onClick, icon, style = {} }) {
  return (
    <button className={'chip press' + (active ? ' chip--active' : '')} onClick={onClick} style={style}>
      {icon && <Icon name={icon} size={15} stroke={1.9} />}
      {children}
    </button>
  );
}

export function SegBar({ options, value, onChange, style = {} }) {
  return (
    <div style={{ display: 'flex', background: 'var(--paper-2)', borderRadius: 'var(--r-pill)', padding: 3, gap: 2, ...style }}>
      {options.map(o => {
        const active = o.value === value;
        return (
          <button key={o.value} onClick={() => onChange(o.value)} className="press"
            style={{
              flex: 1, height: 36, borderRadius: 'var(--r-pill)', fontSize: 13.5, fontWeight: 600,
              color: active ? 'var(--ink)' : 'var(--muted)',
              background: active ? 'var(--surface)' : 'transparent',
              boxShadow: active ? 'var(--sh-sm)' : 'none', transition: 'all 180ms var(--ease)',
            }}>{o.label}</button>
        );
      })}
    </div>
  );
}

/* ============================== TOGGLE ============================== */
export function Toggle({ on, onChange }) {
  return <button className={'swt press' + (on ? ' swt--on' : '')} onClick={() => onChange(!on)} aria-pressed={on} />;
}

/* ============================== BOTTOM SHEET ============================== */
export function Sheet({ open, onClose, children, title, full = false, dark = false }) {
  if (!open) return null;
  return (
    <div onClick={onClose} style={{
      position: 'absolute', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column',
      justifyContent: 'flex-end', background: 'rgba(33,28,24,0.42)', backdropFilter: 'blur(3px)',
      animation: 'fadeIn 200ms var(--ease)',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: dark ? 'var(--ink)' : 'var(--surface)', color: dark ? '#fff' : 'var(--ink)',
        borderRadius: '26px 26px 0 0', maxHeight: full ? 'calc(100% - 40px)' : '88%',
        boxShadow: 'var(--sh-sheet)', display: 'flex', flexDirection: 'column',
        animation: 'sheetUp 340ms var(--ease-emph)', paddingBottom: 'calc(var(--safe-bottom) + 8px)',
        overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10 }}>
          <div style={{ width: 40, height: 4.5, borderRadius: 99, background: dark ? 'rgba(255,255,255,0.25)' : 'var(--faint)' }} />
        </div>
        {title && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px 6px' }}>
            <div className="t-title">{title}</div>
            <button className="press" onClick={onClose} style={{ width: 34, height: 34, borderRadius: 99, background: dark ? 'rgba(255,255,255,0.1)' : 'var(--paper-2)', display: 'grid', placeItems: 'center' }}>
              <Icon name="x" size={18} />
            </button>
          </div>
        )}
        <div className="scroll" style={{ overflowY: 'auto', padding: '6px 20px 20px' }}>{children}</div>
      </div>
    </div>
  );
}

/* ============================== MISC VIZ ============================== */
export function Sparkline({ data, w = 120, h = 34, color = 'var(--clay)', fill = true }) {
  const min = Math.min(...data), max = Math.max(...data);
  const rng = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - ((v - min) / rng) * (h - 6) - 3]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = line + ` L${w} ${h} L0 ${h} Z`;
  return (
    <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
      {fill && <path d={area} fill={color} opacity="0.1" />}
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3" fill={color} />
    </svg>
  );
}

export function ProgressBar({ value, color = 'var(--clay)', track = 'var(--paper-2)', h = 8, animate = true }) {
  return (
    <div style={{ height: h, borderRadius: 99, background: track, overflow: 'hidden', width: '100%' }}>
      <div style={{ height: '100%', width: Math.min(100, value) + '%', background: color, borderRadius: 99, animation: animate ? 'growW 800ms var(--ease-emph)' : 'none' }} />
    </div>
  );
}

export function Delta({ value, invert = false, light = false }) {
  const up = value >= 0;
  const good = invert ? !up : up;
  const c = good ? 'var(--ok)' : 'var(--danger)';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: light ? (up ? '#A7C4A0' : '#E0A59E') : c, fontWeight: 700, fontSize: 13 }}>
      <Icon name={up ? 'arrowUp' : 'arrowDn'} size={13} stroke={2.4} />
      {Math.abs(value)}%
    </span>
  );
}

/* ============================== LAYOUT HELPERS ============================== */
export function SectionLabel({ children, action, onAction }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '0 0 12px' }}>
      <div className="t-meta">{children}</div>
      {action && <button className="press" onClick={onAction} style={{ fontSize: 13, fontWeight: 600, color: 'var(--clay-ink)' }}>{action}</button>}
    </div>
  );
}

export function EmptyState({ icon, title, sub, action, onAction, mutationAction = false }) {
  const Action = mutationAction ? MutationButton : 'button';
  return (
    <div style={{ textAlign: 'center', padding: '40px 24px' }}>
      <div style={{ width: 64, height: 64, borderRadius: 20, background: 'var(--paper-2)', display: 'grid', placeItems: 'center', margin: '0 auto 16px' }}>
        <Icon name={icon} size={28} color="var(--muted-2)" />
      </div>
      <div className="t-title" style={{ marginBottom: 6 }}>{title}</div>
      {sub && <div className="t-body" style={{ color: 'var(--muted)', maxWidth: 240, margin: '0 auto 16px' }}>{sub}</div>}
      {action && <Action className="btn btn--clay press" onClick={onAction} style={{ margin: '0 auto' }}>{action}</Action>}
    </div>
  );
}

export function SubHeader({ title, onBack, right, sub }) {
  return (
    <div style={{
      paddingTop: 'var(--safe-top)', padding: '0 16px', background: 'var(--paper)',
      position: 'sticky', top: 0, zIndex: 30,
    }}>
      <div style={{ paddingTop: 'var(--safe-top)' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 12 }}>
        <button className="press" onClick={onBack} style={{ width: 40, height: 40, marginLeft: -6, borderRadius: 99, display: 'grid', placeItems: 'center' }}>
          <Icon name="chevL" size={24} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="t-h3" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
          {sub && <div className="t-sm" style={{ color: 'var(--muted)' }}>{sub}</div>}
        </div>
        {right}
      </div>
    </div>
  );
}

/* ============================== TOAST ============================== */
/** Mobile-style toast (absolute within the app frame). Use with useToastHost:
 *    const { fireToast, toastProps } = useToastHost();
 *    ... <Toast {...toastProps} />
 *  fireToast({ msg, icon?, undo?: 'Annulla', undoFn?: () => {} })
 */
export function Toast({ toast, onUndo, onDone }) {
  useEffect(() => {
    if (!toast) return;
    const tm = setTimeout(onDone, toast.undo ? 4200 : 2600);
    return () => clearTimeout(tm);
  }, [toast]);
  if (!toast) return null;
  return (
    <div style={{
      position: 'absolute', left: 16, right: 16, bottom: 'calc(var(--safe-bottom) + 86px)', zIndex: 300,
      background: 'var(--ink)', color: '#fff', borderRadius: 'var(--r-md)', padding: '13px 16px',
      display: 'flex', alignItems: 'center', gap: 12, boxShadow: 'var(--sh-pop)',
      animation: 'slideUp 280ms var(--ease-emph)',
    }}>
      {toast.icon && <Icon name={toast.icon} size={19} color="#fff" />}
      <div style={{ flex: 1, fontSize: 14, fontWeight: 500, lineHeight: 1.35 }}>{toast.msg}</div>
      {toast.undo && (
        <button className="press" onClick={onUndo} style={{ color: 'var(--clay-tint)', fontWeight: 700, fontSize: 14, letterSpacing: '0.02em' }}>{toast.undo}</button>
      )}
    </div>
  );
}
