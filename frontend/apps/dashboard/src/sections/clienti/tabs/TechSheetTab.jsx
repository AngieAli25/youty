import { MutationButton } from '@youty/shared';
// TechSheetTab.jsx — profile tab: list of immutable technical sheets +
// inline creation form (GET/POST /api/clients/{id}/sheets).
import React, { useEffect, useState } from 'react';
import { api, ApiError, EmptyState, Icon } from '@youty/shared';
import { useDash } from '../../../ctx.jsx';
import { TechSheetCard, TechSheetForm } from '../TechSheet.jsx';

export default function TechSheetTab({ c }) {
  const { t, fireToast, hasScope, canMutate } = useDash();
  const canWrite = hasScope('clients');
  const [sheets, setSheets] = useState(null);
  const [adding, setAdding] = useState(false);

  const load = () => {
    api.get(`/api/clients/${c.id}/sheets`)
      .then(setSheets)
      .catch((err) => {
        setSheets([]);
        fireToast({ msg: err instanceof ApiError ? err.message : t('Errore di rete', 'Network error'), icon: 'alert' });
      });
  };
  useEffect(() => { setSheets(null); load(); }, [c.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (adding) {
    return (
      <div>
        <div style={{ fontFamily: 'var(--serif)', fontSize: 19, fontWeight: 500, marginBottom: 14 }}>{t('Nuova scheda tecnica', 'New technical sheet')}</div>
        <TechSheetForm clientId={c.id}
          onCancel={() => setAdding(false)}
          onSaved={(sheet) => {
            setAdding(false);
            setSheets((l) => [sheet, ...(l || [])]);
            fireToast({ msg: t('Scheda tecnica salvata', 'Technical sheet saved'), icon: 'check' });
          }} />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <div className="t-sm" style={{ color: 'var(--muted)' }}>{t('Registro tecnico per trattamento. Una scheda per visita, con timestamp e sola lettura una volta salvata.', 'Technical record per treatment. One sheet per visit, timestamped and read-only once saved.')}</div>
        </div>
        {canWrite && <MutationButton className="dk-btn dk-btn--clay" style={{ flexShrink: 0 }} onClick={() => setAdding(true)}><Icon name="plus" size={16} color="#fff" />{t('Nuova scheda', 'New sheet')}</MutationButton>}
      </div>
      {sheets == null ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[...Array(2)].map((_, i) => <div key={i} className="skel" style={{ height: 66, borderRadius: 12 }} />)}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sheets.map((s, i) => <TechSheetCard key={s.id} sheet={s} defaultOpen={i === 0} />)}
          {!sheets.length && <EmptyState icon="edit" title={t('Nessuna scheda tecnica', 'No technical sheets')} sub={t('Crea la prima scheda dopo un trattamento.', 'Create the first sheet after a treatment.')} />}
        </div>
      )}
    </div>
  );
}
