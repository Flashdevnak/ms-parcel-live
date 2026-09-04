# MS Parcel Live

ระบบดูพัสดุคงคลังจาก MS แบบ read-only โดยใช้ Supabase Auth + Edge Functions และ on-demand short cache เพื่อประหยัด quota

## Architecture
- Frontend: GitHub Pages
- Auth: Supabase Auth
- Backend: Supabase Edge Function `ms-parcel-api`
- Source: `fbi.flashexpress.com/api/dc/unfinished_parcel_list`
- Summary: `fbi.flashexpress.com/api/dc/dc_delivery_transfer_list`
- Detail cache: 7 วินาทีเมื่อข้อมูลเปลี่ยน / 15 วินาทีเมื่อข้อมูลนิ่ง
- Hidden tab: frontend ลดการ refresh เหลือ 60 วินาที
- ไม่มี Cron สำหรับ ~95k rows และไม่เก็บ full snapshot ทั้งชุด

## Security
- MS credential/session เข้ารหัส AES-GCM ก่อนเก็บใน `ms_connection`; frontend ไม่มี grant และ RLS เปิดอยู่
- Edge Function ใช้ service role ภายในเท่านั้น
- HAR upload ต้องเป็น admin
- ค่า auth จาก HAR ไม่ถูกส่งกลับ frontend
- ผู้ใช้ใหม่ทุกคนเริ่มเป็น `viewer`
- Admin ต้อง claim ด้วยรหัส one-time bootstrap; ฐานข้อมูลเก็บเฉพาะ SHA-256 hash
- plaintext bootstrap code ไม่ถูก commit ลง GitHub และใช้ซ้ำไม่ได้หลัง claim สำเร็จ

## Supabase
Project ref: `afhnfnfbqdqqzrghovfc`
Region: `ap-southeast-1`
Function: `ms-parcel-api`

## Production URL
https://flashdevnak.github.io/ms-parcel-live/

## Repository
- GitHub: `Flashdevnak/ms-parcel-live`
- `waiting-trucks-report` เป็นคนละระบบและห้ามนำมาใช้/แก้ไขในโปรเจกต์นี้
