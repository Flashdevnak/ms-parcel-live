from pathlib import Path

p = Path('app.js')
s = p.read_text(encoding='utf-8')
old = r"return /\\bms\\s*(401|403)\\b|unauthori[sz]ed|forbidden|auth(?:entication)?\\s*(?:expired|invalid|fail)|session\\s*(?:expired|invalid)|token\\s*(?:expired|invalid)|cookie\\s*(?:expired|invalid)|credential\\s*(?:expired|invalid)|login\\s*(?:expired|required)|หมดอายุ|เข้าสู่ระบบใหม่|ไม่อนุญาตให้อ่านข้อมูล/.test(text);"
new = r"return /\bms\s*(401|403)\b|unauthori[sz]ed|forbidden|auth(?:entication)?\s*(?:expired|invalid|fail)|session\s*(?:expired|invalid)|token\s*(?:expired|invalid)|cookie\s*(?:expired|invalid)|credential\s*(?:expired|invalid)|login\s*(?:expired|required)|หมดอายุ|เข้าสู่ระบบใหม่|ไม่อนุญาตให้อ่านข้อมูล/.test(text);"
if old not in s:
    raise SystemExit('HAR matcher anchor not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
