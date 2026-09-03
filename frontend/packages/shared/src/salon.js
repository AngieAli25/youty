// salon.js — quale salone sta servendo questa pagina.
//
// Un solo deploy dell'app cliente serve tutti i saloni: lo slug è il PRIMO
// SEGMENTO DEL PATH.
//   https://beautyclients.esempio.it/the-parlour → "the-parlour"
//
// Precedenza:
//   1. ?salon=<slug>   override esplicito (test e anteprime)
//   2. primo segmento del path
//   3. VITE_SALON_SLUG fallback a build time (sviluppo locale)
//
// Perché il path e non un sottodominio: col sottodominio ogni salone richiede un
// dominio in più nel proxy e un certificato suo, cioè un passo manuale a ogni
// onboarding. Col path non c'è nessun passo: creato il salone, il suo URL è vivo.
//
// Il primo segmento è libero perché l'app cliente non usa l'URL per navigare —
// le viste sono stato in memoria (vedi ctx.jsx). Se un giorno servisse un router
// vero, il segmento del salone va escluso dalle sue rotte.
//
// NB: tutti i saloni condividono lo stesso origin, quindi anche lo stesso
// localStorage. Le chiavi di sessione sono namespacizzate per slug — vedi
// clientAuth.js — altrimenti una cliente che apre due saloni si porterebbe
// dietro il token sbagliato.

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function resolveSalonSlug() {
  const override = new URLSearchParams(window.location.search).get('salon');
  if (override && SLUG_RE.test(override)) return override;

  const first = window.location.pathname.split('/').filter(Boolean)[0];
  if (first && SLUG_RE.test(first)) return first;

  // Stringa vuota, non un salone di default: senza slug l'app deve mostrare un
  // errore, non aprire silenziosamente il salone sbagliato.
  return import.meta.env.VITE_SALON_SLUG || '';
}

export const SALON_SLUG = resolveSalonSlug();
