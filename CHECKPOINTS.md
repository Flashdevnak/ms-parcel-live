# Checkpoints

- [x] Confirmed source is parcel data, not truck data.
- [x] Parsed HAR and identified `unfinished_parcel_list` + lightweight summary endpoint.
- [x] Parsed XLSX structure: 23 columns, 94,820 data rows.
- [x] Created Supabase project `ms-parcel-live` in `ap-southeast-1`.
- [x] Created Auth/profile, MS connection, short-lived detail cache and summary cache schema.
- [x] Enabled RLS; Security Advisor = 0 lints.
- [x] Deployed `ms-parcel-api` Edge Function v4 with `/status`, `/summary`, `/live`, `/har`, `/claim-admin`.
- [x] Seeded the current HAR credential bundle server-side; AES-GCM encrypted at rest and never returned by API.
- [x] Frontend MVP complete: login/signup, dashboard, detail table/cards, filters, pagination, HAR refresh.
- [x] Adaptive refresh: changed=7s, quiet=15s, hidden tab=60s; summary=30s.
- [x] No cron scanning of all ~95k parcels; no full historical mirror.
- [x] New GitHub repository: `Flashdevnak/ms-parcel-live`.
- [x] GitHub Pages enabled and deployment succeeded.
- [x] Production URL: `https://flashdevnak.github.io/ms-parcel-live/`.
- [x] Security hardening: every new user starts as viewer; admin uses one-time bootstrap code; only hash stored.
- [x] Hard boundary: never read/write `waiting-trucks-report` for this project.
- [ ] Owner creates/signs into first account and claims admin.
- [ ] Live MS end-to-end verification after authenticated owner login.
