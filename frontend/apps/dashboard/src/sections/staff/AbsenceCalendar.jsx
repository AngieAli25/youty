import { PortalFormGate } from '@youty/shared';
import { MutationInput } from '@youty/shared';
import { MutationButton } from '@youty/shared';
// AbsenceCalendar — port of prototype AvailabilityCalendar, backed by the
// absences API (/api/staff/{id}/absences). Exceptions are date RANGES
// { date_from, date_to, type: vacation|holiday|other, note } instead of the
// prototype's per-date map; clicking a covered day selects its absence,
// clicking a free day starts a new single-day one.
import React, { useMemo, useState } from 'react';
import { api, ApiError, Icon, todayStr } from '@youty/shared';
import { useDash } from '../../ctx.jsx';
import { AVAIL_META, ABSENCE_TYPES, MONTHS_IT, MONTHS_EN, inputCss } from './lib.js';

const fmtDM = (iso) => iso.split('-').slice(1).reverse().join('/'); // "2026-07-04" → "04/07"

export default function AbsenceCalendar({ operatorId, absences, onChanged, canEdit }) {
  const { t, lang, fireToast } = useDash();
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  // edit = { id?, type, date_from, date_to, note } | null
  const [edit, setEdit] = useState(null);
  const [saving, setSaving] = useState(false);

  const months = lang === 'en' ? MONTHS_EN : MONTHS_IT;
  const dows = lang === 'en' ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] : ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
  const y = cursor.getFullYear(), m = cursor.getMonth();
  const first = new Date(y, m, 1);
  const startDow = (first.getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const key = (d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const today = todayStr();

  /* date "YYYY-MM-DD" → covering absence (first match) */
  const coverage = useMemo(() => {
    const map = {};
    const monthPrefixFrom = key(1), monthPrefixTo = key(daysInMonth);
    (absences || []).forEach((a) => {
      if (a.date_to < monthPrefixFrom || a.date_from > monthPrefixTo) return;
      const from = a.date_from < monthPrefixFrom ? 1 : Number(a.date_from.slice(-2));
      const to = a.date_to > monthPrefixTo ? daysInMonth : Number(a.date_to.slice(-2));
      for (let d = from; d <= to; d++) { if (!map[d]) map[d] = a; }
    });
    return map;
  }, [absences, y, m, daysInMonth]);

  const monthAbsences = useMemo(() => (
    (absences || [])
      .filter((a) => !(a.date_to < key(1) || a.date_from > key(daysInMonth)))
      .sort((a, b) => a.date_from.localeCompare(b.date_from))
  ), [absences, y, m, daysInMonth]);

  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const openDay = (d) => {
    if (!canEdit) return;
    const covering = coverage[d];
    if (covering) setEdit({ id: covering.id, type: covering.type, date_from: covering.date_from, date_to: covering.date_to, note: covering.note || '' });
    else setEdit({ type: 'vacation', date_from: key(d), date_to: key(d), note: '' });
  };

  const save = async () => {
    if (saving || !edit) return;
    if (!edit.date_from || !edit.date_to || edit.date_to < edit.date_from) {
      fireToast({ msg: t('Intervallo di date non valido', 'Invalid date range'), icon: 'alert' });
      return;
    }
    setSaving(true);
    try {
      const body = { date_from: edit.date_from, date_to: edit.date_to, type: edit.type, note: edit.note || '' };
      if (edit.id) await api.put(`/api/staff/${operatorId}/absences/${edit.id}`, body);
      else await api.post(`/api/staff/${operatorId}/absences`, body);
      await onChanged();
      setEdit(null);
      fireToast({ msg: edit.id ? t('Assenza aggiornata', 'Time off updated') : t('Assenza aggiunta', 'Time off added'), icon: 'check' });
    } catch (err) {
      fireToast({ msg: err instanceof ApiError ? err.message : t('Errore di rete', 'Network error'), icon: 'alert' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (saving || !edit?.id) return;
    setSaving(true);
    try {
      await api.del(`/api/staff/${operatorId}/absences/${edit.id}`);
      await onChanged();
      setEdit(null);
      fireToast({ msg: t('Assenza eliminata', 'Time off deleted'), icon: 'x' });
    } catch (err) {
      fireToast({ msg: err instanceof ApiError ? err.message : t('Errore di rete', 'Network error'), icon: 'alert' });
    } finally {
      setSaving(false);
    }
  };

  const typeChips = (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
      {ABSENCE_TYPES.map((k) => {
        const meta = AVAIL_META[k];
        const on = edit && edit.type === k;
        return (
          <MutationButton key={k} onClick={() => setEdit((e) => ({ ...e, type: k }))}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 99, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: '1px solid ' + (on ? meta.c : 'var(--hair)'), background: on ? meta.bg : 'var(--surface)', color: on ? meta.c : 'var(--ink-2)' }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: meta.c }} />{meta[lang === 'en' ? 'en' : 'it']}
          </MutationButton>
        );
      })}
    </div>
  );

  const dateField = (label, value, extra, onChange) => (
    <label>
      <div className="t-sm" style={{ color: 'var(--muted)', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <MutationInput type="date" value={value} {...extra} onChange={onChange} style={{ ...inputCss, fontSize: 13.5, padding: '8px 10px' }} />
    </label>
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20, alignItems: 'start' }}>
      <div className="dk-card" style={{ padding: 20 }}>
        {/* month nav */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <button className="dk-iconbtn" onClick={() => setCursor(new Date(y, m - 1, 1))}><Icon name="chevL" size={18} /></button>
          <div style={{ fontFamily: 'var(--serif)', fontSize: 20, fontWeight: 500, flex: 1, textAlign: 'center' }}>{months[m]} {y}</div>
          <button className="dk-iconbtn" onClick={() => setCursor(new Date(y, m + 1, 1))}><Icon name="chevR" size={18} /></button>
        </div>
        {/* dow header */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 6, marginBottom: 6 }}>
          {dows.map((d) => <div key={d} className="t-meta" style={{ textAlign: 'center' }}>{d}</div>)}
        </div>
        {/* day grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 6 }}>
          {cells.map((d, i) => {
            if (d == null) return <div key={'e' + i} />;
            const k = key(d);
            const ab = coverage[d];
            const st = ab && (AVAIL_META[ab.type] || AVAIL_META.other);
            const isToday = k === today;
            const selected = edit && edit.id && ab && ab.id === edit.id;
            return (
              <MutationButton key={k} onClick={() => openDay(d)}
                style={{ aspectRatio: '1', borderRadius: 10, cursor: canEdit ? 'pointer' : 'default', border: '1px solid ' + (selected ? 'var(--ink)' : isToday ? 'var(--clay)' : 'var(--hair)'), background: st ? st.bg : 'var(--surface)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, padding: 4, position: 'relative' }}>
                <span style={{ fontWeight: isToday ? 800 : 600, fontSize: 13.5, color: st ? st.c : 'var(--ink)' }}>{d}</span>
                {st && <span style={{ fontSize: 8.5, fontWeight: 700, color: st.c, lineHeight: 1, textAlign: 'center' }}>{st[lang === 'en' ? 'en' : 'it']}</span>}
              </MutationButton>
            );
          })}
        </div>
      </div>

      {/* side: add/edit panel + legend + month exceptions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {canEdit && (edit ? (
          <PortalFormGate preview={!!edit.id} onClose={() => setEdit(null)}><div className="dk-card" style={{ padding: 16, border: '1px solid var(--clay)' }}>
            <div className="t-meta" style={{ marginBottom: 12 }}>
              {edit.id ? t('Modifica assenza', 'Edit time off') : t('Aggiungi assenza / periodo', 'Add time-off / period')}
            </div>
            {typeChips}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {dateField(t('Dal', 'From'), edit.date_from, {}, (e) => setEdit((x) => ({ ...x, date_from: e.target.value, date_to: x.date_to < e.target.value ? e.target.value : x.date_to })))}
              {dateField(t('Al', 'To'), edit.date_to, { min: edit.date_from }, (e) => setEdit((x) => ({ ...x, date_to: e.target.value })))}
              <label>
                <div className="t-sm" style={{ color: 'var(--muted)', fontWeight: 600, marginBottom: 4 }}>{t('Nota', 'Note')}</div>
                <MutationInput value={edit.note} onChange={(e) => setEdit((x) => ({ ...x, note: e.target.value }))} placeholder={t('facoltativa', 'optional')} style={{ ...inputCss, fontSize: 13.5, padding: '8px 10px' }} />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button className="dk-btn dk-btn--ghost" style={{ flex: 1, height: 40 }} onClick={() => setEdit(null)}>{t('Annulla', 'Cancel')}</button>
              <MutationButton className="dk-btn dk-btn--clay" style={{ flex: 1, height: 40, opacity: saving ? 0.6 : 1 }} onClick={save} disabled={saving}>
                <Icon name="check" size={15} color="#fff" />{edit.id ? t('Salva', 'Save') : t('Aggiungi', 'Add')}
              </MutationButton>
            </div>
            {edit.id && (
              <MutationButton onClick={remove} disabled={saving} style={{ width: '100%', marginTop: 8, padding: '9px 0', borderRadius: 9, background: 'transparent', border: '1px solid var(--danger-tint)', color: 'var(--danger)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                {t('Elimina assenza', 'Delete time off')}
              </MutationButton>
            )}
          </div></PortalFormGate>
        ) : (
          <MutationButton className="dk-btn dk-btn--clay" style={{ width: '100%', height: 46 }}
            onClick={() => setEdit({ type: 'vacation', date_from: today, date_to: today, note: '' })}>
            <Icon name="plus" size={17} color="#fff" />{t('Aggiungi assenza / ferie', 'Add time-off')}
          </MutationButton>
        ))}

        <div className="dk-card" style={{ padding: 18 }}>
          <div className="t-meta" style={{ marginBottom: 12 }}>{t('Legenda', 'Legend')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {ABSENCE_TYPES.map((k) => {
              const meta = AVAIL_META[k];
              return (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 14, height: 14, borderRadius: 4, background: meta.bg, border: '1px solid ' + meta.c, flexShrink: 0 }} />
                  <span className="t-sm" style={{ fontWeight: 600 }}>{meta[lang === 'en' ? 'en' : 'it']}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="dk-card" style={{ padding: 18 }}>
          <div className="t-meta" style={{ marginBottom: 10 }}>{t('Assenze · ', 'Time off · ') + months[m]}</div>
          {!monthAbsences.length ? (
            <div className="t-sm" style={{ color: 'var(--muted-2)' }}>{t('Nessuna assenza questo mese.', 'No time off this month.')}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {monthAbsences.map((a) => {
                const meta = AVAIL_META[a.type] || AVAIL_META.other;
                return (
                  <button key={a.id} className="dk-row" onClick={() => canEdit && setEdit({ id: a.id, type: a.type, date_from: a.date_from, date_to: a.date_to, note: a.note || '' })}
                    style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 9px', borderRadius: 9, textAlign: 'left', width: '100%', cursor: canEdit ? 'pointer' : 'default' }}>
                    <span style={{ width: 8, height: 8, borderRadius: 99, background: meta.c, flexShrink: 0 }} />
                    <span className="t-sm" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {a.date_from === a.date_to ? fmtDM(a.date_from) : fmtDM(a.date_from) + '–' + fmtDM(a.date_to)}
                    </span>
                    <span className="t-sm" style={{ flex: 1, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {meta[lang === 'en' ? 'en' : 'it']}{a.note ? ' · ' + a.note : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '12px 14px', background: 'var(--clay-tint)', borderRadius: 12 }}>
          <Icon name="calendar" size={15} color="var(--clay-ink)" />
          <span className="t-sm" style={{ color: 'var(--clay-ink)', lineHeight: 1.45 }}>
            {t("Le assenze confluiscono nell'agenda: nei giorni di ferie, festività o altra assenza non vengono proposti slot prenotabili.",
               'Time off flows into the calendar: on vacation, holiday or other absence dates no bookable slots are offered.')}
          </span>
        </div>
      </div>
    </div>
  );
}
