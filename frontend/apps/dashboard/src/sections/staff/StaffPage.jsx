import { useMutationAction } from '@youty/shared';
import { MutationNumInput } from '@youty/shared';
import { MutationInput } from '@youty/shared';
import { MutationButton } from '@youty/shared';
// StaffPage — per-operator page (port of prototype DkStaffPage).
// Tabs: Anagrafica (basics + colour + assignable services, PUT /api/staff/{id}),
// Turni e ferie (weekly pattern PUT /{id}/shifts + absences CRUD),
// Performance (GET /{id}/performance bar chart), Clienti serviti (GET /{id}/clients).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, Avatar, Icon, NumInput } from '@youty/shared';
import { HexInput } from '../../ui/index.js';
import { useDash } from '../../ctx.jsx';
import {
  GD_PALETTE, eur, inputCss, monthShort, opName, svcLabel,
  weeksFromShifts, shiftsFromWeeks,
} from './lib.js';
import ShiftPattern from './ShiftPattern.jsx';
import AbsenceCalendar from './AbsenceCalendar.jsx';

export default function StaffPage({ id, onBack }) {
  const { t, lang, services, reload, fireToast, hasScope, canMutate, showRevenue, setSelClient, setTab, opPalette } = useDash();
  const mutation = useMutationAction();
  const canTeam = hasScope('team');
  const rev = (v) => (showRevenue ? eur(v, lang) : '•••');

  /* ---- state ---- */
  const [detail, setDetail] = useState(null);       // OperatorDetailOut
  const [form, setForm] = useState(null);           // editable OperatorIn-shaped state
  const [weeks, setWeeks] = useState([]);           // shift editor model
  const [perf, setPerf] = useState(null);           // [PerformanceOut]
  const [absences, setAbsences] = useState(null);   // [AbsenceOut]
  const [clients, setClients] = useState(null);     // [ServedClientOut]
  const [clientQ, setClientQ] = useState('');
  const [staffTab, setStaffTab] = useState('anagrafica');
  const [saving, setSaving] = useState(false);
  const [savingShifts, setSavingShifts] = useState(false);

  const toastErr = useCallback((err) => {
    fireToast({ msg: err instanceof ApiError ? err.message : t('Errore di rete', 'Network error'), icon: 'alert' });
  }, [fireToast, t]);

  const applyDetail = useCallback((d) => {
    setDetail(d);
    setForm({
      first_name: d.first_name, last_name: d.last_name, color: d.color,
      role_title: d.role_title, hourly_cost: String(Number(d.hourly_cost)),
      active: d.active, service_ids: d.service_ids || [],
      location_id: d.location_id ?? null, user_id: d.user_id ?? null, order: d.order,
    });
    setWeeks(weeksFromShifts(d.shifts, d.cycle_weeks));
  }, []);

  /* ---- load: detail + performance + absences ---- */
  useEffect(() => {
    let alive = true;
    setDetail(null); setForm(null); setPerf(null); setAbsences(null);
    Promise.all([
      api.get(`/api/staff/${id}`),
      api.get(`/api/staff/${id}/performance`, { params: { months: 6 } }),
      api.get(`/api/staff/${id}/absences`),
    ]).then(([d, p, a]) => {
      if (!alive) return;
      applyDetail(d); setPerf(p); setAbsences(a);
    }).catch((err) => { if (alive) { toastErr(err); onBack(); } });
    return () => { alive = false; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- served clients (debounced server-side search) ---- */
  const qTimer = useRef(null);
  useEffect(() => {
    clearTimeout(qTimer.current);
    qTimer.current = setTimeout(() => {
      api.get(`/api/staff/${id}/clients`, { params: { q: clientQ || undefined } })
        .then(setClients)
        .catch(() => setClients([]));
    }, clientQ ? 300 : 0);
    return () => clearTimeout(qTimer.current);
  }, [id, clientQ]);

  const reloadAbsences = useCallback(
    () => api.get(`/api/staff/${id}/absences`).then(setAbsences),
    [id],
  );

  /* ---- saves ---- */
  const buildPayload = (cycleWeeks) => ({
    first_name: form.first_name.trim(),
    last_name: form.last_name.trim(),
    color: form.color,
    role_title: form.role_title.trim(),
    location_id: form.location_id,
    user_id: form.user_id,
    service_ids: form.service_ids,
    hourly_cost: (Number(form.hourly_cost) || 0).toFixed(2),
    cycle_weeks: cycleWeeks,
    active: form.active,
    order: form.order,
  });

  const saveBasics = async () => {
    if (saving || !form) return;
    if (!form.first_name.trim() || !form.last_name.trim()) {
      fireToast({ msg: t('Nome e cognome sono obbligatori', 'First and last name are required'), icon: 'alert' });
      return;
    }
    setSaving(true);
    try {
      const updated = await api.put(`/api/staff/${id}`, buildPayload(detail.cycle_weeks));
      setDetail((d) => ({ ...d, ...updated }));
      await reload.operators().catch(() => {});
      fireToast({ msg: t('Modifiche salvate', 'Changes saved'), icon: 'check' });
    } catch (err) { toastErr(err); } finally { setSaving(false); }
  };

  const saveShifts = async () => {
    if (savingShifts || !form) return;
    let rows;
    try { rows = shiftsFromWeeks(weeks, t); } catch (err) {
      fireToast({ msg: err.message, icon: 'alert' });
      return;
    }
    setSavingShifts(true);
    try {
      // cycle length lives on the operator: sync it before the full-replace
      if (weeks.length !== detail.cycle_weeks) {
        const updated = await api.put(`/api/staff/${id}`, buildPayload(weeks.length));
        setDetail((d) => ({ ...d, ...updated }));
      }
      const saved = await api.put(`/api/staff/${id}/shifts`, { shifts: rows });
      setDetail((d) => ({ ...d, cycle_weeks: weeks.length, shifts: saved }));
      setWeeks(weeksFromShifts(saved, weeks.length));
      await reload.operators().catch(() => {});
      fireToast({ msg: t('Turni salvati', 'Shifts saved'), icon: 'check' });
    } catch (err) { toastErr(err); } finally { setSavingShifts(false); }
  };

  const toggleSvc = (sid) => {
    if (!canTeam) return;
    setForm((f) => ({
      ...f,
      service_ids: f.service_ids.includes(sid) ? f.service_ids.filter((x) => x !== sid) : [...f.service_ids, sid],
    }));
  };

  const openClient = (cid) => { setSelClient(cid); setTab('clienti'); };

  /* ---- loading skeleton ---- */
  if (!detail || !form) {
    return (
      <div className="dk-page" style={{ maxWidth: 1180 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
          <div className="skel" style={{ width: 42, height: 42, borderRadius: 12 }} />
          <div className="skel" style={{ width: 56, height: 56, borderRadius: 99 }} />
          <div style={{ flex: 1 }}><div className="skel" style={{ height: 26, width: 260, marginBottom: 8 }} /><div className="skel" style={{ height: 14, width: 140 }} /></div>
        </div>
        <div className="skel" style={{ height: 42, width: 480, marginBottom: 22 }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          {[...Array(4)].map((_, i) => <div key={i} className="skel" style={{ height: 220, borderRadius: 16 }} />)}
        </div>
      </div>
    );
  }

  const initials = ((form.first_name[0] || '') + (form.last_name[0] || '')).toUpperCase() || detail.initials;
  const color = form.color;

  return (
    <div className="dk-page" style={{ maxWidth: 1180 }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
        <button className="dk-iconbtn" onClick={onBack}><Icon name="chevL" size={20} /></button>
        <Avatar initials={initials} size={56} color={color} ring />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--serif)', fontSize: 26, fontWeight: 500, lineHeight: 1.1 }}>{opName(form)}</div>
          <div className="t-sm" style={{ color: 'var(--muted)' }}>
            {form.role_title || t('Operatrice', 'Stylist')}
            {!form.active && <span style={{ marginLeft: 8, fontSize: 11.5, fontWeight: 700, color: 'var(--danger)', background: 'var(--danger-tint)', padding: '2px 8px', borderRadius: 99 }}>{t('Non attiva', 'Inactive')}</span>}
          </div>
        </div>
        {/* prototype clock in/out + commissions have no API backing yet */}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--muted)', background: 'var(--paper-2)', padding: '7px 13px', borderRadius: 99 }}>
          <Icon name="clock" size={13} color="var(--muted-2)" />{t('Timbrature e commissioni: fase 2', 'Time clock & commissions: phase 2')}
        </span>
        {canTeam && (
          <MutationButton className="dk-btn dk-btn--clay" onClick={saveBasics} disabled={saving} style={{ opacity: saving ? 0.6 : 1 }}>
            <Icon name="check" size={17} color="#fff" />{saving ? t('Salvataggio…', 'Saving…') : t('Salva', 'Save')}
          </MutationButton>
        )}
      </div>

      {/* sub-tabs */}
      <div style={{ borderBottom: '1px solid var(--hair)', display: 'flex', gap: 4, marginBottom: 22 }}>
        {[
          ['anagrafica', t('Anagrafica', 'Profile')],
          ['turni', t('Turni e ferie', 'Shifts & time off')],
          ['performance', t('Performance', 'Performance')],
          ['clienti', t('Clienti serviti', 'Clients served')],
        ].map(([k, l]) => (
          <button key={k} onClick={() => setStaffTab(k)} style={{ padding: '11px 4px', marginRight: 22, fontSize: 15.5, fontWeight: 600, cursor: 'pointer', background: 'transparent', color: staffTab === k ? 'var(--ink)' : 'var(--muted)', borderBottom: '2px solid ' + (staffTab === k ? 'var(--clay)' : 'transparent'), marginBottom: -1 }}>{l}</button>
        ))}
      </div>

      {/* ── ANAGRAFICA ── */}
      {staffTab === 'anagrafica' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, alignItems: 'start' }}>
          <div className="dk-card" style={{ padding: 20 }}>
            <div className="t-meta" style={{ marginBottom: 14 }}>{t('Dati anagrafici', 'Personal details')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label style={{ display: 'block' }}>
                  <div className="t-sm" style={{ color: 'var(--muted)', fontWeight: 600, marginBottom: 5 }}>{t('Nome', 'First name')}</div>
                  <MutationInput value={form.first_name} disabled={!canTeam} onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))} style={inputCss} />
                </label>
                <label style={{ display: 'block' }}>
                  <div className="t-sm" style={{ color: 'var(--muted)', fontWeight: 600, marginBottom: 5 }}>{t('Cognome', 'Last name')}</div>
                  <MutationInput value={form.last_name} disabled={!canTeam} onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))} style={inputCss} />
                </label>
              </div>
              <label style={{ display: 'block' }}>
                <div className="t-sm" style={{ color: 'var(--muted)', fontWeight: 600, marginBottom: 5 }}>{t('Ruolo', 'Role')}</div>
                <MutationInput value={form.role_title} disabled={!canTeam} onChange={(e) => setForm((f) => ({ ...f, role_title: e.target.value }))} style={inputCss} />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label style={{ display: 'block' }}>
                  <div className="t-sm" style={{ color: 'var(--muted)', fontWeight: 600, marginBottom: 5 }}>{t('Costo orario €', 'Hourly cost €')}</div>
                  <MutationNumInput min={0} value={form.hourly_cost} disabled={!canTeam} onChange={(hourly_cost) => setForm((f) => ({ ...f, hourly_cost }))} style={inputCss} />
                </label>
                <div>
                  <div className="t-sm" style={{ color: 'var(--muted)', fontWeight: 600, marginBottom: 5 }}>{t('Iniziali', 'Initials')}</div>
                  <div style={{ ...inputCss, background: 'var(--surface-2)', color: 'var(--muted)', fontWeight: 700, letterSpacing: '0.05em' }}>{initials}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4, padding: '10px 12px', borderRadius: 10, background: 'var(--surface-2)' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{t('Operatrice attiva', 'Active stylist')}</div>
                  <div className="t-sm" style={{ color: 'var(--muted)' }}>{t('Se disattivata non compare in agenda né nelle prenotazioni.', 'When inactive she disappears from the calendar and bookings.')}</div>
                </div>
                <MutationButton className={'swt press' + (form.active ? ' swt--on' : '')} disabled={!canTeam} onClick={() => canTeam && setForm((f) => ({ ...f, active: !f.active }))} aria-pressed={form.active} />
              </div>
            </div>
          </div>

          <div className="dk-card" style={{ padding: 20 }}>
            <div className="t-meta" style={{ marginBottom: 6 }}>{t('Colore operatrice', 'Stylist colour')}</div>
            <div className="t-sm" style={{ color: 'var(--muted)', marginBottom: 12 }}>{t('Identifica questa operatrice nell’agenda e nei report.', 'Identifies this stylist in the calendar and reports.')}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <label title={t('Ruota dei colori', 'Colour wheel')} style={{ position: 'relative', width: 34, height: 34, borderRadius: 9, cursor: canTeam ? 'pointer' : 'default', overflow: 'hidden', flexShrink: 0, border: '1px solid var(--hair)', background: color }}>
                <MutationInput type="color" value={color} disabled={!canTeam} onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
              </label>
              <HexInput disabled={!canMutate('team')} value={color} onChange={mutation((c) => canTeam && setForm((f) => ({ ...f, color: c })))} width={70} />
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
              {opPalette.map((c) => (
                <MutationButton key={c} onClick={() => canTeam && setForm((f) => ({ ...f, color: c }))} title={c} style={{ width: 24, height: 24, borderRadius: 6, background: c, cursor: canTeam ? 'pointer' : 'default', border: '1px solid var(--hair)', outline: color.toLowerCase() === c.toLowerCase() ? '2px solid var(--ink)' : 'none', outlineOffset: 1 }} />
              ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxWidth: 280 }}>
              {GD_PALETTE.map((row, ri) => (
                <div key={ri} style={{ display: 'flex', gap: 3 }}>
                  {row.map((c) => {
                    const sel = color.toLowerCase() === c.toLowerCase();
                    return (
                      <MutationButton key={c} onClick={() => canTeam && setForm((f) => ({ ...f, color: c }))} title={c} style={{ width: 22, height: 22, borderRadius: 5, background: c, cursor: canTeam ? 'pointer' : 'default', border: '1px solid ' + (c.toUpperCase() === '#FFFFFF' ? 'var(--hair)' : 'transparent'), outline: sel ? '2px solid var(--ink)' : 'none', outlineOffset: 1, flexShrink: 0 }} />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="dk-card" style={{ padding: 20, gridColumn: '1 / -1' }}>
            <div className="t-meta" style={{ marginBottom: 6 }}>{t('Servizi abilitati', 'Enabled services')}</div>
            <div className="t-sm" style={{ color: 'var(--muted)', marginBottom: 14 }}>{t('I servizi che questa operatrice può erogare. Determinano cosa è prenotabile sulla sua colonna in agenda.', 'The services this stylist can perform. They drive what is bookable on her column in the calendar.')}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {services.map((s) => {
                const on = form.service_ids.includes(s.id);
                return (
                  <MutationButton key={s.id} onClick={() => toggleSvc(s.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 99, fontSize: 12.5, fontWeight: 600, cursor: canTeam ? 'pointer' : 'default', border: '1px solid ' + (on ? 'var(--clay)' : 'var(--hair)'), background: on ? 'var(--clay)' : 'var(--surface)', color: on ? '#fff' : 'var(--ink-2)' }}>
                    {svcLabel(s, lang)}<Icon name={on ? 'check' : 'plus'} size={12} color={on ? '#fff' : 'var(--muted-2)'} />
                  </MutationButton>
                );
              })}
            </div>
            {canTeam && <div className="t-sm" style={{ color: 'var(--muted-2)', marginTop: 12 }}>{t('Le modifiche ai servizi si applicano con “Salva” in alto.', 'Service changes apply with “Save” at the top.')}</div>}
          </div>
        </div>
      )}

      {/* ── TURNI E FERIE ── */}
      {staffTab === 'turni' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '13px 16px', background: 'var(--clay-tint)', borderRadius: 12 }}>
            <Icon name="sparkle" size={16} color="var(--clay-ink)" />
            <span className="t-sm" style={{ color: 'var(--clay-ink)', lineHeight: 1.5 }}>
              {t("Turni e disponibilità alimentano la pianificazione automatica degli appuntamenti. Imposta il pattern ricorrente e programma le eccezioni con largo anticipo: l'agenda proporrà slot solo quando l'operatrice è effettivamente presente.",
                 'Shifts and availability feed automatic appointment planning. Set the recurring pattern and plan exceptions well ahead: the calendar offers slots only when the stylist is actually in.')}
            </span>
          </div>
          <ShiftPattern weeks={weeks} setWeeks={setWeeks} onSave={saveShifts} saving={savingShifts} canEdit={canTeam} t={t} />
          <div>
            <div className="t-meta" style={{ marginBottom: 12 }}>{t('Calendario disponibilità · assenze', 'Availability calendar · time off')}</div>
            {absences == null
              ? <div className="skel" style={{ height: 320, borderRadius: 16 }} />
              : <AbsenceCalendar operatorId={id} absences={absences} onChanged={reloadAbsences} canEdit={canTeam} />}
          </div>
        </div>
      )}

      {/* ── PERFORMANCE ── */}
      {staffTab === 'performance' && (
        perf == null
          ? <div className="skel" style={{ height: 320, borderRadius: 16 }} />
          : <PerformancePanel perf={perf} clients={clients} color={color} hourlyCost={form.hourly_cost} rev={rev} t={t} lang={lang} />
      )}

      {/* ── CLIENTI SERVITI ── */}
      {staffTab === 'clienti' && (
        <ServedClients clients={clients} q={clientQ} setQ={setClientQ} onOpen={openClient} rev={rev} t={t} lang={lang} />
      )}
    </div>
  );
}

/* ================= Performance (hand-rolled bar chart, port of prototype) ================= */
function PerformancePanel({ perf, clients, color, hourlyCost, rev, t, lang }) {
  const values = perf.map((p) => Number(p.revenue));
  const max = Math.max(...values, 1);
  const last = values[values.length - 1] || 0;
  const prev = values[values.length - 2] || 0;
  const delta = prev > 0 ? Math.round(((last - prev) / prev) * 100) : 0;
  const avg = Math.round(values.reduce((a, b) => a + b, 0) / (values.length || 1));
  const chartH = 150;
  const salesThisMonth = perf[perf.length - 1] ? perf[perf.length - 1].sales_count : 0;

  const metrics = [
    { label: t('Incasso mese', 'Month revenue'), value: rev(last) },
    { label: t('Vendite (mese)', 'Sales (month)'), value: salesThisMonth },
    { label: t('Clienti serviti', 'Clients served'), value: clients ? clients.length : '—' },
    { label: t('Costo orario', 'Hourly cost'), value: eur(hourlyCost, lang) },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <div className="t-meta" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="insights" size={14} color="var(--muted)" />{t('Performance del mese', 'This month’s performance')}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {metrics.map((m, i) => (
            <div key={i} className="dk-card" style={{ padding: 14, boxShadow: 'none', border: '1px solid var(--hair)' }}>
              <div className="t-meta" style={{ fontSize: 9.5, marginBottom: 5 }}>{m.label}</div>
              <div className="t-num" style={{ fontSize: 19 }}>{m.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="dk-card" style={{ padding: '18px 20px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18 }}>
          <div>
            <div className="t-meta" style={{ marginBottom: 4 }}>{t('Andamento incassi · 6 mesi', 'Revenue trend · 6 months')}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="t-num" style={{ fontSize: 24, fontWeight: 800 }}>{rev(last)}</span>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: delta >= 0 ? 'var(--ok)' : 'var(--danger)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                <Icon name={delta >= 0 ? 'arrowUp' : 'arrowDn'} size={13} color={delta >= 0 ? 'var(--ok)' : 'var(--danger)'} />{Math.abs(delta)}%
              </span>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="t-meta" style={{ marginBottom: 4 }}>{t('Media', 'Average')}</div>
            <span className="t-num" style={{ fontSize: 15, fontWeight: 700, color: 'var(--muted)' }}>{rev(avg)}</span>
          </div>
        </div>
        <div style={{ position: 'relative', height: chartH }}>
          {[0, 0.5, 1].map((g) => (
            <div key={g} style={{ position: 'absolute', left: 0, right: 0, bottom: g * (chartH - 22) + 22, height: 1, background: 'var(--hair)', opacity: g === 0 ? 1 : 0.5 }} />
          ))}
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: (avg / max) * (chartH - 22) + 22, height: 1, borderTop: '1px dashed var(--clay)', opacity: 0.6 }} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', gap: 14 }}>
            {perf.map((p, i) => {
              const v = Number(p.revenue);
              const isLast = i === perf.length - 1;
              return (
                <div key={p.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
                  <span className="t-sm" style={{ fontSize: 10.5, fontWeight: 700, color: isLast ? color : 'var(--muted-2)' }}>{rev(v)}</span>
                  <div style={{ width: '100%', maxWidth: 38, height: Math.max(2, (v / max) * (chartH - 22)) + 'px', borderRadius: '7px 7px 0 0', background: isLast ? color : 'color-mix(in srgb, ' + color + ' 30%, var(--paper-2))', transition: 'height 400ms var(--ease)' }} />
                  <span className="t-sm" style={{ fontSize: 10.5, fontWeight: isLast ? 700 : 500, color: isLast ? 'var(--ink)' : 'var(--muted-2)' }}>{monthShort(p.month, lang)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================= Clienti serviti (GET /{id}/clients?q=) ================= */
function ServedClients({ clients, q, setQ, onOpen, rev, t, lang }) {
  const fmtVisit = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  return (
    <div style={{ maxWidth: 760 }}>
      <div className="t-meta" style={{ marginBottom: 10 }}>{t('Clienti serviti', 'Clients served')}</div>
      <div className="dk-search" style={{ width: '100%', marginBottom: 12 }}>
        <Icon name="search" size={16} color="var(--muted-2)" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Cerca per nome o telefono…', 'Search by name or phone…')} />
        {q && (
          <button onClick={() => setQ('')} style={{ cursor: 'pointer', display: 'grid', placeItems: 'center', background: 'transparent' }}>
            <Icon name="x" size={14} color="var(--muted-2)" />
          </button>
        )}
      </div>

      {clients == null ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[...Array(4)].map((_, i) => <div key={i} className="skel" style={{ height: 58, borderRadius: 12 }} />)}
        </div>
      ) : !clients.length ? (
        <div className="dk-card" style={{ padding: 28, textAlign: 'center' }}>
          <div className="t-sm" style={{ color: 'var(--muted-2)' }}>
            {q ? t('Nessun cliente trovato.', 'No client found.') : t('Nessun cliente servito finora.', 'No clients served yet.')}
          </div>
        </div>
      ) : (
        <div className="dk-card" style={{ overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 84px 120px 100px', gap: 10, padding: '11px 16px', borderBottom: '1px solid var(--hair)', background: 'var(--surface-2)' }}>
            <span className="t-meta">{t('Cliente', 'Client')}</span>
            <span className="t-meta" style={{ textAlign: 'right' }}>{t('Visite', 'Visits')}</span>
            <span className="t-meta" style={{ textAlign: 'right' }}>{t('Ultima visita', 'Last visit')}</span>
            <span className="t-meta" style={{ textAlign: 'right' }}>{t('Spesa tot.', 'Total spent')}</span>
          </div>
          {clients.map((c) => {
            const initials = ((c.first_name[0] || '') + (c.last_name[0] || '')).toUpperCase();
            return (
              <button key={c.client_id} className="dk-row" onClick={() => onOpen(c.client_id)}
                style={{ display: 'grid', gridTemplateColumns: '1fr 84px 120px 100px', gap: 10, alignItems: 'center', width: '100%', padding: '11px 16px', borderTop: '1px solid var(--hair)', textAlign: 'left', background: 'transparent' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                  <Avatar initials={initials} size={34} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.first_name} {c.last_name}</span>
                    <span className="t-sm" style={{ color: 'var(--muted)' }}>{c.phone}</span>
                  </span>
                </span>
                <span className="t-num" style={{ textAlign: 'right', fontWeight: 700, fontSize: 14 }}>{c.visits}</span>
                <span className="t-sm" style={{ textAlign: 'right', color: 'var(--ink-2)' }}>{fmtVisit(c.last_visit)}</span>
                <span className="t-num" style={{ textAlign: 'right', fontWeight: 700, fontSize: 14 }}>{rev(c.total_spent)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
