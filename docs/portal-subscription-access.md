# Beauty marketplace access

Beauty derives operational access from the existing Yourang marketplace entitlement
`portal_beauty`. A local login, an SSO login, and a refresh always remain available;
no local subscription state or checkout result can grant access.

The backend calls `GET /v/beauty/api/portal-access/beauty` on the configured proxy
with the server's portal key and the organization stored in `YourangConnection`.
The proxy's verified OAuth grant determines the tenant/reseller. Browser query
parameters and headers never select the organization. Decisions are cached for at
most 60 seconds from `checked_at`, capped by `valid_until` and any actual entitlement
expiry. Configuration changes, connection changes and key rotations partition the
cache. A missing local connection cannot prove a missing subscription and is reported as
verification unavailable. Verified missing subscription is different from failed verification; neither allows
business actions. Login and browsing do not depend on remote availability.

`GET /api/auth/portal-access` is staff-authenticated; login/refresh/me also include
`portal_access`. The public access endpoint exposes only the operational boolean
and freshness times, with a neutral notice and errors for clients. The dashboard
receives the purchased variant without enforcing tier/location quotas. Its purchase
link comes from the Yourang response; optional `YOURANG_MARKETPLACE_URL` provides a
configured, branded recovery link during outages or before the salon is connected.
A previously verified purchase URL is retained for one day for the same salon/org
and proxy origin; this never retains or extends operational access.
The existing purchase route is `/plans/configure` on that brand's dashboard origin.

Business API endpoints explicitly use `@business_operation`; role and salon checks
remain in the original endpoints. The anonymous contact hook checks the salon
before creating a lead. Automation token webhooks and signed Yourang webhooks check
after their existing authentication and acknowledge skipped deliveries without
replaying them. Direct appointment, stock, sales, marketing, payment and sync service
entry points check access too. Login/connect's initial sync and scheduled sync skip
and log blocked work. OTP delivery, password/session recovery, OAuth reconnection
and disconnect, plus settlement of previously initiated Stripe payments remain
available. Read-only branding/salon queries no longer create default settings rows.

New blocked business outbox events are terminal `failed` rows with
`portal_access_blocked: skipped; do not replay`; flushing existing pending business
events marks blocked rows failed. OTP entries remain pending. The existing outbox
transport is still a stub; this change does not introduce a sender or a replay path.
Skipped background activity also appends `integration.sync_paused` to the existing
activity log. That durable audit suppresses **all automatic full reconciliation**
after reactivation, including cron, SSO login, and OAuth reconnect. This deliberately
means unrelated new local data will not be bulk-pushed either until a manual recovery
is requested; automatic reconciliation cannot distinguish it safely from skipped
historical work with the existing models. No subscription state is stored locally.

New signed contact notifications now import only their named resource; they never
list or push unrelated contacts. New signed event notifications remain targeted too.
Skipped webhook delivery keys are recorded as terminal `integration.webhook_skipped`
audit entries, so redelivery after reactivation remains a no-op. Where a sender lacks
a delivery ID, the canonical payload hash is used; identical future payloads without
unique IDs are conservatively suppressed. Full sync and targeted events continue to
check entitlement before side effects.

An operator may explicitly request reconciliation with
`python manage.py sync_yourang --salon <id> --allow-backfill`. This flag requires one
salon and current access, must never be scheduled in cron, and deliberately authorizes
recovering that salon's skipped data. A complete successful run appends
`integration.sync_resumed`; a concurrently recorded new skip keeps the pause intact.
It does not replay failed outbox entries or terminal webhook delivery payloads. Keep
these sync audit types in activity-log retention: removing them would remove the
historical information that prevents automatic catch-up.

