# MS Parcel Live

ระบบดูพัสดุคงคลังจาก MS แบบ read-only โดยใช้ Supabase Auth + Edge Functions และ on-demand short cache เพื่อประหยัด quota

## Architecture
- Frontend: static site (เตรียมสำหรับ GitHub Pages)
- Auth: Supabase Auth
- Backend: Supabase Edge Function `ms-parcel-api`
- Source: `fbi.flashexpress.com/api/dc/unfinished_parcel_list`
- Summary: `fbi.flashexpress.com/api/dc/dc_delivery_transfer_list`
- Detail cache: 7 วินาทีเมื่อข้อมูลเปลี่ยน / 15 วินาทีเมื่อข้อมูลนิ่ง
- Hidden tab: frontend ลดการ refresh เหลือ 60 วินาที
- ไม่มี Cron สำหรับ 95k rows และไม่เก็บ full snapshot ทั้งชุด

## Security
- MS credential/session เข้ารหัส AES-GCM ก่อนเก็บใน `ms_connection`; frontend ไม่มี grant และ RLS เปิดอยู่
- Edge Function ใช้ service role ภายในเท่านั้น
- HAR upload ต้องเป็น admin
- ค่า auth จาก HAR ไม่ถูกส่งกลับ frontend

## Supabase
Project ref: `afhnfnfbqdqqzrghovfc`
Region: `ap-southeast-1`
Function: `ms-parcel-api`

## First login
ผู้ใช้ Supabase Auth คนแรกที่เรียก API จะถูกกำหนดเป็น `admin`; ผู้ใช้ถัดไปเป็น `viewer`.

## Repository
- GitHub: `Flashdevnak/ms-parcel-live`
- `waiting-trucks-report` เป็นคนละระบบและห้ามนำมาใช้/แก้ไขในโปรเจกต์นี้
