import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { NumInput } from './ui/NumInput.jsx';
import { useT } from './i18n.jsx';
import { decisionIsActive, createAccessMonitor } from './portalAccessState.js';

export const PortalAccessContext = createContext({ operational_access: false, status: 'unavailable' });

export { decisionIsActive } from './portalAccessState.js';

/** Each org/session owns a monitor; cleanup discards requests from the old org. */
export function usePortalAccess({ identity, path, initial, publicAccess = false }) {
  const [access, setAccess] = useState({ status: 'unavailable', operational_access: false });
  const monitor = useRef(null);
  const refresh = useCallback(() => monitor.current?.refresh(), []);
  useEffect(() => {
    const current = createAccessMonitor({
      fetchAccess: (signal) => api.get(path, { signal, auth: !publicAccess, headers: { 'Cache-Control': 'no-cache' } }),
      onChange: setAccess, purchaseUrl: initial?.purchase_url,
    });
    monitor.current = current;
    const resume = () => { if (document.visibilityState !== 'hidden') current.resume(); };
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      current.stop();
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [identity, path, publicAccess]);
  return { access, refresh, operationalAccess: decisionIsActive(access) };
}

const controlStyle = { border: '1px solid var(--hair, #ded8d2)', borderRadius: 10, padding: '10px 14px', background: 'var(--surface, #fff)', color: 'var(--ink, #302722)', cursor: 'pointer', font: 'inherit' };

export function PortalAccessProvider({ access, refresh, publicAccess = false, children }) {
  const [panelOpen, setPanelOpen] = useState(false);
  const requestAccess = useCallback(() => setPanelOpen(true), []);
  useEffect(() => { if (decisionIsActive(access)) setPanelOpen(false); }, [access]);
  return <PortalAccessContext.Provider value={{ ...access, refresh, publicAccess, requestAccess }}>
    {children}
    {panelOpen && <PortalAccessDialog onClose={() => setPanelOpen(false)} />}
  </PortalAccessContext.Provider>;
}

export function PortalAccessPanel({ onClose, draft = false }) {
  const access = useContext(PortalAccessContext);
  const { t } = useT();
  const required = !access.publicAccess && access.status === 'subscription_required';
  return <section aria-label={t('Accesso alle modifiche', 'Editing access')} style={{ maxWidth: 460, padding: 24, color: 'var(--ink, #302722)', fontFamily: 'var(--sans, sans-serif)' }}>
    <div aria-hidden="true" style={{ fontSize: 26, marginBottom: 12 }}>🔒</div>
    <h2 style={{ fontSize: 22, margin: '0 0 10px' }}>{access.publicAccess
      ? t('Operazioni online non disponibili', 'Online actions unavailable')
      : required ? t('Attiva il tuo abbonamento Beauty', 'Activate your Beauty subscription')
        : t('Non riusciamo a verificare l’abbonamento', 'We cannot verify your subscription')}</h2>
    <p style={{ lineHeight: 1.6, margin: '0 0 16px' }}>{access.publicAccess
      ? t('Puoi continuare a consultare i tuoi dati. Riprova più tardi o contatta il salone.', 'You can keep browsing your data. Try again later or contact the salon.')
      : required ? t('I tuoi dati restano disponibili in sola lettura. Attiva l’abbonamento per creare, modificare e gestire le prenotazioni.', 'Your data remains available to browse. Activate your subscription to create, edit and manage bookings.')
        : t('Le modifiche sono temporaneamente sospese. Puoi continuare a consultare i tuoi dati e riprovare la verifica.', 'Editing is temporarily paused. You can keep browsing your data and retry verification.')}</p>
    {draft && <p style={{ lineHeight: 1.5 }}>{t('La bozza rimane aperta. Potrai riprendere quando l’accesso sarà ripristinato.', 'Your draft stays open. You can resume when access is restored.')}</p>}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      {required && access.purchase_url && <a href={access.purchase_url} style={{ ...controlStyle, background: 'var(--clay, #7c4a57)', color: '#fff', textDecoration: 'none', fontWeight: 700 }}>{t('Gestisci abbonamento', 'Manage subscription')}</a>}
      <button type="button" onClick={access.refresh} style={controlStyle}>{t('Riprova verifica', 'Retry verification')}</button>
      {onClose && <button type="button" onClick={onClose} style={controlStyle}>{t('Torna ai dati', 'Back to browsing')}</button>}
    </div>
  </section>;
}

export function PortalAccessDialog({ onClose }) {
  const dialog = useRef(null);
  const { t } = useT();
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => { previous?.focus?.(); };
  }, []);
  return <dialog ref={dialog} onCancel={(event) => { event.preventDefault(); onClose(); }} aria-modal="true" aria-label={t('Accesso alle modifiche', 'Editing access')}
    style={{ border: '1px solid var(--hair, #ded8d2)', borderRadius: 18, maxWidth: 'calc(100vw - 32px)', padding: 0, background: 'var(--surface, #fff)', boxShadow: '0 16px 60px #0003' }}>
    <PortalAccessPanel onClose={onClose} />
  </dialog>;
}

