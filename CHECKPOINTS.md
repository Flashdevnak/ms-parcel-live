# Checkpoints

## Control Room resume — 2026-09-06 / Phase 0 IN PROGRESS
- Verified latest main base: `f2a08233b37463572d07cd6782514e8a17a1260f`.
- Management API: deployed Edge version 24, ACTIVE, verify_jwt=false. Do not redeploy v13 over this version.
- Retrieved all six deployed source files: differences from main are comments/formatting; scanner request size is now 10000 (snapshot chunk size 5000), not the historical v13 request size. Preserve the newer source behavior pending source verification.
- Authenticated production browser: Admin login and session restoration after reload PASS; NE1 live reads and HAR health working. This is not a general-user/RLS/multi-device acceptance test.
- Production analytics cache observed: 2026-09-06 11:13:06 UTC, scanned=59545, total=59547, complete=false, reason=row_count_mismatch, source page counts [9998,10000,10000,10000,10000,9547], all page totals=59547, requests=14. No snapshot rows currently present. CP-v13-12 and CP-v13-13 remain NOT PASS.
- Active configured branches are NE1 and EA2; NE4 is not configured. Do not fabricate a NE4 production load-test result.
- All seven existing public tables have RLS enabled. Policy behavior and multi-branch-user access still require runtime tests.
- Phase-0 repair: backend-only full-analytics lease reuses cache_refresh_leases, isolated per branch and separate from frontend's short transfer-summary lease. A 180-second crash lease exceeds the Free worker lifetime; conditional release cannot unlock a successor. Cache rechecked after claim. No new table, migration, cron, auth change, or HAR exposure.
- LOCAL PASS: existing tests-data.mjs, tests-ui.mjs (jsdom 26.1.0), root JavaScript syntax; tests-lease.mjs simulates 40 concurrent clients across two branches, one leader each, crash expiry, stale release and fail-closed DB errors. SIMULATION ONLY, not production load PASS.
- CI supports an explicit [skip pages] commit marker so backend/checkpoint verification does not publish frontend before CP-v13-12. No asset versions bumped.
- Remaining: CI Edge typecheck, deploy verified backend repair, authenticated production cache/coalescing checks, diagnose incomplete inventory without filling missing rows, then finish CP-v13-12 before frontend publication or new features.

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
- [x] v6 100-row payload measured ~15.9 KB full / ~1.26 KB delta for 100 rows.

## v8/v9 username / multi-device / multi-branch
- [x] Removed public signup UI; login is Username + password created by Admin.
- [x] Existing Owner migrated to Username `admin` without changing Owner password.
- [x] Admin UI can create user, set branch, enable/disable user, reset password, and grant `can_upload_har`.
- [x] Password minimum aligned to 6 characters for existing Owner and new users; Edge v9 ACTIVE.
- [x] User can keep multiple Supabase sessions/devices; shared lease prevents same branch/page devices from multiplying MS refresh leaders.
- [x] Added `branches` master table.
- [x] Existing NE1 migrated safely to branch id 1; Store `TH27011602` and encrypted credential preserved.
- [x] `ms_connection`, live cache, summary cache and lease are branch-scoped and `branch_id` is NOT NULL.
- [x] Cache key format changed to `b:<branch_id>:...`.
- [x] Viewer direct-cache RLS restricted to own branch; Admin can access all active branches.
- [x] `claim_cache_refresh(branch_id, cache_key)` uses `SECURITY INVOKER` + branch-aware RLS.
- [x] HAR upload is branch-scoped; `can_upload_har` user can update only own branch and Admin can update selected branch.
- [x] Edge function uses custom Auth verification through `/auth/v1/user` on every protected route; public route is `/login` only.
- [x] Edge source refactored into `core.ts`, `ms.ts`, `admin.ts`, `index.ts`; Supabase source matches GitHub at each deployed checkpoint.
- [x] Adaptive live TTL: changed 8s, initial unchanged 15s, unchanged streak >=5 => 30s; summary 60s; hidden tab 60s.
- [x] Frontend reads metadata first, then delta-only when hash chain matches; full payload is fallback only.
- [x] Poll refresh is silent: existing table stays visible; no `กำลังโหลดข้อมูล MS...` overlay every cycle.
- [x] Added `favicon.svg` and linked it from `index.html`.
- [x] Fixed async form reset bug: successful User/branch creation no longer reports `Cannot read properties of null (reading 'reset')`.
- [x] Branch without Store ID is valid before HAR; UI explains Store ID is filled automatically from HAR.
- [x] Added branch indexes including `cache_refresh_leases_branch_idx`; unindexed-FK Advisor INFO removed.

