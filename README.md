# MS Parcel Live

ระบบดูพัสดุคงคลังจาก MS แบบ read-only โดยใช้ GitHub Pages + Supabase Auth + Edge Functions + shared short-lived cache เพื่อให้ข้อมูลสดโดยใช้โควต้าให้น้อยที่สุด

## Architecture
- Frontend: GitHub Pages
- Auth: Supabase Auth
- Backend: Supabase Edge Function `ms-parcel-api` v9
- Source: `fbi.flashexpress.com/api/dc/unfinished_parcel_list`
- Summary: `fbi.flashexpress.com/api/dc/dc_delivery_transfer_list`
- หลายสาขาใน Supabase project เดียว โดยแต่ละสาขามี MS/HAR/cache แยกกัน
- Detail cache: 8 วินาทีเมื่อข้อมูลเปลี่ยน, 15 วินาทีเมื่อเริ่มนิ่ง, 30 วินาทีเมื่อไม่เปลี่ยนต่อเนื่อง
- Summary cache: 60 วินาที
- Hidden tab: 60 วินาที; เมื่อกลับ visible จะตรวจใหม่ภายในประมาณ 300 ms
- ไม่มี Cron scan หลายหมื่นรายการ และไม่เก็บ full historical mirror

## Frontend views — zero extra quota
หน้าเว็บเป็น SPA เดียวเพื่อไม่ reload session/cache ทุกครั้ง แต่แยก UX เป็น 4 หน้า:
- `แดชบอร์ด` — หน้าแรก ภาพรวม + multi-select ช่วงเวลา + คัดลอกรวม
- `พัสดุคงคลัง` — ตารางค้นหา/กรองรายการปัจจุบัน
- `SLA & Backlog` — อายุคงคลัง, เกิน SLA, เกินเวลาแผน
- `ตรวจแบ็กกิ้ง` — Bagging Inspector และตัวกรองเฉพาะแบ็ก

ตารางผลลัพธ์เป็น DOM ชุดเดียวและถูกย้ายไปยังหน้าที่เปิด ไม่สร้าง API call ซ้ำจากการเปลี่ยนหน้า

### Dashboard time selection
- เลือกหลายช่วงพร้อมกันได้: `<3`, `3–6`, `6–9`, `9–12`, `12–16`, `16–22`, `22–24`, `24–48`, `>48` ชั่วโมง
- selection เก็บใน `localStorage` ของ browser เท่านั้น
- `คัดลอกรวมตามเวลาที่เลือก` สร้างข้อความจาก rows ที่โหลดอยู่แล้ว: จำนวนตามช่วงเวลา, จำนวนตามปลายทาง, เลขพัสดุ, แบ็กกิ้ง, การดำเนินการล่าสุด
- `เปิดรายการช่วงที่เลือก` พา selection หลายช่วงไปหน้า SLA โดยใช้ client-side filter เท่านั้น
- navigation/time selection/copy ไม่เพิ่ม Edge/MS request, DB polling หรือ cron

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

## Smart Backlog Monitor — zero extra quota
Smart Monitor เป็น derived UI ทั้งหมดและต้องไม่เพิ่ม MS request, Edge invocation, database polling หรือ cron เพิ่มจาก cadence เดิม

- เวลาค้างคำนวณจาก `real_arrive_time` ที่มีอยู่ใน live row
- ช่วงอายุ: `<3`, `3–6`, `6–9`, `9–12`, `12–16`, `16–22`, `22–24`, `24–48`, `>48` ชั่วโมง
- `เกิน SLA 24 ชม.` / `เกิน SLA 48 ชม.` ใช้กับอายุคงคลัง
- `เกินเวลาแผน` = `plan_leave_time` ผ่านแล้ว แต่พัสดุยังอยู่ใน unfinished list
- `ใกล้เวลาแผน` = เหลือเวลาไม่เกิน 60 นาทีถึง `plan_leave_time`
- ถ้าไม่มี `real_arrive_time` ให้แสดงอายุไม่ทราบ ห้ามเดา timestamp
- Quick Filter และจำนวนความเสี่ยงคำนวณจาก rows ที่โหลดอยู่ในหน้าปัจจุบันเท่านั้น
- `เสี่ยงสุดก่อน` เป็น client-side sort
- `คัดลอกรายการที่กรอง` ใช้ Clipboard API และไม่ส่งข้อมูลออกไป backend เพิ่ม

## Bagging Inspector — zero extra quota
- ค่าเริ่มต้น `ทั้งหมด`; เลือก `เฉพาะมีเลขแบ็กกิ้ง` ได้
- filter จากข้อมูลแบ็กในหน้าปัจจุบัน: เลขแบ็กกิ้ง, สถานะการดำเนินการล่าสุด, HUB, สาขา, ประเภทความผิดปกติ
- HUB/สาขาที่ขึ้นต้นด้วย `(xxx)` หรือ `（xxx）` จะตัด prefix ออกก่อนแสดง/กรอง
- ตรวจปลายทางปน, การดำเนินการปน, สถานะพัสดุปน, เกินเวลาแผน, ไม่อัปเดต >6 ชม., และวิกฤต `>48 ชม. + เกินเวลาแผน`
- ทั้งหมดทำใน frontend จาก rows เดิม ไม่เพิ่ม Edge/MS request

## Silent refresh UX
- ไม่มี overlay / ข้อความ `กำลังโหลดข้อมูล MS...` ทุก polling รอบ
- ตารางเดิมค้างอยู่ระหว่าง refresh หลังบ้าน
- ถ้า refresh พลาด หน้าเว็บยังเก็บข้อมูลล่าสุดไว้และแสดงสถานะเล็ก ๆ เท่านั้น

## Security
- Public Edge route มีเฉพาะ `/login`
- Route ที่มีข้อมูลตรวจ Bearer token กับ Supabase Auth `/auth/v1/user` จริงก่อนใช้งาน เพราะ Edge ใช้ custom authentication เพื่อรองรับ Username login
- MS credential/session เข้ารหัส AES-GCM ก่อนเก็บใน `ms_connection`
- frontend ไม่มีสิทธิ์อ่าน credential และไม่เคยรับ raw MS auth/session
- HAR upload ตรวจ role + branch permission ฝั่ง Edge
- RLS เปิดบนตารางที่เกี่ยวข้อง
- service role ใช้เฉพาะ Edge Function

## Supabase
Project ref: `afhnfnfbqdqqzrghovfc`
Region: `ap-southeast-1`
Function: `ms-parcel-api` v9

## Security Advisor note
Supabase Free อาจแสดง `Leaked Password Protection Disabled`; เป็น warning ของ Auth เพิ่มเติมและไม่ได้ทำให้ระบบ Login/MS Live ใช้งานไม่ได้ จึงยังคงสถาปัตยกรรม Free ตามข้อกำหนดของโปรเจกต์

## Repository boundary
- GitHub: `Flashdevnak/ms-parcel-live`
- `waiting-trucks-report` เป็นคนละระบบและห้ามนำมาใช้ อ่าน แก้ไข หรือ commit ในโปรเจกต์นี้
