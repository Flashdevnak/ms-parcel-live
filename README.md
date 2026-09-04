# MS Parcel Live

ระบบดูพัสดุคงคลังจาก MS แบบ read-only โดยใช้ Supabase Auth + Edge Functions + shared short-lived cache เพื่อให้ข้อมูลสดโดยใช้โควต้าให้น้อยที่สุด

## Architecture
- Frontend: GitHub Pages
- Auth: Supabase Auth
- Backend: Supabase Edge Function `ms-parcel-api` v6
- Source: `fbi.flashexpress.com/api/dc/unfinished_parcel_list`
- Summary: `fbi.flashexpress.com/api/dc/dc_delivery_transfer_list`
- Detail cache: 8 วินาทีเมื่อข้อมูลเปลี่ยน / 15 วินาทีเมื่อข้อมูลนิ่ง
- Summary cache: 60 วินาที
- Hidden tab: frontend ลดการ refresh เหลือ 60 วินาที
- เมื่อ tab กลับ visible จะตรวจ live ใหม่ภายในประมาณ 300 ms
- ไม่มี Cron สำหรับข้อมูลหลายหมื่นรายการ และไม่เก็บ full historical mirror

## Shared cache / quota control
- Browser อ่าน cache metadata จาก Supabase ก่อน
- ใช้ `claim_cache_refresh()` แบบ atomic lease เพื่อให้ในหนึ่ง cache key มี browser เดียวเป็น leader ไปเรียก Edge/MS เมื่อ cache หมดอายุ
- Lease ใช้ `SECURITY INVOKER` และ RLS; เฉพาะบัญชี `active` เท่านั้นที่ claim ได้
- Cache key และ lease duration ถูกจำกัดที่ฐานข้อมูล
- Live rows ถูกทำ slim payload เฉพาะ field ที่หน้าเว็บใช้
- ใช้ `content_hash` + `previous_hash` + `delta_payload`
- ถ้าข้อมูลไม่เปลี่ยน Edge ตอบแบบ not-modified โดยไม่ต้องส่ง rows เต็มซ้ำ
- ถ้าเปลี่ยนบางรายการ client สามารถใช้ delta เพิ่ม/แก้/ลบแทน full payload
- จาก production sample 100 rows: cache รุ่นเดิมประมาณ 168–169 KB; v6 full payloadประมาณ 83.5 KB และ delta sample ประมาณ 22.8 KB

## Security
- MS credential/session เข้ารหัส AES-GCM ก่อนเก็บใน `ms_connection`
- frontend ไม่มีสิทธิ์อ่าน credential
- Edge Function ใช้ service role ภายในเท่านั้น
- HAR upload ต้องเป็น admin
- ค่า auth จาก HAR ไม่ถูกส่งกลับ frontend
- RLS เปิดบนตารางที่เกี่ยวข้อง
- Client อ่าน live/summary cache ได้เฉพาะบัญชี `active`
- ผู้สมัครใหม่เป็น `pending` จน Admin อนุมัติ

## Auth behavior
- Supabase token refresh / repeated `SIGNED_IN` ของ user เดิมอัปเดต session โดยไม่ล้าง rows, hash หรือ polling timers
- Full session reset ทำเมื่อ logout หรือเปลี่ยน user จริง

## Supabase
Project ref: `afhnfnfbqdqqzrghovfc`
Region: `ap-southeast-1`
Function: `ms-parcel-api` v6

## Admin bootstrap
- ทุกบัญชีเริ่มเป็น viewer
- เจ้าของระบบใช้รหัส one-time bootstrap เพื่อ claim admin
- ระบบเก็บเฉพาะ SHA-256 hash
- plaintext code ไม่ถูก commit ลง GitHub
- หลัง claim สำเร็จ bootstrap ใช้ซ้ำไม่ได้

## User approval
- New signups start as `pending` and cannot read parcel live/summary data.
- Admin can approve or disable accounts from the web UI.
- The owner/admin account remains `active`.
- Client-side profile role/access mutation is revoked; changes go through the authenticated Edge Function only.

## Security Advisor note
Supabase Free อาจแสดง `Leaked Password Protection Disabled`; เอกสาร Supabase ระบุว่าฟีเจอร์ leaked-password protection ใช้ได้ใน Pro Plan ขึ้นไป จึงไม่เปิดในสถาปัตยกรรม Free นี้

## Repository boundary
- GitHub: `Flashdevnak/ms-parcel-live`
- `waiting-trucks-report` เป็นคนละระบบและห้ามนำมาใช้หรือแก้ไขในโปรเจกต์นี้
