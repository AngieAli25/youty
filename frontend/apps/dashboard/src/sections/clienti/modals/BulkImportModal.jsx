import { withPortalForm } from '@youty/shared';
import { MutationButton } from '@youty/shared';
// BulkImportModal — CSV paste/upload (Nome, Email, Telefono) → parse →
// POST /api/clients/import → shows the API's {created, updated} result.
// The backend upserts by phone, then email (the prototype matched by name).
import React, { useRef, useState } from 'react';
import { api, ApiError, Icon } from '@youty/shared';
import DkModal from '../../../ui/DkModal.jsx';
import { useDash } from '../../../ctx.jsx';
import { inputCss } from '../helpers.js';

function parseCsv(raw) {
  const rows = String(raw).split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  if (!rows.length) return [];
  const delim = (rows[0].match(/;/g) || []).length > (rows[0].match(/,/g) || []).length ? ';' : ',';
  let start = 0;
  if (/nome|name|email|tel|phone/i.test(rows[0])) start = 1;
  const out = [];
  for (let i = start; i < rows.length; i++) {
    const cols = rows[i].split(delim).map((cc) => cc.trim().replace(/^"(.*)"$/, '$1'));
    const name = cols[0]; if (!name) continue;
    const words = name.split(/\s+/);
    out.push({
      first_name: words[0],
      last_name: words.slice(1).join(' '),
      email: (cols[1] || '').trim(),
      phone: (cols[2] || '').trim(),
    });
  }
  return out;
}

function BulkImportModal({ onClose }) {
  const { t, fireToast } = useDash();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // ImportOut {created, updated}
  const fileRef = useRef(null);

  const rows = parseCsv(text);
  const onFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => setText(String(r.result));
    r.readAsText(f);
    e.target.value = '';
  };

  const apply = async () => {
    setBusy(true);
    try {
      const res = await api.post('/api/clients/import', { rows });
      setResult(res);
      fireToast({ msg: t(`Importati ${res.created} nuovi · ${res.updated} aggiornati`, `${res.created} added · ${res.updated} updated`), icon: 'check' });
    } catch (err) {
      fireToast({ msg: err instanceof ApiError ? err.message : t('Errore di rete', 'Network error'), icon: 'alert' });
    } finally { setBusy(false); }
  };

  if (result) {
    return (
      <DkModal open onClose={onClose} title={t('Importazione completata', 'Import complete')} width={420}
        foot={<button className="dk-btn dk-btn--clay" onClick={onClose}><Icon name="check" size={16} color="#fff" />{t('Chiudi', 'Close')}</button>}>
        <div style={{ display: 'flex', gap: 12, padding: '8px 0 16px' }}>
          <div className="dk-card" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12, padding: '16px', boxShadow: 'none', border: '1px solid var(--hair)' }}>
            <div style={{ width: 40, height: 40, borderRadius: 11, background: 'var(--ok-tint)', display: 'grid', placeItems: 'center' }}><Icon name="plus" size={19} color="var(--ok)" /></div>
            <div><div className="t-num" style={{ fontSize: 24, lineHeight: 1 }}>{result.created}</div><div className="t-sm" style={{ color: 'var(--muted)', marginTop: 2 }}>{t('nuovi clienti', 'new clients')}</div></div>
          </div>
          <div className="dk-card" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12, padding: '16px', boxShadow: 'none', border: '1px solid var(--hair)' }}>
            <div style={{ width: 40, height: 40, borderRadius: 11, background: 'var(--warn-tint)', display: 'grid', placeItems: 'center' }}><Icon name="refresh" size={19} color="var(--warn)" /></div>
            <div><div className="t-num" style={{ fontSize: 24, lineHeight: 1 }}>{result.updated}</div><div className="t-sm" style={{ color: 'var(--muted)', marginTop: 2 }}>{t('aggiornati', 'updated')}</div></div>
          </div>
        </div>
      </DkModal>
    );
  }

  return (
    <DkModal open onClose={onClose} title={t('Importa clienti in massa', 'Bulk import clients')} sub={t('Aggiungi o aggiorna nome, email e telefono da un elenco', 'Add or update name, email and phone from a list')} width={620}
      foot={<React.Fragment>
        <span className="t-sm" style={{ marginRight: 'auto', color: 'var(--muted)' }}>{rows.length > 0 ? t(`${rows.length} righe pronte`, `${rows.length} rows ready`) : ''}</span>
        <button className="dk-btn dk-btn--ghost" onClick={onClose}>{t('Annulla', 'Cancel')}</button>
        <MutationButton className="dk-btn dk-btn--clay" disabled={!rows.length || busy} style={{ opacity: rows.length && !busy ? 1 : 0.4 }} onClick={apply}>
          <Icon name="check" size={17} color="#fff" />{busy ? t('Importo…', 'Importing…') : `${t('Importa', 'Import')} ${rows.length || ''}`}
        </MutationButton>
      </React.Fragment>}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <button className="dk-btn dk-btn--ghost" onClick={() => fileRef.current && fileRef.current.click()}><Icon name="arrowDn" size={15} />{t('Carica file CSV', 'Upload CSV file')}</button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: 'none' }} />
        <span className="t-sm" style={{ color: 'var(--muted-2)' }}>{t('oppure incolla qui sotto', 'or paste below')}</span>
      </div>
      <div className="t-meta" style={{ marginBottom: 6 }}>
        {t('Formato', 'Format')}: <span style={{ fontFamily: 'var(--mono, monospace)', textTransform: 'none', letterSpacing: 0 }}>{t('Nome, Email, Telefono', 'Name, Email, Phone')}</span>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} placeholder={'Sofia Ricci, sofia@email.it, +39 348 221 0094\nGiada Neri, giada@email.it, +39 333 118 4420'} style={{ ...inputCss, fontFamily: 'var(--mono, monospace)', resize: 'vertical' }} />
      <div className="t-sm" style={{ color: 'var(--muted-2)', marginTop: 6 }}>
        {t('I clienti già esistenti (stesso telefono o email) ricevono solo l’aggiornamento dei dati — i nuovi vengono creati.', 'Existing clients (same phone or email) only get their data updated — new ones are created.')}
      </div>
      {rows.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="t-meta" style={{ marginBottom: 8 }}>{t('Anteprima', 'Preview')} · {rows.length}</div>
          <div className="dk-card" style={{ overflow: 'hidden', maxHeight: 200, overflowY: 'auto', boxShadow: 'none', border: '1px solid var(--hair)' }}>
            {rows.slice(0, 40).map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 13px', borderTop: i ? '1px solid var(--hair)' : 'none' }}>
                <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.first_name} {r.last_name}</span>
                <span className="t-sm" style={{ flex: 1, minWidth: 0, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.email || '—'}</span>
                <span className="t-sm" style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{r.phone || '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </DkModal>
  );
}

export default withPortalForm(BulkImportModal);
