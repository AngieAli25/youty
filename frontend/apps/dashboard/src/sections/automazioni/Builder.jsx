import { withPortalForm } from '@youty/shared';
import { MutationButton } from '@youty/shared';
// Builder.jsx — right pane: create / edit one automation rule.
// Maps 1:1 onto AutomationIn: name, event, offset_direction/offset_value/offset_unit,
// send_time (null = right away), conditions {op, rules:[{field,cmp,value}]},
// trigger_origin (yourang | webhook), active.
// Execution (channel + message) lives on Yourang — shown read-only, with a live
// client-side WhatsApp preview (token substitution) as a nicety.
import React, { useMemo, useState } from 'react';
import { api, ApiError, API_URL, Icon, Toggle } from '@youty/shared';
import { DkSeg } from '../../ui/index.js';
import { useDash } from '../../ctx.jsx';
import DkCondRow, { defaultRule, ruleForField } from './DkCondRow.jsx';
import { DkStepper, DkCopyField, DkTrigStep, MiniMetric, DkEventMenu } from './controls.jsx';
import {
  eventIcon, eventHint, OFFSET_UNITS, offsetPhrase,
  dkRender, EVENT_SAMPLE_MESSAGE, catLabel,
} from './catalog.js';

let CID = 0;
const withIds = (rules) => (rules || []).map((r) => ({ id: 'c' + (++CID), ...r }));

const normTime = (v) => (v ? String(v).slice(0, 5) : null); // "10:00:00" → "10:00"

function initDraft(rule, catalog) {
  const firstEvent = (catalog.events[0] || {}).value || 'appointment_upcoming';
  return {
    name: rule ? rule.name : '',
    event: rule ? rule.event : firstEvent,
    offset_direction: rule ? rule.offset_direction : 'after',
    offset_value: rule ? rule.offset_value : 0,
    offset_unit: rule ? rule.offset_unit : 'hours',
    send_time: rule ? normTime(rule.send_time) : null,
    join: (rule && rule.conditions && rule.conditions.op) || 'and',
    conds: withIds(rule && rule.conditions && rule.conditions.rules),
    trigger_origin: rule ? rule.trigger_origin : 'yourang',
    active: rule ? rule.active : true,
  };
}

/* Quick presets — ADAPTED from the prototype: its fields (consent, days-since-visit)
 * have no API backing; these use the real events-catalog fields. */
const QUICK = [
  { id: 'new', label: { it: 'Nuovi', en: 'New' }, rule: { field: 'visits', cmp: 'lte', value: 1 } },
  { id: 'reliable', label: { it: 'Affidabili', en: 'Reliable' }, rule: { field: 'reliability', cmp: 'gte', value: 80 } },
  { id: 'top', label: { it: 'Alto valore', en: 'High value' }, rule: { field: 'total_spent', cmp: 'gte', value: 500 } },
  { id: 'all', label: { it: 'Tutti', en: 'All' }, rule: null },
];