/** Entry controls explain the lock; role/validation disabled states remain intact. */
export function MutationButton({ disabled, style, onClick, children, type = 'button', ...props }) {
  const form = useContext(PortalFormContext);
  const frozen = !!form?.blocked;
  const access = useContext(PortalAccessContext);
  const { t } = useT();
  const blocked = !decisionIsActive(access);
  return <button {...props} type={type} disabled={disabled || frozen} data-portal-locked={blocked || undefined}
    aria-disabled={disabled || frozen || undefined} aria-haspopup={blocked ? 'dialog' : props['aria-haspopup']}
    onClick={(event) => {
      if (blocked) { event.preventDefault(); event.stopPropagation(); access.requestAccess?.(); return; }
      onClick?.(event);
    }}
    title={blocked ? t('Modifiche bloccate: mostra dettagli', 'Editing locked: show details') : props.title}
    style={{ ...style, ...(blocked ? { opacity: 0.7, cursor: 'pointer', position: style?.position || 'relative' } : {}) }}>
    {children}
    {blocked && <span aria-hidden="true" style={{ position: 'absolute', right: -3, top: -5, background: 'var(--surface, white)', color: 'var(--ink, #302722)', border: '1px solid var(--hair, #ddd)', borderRadius: 99, padding: '1px 3px', fontSize: 10, lineHeight: 1.3 }}>🔒</span>}
  </button>;
}

export const MutationInput = React.forwardRef(function MutationInput({ disabled, onChange, onBlur, onKeyDown, ...props }, ref) {
  const access = useContext(PortalAccessContext);
  const blocked = !decisionIsActive(access);
  const nonText = ['checkbox', 'radio', 'file', 'color', 'range', 'button', 'submit', 'reset', 'image'].includes(props.type);
  const guarded = (callback) => (event) => { if (!disabled && decisionIsActive(access)) callback?.(event); };
  return <input {...props} ref={ref} disabled={disabled || (blocked && nonText)} readOnly={props.readOnly || (blocked && !nonText)} onChange={guarded(onChange)} onBlur={guarded(onBlur)} onKeyDown={guarded(onKeyDown)} />;
});
export const MutationTextarea = React.forwardRef(function MutationTextarea({ disabled, onChange, ...props }, ref) {
  const access = useContext(PortalAccessContext);
  return <textarea {...props} ref={ref} disabled={disabled} readOnly={props.readOnly || !decisionIsActive(access)} onChange={(event) => { if (!disabled && decisionIsActive(access)) onChange?.(event); }} />;
});
export const MutationSelect = React.forwardRef(function MutationSelect({ disabled, onChange, ...props }, ref) {
  const access = useContext(PortalAccessContext);
  return <select {...props} ref={ref} disabled={disabled || !decisionIsActive(access)} onChange={(event) => { if (!disabled && decisionIsActive(access)) onChange?.(event); }} />;
});
export function MutationNumInput({ disabled, onChange, ...props }) {
  const access = useContext(PortalAccessContext);
  const blocked = !decisionIsActive(access);
  return <NumInput {...props} disabled={disabled} readOnly={props.readOnly || blocked} onChange={(value) => { if (!blocked && !disabled) onChange?.(value); }} />;
}
export function MutationToggle({ on, onChange }) {
  return <MutationButton className={'swt press' + (on ? ' swt--on' : '')}
    onClick={() => onChange(!on)} aria-pressed={on} />;
}

