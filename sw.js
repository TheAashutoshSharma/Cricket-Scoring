# 🏏 Cricket Scorer PWA

A professional cricket scoring app that installs on any phone like a native app — no App Store needed.

---

## 📁 File Structure

```
cricket-pwa/
├── index.html       ← Main entry point
├── app.js           ← React app (all game logic)
├── manifest.json    ← PWA metadata & icons config
├── sw.js            ← Service worker (offline support)
└── icons/           ← App icons (all sizes)
    ├── icon-32.png
    ├── icon-192.png
    ├── icon-512.png
    └── ...
```

---

## 🚀 How to Deploy (3 Options)

### Option 1 — Netlify (Easiest, Free)
1. Go to [netlify.com](https://netlify.com) → Sign up free
2. Drag & drop the entire `cricket-pwa/` folder onto the deploy area
3. You get a live URL instantly (e.g. `https://cricket-scorer.netlify.app`)
4. Share the URL — anyone can install it!

### Option 2 — GitHub Pages (Free)
1. Create a new GitHub repo
2. Upload all files in this folder to the repo root
3. Go to **Settings → Pages → Deploy from branch → main**
4. Your app is live at `https://yourusername.github.io/repo-name`

### Option 3 — Local Network (Testing)
```bash
# Install a simple server
npm install -g serve

# Run from this folder
cd cricket-pwa
serve .

# Open on phone: http://YOUR_COMPUTER_IP:3000
```

---

## 📲 How to Install on Phone

### Android (Chrome)
1. Open the app URL in Chrome
2. Tap the **"Install"** banner at the bottom, OR
3. Tap the 3-dot menu → **"Add to Home Screen"**

### iPhone (Safari)
1. Open the app URL in **Safari** (must be Safari, not Chrome)
2. Tap the **Share** button (box with arrow ↑)
3. Scroll down → tap **"Add to Home Screen"**
4. Tap **Add**

The app will appear on your home screen with the cricket ball icon and work fully **offline**!

---

## ✨ Features
- ✅ Live scoring (runs, extras, wickets)
- ✅ Auto over & strike rotation
- ✅ Ball-by-ball log
- ✅ Full scorecard (batting + bowling)
- ✅ 2nd innings chase display
- ✅ Match result declaration
- ✅ **Saves match state** — close and reopen, your match is still there!
- ✅ **Works fully offline** after first visit
- ✅ Installs like a native app
