import { withPortalForm } from '@youty/shared';
import { MutationButton } from '@youty/shared';
// NewClientModal — manual client entry → POST /api/clients/ (consents,
// categories, language included). An optional initial note becomes the first
// client note. Ported from the prototype; the separate "WhatsApp phone" field
// collapses into phone + wa flag (the API has a single phone), and the
// "add to waiting list" block is dropped (no staff-side waitlist-create API).
import React, { useState } from 'react';
import { api, ApiError, Icon, Toggle } from '@youty/shared';
import DkModal from '../../../ui/DkModal.jsx';
import { useDash } from '../../../ctx.jsx';
import { Field } from '../components.jsx';
import { inputCss } from '../helpers.js';

function NewClientModal({ onClose }) {
  const { t, clientCategories, fireToast, setSelClient, setTab, tab } = useDash();
  const [f, setF] = useState({
    first: '', last: '', phone: '', wa: true, email: '', birthday: '',
    privacy: true, marketing: false, whatsapp: true, tags: [], note: '', lang: 'it',
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF((o) => ({ ...o, [k]: v }));
  const canSave = f.first.trim() && f.phone.trim() && !saving;

  const save = async () => {
    setSaving(true);
    try {
      const created = await api.post('/api/clients/', {
        first_name: f.first.trim(),
        last_name: f.last.trim(),
        phone: f.phone.trim(),
        wa: f.wa,
        email: f.email.trim(),
        lang: f.lang,
        category_ids: f.tags,
        birthday: f.birthday || null,
        origin: t('Inserimento manuale', 'Manual entry'),
        consents: { privacy: f.privacy, marketing: f.marketing, card_charge: false },
        whatsapp_reminders: f.whatsapp,
      });
      if (f.note.trim()) {
        try { await api.post(`/api/clients/${created.id}/notes`, { text: f.note.trim(), visibility: 'private' }); }
        catch { /* the client exists — don't fail the flow on the note */ }
      }
      fireToast({ msg: t(`Cliente ${created.full_name} creato`, `Client ${created.full_name} created`), icon: 'check' });
      setSelClient(created.id);
      if (tab !== 'clienti') setTab('clienti');
      onClose();
    } catch (err) {
      fireToast({ msg: err instanceof ApiError ? err.message : t('Errore di rete', 'Network error'), icon: 'alert' });
    } finally { setSaving(false); }
  };

  const Cons = ({ k, label, sub }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{label}</div>
        {sub && <div className="t-sm" style={{ color: 'var(--muted-2)', fontSize: 11.5 }}>{sub}</div>}
      </div>
      <Toggle on={f[k]} onChange={(v) => set(k, v)} />
    </div>
  );

  return (
    <DkModal open onClose={onClose} title={t('Nuovo cliente', 'New client')} sub={t('Inserimento manuale in anagrafica', 'Manual entry')} width={520}
      foot={<React.Fragment>
        <button className="dk-btn dk-btn--ghost" onClick={onClose}>{t('Annulla', 'Cancel')}</button>
        <MutationButton className="dk-btn dk-btn--clay" disabled={!canSave} style={{ opacity: canSave ? 1 : 0.4 }} onClick={save}>
          <Icon name="check" size={17} color="#fff" />{saving ? t('Creo…', 'Creating…') : t('Crea cliente', 'Create client')}
        </MutationButton>
      </React.Fragment>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        <Field label={t('Nome', 'First name')}><input value={f.first} onChange={(e) => set('first', e.target.value)} style={inputCss} autoFocus /></Field>
        <Field label={t('Cognome', 'Last name')}><input value={f.last} onChange={(e) => set('last', e.target.value)} style={inputCss} /></Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, marginBottom: 14, alignItems: 'end' }}>
        <Field label={t('Telefono', 'Phone')}>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', display: 'grid', placeItems: 'center' }}><Icon name="phone" size={15} color="var(--muted-2)" /></span>
            <input value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+39 …" style={{ ...inputCss, paddingLeft: 34 }} />
          </div>
        </Field>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 42 }}>
          <Icon name="whatsapp" size={16} color="#3F9D58" />
          <span className="t-sm" style={{ fontWeight: 600, color: 'var(--ink-2)' }}>WhatsApp</span>
          <Toggle on={f.wa} onChange={(v) => set('wa', v)} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <Field label="Email"><input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} placeholder="nome@email.it" style={inputCss} /></Field>
        <Field label={t('Compleanno', 'Birthday')}><input type="date" value={f.birthday} onChange={(e) => set('birthday', e.target.value)} style={inputCss} /></Field>
      </div>

      {/* preferred language — language of automatic WhatsApp messages */}
      <Field label={t('Lingua preferita', 'Preferred language')} hint={t('· comunicazioni WhatsApp automatiche', '· automatic WhatsApp messages')}>
        <div style={{ display: 'flex', gap: 8 }}>
          {[['it', 'Italiano'], ['en', 'English']].map(([k, l]) => {
            const on = f.lang === k;
            return (
              <button key={k} onClick={() => set('lang', k)} style={{ flex: 1, padding: '10px', borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: 'pointer', border: '1px solid ' + (on ? 'var(--clay)' : 'var(--hair)'), background: on ? 'var(--clay-tint)' : 'var(--surface)', color: on ? 'var(--clay-ink)' : 'var(--ink-2)' }}>{l}</button>
            );
          })}
        </div>
      </Field>

      {/* labels — from the client-category catalog */}
      <div className="t-meta" style={{ margin: '16px 0 8px' }}>{t('Etichette', 'Labels')}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 16 }}>
        {clientCategories.map((cat) => {
          const on = f.tags.includes(cat.id);
          return (
            <button key={cat.id} onClick={() => set('tags', on ? f.tags.filter((x) => x !== cat.id) : [...f.tags, cat.id])} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 99, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: '1px solid ' + (on ? 'var(--clay)' : 'var(--hair)'), background: on ? 'var(--clay-tint)' : 'var(--surface)', color: on ? 'var(--clay-ink)' : 'var(--ink-2)' }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: cat.color }} />{cat.name}{on && <Icon name="check" size={12} color="var(--clay-ink)" />}
            </button>
          );
        })}
        {!clientCategories.length && <span className="t-sm" style={{ color: 'var(--muted-2)' }}>{t('Nessuna etichetta a catalogo.', 'No labels in the catalogue.')}</span>}
      </div>

      {/* initial note */}
      <Field label={t('Note', 'Notes')} hint={t('· facoltative, visibili nella scheda', '· optional, shown on the profile')}>
        <textarea value={f.note} onChange={(e) => set('note', e.target.value)} rows={3} placeholder={t('es. Allergie, preferenze, come ci ha conosciuto…', 'e.g. Allergies, preferences, how they found us…')} style={{ ...inputCss, resize: 'none', lineHeight: 1.5 }} />
      </Field>

      <div style={{ height: 16 }} />
      <div className="t-meta" style={{ marginBottom: 4 }}>{t('Consensi GDPR', 'GDPR consents')}</div>
      <div style={{ border: '1px solid var(--hair)', borderRadius: 12, padding: '2px 14px', display: 'flex', flexDirection: 'column' }}>
        <Cons k="privacy" label={t('Privacy & trattamento dati', 'Privacy & data')} sub={t("Obbligatorio per l'anagrafica", 'Required for records')} />
        <div style={{ height: 1, background: 'var(--hair)' }} />
        <Cons k="marketing" label={t('Comunicazioni marketing', 'Marketing messages')} />
        <div style={{ height: 1, background: 'var(--hair)' }} />
        <Cons k="whatsapp" label={t('Promemoria WhatsApp', 'WhatsApp reminders')} />
      </div>
      <div className="t-sm" style={{ color: 'var(--muted-2)', marginTop: 10 }}>
        {t('I consensi possono arrivare anche da modulo cartaceo e restano modificabili dalla scheda.', 'Consents may come from a paper form and stay editable from the profile.')}
      </div>
    </DkModal>
  );
}

export default withPortalForm(NewClientModal);