const PortalFormContext = createContext(null);

/** Explicit form regions freeze drafts without replacing their component tree. */
export function PortalFormBody({ children, onClose, notice = true }) {
  const form = useContext(PortalFormContext);
  const access = useContext(PortalAccessContext);
  const { t } = useT();
  if (!form) return children;
  return <>
    {form.blocked && notice && <div style={{ marginBottom: 16 }}>
      <PortalAccessNotice access={access} refresh={access.refresh} publicAccess={access.publicAccess} />
      {!form.preview && <p role="status" style={{ margin: '8px 0', lineHeight: 1.5, fontSize: 14 }}>{t('La bozza rimane aperta. Potrai riprendere quando l’accesso sarà ripristinato.', 'Your draft stays open. You can resume when access is restored.')}</p>}
      {onClose && <button type="button" onClick={onClose} style={{ ...controlStyle, marginTop: 8 }}>{t('Torna ai dati', 'Back to browsing')}</button>}
    </div>}
    <fieldset disabled={form.blocked} onSubmitCapture={(event) => { if (form.blocked) { event.preventDefault(); event.stopPropagation(); } }}
      style={{ display: 'contents', border: 0, padding: 0, margin: 0, minWidth: 0 }}>{children}</fieldset>
  </>;
}

/** First entry is gated; an admitted form never unmounts when access expires.
 * Framed forms put PortalFormBody inside their own modal/drawer chrome so close
 * and navigation controls stay available. Preview is for existing record cards.
 */
export function PortalFormGate({ children, onClose, preview = false, framed = false, overlay = false }) {
  const access = useContext(PortalAccessContext);
  const active = decisionIsActive(access);
  const admitted = useRef(false);
  if (active || preview) admitted.current = true;
  if (!admitted.current) return overlay ? <PortalAccessDialog onClose={onClose} /> : <PortalAccessPanel onClose={onClose} />;
  return <PortalFormContext.Provider value={{ blocked: !active, preview }}>
    {framed ? children : <PortalFormBody onClose={onClose}>{children}</PortalFormBody>}
  </PortalFormContext.Provider>;
}

export function withPortalForm(Component, { preview = () => false, framed = true, overlay = true } = {}) {
  function GatedForm(props) {
    return <PortalFormGate onClose={props.onClose || props.onBack || props.onCancel} preview={preview(props)} framed={framed} overlay={overlay}><Component {...props} /></PortalFormGate>;
  }
  GatedForm.displayName = `PortalForm(${Component.name})`;
  return GatedForm;
}

/** For semantic actions rendered as calendar cells/cards rather than buttons. */
export function useMutationAction() {
  const access = useContext(PortalAccessContext);
  return (action) => (...args) => {
    if (!decisionIsActive(access)) { access.requestAccess?.(); return; }
    return action(...args);
  };
}

export function PortalAccessNotice({ access, refresh, publicAccess = false }) {
  const { t } = useT();
  if (decisionIsActive(access)) return null;
  const required = !publicAccess && access.status === 'subscription_required';
  return <div role="status" style={{ padding: '12px 18px', background: 'var(--clay-tint, #f4e7df)', color: 'var(--ink, #302722)', fontSize: 14, lineHeight: 1.5 }}>
    {publicAccess
      ? t('Le operazioni online sono al momento non disponibili. Puoi consultare i tuoi dati o contattare il salone.', 'Online actions are currently unavailable. You can browse your data or contact the salon.')
      : required
        ? t('Accesso in sola lettura. Attiva l’abbonamento Beauty per apportare modifiche e ricevere prenotazioni.', 'Read-only access. Activate your Beauty subscription to make changes and receive bookings.')
        : t('Accesso in sola lettura: verifica dell’abbonamento temporaneamente non disponibile.', 'Read-only access: subscription verification is temporarily unavailable.')}
    {required && access.purchase_url && <a href={access.purchase_url} style={{ marginLeft: 12, color: 'inherit', fontWeight: 700 }}>{t('Gestisci abbonamento', 'Manage subscription')}</a>}
    <button type="button" onClick={refresh} style={{ marginLeft: 12, textDecoration: 'underline', color: 'inherit' }}>{t('Riprova', 'Retry')}</button>
  </div>;
}
