# MS Parcel Live

ระบบติดตามพัสดุคงคลังจาก MS แบบ read-only ใช้ GitHub Pages + Supabase Auth + Edge Function + shared cache โดยออกแบบให้ข้อมูลสดและคุมโควต้า Free plan

## Production
- Web: https://flashdevnak.github.io/ms-parcel-live/
- Supabase project: `afhnfnfbqdqqzrghovfc`
- Region: `ap-southeast-1`
- Edge Function: `ms-parcel-api`
- Production Edge ที่ยืนยันล่าสุด: v16
- `verify_jwt=false` โดยตั้งใจ เพราะ Edge ตรวจ Bearer token เองผ่าน Supabase Auth `/auth/v1/user`

## Data source
- Detail: `fbi.flashexpress.com/api/dc/unfinished_parcel_list`
- Summary: `fbi.flashexpress.com/api/dc/dc_delivery_transfer_list`
- `dst_hub_name` = LH ปลายทาง
- `dst_store_name` = FD ปลายทาง
- ข้อมูล `ผู้จัดการสาขา` ใช้ข้อมูลจริงครบจาก source row: `store_id` + `store_name` + `store_manager_name` + `store_manager_phone`; แสดง Store ID พร้อมวงเล็บและไม่ตัดข้อความ
- รูปแบบแสดงผล: `(Store ID)ชื่อสาขา · ชื่อผู้จัดการ · เบอร์โทร`
- ถ้า source ไม่มีชื่อ/เบอร์ผู้จัดการ จะถือเป็น `ไม่ระบุ` แทนการสร้างตัวตนจาก Store ID อย่างเดียว
- HAR/session ของแต่ละสาขาแยกกันและเข้ารหัสก่อนเก็บ

## Views
เว็บเป็น SPA เดียว ไม่ reload session/cache ตอนเปลี่ยนหน้า

1. `แดชบอร์ด`
   - ภาพรวมคงคลัง
   - ช่วงเวลา `<3`, `3–6`, `6–9`, `9–12`, `12–16`, `16–22`, `22–24`, `24–48`, `>48`
   - สรุป LH / FD / การดำเนินการล่าสุด
   - คัดลอกรวมพร้อมเลขพัสดุเมื่อ Full Snapshot พร้อม
   - Insight: ไม่มีแบ็ก >24ชม., ผู้จัดการงานค้างสูงสุด, ปลายทาง >48 สูงสุด, อัตรามีแบ็ก

2. `พัสดุคงคลัง`
   - รายการพัสดุ
   - Live page 20/50/100 สำหรับข้อมูลสด
   - Full Snapshot ใช้เป็นมุมมองข้อมูลทั้งหมดแบบ client-side pagination เมื่อพร้อม

3. `สถานะพัสดุ`
   - กราฟการดำเนินการล่าสุด
   - กราฟ LH
   - กราฟ FD
   - รายการเลขพัสดุจาก Full Snapshot

4. `SLA & Backlog`
   - เกิน SLA 24 / 48 ชั่วโมง
   - `เกินเวลาแผน` จาก `plan_leave_time`
   - `ใกล้เวลาแผน` ภายใน 60 นาที
   - คัดลอกรายการพร้อมเลขพัสดุ

5. `น้ำหนักสาขา`
   - FD และ LH แยกกัน
   - จำนวนพัสดุ / น้ำหนักรวม / น้ำหนักเฉลี่ย

6. `ตรวจแบ็กกิ้ง`
   - จัดกลุ่ม `LH/FD -> เลขแบ็ก -> เลขพัสดุ`
   - ตรวจปลายทางปน / การดำเนินการปน / สถานะปน / เกินเวลาแผน / ไม่อัปเดต >6ชม.
   - คัดลอกต่อแบ็กหรือทั้งตัวกรองพร้อมเลขพัสดุ

## Waiting-time rule
- เวลาค้างทุกหน้าใช้ `LastActionTime` (เวลาที่ดำเนินการล่าสุด) เป็นจุดเริ่มต้น ไม่ใช้ `real_arrive_time` สำหรับอายุค้าง
- หน้ารายการ/SLA/Bagging แสดง live page ทันทีระหว่างรอ Full Snapshot และติดป้ายชัดเจนว่าไม่ใช่ทั้งคลัง
- Dropdown ทุกตัวเป็นแบบ persistent: เลือกค่าแล้วรายการยังเปิดอยู่ ปิดเมื่อกดปิด/Escape/เปิด dropdown อื่น/คลิกออกนอกกล่อง
- ตารางและกลุ่มสรุปหลักมีปุ่มคัดลอกตาราง