Both React apps refresh at the absolute returned deadline (not a new 60-second TTL
started after network response), expire visible operational access while refreshing,
and refresh on focus/visibility return and session/salon change. Verification requests
time out and abort after five seconds; failed checks retry within one minute of the
request start, and late timed-out responses cannot restore access. Old organization
responses are discarded. Navigation and read permissions remain available. Mutation
entry controls visibly show a lock and open a localized access dialog instead of
silently doing nothing. Verified unpaid state offers the canonical purchase link;
verification failure offers retry without implying a purchase is required. Public
client actions retain neutral salon-availability copy, with no subscription details.

Explicit `MutationButton`, `MutationInput`, `MutationTextarea`, `MutationSelect` and
`MutationNumInput` primitives cover entry actions and inline edits. Existing inline text remains
focusable/selectable with readOnly; file/checkbox and other nontext mutation inputs
are disabled, preserving any original role/loading disabled state. `PortalFormGate`
checks admission before mounting new forms; an admitted draft remains mounted when
access is lost, freezes its mutation fields, and resumes with the same values after
reactivation. `PortalFormBody` puts this boundary inside modal/drawer chrome, keeping
close/cancel/recovery controls outside the disabled form; footer mutation buttons inherit the form lock individually. Existing record cards can opt into
read-only preview, while search, filters, tabs and record selection remain accessible.
The dashboard has state-based sections/modals rather than separate create/edit URLs;
its form components carry the gate themselves so direct component entry is covered.
The dashboard remounts the entire provider/draft-owner tree on salon/user changes;
entitlement changes alone do not remount it. Client account logout/switch resets its
screen tree, while guest-to-OTP-login preserves the in-progress booking flow.
The client app gates booking, rescheduling, cancellation, gift-card and waitlist forms
and the direct public lead-hook page. Auth/account recovery stays outside these gates.

Coverage includes global quick creation, calendar slots/group bookings and appointment
actions, clients/notes/technical sheets, services/packages, staff/shifts/absences,
inventory/adjustments/suppliers/orders, loyalty/coupons/gifts, communications,
automations, POS/payment forms, team/invitations/roles, categories/location/brand and
booking settings. Calendar drag commits and category ordering retain live entitlement
checks alongside role checks. Native text blur/keyboard mutation callbacks also guard
access, including fields that lose focus during a refresh. API enforcement covers
direct calls and stale UI independently of these presentation controls.

Deploy the compatible YR-502 proxy and additive Yourang portal-access API/catalogue
first, then this Beauty backend and both frontend builds. Existing customers are
enforced immediately; there are no automatic grants or data deletions. No schema
migration or generated frontend contract is required (this project uses raw ESM and
Ninja's runtime OpenAPI schema).

Verification:

- `backend/.venv/bin/python backend/manage.py test apps --noinput`
- `npm --prefix frontend run test:portal-access`
- `npm --prefix frontend run build`

The access suite exercises the real auth, resolver and guards while mocking only
the remote authority. Existing domain fixtures explicitly represent an entitled
salon. Monitor tests cover absolute expiry, network latency, purchase recovery,
unavailable recovery, focus, and stale organization responses. The 19 monitor/mounted React tests
verify locked activation, direct form admission, unchanged draft instance/value through
revocation/recovery, role locks, independent filters/navigation, organization resets,
public neutral copy, and modal close controls outside disabled form regions.

An isolated browser fixture is in `frontend/scripts/portal-access-fixture.jsx`. It
renders the actual shared controls, dashboard modal and styles with explicit local
access-state buttons and sample names; it makes no API calls. Chromium verification
confirmed locked-action dialog, working search, native `:disabled` form state on loss,
no purchase links during failure, and the same DOM input node/value after retry.
The final control snapshot also confirmed Cancel stayed enabled while Save was
disabled. A later screenshot refresh stalled, so the screenshots are supplementary
evidence from the earlier fixture pass; the 19 automated tests cover the final code.
Only the isolated fixture browser was opened and closed; no Beauty service or
tenant data was created/changed for this check. This is component/visual evidence,
not a live Beauty billing test. Live browser/SSO and
end-to-end checkout tests require the compatible proxy/API deployment and real grants.
