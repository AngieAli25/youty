import { MutationToggle } from '@youty/shared';
import { MutationNumInput } from '@youty/shared';
import { MutationButton } from '@youty/shared';
// BookingsOptimPage.jsx — port of DkBookingsOptim mapped onto the REAL settings
// fields: agenda_fill, slot_recovery, lastminute_discount_cap,
// lastminute_monthly_budget, flexible_enabled, flexible_window_min,
// flexible_reward_pct → PUT /api/core/settings (owner-only).
// Dropped (no API field): deposit-mode selector (covered by DepositRules below)
// and the free-text "Le tue regole" builder (phase 2).
import React, { useState } from 'react';
import { api, Icon, Toggle, NumInput } from '@youty/shared';
import DkSeg from '../../ui/DkSeg.jsx';
import { useDash } from '../../ctx.jsx';
import DepositRules from './DepositRules.jsx';
import { toastErr, LockNote } from './lib.jsx';

/* module-scope helpers — stable identity so inputs keep focus across re-renders */
const AoPills = ({ value, onChange, options, disabled }) => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
    {options.map(([v, l]) => {
      const on = value === v;
      return <MutationButton key={v} disabled={disabled} onClick={() => onChange(v)} style={{ padding: '8px 15px', borderRadius: 99, fontSize: 13, fontWeight: 600, cursor: disabled ? 'default' : 'pointer', whiteSpace: 'nowrap', border: '1px solid ' + (on ? 'var(--ink)' : 'var(--hair)'), background: on ? 'var(--ink)' : 'var(--surface)', color: on ? '#fff' : 'var(--ink-2)', transition: 'all 140ms', opacity: disabled && !on ? 0.55 : 1 }}>{l}</MutationButton>;
    })}
  </div>
);

const AoStepper = ({ value, onChange, min = 0, max = 999, step = 5, suffix, disabled }) => (
  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid var(--hair)', borderRadius: 10, padding: '0 5px 0 10px', height: 40, background: 'var(--surface)', opacity: disabled ? 0.55 : 1 }}>
    <MutationNumInput integer min={min} max={max} value={value} disabled={disabled} onChange={onChange} style={{ width: 46, border: 'none', outline: 'none', background: 'transparent', fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }} />
    {suffix && <span className="t-sm" style={{ color: 'var(--muted-2)', fontWeight: 700, marginRight: 2 }}>{suffix}</span>}
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <MutationButton disabled={disabled} onClick={() => onChange(Math.min(max, value + step))} style={{ border: 'none', background: 'transparent', cursor: disabled ? 'default' : 'pointer', padding: '1px 4px', lineHeight: 1, color: 'var(--muted)' }}><Icon name="chevD" size={12} color="var(--muted)" style={{ transform: 'rotate(180deg)' }} /></MutationButton>
      <MutationButton disabled={disabled} onClick={() => onChange(Math.max(min, value - step))} style={{ border: 'none', background: 'transparent', cursor: disabled ? 'default' : 'pointer', padding: '1px 4px', lineHeight: 1, color: 'var(--muted)' }}><Icon name="chevD" size={12} color="var(--muted)" /></MutationButton>
    </div>
  </div>
);

const AoCtrl = ({ icon, title, micro, how, children, t }) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div style={{ padding: '20px 0', borderTop: '1px solid var(--hair)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 13 }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--surface-2)', display: 'grid', placeItems: 'center', flexShrink: 0, marginTop: 1 }}><Icon name={icon} size={18} color="var(--muted)" /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{title}</div>
          <div className="t-sm" style={{ color: 'var(--muted)', marginTop: 3, lineHeight: 1.45 }}>{micro}</div>
        </div>
      </div>
      <div style={{ marginTop: 14, marginLeft: 47 }}>{children}</div>
      <button onClick={() => setIsOpen((o) => !o)} style={{ marginLeft: 47, marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--clay-ink)', fontSize: 12.5, fontWeight: 600, padding: 0 }}>
        {t('Come funziona', 'How it works')}<Icon name="chevD" size={13} color="var(--clay-ink)" style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 160ms' }} />
      </button>
      {isOpen && <div className="t-sm" style={{ marginLeft: 47, marginTop: 10, padding: '13px 15px', background: 'var(--surface-2)', borderRadius: 11, color: 'var(--ink-2)', lineHeight: 1.6 }}>{how}</div>}
    </div>
  );
};