## Smart Backlog Monitor — zero incremental backend quota
- [x] Added client-side `<24h`, `24–48h`, `>48h` backlog classification from existing `real_arrive_time`.
- [x] Expanded `<24h` into `<3`, `3–6`, `6–9`, `9–12`, `12–16`, `16–22`, `22–24` hour bands.
- [x] Changed operational wording from `ตกรอบรถ` to `เกินเวลาแผน`: `plan_leave_time` has passed while parcel remains in unfinished list.
- [x] Use `เกิน SLA 24 ชม.` / `เกิน SLA 48 ชม.` for inventory-age SLA grouping.
- [x] Added `ใกล้เวลาแผน ≤60 นาที` warning from existing `plan_leave_time`.
- [x] Missing arrival timestamp stays `อายุไม่ทราบ`; no inferred/fabricated timestamp.
- [x] Added risk badges on desktop table and mobile cards.
- [x] Added current-page quick filters and counts.
- [x] Added client-side `เสี่ยงสุดก่อน` sorting.
- [x] Added `คัดลอกรายการที่กรอง` using Clipboard API for operational follow-up.

## Operational SPA views / shared filters
- [x] SPA has six operational views: `แดชบอร์ด`, `พัสดุคงคลัง`, `สถานะพัสดุ`, `SLA & Backlog`, `น้ำหนักสาขา`, `ตรวจแบ็กกิ้ง`.
- [x] Dashboard remains the default view and keeps the existing live engine/session/cache running without page reload.
- [x] Operational terminology: `dst_hub_name` = LH destination; `dst_store_name` = FD destination.
- [x] Current source HUB is excluded from LH destination summaries.
- [x] Dashboard supports multi-select time bands: `<3`, `3–6`, `6–9`, `9–12`, `12–16`, `16–22`, `22–24`, `24–48`, `>48`.
- [x] Time selection persists locally in browser `localStorage`.

## v13 full-data analytics redesign
- [x] Frontend modules are fail-safe isolated: navigation, operational views, and analytics cannot take each other down.
- [x] CI validates `app.js`, `inspector.js`, `analytics-client.js`, `snapshot-client.js`, `ops.js`, `shell.js` and Deno type-checks the Edge entrypoint/dependencies before Pages deploy.
- [x] Status view redesigned as three bar-chart groups: latest action, LH destination, FD destination.
- [x] Weight view redesigned as separate FD cards and LH cards with parcel count / total kg / average kg.
- [x] Bagging view redesigned as destination group -> bag card -> parcel-number list; per-bag and full-filter copy includes parcel numbers.
- [x] Dashboard copy and SLA/Bagging copy lazy-load full detail and include parcel numbers when a full snapshot is available.
- [x] Added shared manager-phone dimension using actual MS field `store_manager_phone`.
- [x] Added aggregate-only operational insights without additional MS reads: no-bag >24h, top manager backlog, top >48h destination, bagging rate.
- [x] Full Analytics hard limit remains max 30 MS source requests per snapshot; no fallback to ~900 page reads.
- [x] Full Analytics complete-cache target is 30 minutes; incomplete/probe cache is 5 minutes.
- [x] Full snapshot writes are batched 3 pages at a time; a failed build cleans its partial snapshot.
- [x] Full-detail rows are loaded on demand only for pages/actions that need parcel numbers; Dashboard normally uses aggregate data only.
- [x] CP-v13-10: removed the new-table migration requirement. Full snapshot chunks reuse existing branch-RLS-protected `live_cache_pages`; no production schema change is required.
- [x] Existing production-approved `transfer-summary` lease is reused only for the short analytics leader election, avoiding a DB policy migration.
- [x] HAR upload clears live/snapshot cache for only the selected branch.
- [x] Backend source passes `deno check`; frontend source passes all `node --check` gates.
- [x] CP-v13-11: PASS — production Edge v13 ACTIVE, verify_jwt=false, verified 2026-09-06. No schema migration.
- [ ] CP-v13-12: after Edge activation verify NE1 `scanned == total`, accepted MS page size, source page count, snapshot page count, manager filter, parcel-number copy, LH/FD graphs and bag groups against live data.
- [ ] CP-v13-13: only after CP-v13-12 passes, force-bump frontend asset versions and run final production smoke test.

### v13 deployment credential gate
- [x] Direct DB migration is no longer required.
- [x] GitHub fallback deployment workflow is manual-only and deploys Edge via Supabase CLI `--use-api`.
- [x] Checked repository + `github-pages` environment credential aliases without exposing values.
- [x] Historical credential gate resolved: production v13 deployment confirmed through Supabase management connector. No token values inspected.