## Shared filters
ตัวกรองที่ใช้ร่วมกันในหน้าวิเคราะห์:
- ช่วงเวลา
- LH ปลายทาง
- FD ปลายทาง
- การดำเนินการล่าสุด
- ผู้จัดการสาขาแบบเต็ม `(Store ID)ชื่อสาขา · ชื่อผู้จัดการ · เบอร์โทร`

กติกา:
- LH ไม่รวม HUB ต้นทางที่กำลังเลือก
- FD คือสาขาปลายทางภายใต้ HUB ต้นทางที่เลือก
- ชื่อที่มี `(xxx)` / `（xxx）` ด้านหน้าตัด prefix เฉพาะตอนแสดงผลของปลายทาง; identity ผู้จัดการเก็บ Store ID ไว้เพื่อไม่รวมคน/สาขาผิดกลุ่ม
- เลือกช่วงเวลาครบทั้ง 9 ช่วงถือเป็น `ทั้งหมด`; รายการที่ไม่มีเวลาถึงจริงอยู่ในกลุ่มอายุไม่ทราบ

## Live cache
- ข้อมูลเปลี่ยน: TTL 8 วินาที
- เริ่มนิ่ง: 15 วินาที
- นิ่งต่อเนื่อง: 30 วินาที
- Hidden tab: 60 วินาที
- Summary: 60 วินาที
- ใช้ `content_hash`, `previous_hash`, `delta_payload`
- Browser อ่าน cache ก่อน แล้วมี browser เดียวที่ได้ atomic lease ไป refresh Edge/MS ต่อหนึ่ง branch/page key

## Full Analytics
เป้าหมายคือให้ Dashboard / Status / Weight / Bagging ใช้ยอดทั้งสาขาโดยไม่ไล่ MS ทีละ 100 แถวหลายร้อยหน้า

- ขอ MS ด้วย `page_size=5000` ก่อน
- ใช้จำนวนรายการที่ MS ส่งกลับจริงเป็น accepted source page size
- hard limit สูงสุด 30 MS source requests ต่อ Full Snapshot
- ถ้า MS cap จนต้องเกิน 30 หน้า ระบบหยุดและคืนสถานะ incomplete; ห้าม fallback ไปประมาณ 900 requests
- ถ้า `total` ของ MS เปลี่ยนระหว่าง scan จะคืน `source_changed` และไม่สร้าง partial snapshot
- Full Analytics ที่ครบ cache 30 นาที
- probe/incomplete cache 5 นาที
- หลาย browser ใช้ shared leader lease เดียวกัน
- Analytics schema v4 ใช้ full manager identity แทนการ aggregate เฉพาะเบอร์โทร

### Full-detail snapshot
- ไม่สร้างตาราง DB ใหม่
- reuse `live_cache_pages` ที่มี branch-aware RLS อยู่แล้ว
- cache key: `b:<branch>:snapshot:<snapshot-id>:p:<page>`
- เก็บเฉพาะ compact fields ที่หน้าเว็บใช้
- manager field ใน snapshot เก็บ full manager identity เพื่อให้ตัวกรอง/รายละเอียดตรงกับ aggregate
- เขียน cache เป็น batch ละ 3 หน้า
- ถ้าเขียน snapshot ไม่ครบ จะลบ partial snapshot ชุดนั้น
- browser โหลด raw Full Snapshot แบบ on-demand เฉพาะเมื่อต้องใช้เลขพัสดุ เช่น รายการเต็ม / Status detail / SLA / Bagging / Copy
- Dashboard ปกติอ่าน aggregate เท่านั้น เพื่อลด egress
- reader ตรวจ page count, item count และ final row count ก่อนประกาศว่า Full Snapshot พร้อม

## Quota safeguards
- ไม่มี cron scan หลายหมื่นรายการ
- Live refresh ไม่ดึง 90k ทุก 8–30 วินาที
- Full Analytics รอบยาว 30 นาทีเมื่อครบ
- hard cap 30 source requests ต่อ snapshot
- หลายเครื่องแชร์ cache/lease
- switching page, filtering, chart rendering, sorting และ grouping ทำใน browser
- raw full snapshot โหลดเฉพาะตอนต้องใช้รายละเอียดจริง

## Export fallback research
HAR ยืนยันว่า `unfinished_parcel_list?export=1` สร้างงานดาวน์โหลดแบบ async และ MS รุ่นใหม่มี Download Center task APIs แต่ HAR ปัจจุบันยังไม่มี payload/auth ของขั้น query/download ครบ จึงยังไม่ใช้เป็น production fallback จนกว่าจะยืนยัน flow จริงได้

