import { withPortalForm } from '@youty/shared';
import { MutationButton } from '@youty/shared';
// ShiftPattern — recurring weekly shift editor (port of the "Pattern settimanale
// ricorrente" card in prototype DkStaffPage). Times are edited as "9–19" text and
// converted to minutes-from-midnight (WeeklyShiftIn) on save; multi-week rotation
// maps to week_index + operator.cycle_weeks.
import React from 'react';
import { Icon } from '@youty/shared';
import { WEEKDAYS, currentWeekIndex, emptyWeek, inputCss } from './lib.js';

function ShiftPattern({ weeks, setWeeks, onSave, saving, canEdit, t }) {
  const dayInput = { ...inputCss, padding: '8px 11px' };
  const curIdx = currentWeekIndex(weeks.length);

  const setDayField = (wi, di, field, v) => setWeeks(weeks.map((w, j) => (
    j === wi ? { ...w, days: w.days.map((d, k) => (k === di ? { ...d, [field]: v } : d)) } : w
  )));
  const addWeek = () => setWeeks([...weeks, emptyWeek()]);
  const removeWeek = (wi) => setWeeks(weeks.filter((_, j) => j !== wi));

  return (
    <div className="dk-card" style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
        <div className="t-meta">{t('Pattern settimanale ricorrente', 'Recurring weekly pattern')}</div>
        <span className="t-sm" style={{ color: 'var(--muted-2)', fontWeight: 600 }}>
          {weeks.length > 1 ? t('rotazione di ' + weeks.length + ' settimane', weeks.length + '-week rotation') : t('valido ogni settimana', 'applies every week')}
        </span>
      </div>
      <div className="t-sm" style={{ color: 'var(--muted)', marginBottom: 16 }}>
        {t('Orario e pausa per ogni giorno (es. 9–19 e 13–14; vuoto = riposo). Aggiungi più settimane per una rotazione; le eccezioni (ferie, festività) si impostano nel calendario sotto.',
           'Hours and break for each day (e.g. 9–19 and 13–14; empty = day off). Add more weeks for a rotation; exceptions (vacation, holidays) are set in the calendar below.')}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {weeks.map((w, wi) => (
          <div key={wi} style={{ border: '1px solid ' + (weeks.length > 1 && wi === curIdx ? 'var(--clay)' : 'var(--hair)'), borderRadius: 12, padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--clay-ink)' }}>
                {weeks.length > 1 ? t('Settimana ' + (wi + 1), 'Week ' + (wi + 1)) : t('Ogni settimana', 'Every week')}
              </span>
              {weeks.length > 1 && wi === curIdx && (
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--clay-ink)', background: 'var(--clay-tint)', padding: '3px 9px', borderRadius: 99 }}>
                  {t('settimana corrente', 'current week')}
                </span>
              )}
              <span style={{ flex: 1 }} />
              {canEdit && weeks.length > 1 && (
                <button className="dk-iconbtn" style={{ width: 28, height: 28, borderRadius: 8 }} onClick={() => removeWeek(wi)} title={t('Rimuovi settimana', 'Remove week')}>
                  <Icon name="x" size={13} color="var(--muted)" />
                </button>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '46px 1fr 1fr', gap: '8px 10px', alignItems: 'center' }}>
              <span className="t-meta" />
              <span className="t-meta">{t('Orario', 'Hours')}</span>
              <span className="t-meta">{t('Pausa', 'Break')}</span>
              {w.days.map((d, di) => (
                <React.Fragment key={di}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink-2)' }}>{t(WEEKDAYS[di][0], WEEKDAYS[di][1])}</span>
                  <input value={d.hours} disabled={!canEdit} onChange={(e) => setDayField(wi, di, 'hours', e.target.value)} placeholder={t('9–19 o riposo', '9–19 or off')} style={dayInput} />
                  <input value={d.brk} disabled={!canEdit} onChange={(e) => setDayField(wi, di, 'brk', e.target.value)} placeholder={t('es. 13–14', 'e.g. 13–14')} style={dayInput} />
                </React.Fragment>
              ))}
            </div>
          </div>
        ))}
      </div>

      {canEdit && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
          <button onClick={addWeek} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderRadius: 9, border: '1px dashed var(--hair)', background: 'var(--surface)', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--clay-ink)' }}>
            <Icon name="plus" size={15} color="var(--clay-ink)" />{t('Aggiungi settimana', 'Add week')}
          </button>
          <span style={{ flex: 1 }} />
          <MutationButton className="dk-btn dk-btn--clay" onClick={onSave} disabled={saving} style={{ height: 40, opacity: saving ? 0.6 : 1 }}>
            <Icon name="check" size={15} color="#fff" />{saving ? t('Salvataggio…', 'Saving…') : t('Salva turni', 'Save shifts')}
          </MutationButton>
        </div>
      )}
    </div>
  );
}

export default withPortalForm(ShiftPattern, { preview: () => true, framed: false, overlay: false });
