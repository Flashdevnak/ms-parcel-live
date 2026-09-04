# Checkpoints

- [x] Confirmed source is parcel data, not truck data.
- [x] Parsed HAR and identified `unfinished_parcel_list` + lightweight summary endpoint.
- [x] Parsed XLSX structure: 23 columns, 94,820 data rows.
- [x] Created Supabase project `ms-parcel-live` in `ap-southeast-1`.
- [x] Created Auth/profile, MS connection, short-lived detail cache and summary cache schema.
- [x] Enabled RLS; Security Advisor = 0 lints.
- [x] Deployed `ms-parcel-api` Edge Function v5 with `/status`, `/summary`, `/live`, `/har`, `/users`, `/claim-admin`.
- [x] Seeded the current HAR credential bundle server-side; encrypted at rest and never returned by API.
- [x] Frontend MVP complete: login/signup, dashboard, detail table/cards, filters, pagination, HAR refresh.
- [x] Adaptive refresh: changed=7s, quiet=15s, hidden tab=60s; summary=30s.
- [x] No cron scanning of all ~95k parcels; no full historical mirror.
- [x] First authenticated login + live MS end-to-end verification.
- [x] New GitHub repository created: `Flashdevnak/ms-parcel-live`.
- [x] Publish and verify GitHub Pages.
- [x] Hard boundary: never read/write `waiting-trucks-report` for this project.

- CP15: GitHub Pages enabled and rerun passed.
- CP16: Pages deployment success: https://flashdevnak.github.io/ms-parcel-live/
- CP17: Security hardening: all new users viewer; one-time admin bootstrap with hash-only storage.
- [x] Owner account claimed Admin successfully; bootstrap is consumed and cannot be reused.
- [x] Edge Function v5: new users are pending until Admin approval; Admin user management added.
- [x] MS live verified on v5 with HTTP 200 for summary/live and encrypted credential.
- [x] Supabase docs confirmed CORS OPTIONS preflight is not billed as Edge Function invocation.
