# MS Parcel Live

MS Parcel Live เป็นเว็บสำหรับติดตามและวิเคราะห์งานพัสดุคงคลังแบบ read-only โดยใช้ GitHub Pages + Supabase Auth + Edge Function + shared cache และออกแบบให้รองรับหลาย HUB/Branch หลายผู้ใช้ และหลายอุปกรณ์ โดยคุมการใช้งานโควต้าแบบ Free-first

> เอกสารสาธารณะนี้ตั้งใจไม่เปิดเผย endpoint ภายในของบริษัท, schema/field mapping ภายใน, HAR/session details, credential structure, Store ID ภายใน, ข้อมูลบุคคล หรือรายละเอียดการเชื่อมต่อระบบต้นทาง

## Production

- Web: https://flashdevnak.github.io/ms-parcel-live/
- Authentication ผ่าน Supabase Auth
- Backend ใช้ Supabase Edge Function
- ระบบใช้ shared cache / snapshot / lease เพื่อลดการอ่านข้อมูลต้นทางซ้ำเมื่อมีหลายผู้ใช้หรือหลายอุปกรณ์

## Data handling

- ข้อมูลต้นทางเป็นข้อมูลภายในและเข้าถึงผ่าน backend เท่านั้น
- รายละเอียด endpoint, field mapping และรูปแบบ credential ไม่บันทึกไว้ใน public documentation
- Credential ของแต่ละ Branch แยกกันและเข้ารหัสก่อนเก็บ
- Frontend ไม่ได้รับ credential ต้นทาง
- ระบบไม่สร้างข้อมูลที่ต้นทางไม่ได้ยืนยัน

## Views

เว็บเป็น SPA เดียวเพื่อรักษา session/cache ระหว่างเปลี่ยนหน้า

1. `แดชบอร์ด`
   - ภาพรวมคงคลัง
   - ช่วงเวลา Aging
   - สรุป FD / LH / การดำเนินการล่าสุด
   - Drill-down และ Copy ตามสิทธิ์และความพร้อมของ snapshot

2. `พัสดุคงคลัง`
   - รายการพัสดุ
   - Live view และ Full Snapshot เมื่อพร้อม

3. `สถานะพัสดุ`
   - ภาพรวมการดำเนินการล่าสุด
   - FD / LH analysis

4. `SLA & Backlog`
   - Aging / SLA
   - งานใกล้ threshold
   - รายการสำหรับติดตาม

5. `น้ำหนักสาขา`
   - FD และ LH แยกกัน
   - จำนวนพัสดุ / น้ำหนักรวม / น้ำหนักเฉลี่ย

6. `ตรวจแบ็กกิ้ง`
   - จัดกลุ่มตามปลายทางและเลขแบ็กกิ้งที่พบ
   - Drill-down ถึงรายการพัสดุ
   - ตรวจข้อมูลผิดปกติจากข้อมูลที่ระบบมีจริง

## Operational principles

- ใช้ข้อมูลต้นทางจริงและ calculation ที่อธิบายได้
- ถ้าข้อมูลไม่ยืนยันสถานะ ระบบไม่ฟันธงเอง
- Full Snapshot ที่ไม่ครบจะไม่ถูกนำเสนอเป็นข้อมูลทั้งคลัง
- Trend / Compare / Residual ต้องอาศัย snapshot ที่ผ่าน integrity check
- Dashboard และ summary ใช้ aggregate/cache ให้มากที่สุด

## Shared filters

รองรับตัวกรองร่วม เช่น:

- ช่วงเวลา
- FD
- LH
- การดำเนินการล่าสุด
- ผู้จัดการสาขาตามข้อมูลที่ผู้ใช้มีสิทธิ์เห็น

## Cache / snapshot architecture

- หลาย browser ใน Branch เดียวกัน reuse shared cache/lease
- Full-detail โหลดแบบ on-demand เฉพาะเมื่อจำเป็น
- Dashboard ปกติอ่าน aggregate ก่อน
- การเปลี่ยนหน้า, filter, sort และ grouping ไม่ควรสร้างการอ่าน source ใหม่โดยไม่จำเป็น
- Incomplete snapshot ไม่ถูกประกาศเป็น complete

## Multi-branch

- Branch แยก credential และ cache ออกจากกัน
- ผู้ใช้เห็นเฉพาะ Branch ที่ได้รับสิทธิ์
- Admin จัดการ Branch/ผู้ใช้ตาม permission
- หลายอุปกรณ์ใน Branch เดียวกันต้อง reuse backend result ให้มากที่สุด ไม่สร้าง full source scan ต่ออุปกรณ์

## Quota safeguards

- ไม่มี full historical mirror ของข้อมูลพัสดุทั้งหมด
- ไม่สร้าง polling แยกต่อ widget โดยไม่จำเป็น
- ไม่สร้าง source scan ต่อผู้ใช้แต่ละคนเมื่อสามารถใช้ shared result ได้
- Full-detail ใช้ TTL และโหลดเฉพาะเมื่อจำเป็น
- Historical intelligence ใช้ aggregate/delta ก่อน full rows

## Authentication / security

- ไม่มี public signup
- ผู้ใช้ถูกสร้างและกำหนดสิทธิ์โดยผู้ดูแลระบบ
- รองรับหลาย session/หลายอุปกรณ์ตามสิทธิ์
- Credential ต้นทางเข้ารหัสและไม่ส่งกลับ frontend
- Branch isolation บังคับใช้ทั้ง backend และฐานข้อมูล
- รายละเอียด endpoint/credential ภายในไม่ควรถูกเพิ่มกลับเข้ามาใน README หรือเอกสาร public

## CI

GitHub workflow ตรวจ syntax, automated tests และ Edge typecheck ก่อน deploy ตาม checkpoint gate ของโปรเจกต์

## Repository boundary

- ใช้เฉพาะ `Flashdevnak/ms-parcel-live`
- โปรเจกต์อื่นเป็นคนละระบบและห้ามใช้เป็นฐานหรือแก้ไขร่วมกัน

## Documentation security rule

ห้าม commit ข้อมูลต่อไปนี้ลง public documentation:

- internal company endpoint / hostname / API path
- HAR payload หรือ session detail
- auth token / cookie / credential
- internal Store ID หรือข้อมูลระบุตัวบุคคลจริง
- source field mapping ที่เปิดเผยโครงสร้างระบบภายในโดยไม่จำเป็น
- screenshot/log ที่มีข้อมูลบริษัทหรือข้อมูลผู้ใช้จริง

รายละเอียดเชิง implementation ที่จำเป็นต่อการทำงานให้เก็บใน source/config ที่เหมาะสมและจำกัดการเข้าถึงตาม security model ของระบบ
