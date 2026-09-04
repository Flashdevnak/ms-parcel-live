# Checkpoints

- [x] Confirmed source is parcel data, not truck data.
- [x] Parsed HAR and identified `unfinished_parcel_list` + lightweight summary endpoint.
- [x] Parsed XLSX structure: 23 columns, 94,820 data rows.
- [x] Created Supabase project `ms-parcel-live` in `ap-southeast-1`.
- [x] Created Auth/profile, MS connection, short-lived detail cache and summary cache schema.
- [x] Enabled RLS; Security Advisor = 0 lints.
- [x] Deployed `ms-parcel-api` Edge Function v3 with `/status`, `/summary`, `/live`, `/har`.
- [x] Seeded the current HAR credential bundle server-side; encrypted at rest and never returned by API.
- [x] Frontend MVP complete: login/signup, dashboard, detail table/cards, filters, pagination, HAR refresh.
- [x] Adaptive refresh: changed=7s, quiet=15s, hidden tab=60s; summary=30s.
- [x] No cron scanning of all ~95k parcels; no full historical mirror.
- [ ] First authenticated login + live MS end-to-end verification.
- [x] New GitHub repository created: `Flashdevnak/ms-parcel-live`.
- [ ] Publish and verify GitHub Pages.
- [x] Hard boundary: never read/write `waiting-trucks-report` for this project.
