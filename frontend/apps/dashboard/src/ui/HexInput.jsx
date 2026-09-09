import React, { useEffect, useState } from 'react';

export default function HexInput({ value, onChange, width, disabled }) {
  const [raw, setRaw] = useState((value || '').replace('#', '').toUpperCase());
  useEffect(() => { setRaw((value || '').replace('#', '').toUpperCase()); }, [value]);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid var(--hair)', borderRadius: 9, padding: '8px 11px', background: 'var(--surface)' }}>
      <span style={{ color: 'var(--muted-2)', fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>#</span>
      <input disabled={disabled} value={raw} maxLength={6}
        onChange={(e) => { const v = e.target.value.replace(/[^0-9a-fA-F]/g, '').toUpperCase(); setRaw(v); if (v.length === 6) onChange('#' + v); }}
        onBlur={() => {
          if (raw.length === 3) { const x = raw.split('').map((c) => c + c).join(''); setRaw(x); onChange('#' + x); }
          else if (raw.length === 6) { onChange('#' + raw); }
          else { setRaw((value || '').replace('#', '').toUpperCase()); }
        }}
        style={{ border: 'none', outline: 'none', background: 'transparent', fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: 14, width: width || 78, letterSpacing: '0.05em' }} />
    </span>
  );
}