export default function BookingsOptimPage({ onBack }) {
  const { t, session, operationalAccess, settings, reload, fireToast } = useDash();
  const isOwner = !!session?.is_owner;
  const s = settings || {};

  const [slotInterval, setSlotInterval] = useState(s.slot_interval_min || 15);
  const [fill, setFill] = useState(s.agenda_fill || 'free');
  const [recovery, setRecovery] = useState(s.slot_recovery || 'notify');
  const [cap, setCap] = useState(s.lastminute_discount_cap || 0);
  const [budget, setBudget] = useState(Math.round(Number(s.lastminute_monthly_budget) || 0));
  const [flexOn, setFlexOn] = useState(!!s.flexible_enabled);
  const [flexWindow, setFlexWindow] = useState(s.flexible_window_min || 30);
  const [flexReward, setFlexReward] = useState(s.flexible_reward_pct || 10);
  const [saving, setSaving] = useState(false);
  const ro = !isOwner; // read-only for non-owners

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await api.put('/api/core/settings', {
        slot_interval_min: slotInterval,
        agenda_fill: fill,
        slot_recovery: recovery,
        lastminute_discount_cap: cap,
        lastminute_monthly_budget: Number(budget).toFixed(2),
        flexible_enabled: flexOn,
        flexible_window_min: flexWindow,
        flexible_reward_pct: flexReward,
      });
      await reload.salon();
      fireToast({ msg: t('Impostazioni salvate', 'Settings saved'), icon: 'check' });
      onBack();
    } catch (err) { toastErr(err, fireToast, t); }
    finally { setSaving(false); }
  };

  // dynamic summary: what the system will do with the chosen behaviours
  const summary = () => {
    const parts = [];
    parts.push(fill === 'free'
      ? t('mostra alla cliente tutti gli orari liberi', 'shows the client every open time')
      : t('online propone solo gli orari che riducono i buchi', 'online it offers only the times that reduce gaps'));
    parts.push(recovery === 'notify'
      ? t('quando si libera un posto ti avvisa e decidi tu', 'when a slot frees up it alerts you and you decide')
      : t('quando si libera un posto ricontatta da solo i clienti e lo riassegna', 'when a slot frees up it re-contacts clients on its own and reassigns it'));
    if (flexOn) parts.push(t(`compatta la giornata spostando solo chi ha aderito (±${flexWindow} min, coupon ${flexReward}%)`, `compacts the day moving only those who opted in (±${flexWindow} min, ${flexReward}% coupon)`));
    if (cap > 0) parts.push(t(`sui buchi dell’ultim’ora arriva fino al ${cap}% di sconto`, `on last-minute gaps it goes up to ${cap}% off`));
    return parts;
  };

  return (
    <div className="dk-page" style={{ maxWidth: 820 }}>
      {/* header with back */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <button className="dk-iconbtn" onClick={onBack} style={{ width: 38, height: 38, borderRadius: 10, display: 'grid', placeItems: 'center', border: '1px solid var(--hair)', background: 'var(--surface)' }}><Icon name="chevL" size={18} /></button>
        <div>
          <div style={{ fontFamily: 'var(--serif)', fontSize: 26, fontWeight: 500 }}>{t('Prenotazioni & ottimizzazione', 'Bookings & optimization')}</div>
          <div className="t-sm" style={{ color: 'var(--muted)', marginTop: 2 }}>{t('Come il sistema riempie l’agenda, recupera i buchi e protegge dai no-show.', 'How the system fills the agenda, recovers gaps and protects against no-shows.')}</div>
        </div>
      </div>

      {ro && <div style={{ marginTop: 12 }}><LockNote t={t} msg={t('Solo il titolare può modificare queste impostazioni. Visualizzazione in sola lettura.', 'Only the owner can change these settings. Read-only view.')} /></div>}

      <div className="dk-card" style={{ padding: '4px 22px 22px', marginTop: 14 }}>
        <AoCtrl t={t} icon="clock" title={t('Intervallo fasce orarie', 'Time-slot interval')} micro={t('La granularità con cui agenda e prenotazione online mostrano gli orari disponibili.', 'The granularity at which the agenda and online booking show available times.')}
          how={<React.Fragment>
            {t("È il passo della griglia oraria. Con 15 minuti gli orari proposti sono 09:00, 09:15, 09:30…; con 30 minuti diventano 09:00, 09:30, 10:00…", 'It is the step of the time grid. With 15 minutes the offered times are 09:00, 09:15, 09:30…; with 30 minutes they become 09:00, 09:30, 10:00…')}<br /><br />
            {t('Lo stesso valore determina la granularità della griglia dell’agenda interna (giorno e settimana) e la base delle disponibilità mostrate nella prenotazione online lato cliente.', 'The same value drives the granularity of the internal agenda grid (day and week) and the base of the availability shown in client-side online booking.')}
          </React.Fragment>}>
          <DkSeg value={slotInterval} onChange={(v) => !ro && setSlotInterval(v)} options={[{ value: 15, label: t('15 minuti', '15 minutes') }, { value: 20, label: t('20 minuti', '20 minutes') }, { value: 30, label: t('30 minuti', '30 minutes') }]} />
        </AoCtrl>

        <AoCtrl t={t} icon="grid" title={t('Riempimento del calendario', 'Calendar fill')} micro={t('Quanto il sistema ottimizza gli orari proposti in prenotazione online.', 'How much the system optimizes the times offered in online booking.')}
          how={<React.Fragment>
            <b>{t('Libero', 'Free')}</b> — {t("la cliente vede tutti gli orari disponibili nell'ordine in cui vengono trovati. Il sistema non interviene sulla lista: mostra tutto e la scelta è completamente sua.", 'the client sees every available time in the order they appear. The system does not intervene on the list: it shows everything and the choice is entirely hers.')}<br /><br />
            <b>{t('Massimo incasso', 'Max revenue')}</b> — {t("online vengono proposti solo gli orari che riducono i buchi tra un appuntamento e l'altro e proteggono le fasce lunghe per i trattamenti che le richiedono. Gli orari che frammenterebbero la giornata non vengono mostrati.", 'only times that reduce gaps between appointments and protect long bands for treatments that need them are offered online. Times that would needlessly fragment the day are not shown.')}<br /><br />
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>{t('Questo controlla solo la vista online: dalla dashboard puoi sempre prenotare in qualsiasi orario libero.', 'This only controls the online view: from the dashboard you can always book any free time.')}</span>
          </React.Fragment>}>
          <DkSeg value={fill} onChange={(v) => !ro && setFill(v)} options={[{ value: 'free', label: t('Libero', 'Free') }, { value: 'max_revenue', label: t('Massimo incasso', 'Max revenue') }]} />
        </AoCtrl>

        <AoCtrl t={t} icon="refresh" title={t('Se si libera un posto', 'When a slot opens up')} micro={t('Cosa fa il sistema quando un appuntamento viene cancellato o spostato.', 'What the system does when an appointment is cancelled or moved.')}
          how={<React.Fragment>
            {t('Quando si libera uno slot, il sistema percorre sempre la stessa cascata:', 'When a slot opens up, the system always runs the same cascade:')}<br />
            <ol style={{ margin: '8px 0 10px 16px', padding: 0, lineHeight: 1.7 }}>
              <li>{t("Clienti in lista d'attesa per quel servizio", 'Clients on the waiting list for that service')}</li>
              <li>{t('Clienti in scadenza di ciclo con un servizio della durata giusta', 'Clients due for their cycle with a service of the right duration')}</li>
              <li>{t('Offerta last-minute (con sconto se attivato sotto)', 'Last-minute offer (with discount if enabled below)')}</li>
            </ol>
            <b>{t('Avvisa', 'Notify')}</b> — {t('il sistema ti mostra i candidati ordinati per compatibilità. Sei tu a scegliere chi contattare e quando: nulla parte senza la tua conferma.', 'the system shows you the candidates sorted by compatibility. You choose who to contact and when: nothing goes without your confirmation.')}<br /><br />
            <b>{t('Esegui', 'Execute')}</b> — {t("il sistema contatta i candidati in autonomia nell'ordine suggerito, invia il messaggio via Yourang e assegna lo slot al primo che risponde sì. Ricevi solo una notifica di riepilogo.", 'the system contacts the candidates autonomously in the suggested order, sends the message via Yourang and assigns the slot to the first who says yes. You only receive a summary notification.')}<br /><br />
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>{t('La cascata è identica in entrambi i casi; cambia solo chi preme "invia".', 'The cascade is identical in both cases; what changes is who presses "send".')}</span>
          </React.Fragment>}>
          <DkSeg value={recovery} onChange={(v) => !ro && setRecovery(v)} options={[{ value: 'notify', label: t('Avvisa', 'Notify') }, { value: 'execute', label: t('Esegui', 'Execute') }]} />
        </AoCtrl>

        <AoCtrl t={t} icon="user" title={t('Clienti flessibili', 'Flexible clients')} micro={t('Chiedi in prenotazione chi accetta di spostarsi per compattare la giornata.', 'Ask at booking who is willing to move to compact the day.')}
          how={<React.Fragment>
            {t('In fase di prenotazione online, la cliente vede un\'opzione: "Accetto uno spostamento di ±X minuti se aiuta il salone a ottimizzare la giornata". Chi la attiva aderisce alla flessibilità.', 'At online booking, the client sees an option: "I accept a shift of ±X minutes if it helps the salon optimise the day". Those who enable it opt into flexibility.')}<br /><br />
            {t('La sera prima, il sistema calcola se spostando solo chi ha aderito riesce a compattare la giornata. Se la cliente viene effettivamente spostata, riceve in automatico un coupon con la percentuale di sconto che imposti, valido sul prossimo appuntamento.', 'The evening before, the system calculates whether moving only those who opted in can compact the day. If the client is actually moved, she automatically receives a coupon with the discount percentage you set, valid on the next appointment.')}
          </React.Fragment>}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <span style={{ opacity: ro ? 0.55 : 1, pointerEvents: ro ? 'none' : 'auto' }}><MutationToggle on={flexOn} onChange={setFlexOn} /></span>
            <span className="t-sm" style={{ fontWeight: 600, color: flexOn ? 'var(--ok)' : 'var(--muted)' }}>{flexOn ? t('Attivo', 'On') : t('Disattivato', 'Off')}</span>
          </div>
          {flexOn && (
            <div style={{ marginTop: 13, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ padding: '12px 15px', background: 'var(--surface-2)', borderRadius: 11, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 150 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{t('Finestra di spostamento', 'Move window')}</div>
                  <div className="t-sm" style={{ color: 'var(--muted-2)', marginTop: 1 }}>{t('Di quanto al massimo può slittare l’orario', 'How far the time can shift at most')}</div>
                </div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><span className="t-sm" style={{ color: 'var(--muted-2)', fontWeight: 700 }}>±</span><AoStepper value={flexWindow} onChange={setFlexWindow} min={5} max={120} step={5} suffix={t('min', 'min')} disabled={ro} /></div>
              </div>
              <div style={{ padding: '12px 15px', background: 'var(--surface-2)', borderRadius: 11, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 150 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{t('Coupon di cortesia se spostata', 'Courtesy coupon if moved')}</div>
                  <div className="t-sm" style={{ color: 'var(--muted-2)', marginTop: 1 }}>{t('Sconto sul prossimo appuntamento', 'Discount on the next appointment')}</div>
                </div>
                <AoStepper value={flexReward} onChange={setFlexReward} min={0} max={50} step={5} suffix="%" disabled={ro} />
              </div>
            </div>
          )}
        </AoCtrl>

        <AoCtrl t={t} icon="coupon" title={t('Sconti last-minute', 'Last-minute discounts')} micro={t('Il tetto massimo dello sconto sui buchi dell’ultim’ora.', 'The maximum discount cap on last-minute gaps.')}
          how={<React.Fragment>
            {t('Il valore che scegli è il tetto di una curva di escalation — lo sconto non parte al massimo subito:', 'The value you choose is the cap of an escalation curve — the discount does not start at the maximum straight away:')}<br />
            <ul style={{ margin: '8px 0 10px 16px', padding: 0, lineHeight: 1.7 }}>
              <li>{t('24h prima del buco → sconto minimo (pochi punti %)', '24h before the gap → minimum discount (a few %)')}</li>
              <li>{t('4h prima → sconto intermedio', '4h before → intermediate discount')}</li>
              <li>{t('1h prima → sconto al massimo scelto', '1h before → maximum discount chosen')}</li>
            </ul>
            {t('Il budget mensile fissa un tetto: una volta esaurito, gli sconti si spengono da soli fino al mese successivo. Con "Mai" questo passo della cascata è spento.', 'The monthly budget sets a cap: once exhausted, discounts switch off automatically until the next month. With "Never" this cascade step is off.')}
          </React.Fragment>}>
          <AoPills value={cap} onChange={setCap} disabled={ro} options={[[0, t('Mai', 'Never')], [10, '10%'], [20, '20%'], [30, '30%']]} />
          {cap > 0 && (
            <div style={{ marginTop: 13, padding: '13px 15px', background: 'var(--surface-2)', borderRadius: 11, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 150 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{t('Budget mensile', 'Monthly budget')}</div>
                <div className="t-sm" style={{ color: 'var(--muted-2)', marginTop: 1 }}>{t('Stop automatico a esaurimento', 'Auto-stop when exhausted')}</div>
              </div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--hair)', borderRadius: 10, padding: '0 12px', height: 40, background: 'var(--surface)', opacity: ro ? 0.55 : 1 }}>
                <span className="t-sm" style={{ color: 'var(--muted-2)', fontWeight: 700 }}>€</span>
                <MutationNumInput integer min={0} value={budget} disabled={ro} onChange={setBudget} style={{ width: 56, border: 'none', outline: 'none', background: 'transparent', fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }} />
              </div>
            </div>
          )}
        </AoCtrl>
      </div>

      {/* dynamic summary */}
      <div style={{ display: 'flex', gap: 12, padding: '16px 18px', background: 'var(--clay-tint)', borderRadius: 13, marginTop: 16, border: '1px solid color-mix(in srgb, var(--clay) 22%, transparent)' }}>
        <Icon name="sparkle" size={18} color="var(--clay-ink)" style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--clay-ink)', marginBottom: 5 }}>{t('In base a come l’hai impostato', 'Based on how you set it')}</div>
          <div className="t-sm" style={{ color: 'var(--ink-2)', lineHeight: 1.6 }}>{t('Con queste scelte, il sistema ', 'With these choices, the system ')}{summary().join('; ')}.</div>
        </div>
      </div>

      {/* deposit rules — detail engine */}
      <div style={{ marginTop: 28 }}>
        <div className="t-meta" style={{ marginBottom: 10 }}>{t('Regole deposito · condizioni di dettaglio', 'Deposit rules · detailed conditions')}</div>
        <div className="dk-card" style={{ padding: 0 }}>
          <DepositRules />
        </div>
      </div>

      {isOwner && (
        <MutationButton className="dk-btn dk-btn--clay" disabled={saving} style={{ width: '100%', marginTop: 24, marginBottom: 12, opacity: saving ? 0.6 : 1 }} onClick={save}>
          <Icon name="check" size={17} color="#fff" />{saving ? t('Salvataggio…', 'Saving…') : t('Salva', 'Save')}
        </MutationButton>
      )}
    </div>
  );
}