function Builder({ rule, catalog, canWrite, onSaved }) {
  const { t, lang, fireToast, clientCategories } = useDash();
  const [draft, setDraft] = useState(() => initDraft(rule, catalog));
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  const ev = useMemo(
    () => catalog.events.find((e) => e.value === draft.event) || catalog.events[0] || { value: draft.event, label_it: draft.event, label_en: draft.event },
    [catalog.events, draft.event],
  );

  /* ---- condition helpers ---- */
  const setConds = (fn) => setDraft((d) => ({ ...d, conds: fn(d.conds) }));
  const addCond = () => setConds((cs) => [...cs, { id: 'c' + (++CID), ...defaultRule(catalog.fields, clientCategories) }]);
  const updCond = (id, patch) => setConds((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const rmCond = (id) => setConds((cs) => cs.filter((c) => c.id !== id));
  const applyQuick = (q) => setConds(() => (q.rule ? [{ id: 'c' + (++CID), ...q.rule }] : []));
  const quickOn = (q) => (q.rule
    ? draft.conds.length === 1 && draft.conds[0].field === q.rule.field && draft.conds[0].cmp === q.rule.cmp && draft.conds[0].value === q.rule.value
    : draft.conds.length === 0);

  /* ---- save (POST new / PUT existing) ---- */
  const save = async () => {
    if (!draft.name.trim()) {
      fireToast({ msg: t('Dai un nome all’automazione', 'Give the automation a name'), icon: 'alert' });
      return;
    }
    const payload = {
      name: draft.name.trim(),
      event: draft.event,
      offset_direction: draft.offset_direction,
      offset_value: draft.offset_value,
      offset_unit: draft.offset_unit,
      send_time: draft.send_time || null,
      conditions: draft.conds.length
        ? { op: draft.join, rules: draft.conds.map(({ field, cmp, value }) => ({ field, cmp, value })) }
        : {},
      trigger_origin: draft.trigger_origin,
      active: draft.active,
    };
    setSaving(true);
    try {
      const saved = rule
        ? await api.put(`/api/automations/${rule.id}`, payload)
        : await api.post('/api/automations/', payload);
      fireToast({ msg: t('Automazione salvata', 'Automation saved'), icon: 'check' });
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError) fireToast({ msg: err.message, icon: 'alert' });
      else fireToast({ msg: t('Errore di rete', 'Network error'), icon: 'alert' });
    } finally {
      setSaving(false);
    }
  };

  /* ---- live WhatsApp preview (client-side nicety; real template lives on Yourang) ---- */
  const sampleMsg = (rule && rule.message_preview && rule.message_preview.trim())
    || t(EVENT_SAMPLE_MESSAGE[draft.event] || { it: '', en: '' });
  const msgPreview = dkRender(sampleMsg);

  const webhookFullUrl = rule && rule.webhook_url ? API_URL + rule.webhook_url : null;

  return (
    <div style={{ padding: '24px 28px 40px', maxWidth: 780 }}>
      {/* head: name + active + save */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
        <div style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--clay-tint)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <Icon name={eventIcon(draft.event)} size={24} color="var(--clay-ink)" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <input
            value={draft.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder={t('Nome automazione…', 'Automation name…')}
            disabled={!canWrite}
            style={{ width: '100%', border: 'none', outline: 'none', background: 'transparent', fontFamily: 'var(--serif)', fontSize: 24, fontWeight: 500, color: 'var(--ink)', padding: 0 }}
          />
          <div className="t-sm" style={{ color: 'var(--muted)' }}>{catLabel(ev, lang)} · {eventHint(draft.event, lang)}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: draft.active ? 'var(--ok)' : 'var(--muted)' }}>{draft.active ? t('Attiva', 'Active') : t('In pausa', 'Paused')}</span>
          <Toggle on={draft.active} onChange={(v) => canWrite && set('active', v)} />
          {canWrite && (
            <MutationButton className="dk-btn dk-btn--primary" disabled={saving} onClick={save} style={{ opacity: saving ? 0.6 : 1 }}>
              {saving ? t('Salvataggio…', 'Saving…') : t('Salva', 'Save')}
            </MutationButton>
          )}
        </div>
      </div>

      {/* reporting metrics — no API backing yet (delivery/open data will come from Yourang) */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 8 }}>
        <MiniMetric label={t('Tasso di apertura', 'Open rate')} value="—" />
        <MiniMetric label={t('Ultimo invio', 'Last sent')} value="—" />
        <MiniMetric label={t('Risultato', 'Result')} value="—" wide />
      </div>
      <div className="t-sm" style={{ color: 'var(--muted-2)', margin: '0 2px 22px' }}>{t('Dati da Yourang (fase 2)', 'Data from Yourang (phase 2)')}</div>

      {/* TRIGGER — event + timing + filters */}
      <div className="t-meta" style={{ margin: '0 2px 10px', display: 'flex', alignItems: 'center', gap: 7 }}>
        <Icon name="bolt" size={14} color="var(--clay-ink)" />{t('Trigger · come si configura la regola', 'Trigger · how the rule is set up')}
      </div>

      {/* a) EVENT */}
      <DkTrigStep n="a" title={t('Evento', 'Event')} hint={t('Cosa fa partire l’automazione', 'What sets the automation off')}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, flex: 1, minWidth: 0 }}>
            <div style={{ width: 40, height: 40, borderRadius: 11, background: 'var(--clay-tint)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Icon name={eventIcon(draft.event)} size={20} color="var(--clay-ink)" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{catLabel(ev, lang)}</div>
              <div className="t-sm" style={{ color: 'var(--muted)' }}>{eventHint(draft.event, lang)}</div>
            </div>
          </div>
          {canWrite && <DkEventMenu value={draft.event} onChange={(v) => set('event', v)} events={catalog.events} icons={eventIcon} t={t} lang={lang} />}
        </div>
      </DkTrigStep>

      {/* b) TIMING */}
      <DkTrigStep n="b" title={t('Tempo · quando', 'Timing · when')} hint={t('Ritardo rispetto all’evento', 'Offset relative to the event')}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <DkSeg value={draft.offset_direction} onChange={(v) => set('offset_direction', v)} options={[{ value: 'before', label: t('Prima', 'Before') }, { value: 'after', label: t('Dopo', 'After') }]} />
          <DkStepper value={draft.offset_value} onChange={(v) => set('offset_value', v)} />
          <DkSeg value={draft.offset_unit} onChange={(v) => set('offset_unit', v)} options={OFFSET_UNITS.map((u) => ({ value: u.id, label: u.label[lang] }))} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 13, padding: '10px 13px', background: 'var(--clay-tint)', borderRadius: 11 }}>
          <Icon name="clock" size={15} color="var(--clay-ink)" />
          <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--clay-ink)' }}>
            {offsetPhrase(draft.offset_direction, draft.offset_value, draft.offset_unit, lang)} · {catLabel(ev, lang).toLowerCase()}
          </span>
        </div>
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--hair)' }}>
          <div className="t-meta" style={{ marginBottom: 9, display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="bell" size={13} color="var(--muted)" />{t('A che ora', 'Time of day')}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <DkSeg
              value={draft.send_time ? 'fixed' : 'now'}
              onChange={(v) => set('send_time', v === 'now' ? null : (draft.send_time || '10:00'))}
              options={[{ value: 'now', label: t('Subito', 'Right away') }, { value: 'fixed', label: t('Orario fisso', 'Fixed time') }]}
            />
            {draft.send_time && (
              <input
                type="time"
                value={draft.send_time}
                onChange={(e) => set('send_time', e.target.value || '10:00')}
                style={{ height: 38, border: '1px solid var(--hair)', borderRadius: 10, padding: '0 10px', background: 'var(--surface)', fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums', outline: 'none', color: 'var(--ink)' }}
              />
            )}
          </div>
        </div>
      </DkTrigStep>

      {/* c) FILTERS */}
      <DkTrigStep n="c" title={t('Filtri · condizioni SE', 'Filters · IF conditions')} hint={t('Devono essere vere perché scatti per quel cliente', 'Must be true for it to fire for that client')} last>
        <div className="t-meta" style={{ marginBottom: 8 }}>{t('Filtri rapidi', 'Quick filters')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
          {QUICK.map((q) => {
            const on = quickOn(q);
            return (
              <button key={q.id} onClick={() => canWrite && applyQuick(q)} style={{ padding: '8px 15px', borderRadius: 99, fontSize: 13.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', border: '1px solid ' + (on ? 'var(--ink)' : 'var(--hair)'), background: on ? 'var(--ink)' : 'var(--surface)', color: on ? '#fff' : 'var(--ink-2)' }}>
                {q.label[lang]}
              </button>
            );
          })}
        </div>

        {draft.conds.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '13px 15px', borderRadius: 11, border: '1px dashed var(--line-strong)', color: 'var(--muted)', fontSize: 13.5, fontWeight: 500, marginBottom: 12 }}>
            <Icon name="clients" size={16} color="var(--muted)" />{t('Nessun filtro — scatta per tutti i clienti coinvolti dall’evento.', 'No filter — fires for every client touched by the event.')}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginBottom: 12 }}>
            {draft.conds.map((c, i) => (
              <React.Fragment key={c.id}>
                {i > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0' }}>
                    <div className="dk-seg" style={{ padding: 3 }}>
                      {[['and', t('E', 'AND')], ['or', t('O', 'OR')]].map(([k, l]) => (
                        <button key={k} className={draft.join === k ? 'on' : ''} style={{ height: 28, padding: '0 13px', fontSize: 12 }} onClick={() => set('join', k)}>{l}</button>
                      ))}
                    </div>
                    <div style={{ flex: 1, height: 1, background: 'var(--hair)' }} />
                  </div>
                )}
                <DkCondRow
                  c={c}
                  onChange={(p) => updCond(c.id, p)}
                  onRemove={() => rmCond(c.id)}
                  t={t} lang={lang}
                  fields={catalog.fields}
                  operators={catalog.operators}
                  clientCategories={clientCategories}
                />
              </React.Fragment>
            ))}
          </div>
        )}

        {canWrite && (
          <button className="dk-btn dk-btn--soft" style={{ height: 38, fontSize: 13.5 }} onClick={addCond}>
            <Icon name="plus" size={16} />{t('Aggiungi condizione', 'Add condition')}
          </button>
        )}
      </DkTrigStep>

      {/* OPERATIONS · YOURANG — trigger origin + read-only channel/message */}
      <div className="t-meta" style={{ margin: '26px 2px 10px' }}>{t('Operatività', 'Operations')}</div>
      <div className="dk-card" style={{ padding: 20, background: 'var(--surface-2)', border: '1px solid var(--hair)', boxShadow: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 18 }}>
          <div style={{ width: 38, height: 38, borderRadius: 11, background: 'var(--ink)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name="bolt" size={19} color="var(--clay-tint)" /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 15.5 }}>{t('Operatività · Yourang', 'Operations · Yourang')}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', background: 'var(--paper-2)', padding: '2px 8px', borderRadius: 99 }}><Icon name="lock" size={11} color="var(--muted)" />{t('Sola lettura', 'Read-only')}</span>
            </div>
            <div className="t-sm" style={{ color: 'var(--muted)', marginTop: 3 }}>{t('L’esecuzione (canale, invio, dinamiche) è gestita da Yourang. Qui sono sincronizzati.', 'Execution (channel, send, dynamics) is handled by Yourang. Synced here.')}</div>
          </div>
          <button className="dk-btn dk-btn--primary" style={{ height: 40, flexShrink: 0 }} onClick={() => fireToast({ msg: t('Apertura di Yourang per canale e messaggio…', 'Opening Yourang for channel and message…'), icon: 'ext' })}>
            <Icon name="ext" size={16} color="#fff" />{t('Apri su Yourang', 'Open in Yourang')}
          </button>
        </div>

        {/* TRIGGER ORIGIN */}
        <div className="dk-card" style={{ padding: 16, boxShadow: 'none', border: '1px solid var(--hair)', background: 'var(--surface)', marginBottom: 14 }}>
          <div className="t-meta" style={{ marginBottom: 11, display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="bolt" size={13} color="var(--clay-ink)" />{t('Origine trigger', 'Trigger source')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              { id: 'yourang', title: 'Yourang', desc: t('Da un’azione interna a Yourang', 'From an action inside Yourang') },
              { id: 'webhook', title: 'Webhook', desc: t('Da un sistema esterno', 'From an external system') },
            ].map((o) => {
              const on = draft.trigger_origin === o.id;
              return (
                <button key={o.id} onClick={() => canWrite && set('trigger_origin', o.id)} style={{ textAlign: 'left', padding: '13px 14px', borderRadius: 12, cursor: 'pointer', border: '1.5px solid ' + (on ? 'var(--clay)' : 'var(--hair)'), background: on ? 'var(--clay-tint)' : 'var(--surface)', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ width: 20, height: 20, borderRadius: 99, flexShrink: 0, marginTop: 1, border: '1.5px solid ' + (on ? 'var(--clay)' : 'var(--line-strong)'), background: on ? 'var(--clay)' : 'transparent', display: 'grid', placeItems: 'center' }}>{on && <Icon name="check" size={13} color="#fff" stroke={2.6} />}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14.5, color: on ? 'var(--clay-ink)' : 'var(--ink)' }}>{o.title}</div>
                    <div className="t-sm" style={{ color: 'var(--muted)', marginTop: 1 }}>{o.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>
          {draft.trigger_origin === 'webhook' && (
            <div style={{ marginTop: 14 }}>
              <div className="t-meta" style={{ marginBottom: 7 }}>{t('Endpoint del webhook', 'Webhook endpoint')}</div>
              {webhookFullUrl ? (
                <React.Fragment>
                  <DkCopyField value={webhookFullUrl} onCopy={() => fireToast({ msg: t('URL copiato', 'URL copied'), icon: 'check' })} t={t} />
                  <div className="t-sm" style={{ color: 'var(--muted-2)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 5 }}><Icon name="lock" size={12} color="var(--muted-2)" />{t('Chiama questo URL dal tuo sistema per innescare l’automazione.', 'Call this URL from your system to fire the automation.')}</div>
                </React.Fragment>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 13px', borderRadius: 10, border: '1px dashed var(--line-strong)', color: 'var(--muted)', fontSize: 13, fontWeight: 500 }}>
                  <Icon name="info" size={15} color="var(--muted)" />{t('L’URL del webhook viene generato al salvataggio.', 'The webhook URL is generated when you save.')}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 14 }}>
          {/* active channel — fixed WhatsApp, executed by Yourang */}
          <div className="dk-card" style={{ padding: 14, boxShadow: 'none', border: '1px solid var(--hair)', background: 'var(--surface)' }}>
            <div className="t-meta" style={{ marginBottom: 10 }}>{t('Canale attivo', 'Active channel')}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <div style={{ width: 32, height: 32, borderRadius: 9, background: 'color-mix(in srgb, #3F9D58 14%, transparent)', display: 'grid', placeItems: 'center' }}><Icon name="whatsapp" size={17} color="#3F9D58" /></div>
              <span style={{ fontWeight: 700, fontSize: 14.5 }}>WhatsApp</span>
            </div>
            <div className="t-sm" style={{ color: 'var(--muted-2)', marginTop: 10, display: 'flex', alignItems: 'center', gap: 5 }}><Icon name="refresh" size={12} color="var(--muted-2)" />{t('Sincronizzato', 'Synced')}</div>
          </div>
          {/* live message preview (token substitution) */}
          <div className="dk-card" style={{ padding: 14, boxShadow: 'none', border: '1px solid var(--hair)', background: 'var(--surface)' }}>
            <div className="t-meta" style={{ marginBottom: 10 }}>{t('Anteprima messaggio', 'Message preview')}</div>
            <div style={{ display: 'flex', gap: 9 }}>
              <div style={{ width: 26, height: 26, borderRadius: 99, background: 'var(--brand, #7C4A57)', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 800, fontSize: 12, flexShrink: 0 }}>P</div>
              <div style={{ flex: 1, minWidth: 0, background: 'var(--paper-2)', borderRadius: '4px 12px 12px 12px', padding: '8px 11px', fontSize: 13, lineHeight: 1.45, color: 'var(--ink-2)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {msgPreview || t('Il testo del messaggio verrà sincronizzato da Yourang.', 'The message text will be synced from Yourang.')}
              </div>
            </div>
            <div className="t-sm" style={{ color: 'var(--muted-2)', marginTop: 10 }}>{t('Testo e variabili si modificano su Yourang', 'Text and variables are edited on Yourang')}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default withPortalForm(Builder, { preview: ({ rule }) => !!rule?.id, framed: false, overlay: false });
