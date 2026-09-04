# Checkpoints

- [x] Confirmed source is parcel data, not truck data.
- [x] Parsed HAR and identified `unfinished_parcel_list` + lightweight summary endpoint.
- [x] Parsed XLSX structure: 23 columns, 94,820 data rows.
- [x] Created Supabase project `ms-parcel-live` in `ap-southeast-1`.
- [x] Current HAR credential encrypted at rest and never returned by API.
- [x] GitHub Pages published: https://flashdevnak.github.io/ms-parcel-live/
- [x] No cron scanning of all ~95k parcels; no full historical mirror.
- [x] Hard boundary: never read/write `waiting-trucks-report` for this project.

## v6 production baseline
- [x] Owner/Admin live authentication verified.
- [x] Live changed TTL = 8 seconds; quiet TTL = 15 seconds; summary = 60 seconds; hidden tab = 60 seconds.
- [x] Slim payload + `content_hash` + `previous_hash` + `delta_payload` verified.
- [x] Shared refresh lease verified atomic: first claim=true, immediate second claim=false.
- [x] Final visible-tab production test: DB TTL 8.002 seconds; repeated `/live` about every 9.3–9.5 seconds including MS/Edge processing.
- [x] v6 100-row payload measured ~15.9 KB full / ~1.26 KB delta in latest production sample.

## v8 username / multi-device / multi-branch
- [x] Removed public signup UI; login is Username + password created by Admin.
- [x] Existing Owner migrated to Username `admin` without changing Owner password.
- [x] Admin UI can create user, set branch, enable/disable user, reset password, and grant `can_upload_har`.
- [x] User can keep multiple Supabase sessions/devices; shared lease prevents same branch/page devices from multiplying MS refresh leaders.
- [x] Added `branches` master table.
- [x] Existing NE1 migrated safely to branch id 1; Store `TH27011602` and encrypted credential preserved.
- [x] `ms_connection`, live cache, summary cache and lease are branch-scoped and `branch_id` is NOT NULL.
- [x] Cache key format changed to `b:<branch_id>:...`.
- [x] Viewer direct-cache RLS restricted to own branch; Admin can access all active branches.
- [x] `claim_cache_refresh(branch_id, cache_key)` uses `SECURITY INVOKER` + branch-aware RLS.
- [x] HAR upload is branch-scoped; `can_upload_har` user can update only own branch and Admin can update selected branch.
- [x] Edge function uses custom Auth verification through `/auth/v1/user` on every protected route; public route is `/login` only.
- [x] Edge source refactored into `core.ts`, `ms.ts`, `admin.ts`, `index.ts`; Supabase v8 ACTIVE and source matches GitHub.
- [x] Adaptive live TTL: changed 8s, initial unchanged 15s, unchanged streak >=5 => 30s; summary 60s; hidden tab 60s.
- [x] Frontend reads metadata first, then delta-only when hash chain matches; full payload is fallback only.
- [x] Poll refresh is silent: existing table stays visible; no `กำลังโหลดข้อมูล MS...` overlay every cycle.
- [x] Added `favicon.svg` and linked it from `index.html`.
- [x] JavaScript CI gate `node --check app.js` passes and Pages deployment for v8 source passed.
- [x] Added branch indexes including `cache_refresh_leases_branch_idx`; unindexed-FK Advisor INFO removed.
- [ ] Production browser smoke test on v8: expect branch key `b:1:*`, Edge v8 HTTP 200, and username login path verification.

## Advisor note
- [x] Security Advisor has no new RLS/schema warning; remaining `Leaked Password Protection Disabled` is the known Free-plan Auth warning.
- [x] Performance Advisor currently shows only unused-index INFO immediately after v8 cache reset; retain indexes until real multi-branch traffic exists.

## Historical checkpoints
- CP15: GitHub Pages enabled and rerun passed.
- CP16: Pages deployment success.
- CP25: owner/admin claim verified in production.
- CP35: Edge Function v6 ACTIVE.
- CP39: atomic shared lease verified.
- CP46: v6 slim cache measured at ~15.9 KB full / ~1.26 KB delta for 100 rows.
- CP47: final v6 visible-tab cadence verified at ~9.3–9.5 seconds end-to-end.
- v8-1: multi-branch/username/permission migration applied.
- v8-2: NE1 existing credential migration verified safe.
- v8-3: username/multi-branch frontend + silent refresh + favicon committed.
- v8-4: Edge custom-auth architecture deployed.
- v8-5: Edge source modularized and production/GitHub parity restored on v8.
