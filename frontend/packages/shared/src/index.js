// @youty/shared — raw ESM, consumed directly by Vite (no build step).

export { api, ApiError, qs, mediaUrl, API_URL, setTokenProvider, setOnUnauthorized } from './api.js';

// Auth stores are namespaced (both expose login/logout/getSession/subscribe):
//   import { staffAuth, clientAuth } from '@youty/shared';
//   staffAuth.hasScope('agenda'); clientAuth.requestOtp(slug, phone);
export * as staffAuth from './staffAuth.js';
export * as clientAuth from './clientAuth.js';

export { SALON_SLUG, resolveSalonSlug } from './salon.js';

export { LangProvider, useT, makeT } from './i18n.jsx';

export {
  fmtEur, timeLabel, fmtDur,
  todayStr, toDateStr, parseISO, minutesOfDay, addDays, fmtDateIt,
} from './format.js';

export * from './ui/index.js';