## Advisor note
- [x] Security Advisor has no new RLS/schema warning; remaining `Leaked Password Protection Disabled` is the known Free-plan Auth warning.
- [x] Performance Advisor currently shows only unused-index INFO immediately after multi-branch cache reset; retain indexes until real multi-branch traffic exists.

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
- v8-5: Edge source modularized and production/GitHub parity restored.
- v9-1: password minimum aligned to 6 characters.
- v9-2: async admin form reset bug fixed and Store ID-from-HAR UX clarified.
- v9-3: zero-quota Smart Backlog Monitor implemented.
- v9-4: SLA sub-bands + Bagging Inspector implemented.
- v9-5: compact dashboard-first SPA + shared time filters.
- v9-6: LH/FD semantics, cascading filters, latest-action page, weight page, and operational bagging detail implemented.


## Workspace upgrade — 2026-09-06
- Base main: `9bad9c6cfb0f74995b72b42cbb8861259a7193c1`; no rollback/reset, no access to other projects.
- CP-UX-01 IMPLEMENTED: six workspace views, destination cards, age heatmap, clickable status charts, FD/LH weight cards, destination-first bag groups, parcel detail drawer.
- CP-DATA-01 IMPLEMENTED: bounded source scan with duplicate/missing-ID checks, exact count equality, total consistency, one isolated retry within the same 30-request budget.
- CP-DATA-02 IMPLEMENTED: no live-page fallback for aggregate totals or copy; explicit readiness/expiry; branch/snapshot identity guards; global filters are not rewritten by live polling.
- CP-DATA-03 IMPLEMENTED: separate live/analytics timestamps, distinct unknown-age group, manager uses store_manager_phone, mixed bags checked against all members before filtering.
- CP-TEST-01 LOCAL PASS: Node syntax + tests-data.mjs (bounded scans, moving totals, duplicates, retry, source cap, empty inventory, FD/LH, manager and snapshot checks).
- CP-TEST-02 PENDING: CI Deno check and tests-ui.mjs; production smoke after deployment.
- CP-v13-12 NOT PASS: authenticated baseline cache at 2026-09-05 20:03:12 UTC has scanned=67560,total=68065,snapshotId=null. Owner logged in. New backend diagnostics must establish source consistency; never relabel a partial inventory as complete.
- CP-v13-13 NOT PASS: previous Pages deployment succeeded; final full-data gate remains tied to CP-v13-12.
- No new migrations, cron, tables, RLS edits or SECURITY DEFINER. Original live TTL logic and summary polling retained.

### Verified production diagnosis
- Pages run 33989175816 SUCCESS at cf97a309aa8274bd55cc921f9d15a63752d13b59. Deno and UI tests both passed.
- Edge v14 ACTIVE verified, custom authentication retained. Owner authenticated browser is online.
- New scanner evidence (2026-09-05 20:11:41 UTC): total=66013, scanned=65846, reason=source_changed, requests=28 (two attempts inside 30-request budget).
- Source totals during final attempt: 66013,65984,65981,65981,65955,65955,65955,65912,65912,65912,65873,65873,65873,65848.
- Page counts: 4998,5000,5000,5000,5000,5000,5000,5000,5000,5000,5000,5000,5000,848. MS pagination is changing during collection; observed first-page length must not be mistaken for accepted page-size cap.
- Follow-up preserves labelled partial aggregate views (no partial snapshot/copy) while requiring exact full-data verification for PASS. Shared browser auth client removes multiple GoTrueClient instances.

### Phase 0 verification / deployment gate
- Repair source main: `8e9a0d6709abf33de9379b57933b8cbb6a541053`.
- GitHub Actions run `34034508954` / job `101490013145`: frontend syntax, data tests, lease simulation, Deno Edge typecheck and UI tests all SUCCESS. Configure/Upload/Deploy Pages explicitly SKIPPED.
- Production browser smoke: authenticated Admin can open all six existing views; document width=viewport width=1348 on each. This verifies desktop navigation only, not full snapshot accuracy, mobile/tablet, copy/export completeness or general-user permissions.
- Edge deployment of the tested repair was REJECTED by automatic approval review: production mutation before the production-verification/cutover gate. No alternate deployment path attempted.
- Management API checked again after rejection: Edge remains version 24 / ACTIVE / verify_jwt=false. Main intentionally contains the undeployed lease repair; deployed source parity with this repair is NOT PASS.
- Owner action needed: explicitly authorize deploying the tested backend-only Phase 0 repair while CP-v13-12 is still incomplete, to permit subsequent production verification. Runtime risk: contenders receive a labelled stale result while the branch leader collects data; a crashed leader can hold its lease up to 180s.
- No frontend asset bump/publication, schema/RLS change, new feature phase, quota/load production PASS, or overall-completion claim.
