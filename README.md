# MS Parcel Live

ระบบดูพัสดุคงคลังจาก MS แบบ read-only โดยใช้ GitHub Pages + Supabase Auth + Edge Functions + shared short-lived cache เพื่อให้ข้อมูลสดโดยใช้โควต้าให้น้อยที่สุด

## Architecture
- Frontend: GitHub Pages
- Auth: Supabase Auth
- Backend: Supabase Edge Function `ms-parcel-api` v8
- Source: `fbi.flashexpress.com/api/dc/unfinished_parcel_list`
- Summary: `fbi.flashexpress.com/api/dc/dc_delivery_transfer_list`
- หลายสาขาใน Supabase project เดียว โดยแต่ละสาขามี MS/HAR/cache แยกกัน
- Detail cache: 8 วินาทีเมื่อข้อมูลเปลี่ยน, 15 วินาทีเมื่อเริ่มนิ่ง, 30 วินาทีเมื่อไม่เปลี่ยนต่อเนื่อง
- Summary cache: 60 วินาที
- Hidden tab: 60 วินาที; เมื่อกลับ visible จะตรวจใหม่ภายในประมาณ 300 ms
- ไม่มี Cron scan หลายหมื่นรายการ และไม่เก็บ full historical mirror

## Username / user management
- ไม่มี public signup ในหน้าเว็บ
- Admin สร้าง Username + password ให้ผู้ใช้เอง
- ผู้ใช้ไม่ต้องใช้อีเมลจริง; Supabase Auth email ภายในไม่แสดงใน UI
- Owner เดิมใช้ Username `admin` และรหัสผ่านเดิม
- หนึ่ง Username สามารถมีหลาย session / หลายเครื่องพร้อมกันได้
- Admin กำหนดสาขา, เปิด/ระงับบัญชี, เปลี่ยนรหัสผ่าน และกำหนด `can_upload_har`
- ผู้ที่มี `can_upload_har` อัปโหลด HAR ได้เฉพาะสาขาของตัวเอง; Admin อัปโหลดให้ทุกสาขาที่เลือกได้

## Multi-branch isolation
- ตาราง `branches` เป็น master ของสาขา
- `app_profiles.branch_id` ผูกผู้ใช้กับสาขา
- `ms_connection.branch_id` แยก credential/HAR ของแต่ละสาขา
- live cache, summary cache และ refresh lease มี `branch_id`
- cache key ใช้รูปแบบ `b:<branch_id>:...`
- RLS อนุญาต viewer อ่าน cache เฉพาะสาขาตัวเอง; Admin อ่านทุกสาขา

## Shared cache / quota control
- Browser อ่าน cache metadata จาก Supabase ก่อน
- `claim_cache_refresh(branch_id, cache_key)` เป็น atomic shared lease: ในหนึ่ง branch + page key มี browser เดียวเป็น leader ไปเรียก Edge/MS
- หลายเครื่องที่เปิด branch/page เดียวกันจึงไม่คูณ Edge invocation ตามจำนวนเครื่อง
- ถ้าเปิดคนละ page หรือคนละ branch จะเป็น cache key คนละชุดและ refresh แยกกัน
- Live rows เป็น slim payload เฉพาะ field ที่ UI ใช้
- ใช้ `content_hash` + `previous_hash` + `delta_payload`
- Browser อ่าน delta ก่อนและขอ full payload เฉพาะครั้งแรกหรือ hash chain ต่อไม่ได้
- ถ้าไม่เปลี่ยน Edge ตอบ not-modified; ถ้าเปลี่ยนต่อเนื่องส่งเฉพาะ delta เมื่อทำได้

## Silent refresh UX
- ไม่มี overlay / ข้อความ `กำลังโหลดข้อมูล MS...` ทุก polling รอบ
- ตารางเดิมค้างอยู่ระหว่าง refresh หลังบ้าน
- ถ้า refresh พลาด หน้าเว็บยังเก็บข้อมูลล่าสุดไว้และแสดงสถานะเล็ก ๆ เท่านั้น

## Security
- Public Edge route มีเฉพาะ `/login`
- Route ที่มีข้อมูลตรวจ Bearer token กับ Supabase Auth `/auth/v1/user` จริงก่อนใช้งาน เพราะ Edge v8 ใช้ custom authentication เพื่อรองรับ Username login
- MS credential/session เข้ารหัส AES-GCM ก่อนเก็บใน `ms_connection`
- frontend ไม่มีสิทธิ์อ่าน credential และไม่เคยรับ raw MS auth/session
- HAR upload ตรวจ role + branch permission ฝั่ง Edge
- RLS เปิดบนตารางที่เกี่ยวข้อง
- service role ใช้เฉพาะ Edge Function

## Supabase
Project ref: `afhnfnfbqdqqzrghovfc`
Region: `ap-southeast-1`
Function: `ms-parcel-api` v8

## Security Advisor note
Supabase Free อาจแสดง `Leaked Password Protection Disabled`; เป็น warning ของ Auth เพิ่มเติมและไม่ได้ทำให้ระบบ Login/MS Live ใช้งานไม่ได้ จึงยังคงสถาปัตยกรรม Free ตามข้อกำหนดของโปรเจกต์

## Repository boundary
- GitHub: `Flashdevnak/ms-parcel-live`
- `waiting-trucks-report` เป็นคนละระบบและห้ามนำมาใช้ อ่าน แก้ไข หรือ commit ในโปรเจกต์นี้
