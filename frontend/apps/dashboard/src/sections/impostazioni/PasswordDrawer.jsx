// PasswordDrawer.jsx — cambio password del proprio account staff.
// POST /api/auth/staff/password. Il backend incrementa token_version, quindi
// invalida ogni altra sessione dell'utente: ci restituisce token nuovi che
// applichiamo subito, altrimenti ci sloggheremmo da soli.
import React, { useState } from 'react';
import { api, staffAuth, Icon } from '@youty/shared';
import DkDrawer from '../../ui/DkDrawer.jsx';
import { useDash } from '../../ctx.jsx';
import { inputCss, toastErr } from './lib.jsx';

const MIN_LEN = 8;

export default function PasswordDrawer({ onClose }) {
  const { t, session, fireToast } = useDash();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [conf, setConf] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  const tooShort = next.length > 0 && next.length < MIN_LEN;
  const mismatch = conf.length > 0 && next !== conf;
  const same = next.length > 0 && next === cur;
  const canSave = cur && next.length >= MIN_LEN && next === conf && !same && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const data = await api.post('/api/auth/staff/password', {
        current_password: cur,
        new_password: next,
      });
      staffAuth.applySession(data); // i token vecchi non valgono più
      fireToast({ msg: t('Password aggiornata', 'Password updated'), icon: 'check' });
      onClose();
    } catch (err) { toastErr(err, fireToast, t); }
    finally { setSaving(false); }
  };

  const Field = ({ label, value, onChange, autoComplete, err }) => (
    <div style={{ marginBottom: 14 }}>
      <div className="t-meta" style={{ marginBottom: 8 }}>{label}</div>
      <input
        type={show ? 'text' : 'password'}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...inputCss, width: '100%', boxSizing: 'border-box' }}
      />
      {err && <div className="t-sm" style={{ color: 'var(--danger)', marginTop: 6 }}>{err}</div>}
    </div>
  );

  return (
    <DkDrawer open onClose={onClose}>
      <div style={{ padding: '22px 22px 18px', borderBottom: '1px solid var(--hair)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--serif)', fontSize: 22, fontWeight: 500, lineHeight: 1.15 }}>{t('Cambia password', 'Change password')}</div>
          <div className="t-sm" style={{ color: 'var(--muted)', marginTop: 4 }}>{session?.user?.email}</div>
        </div>
        <button className="dk-iconbtn" style={{ flexShrink: 0, marginLeft: 12 }} onClick={onClose}><Icon name="x" size={18} /></button>
      </div>

      <div className="scroll" style={{ flex: 1, overflowY: 'auto', padding: '18px 22px 30px' }}>
        <Field label={t('Password attuale', 'Current password')} value={cur} onChange={setCur} autoComplete="current-password" />
        <Field label={t('Nuova password', 'New password')} value={next} onChange={setNext} autoComplete="new-password"
          err={tooShort ? t(`Almeno ${MIN_LEN} caratteri`, `At least ${MIN_LEN} characters`)
             : same ? t('Deve essere diversa da quella attuale', 'Must differ from the current one') : null} />
        <Field label={t('Ripeti la nuova password', 'Repeat new password')} value={conf} onChange={setConf} autoComplete="new-password"
          err={mismatch ? t('Le due password non coincidono', 'The two passwords do not match') : null} />

        <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 20, cursor: 'pointer' }}>
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--clay-ink)' }} />
          <span className="t-sm" style={{ color: 'var(--ink-2)', fontWeight: 600 }}>{t('Mostra le password', 'Show passwords')}</span>
        </label>

        <div className="t-sm" style={{ color: 'var(--muted-2)', lineHeight: 1.5, marginBottom: 20 }}>
          {t('Salvando, tutte le altre sessioni aperte con il tuo account vengono disconnesse — su questo dispositivo resti collegata.',
             'On save, every other session opened with your account is signed out — you stay signed in on this device.')}
        </div>

        <button className="dk-btn dk-btn--clay" disabled={!canSave} style={{ width: '100%', opacity: canSave ? 1 : 0.5 }} onClick={save}>
          {saving ? t('Salvataggio…', 'Saving…') : t('Cambia password', 'Change password')}
        </button>
      </div>
    </DkDrawer>
  );
}