## Authentication / multi-branch
- ไม่มี public signup
- Admin สร้าง Username + password
- รหัสผ่านขั้นต่ำ 6 ตัว
- หนึ่ง Username ใช้หลาย session/หลายเครื่องพร้อมกันได้
- Admin กำหนดสาขา เปิด/ปิดบัญชี เปลี่ยนรหัส และสิทธิ์อัปโหลด HAR
- ผู้ใช้ `can_upload_har` อัป HAR ได้เฉพาะสาขาของตัวเอง
- Store ID ไม่ต้องกรอกตอนสร้างสาขา; เติมอัตโนมัติจาก HAR

## Security
- Public Edge route มีเฉพาะ `/login`
- protected route ตรวจ Bearer token กับ Supabase Auth `/auth/v1/user`
- MS credential เข้ารหัส AES-GCM และไม่ส่งกลับ frontend
- service role ใช้เฉพาะ Edge
- RLS แยก branch สำหรับ cache
- HAR upload ตรวจ role/branch permission ฝั่ง Edge

## CI
GitHub Pages workflow ตรวจทุก commit:
- `node --check app.js`
- `node --check inspector.js`
- `node --check analytics-client.js`
- `node --check snapshot-client.js`
- `node --check ops.js`
- `node --check shell.js`
- `node --check data-model.js`
- `node --check auth-client.js`
- `node tests-data.mjs`
- `node tests-ui.mjs` (ผ่าน jsdom)
- `deno check supabase/functions/ms-parcel-api/index.ts`

## Repository boundary
- ใช้เฉพาะ `Flashdevnak/ms-parcel-live`
- `waiting-trucks-report` เป็นคนละระบบ ห้ามอ่าน แก้ไข commit หรือใช้เป็นฐานของโปรเจกต์นี้

- ตัวกรอง LH / FD / การดำเนินการล่าสุด / ผู้จัดการสาขา เป็น checkbox multi-select และเลือกหลายค่าได้; คอลัมน์ผู้จัดการสาขาเก็บค่าตาม source ครบแม้เป็น `()`, `(1)` หรือไม่มีชื่อ/เบอร์ โดยไม่ตัดทิ้ง


## Smart Leader v23 — 20 client-side upgrades (no extra quota)
1. จัดกึ่งกลาง KPI / การ์ด / ตาราง / สรุปหลัก
2. ป้องกันข้อความและปุ่มทับซ้อนด้วย responsive min-width/wrap guards
3. พัสดุบนมือถือเปลี่ยนเป็น 1 คอลัมน์เมื่อพื้นที่แคบ
4. Heatmap บนมือถือแปลงเป็นการ์ด ไม่บังคับเลื่อนซ้ายขวา
5. ทุกหน้ามีตัวเลือกช่วงเวลาเดียวกับ Dashboard
6. มี preset เวลา ทั้งหมด / <24 / 24–48 / >48 / >=24 / ไม่ทราบ
7. จำนวนแต่ละช่วงเวลาซิงก์กันทุกหน้า
8. Active filter chips บอกว่ากำลังกรองอะไร
9. แตะ chip เพื่อล้างตัวกรองมิตินั้นได้ทันที
10. Result ribbon บอกยอดหลังกรองชัดเจน
11. Leader / Hierarchy View แยก LH HUB และ FD สาขา
12. HUB ใคร HUB มัน / สาขาใครสาขามัน ไม่ปนกัน
13. ผู้จัดการถูกจัดอยู่ใต้ปลายทางของตัวเอง
14. Risk Score 0–100 ต่อปลายทาง คำนวณใน browser
15. Risk badge ปกติ / เฝ้าระวัง / เสี่ยงสูง / วิกฤต
16. Top 3 Hotspots อัตโนมัติจากข้อมูลที่โหลดแล้ว
17. ระบบแนะนำ Next Action ตาม >48ชม. / เลยเวลาแผน / ไม่มีแบ็ก
18. แสดงสัดส่วน % ของแต่ละปลายทางต่อชุดที่กรอง
19. Leader View เรียงได้ตามความเสี่ยง / จำนวน / น้ำหนัก และคัดลอก Leader Report ได้
20. สลับมุมมองกระชับ/สบายด้วย localStorage โดยไม่เรียก API เพิ่ม

โบนัส: ปุ่มกลับด้านบนแบบลอย และ mobile no-overlap hardening เพิ่มเติม ทั้งหมดใช้ analytics/snapshot ที่โหลดอยู่แล้ว ไม่มี polling/fetch ใหม่จากฟีเจอร์ชุดนี้
