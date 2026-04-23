# 🎬 logiclass — Promo Animation לווטסאפ סטטוס

אנימציה אוטומטית בפורמט 9:16 (1080×1920) עם 6 סצנות + צליל רקע פרוצדורלי —
מוכנה להקלטה כ-MP4 ושיתוף לסטטוס ווטסאפ / סטורי אינסטגרם / TikTok.

## ⏱ משך האנימציה

22 שניות לולאה מלאה:
1. **Logo intro** (3 שנ') — לוגו + שם + tagline
2. **Problem** (3 שנ') — "3 שבועות של עבודה?"
3. **AI Solver** (6 שנ') — רשת מתמלאת בזמן אמת + ציון עולה
4. **Constraints** (3.5 שנ') — 9 צ'יפים של אילוצים מופיעים
5. **Result** (3 שנ') — "8h במקום 3 שבועות" + סטטיסטיקות
6. **CTA** (3.5 שנ') — "שעות, לא שבועות" + logiclass.co.il

## 🎵 צליל

צליל הרקע נוצר **פרוצדורלית** עם Web Audio API — אין צורך בקובץ mp3.
- Ambient pad (סיינוס 110Hz)
- Bass פועם כל 2 שניות
- מלודיה עדינה שמלווה את מילוי המערכת

תוכל לשלוט בו עם הכפתור **🔇 הפעל צליל** (יש לאשר פעם אחת — דפדפנים חוסמים audio autoplay).

## 🎬 איך להקליט ל-MP4 (macOS)

### אופציה 1: QuickTime (הכי פשוט)

1. פתח את `promo/index.html` בדפדפן
2. לחץ **F11** (fullscreen) או החזק Cmd+Ctrl+F
3. QuickTime → **File → New Screen Recording**
4. לחץ **⌥** ליד כפתור ההקלטה → **Internal Microphone** *(אם רוצה את הצליל)*
5. גרור מסגרת על הסטייג' (או הקלט fullscreen)
6. חזור לדפדפן → לחץ **▶ התחל** + **🔊 צליל פועל**
7. המתן 22 שניות → עצור הקלטה → שמור כ-MP4

### אופציה 2: Chrome DevTools (ללא צליל, אבל מדויק)

1. פתח DevTools → ⋮ → **More tools → Rendering**
2. הדלק **"Capture screenshot sequence"** במצב פיתוח
3. השתמש בתוסף כמו **Screencastify** או **Loom**

### אופציה 3: ffmpeg (מתקדם)

אם מותקן ffmpeg ומקליט עם QuickTime לתיקייה `~/Movies`:
```bash
cd ~/Movies
ffmpeg -i "Screen Recording*.mov" -vf "scale=1080:1920,setsar=1" -c:v libx264 -crf 20 -c:a aac -b:a 128k logiclass-promo.mp4
```

## 📱 העלאה לווטסאפ

1. AirDrop את ה-MP4 לטלפון
2. WhatsApp → הוספת סטטוס → גלריה → בחר את הווידאו
3. ווטסאפ חותך ל-30 שנ' — האנימציה 22 שנ' אז זה מושלם

## 🎨 התאמות

- **משך כל סצנה** — שנה ב-`TIMINGS` ב-JavaScript
- **צבעים** — שנה ב-CSS `:root` (תואם לאתר הנחיתה)
- **טקסטים** — ערוך את ה-HTML ישירות
- **מוזיקה אחרת** — החלף את `startAudio()` בהשמעה של קובץ mp3:
  ```javascript
  const audio = new Audio("/music.mp3");
  audio.loop = true;
  audio.play();
  ```
  (הוסף קובץ mp3 royalty-free מ-[Pixabay Music](https://pixabay.com/music/) או [YouTube Audio Library](https://studio.youtube.com))

## 🎼 מוזיקת רקע מומלצת (חינם)

אם תרצה מוזיקה מוקלטת במקום הצליל הפרוצדורלי:
- **Pixabay**: [pixabay.com/music](https://pixabay.com/music/search/corporate%20minimal/) — חפש "corporate uplifting" / "tech intro"
- **YouTube Audio Library**: חפש "optimistic tech"
- **Uppbeat**: [uppbeat.io](https://uppbeat.io/) — תחת "Corporate" / "Tech"

אורך רצוי: 22 שנ' (או לחתוך לוליאה).
