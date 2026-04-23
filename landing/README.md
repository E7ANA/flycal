# logiclass — Landing Page

אתר נחיתה סטטי (HTML/CSS/JS טהור, ללא build step) עבור מערכת logiclass.

## מה יש כאן

- `index.html` — הדף הראשי
- `styles.css` — עיצוב (פלטת logiclass, Montserrat)
- `script.js` — אנימציות (סולבר חי, ספירת סטטיסטיקות, סליידרים)
- `logiclass.svg` — לוגו
- `render.yaml` / `netlify.toml` / `vercel.json` — קונפיגורציה לפריסה

## ריצה מקומית

```bash
# אופציה 1: npm
npm start

# אופציה 2: Python
python3 -m http.server 3000

# אופציה 3: npx ישירות
npx serve -s . -l 3000
```

פתח: http://localhost:3000

## פריסה

### Render (מומלץ)
1. צור ריפו חדש ב-GitHub עם תוכן התיקיה הזו
2. ב-Render: New → Static Site → Connect Repository
3. הגדרות:
   - **Build Command**: `echo "Static site"` (או ריק)
   - **Publish Directory**: `.`
4. ה-`render.yaml` ייקרא אוטומטית ויגדיר rewrites ו-caching

### Netlify
1. גרור את התיקיה ל-https://app.netlify.com/drop
2. או התחבר לגיט: `netlify deploy`

### Vercel
```bash
npx vercel
```

### GitHub Pages
הוסף ל-`.github/workflows/pages.yml`:
```yaml
name: Deploy to Pages
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v4
      - uses: actions/upload-pages-artifact@v3
        with: { path: . }
      - uses: actions/deploy-pages@v4
```

## דומיין מותאם

1. רכוש דומיין (למשל `logiclass.co.il`)
2. ב-Render/Netlify/Vercel: Settings → Custom Domain → הוסף
3. עדכן DNS לפי ההוראות של הספק
4. עדכן את `og:url` ו-`og:image` ב-`index.html` לכתובת המלאה

## עדכון תוכן

- **טקסטים**: `index.html`
- **צבעים/עיצוב**: `styles.css` (משתני CSS ב-`:root`)
- **אנימציה של הסולבר**: `script.js` (מערך `SCHEDULE`)
- **OG Image** (לווטצאפ): עדכן `og:image` ב-`<head>` + העלה תמונה בגודל 1200×630
