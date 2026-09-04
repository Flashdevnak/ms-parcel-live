# Checkpoints

- [x] Confirmed source is parcel data, not truck data.
- [x] Parsed HAR and identified `unfinished_parcel_list` + lightweight summary endpoint.
- [x] Parsed XLSX structure: 23 columns, 94,820 data rows.
- [x] Created Supabase project `ms-parcel-live` in `ap-southeast-1`.
- [x] Created Auth/profile, MS connection, short-lived detail cache and summary cache schema.
- [x] Seeded the current HAR credential bundle server-side; encrypted at rest and never returned by API.
- [x] Frontend MVP complete: login/signup, dashboard, detail table/cards, filters, pagination, HAR refresh.
- [x] No cron scanning of all ~95k parcels; no full historical mirror.
- [x] First authenticated login + live MS end-to-end verification.
- [x] GitHub Pages published: https://flashdevnak.github.io/ms-parcel-live/
- [x] Hard boundary: never read/write `waiting-trucks-report` for this project.

## Auth / access
- [x] Owner account claimed Admin successfully; bootstrap is consumed and cannot be reused.
- [x] New users start as `pending`; Admin approval is required before live/summary data access.
- [x] Admin user-management UI added.
- [x] Credential encrypted with AES-GCM; frontend cannot read it.
- [x] Auth refresh / repeated SIGNED_IN for the same user no longer clears live rows/hash/timers.

## v6 live optimization
- [x] Edge Function `ms-parcel-api` v6 ACTIVE.
- [x] Live changed TTL = 8 seconds; quiet TTL = 15 seconds.
- [x] Summary TTL = 60 seconds.
- [x] Hidden tab refresh = 60 seconds; visible again triggers live check in ~300 ms.
- [x] Slim payload stores only fields used by the UI.
- [x] `content_hash`, `previous_hash`, and `delta_payload` implemented.
- [x] Production sample verified: old 100-row cache ~168–169 KB; initial v6 full payload ~83.5 KB; later optimized v6 full payload ~15.9 KB; latest delta sample ~1.26 KB.
- [x] Shared refresh lease implemented so concurrent browsers do not all call Edge/MS for the same cache key.
- [x] Atomic lease test: first claim=true, immediate second claim=false.
- [x] Lease hardened to `SECURITY INVOKER` + RLS; only active users can claim, keys are constrained, lease <= 15 seconds.
- [x] Performance Advisor duplicate-policy warnings removed.
- [x] GitHub Actions validates `node --check app.js` before Pages deployment.
- [x] Edge v6 production `/status`, `/summary`, `/live` verified HTTP 200 with no observed v6 4xx/5xx in the verification window.
- [x] Final visible-tab production test: DB TTL measured 8.002 seconds; repeated `/live` calls observed about every 9.3–9.5 seconds including ~0.9–1.1 seconds MS/Edge processing time; `known_hash` present on every repeat request.

## Advisor note
- [x] Remaining Security Advisor warning reviewed: `Leaked Password Protection Disabled` is a Supabase Pro-or-above feature, so it is not enabled for this Free architecture.
- [x] Remaining Performance Advisor item is only INFO for an index not yet used while the user table is very small.

## Historical checkpoints
- CP15: GitHub Pages enabled and rerun passed.
- CP16: Pages deployment success.
- CP17: Security hardening: all new users viewer; one-time admin bootstrap with hash-only storage.
- CP25: owner/admin claim verified in production.
- CP27: pending/active/disabled approval schema verified.
- CP28: Edge Function v5 ACTIVE with approval enforcement.
- CP30: Pages v5 deployment passed.
- CP33: production payload size measured before v6 optimization.
- CP35: Edge Function v6 ACTIVE.
- CP37: Pages v6 deployment and JavaScript syntax gate passed.
- CP39: atomic shared lease verified.
- CP40: GitHub schema synchronized with hardened production schema.
- CP41: production v6 hash/full/delta cache verified after real browser traffic.
- CP42: v6 Edge responses verified HTTP 200; hidden-tab cadence explained by intended 60-second throttle.
- CP43: auth event handling updated to preserve polling state for the same user.
- CP46: v6 slim cache measured at ~15.9 KB full / ~1.26 KB delta for 100 rows with 8.002-second TTL.
- CP47: final visible-tab cadence verified in production at ~9.3–9.5 seconds end-to-end with repeated HTTP 200 and `known_hash`.
