// BrandDrawer.jsx — port of BrandManager. Brand colour (PUT /api/core/settings)
// + logo upload (postForm POST /api/core/settings/logo). Owner-only writes;
// polite lock state for non-owners. No logo-delete endpoint: "remove" only
// clears the locally selected file before saving.
import React, { useRef, useState } from 'react';
import { api, mediaUrl, Icon } from '@youty/shared';
import DkDrawer from '../../ui/DkDrawer.jsx';
import HexInput from '../../ui/HexInput.jsx';
import { useDash } from '../../ctx.jsx';
import { PaletteGrid, inputCss, toastErr, LockNote } from './lib.jsx';

export default function BrandDrawer({ onClose }) {
  const { t, session, salon, settings, reload, fireToast } = useDash();
  const isOwner = !!session?.is_owner;
  const [color, setColor] = useState(settings?.brand_color || '#6366F1');
  const [openingHours, setOpeningHours] = useState(settings?.opening_hours || '');
  const [privacyUrl, setPrivacyUrl] = useState(settings?.privacy_policy_url || '');
  const [file, setFile] = useState(null);        // pending File
  const [filePreview, setFilePreview] = useState(null); // data URL of pending file
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  const serverLogo = settings?.logo_url ? mediaUrl(settings.logo_url) : null;
  const logoSrc = filePreview || serverLogo;

  const onFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setFile(f);
    const r = new FileReader();
    r.onload = (ev) => setFilePreview(ev.target.result);
    r.readAsDataURL(f);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (file) await api.postForm('/api/core/settings/logo', { logo: file });
      await api.put('/api/core/settings', { brand_color: color, opening_hours: openingHours, privacy_policy_url: privacyUrl.trim() });
      await reload.salon();
      fireToast({ msg: t('Brand salvato', 'Brand saved'), icon: 'check' });
      onClose();
    } catch (err) { toastErr(err, fireToast, t); }
    finally { setSaving(false); }
  };

  const Logo = ({ size }) => logoSrc
    ? <img src={logoSrc} alt="logo" style={{ width: size, height: size, objectFit: 'cover', borderRadius: 10 }} />
    : <div style={{ width: size, height: size, borderRadius: 10, background: color, display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 800, fontFamily: 'var(--serif)', fontSize: size * 0.42 }}>{(salon?.name || 'S')[0]}</div>;

  return (
    <DkDrawer open onClose={onClose}>
      <div style={{ padding: '22px 22px 18px', borderBottom: '1px solid var(--hair)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--serif)', fontSize: 22, fontWeight: 500, lineHeight: 1.15 }}>{t('Brand & app cliente', 'Brand & client app')}</div>
          <div className="t-sm" style={{ color: 'var(--muted)', marginTop: 4 }}>{salon?.name}{salon?.locations?.length ? ' · ' + (salon.locations.find((l) => l.is_default)?.name || salon.locations[0].name) : ''}</div>
        </div>
        <button className="dk-iconbtn" style={{ flexShrink: 0, marginLeft: 12 }} onClick={onClose}><Icon name="x" size={18} /></button>
      </div>

      <div className="scroll" style={{ flex: 1, overflowY: 'auto', padding: '18px 22px 30px' }}>
        {!isOwner && (
          <div style={{ marginBottom: 18 }}>
            <LockNote t={t} msg={t('Solo il titolare può modificare il brand. Visualizzazione in sola lettura.', 'Only the owner can edit the brand. Read-only view.')} />
          </div>
        )}

        {/* logo */}
        <div className="t-meta" style={{ marginBottom: 10 }}>{t('Logo', 'Logo')}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
          <Logo size={64} />
          {isOwner && (
            <div style={{ flex: 1 }}>
              <button className="dk-btn dk-btn--ghost" onClick={() => fileRef.current && fileRef.current.click()}><Icon name="plus" size={16} />{logoSrc ? t('Cambia logo', 'Change logo') : t('Carica logo', 'Upload logo')}</button>
              {file && <button onClick={() => { setFile(null); setFilePreview(null); if (fileRef.current) fileRef.current.value = ''; }} style={{ marginLeft: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700, color: 'var(--danger)', background: 'none', border: 'none' }}>{t('Annulla scelta', 'Discard choice')}</button>}
              <input ref={fileRef} type="file" accept="image/*" onChange={onFile} style={{ display: 'none' }} />
            </div>
          )}
        </div>
        <div className="t-sm" style={{ color: 'var(--muted-2)', marginBottom: 22 }}>{t('Compare nell’app cliente e nelle comunicazioni.', 'Shown in the client app and communications.')}</div>

        {/* primary colour — wheel + hex + palette */}
        <div className="t-meta" style={{ marginBottom: 10 }}>{t('Colore principale', 'Primary colour')}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, opacity: isOwner ? 1 : 0.55, pointerEvents: isOwner ? 'auto' : 'none' }}>
          <label title={t('Ruota dei colori', 'Colour wheel')} style={{ position: 'relative', width: 48, height: 48, borderRadius: 12, cursor: 'pointer', overflow: 'hidden', flexShrink: 0, border: '1px solid var(--hair)', background: color }}>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value.toUpperCase())} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
          </label>
          <div style={{ flex: 1 }}>
            <div className="t-sm" style={{ color: 'var(--muted)', fontWeight: 600, marginBottom: 4 }}>{t('Codice esadecimale', 'Hex code')}</div>
            <HexInput value={color} onChange={setColor} />
          </div>
        </div>
        <div style={{ opacity: isOwner ? 1 : 0.55, pointerEvents: isOwner ? 'auto' : 'none' }}>
          <PaletteGrid value={color} onChange={setColor} style={{ marginBottom: 22 }} />
        </div>

        {/* live preview */}
        <div className="t-meta" style={{ marginBottom: 10 }}>{t('Anteprima', 'Preview')}</div>
        <div style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid var(--hair)', marginBottom: 16 }}>
          <div style={{ height: 70, background: color, display: 'flex', alignItems: 'flex-end', padding: 12, gap: 10 }}>
            {logoSrc && <img src={logoSrc} alt="" style={{ width: 30, height: 30, borderRadius: 8, objectFit: 'cover' }} />}
            <span style={{ fontFamily: 'var(--serif)', fontSize: 20, fontWeight: 600, color: '#fff' }}>{salon?.name}</span>
          </div>
          <div style={{ padding: 12, background: 'var(--surface)' }}>
            <div style={{ height: 8, width: '60%', borderRadius: 4, background: 'var(--paper-2)', marginBottom: 8 }} />
            <div style={{ height: 30, borderRadius: 99, background: color, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 12, fontWeight: 700 }}>{t('Prenota', 'Book')}</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', background: 'var(--info-tint)', borderRadius: 12, marginBottom: 18 }}>
          <Icon name="info" size={16} color="var(--info)" />
          <span className="t-sm" style={{ color: 'var(--ink-2)', fontWeight: 600 }}>{t('Colore e logo vengono applicati alla web app cliente al prossimo caricamento.', 'Colour and logo are applied to the client web app on the next load.')}</span>
        </div>

        {/* orari di apertura — testo libero, mostrato nel footer dell'app cliente */}
        <div className="t-meta" style={{ marginBottom: 10 }}>{t('Orari di apertura', 'Opening hours')}</div>
        <textarea
          value={openingHours}
          disabled={!isOwner}
          onChange={(e) => setOpeningHours(e.target.value)}
          placeholder={t('es. Lun-Ven 9:00-19:00\nSab 9:00-13:00', 'e.g. Mon-Fri 9am-7pm\nSat 9am-1pm')}
          rows={3}
          style={{ ...inputCss, width: '100%', boxSizing: 'border-box', resize: 'vertical', lineHeight: 1.5, opacity: isOwner ? 1 : 0.55 }}
        />
        <div className="t-sm" style={{ color: 'var(--muted-2)', marginTop: 6, marginBottom: 22 }}>{t('Compare nel footer dell’app cliente.', 'Shown in the client app footer.')}</div>

        {/* informativa privacy — obbligatoria nel form pubblico di raccolta contatti */}
        <div className="t-meta" style={{ marginBottom: 10 }}>{t('Informativa privacy', 'Privacy policy')}</div>
        <input
          type="url"
          value={privacyUrl}
          disabled={!isOwner}
          onChange={(e) => setPrivacyUrl(e.target.value)}
          placeholder="https://…"
          style={{ ...inputCss, width: '100%', boxSizing: 'border-box', opacity: isOwner ? 1 : 0.55 }}
        />
        <div className="t-sm" style={{ color: 'var(--muted-2)', marginTop: 6, marginBottom: 22 }}>
          {t('Link alla vostra informativa, mostrato nel form pubblico di raccolta contatti. Il titolare del trattamento dei dati delle clienti è il salone.',
             'Link to your privacy policy, shown on the public contact form. The salon is the data controller for its clients.')}
        </div>

        {isOwner && (
          <button className="dk-btn dk-btn--clay" disabled={saving} style={{ width: '100%', opacity: saving ? 0.6 : 1 }} onClick={save}>
            <Icon name="check" size={17} color="#fff" />{saving ? t('Salvataggio…', 'Saving…') : t('Salva', 'Save')}
          </button>
        )}
      </div>
    </DkDrawer>
  );
}
