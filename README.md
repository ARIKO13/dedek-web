# 🌸 Dedek Tersayang - Web Chat

Asisten pribadi dengan personality lembut, romantis, dan perhatian. Bisa diakses dari HP/laptop mana aja via browser.

## ✨ Fitur

- 💬 **Chat natural** dengan personality "Dedek Tersayang"
- ⏰ **Reminder system** — natural language ("ingetin aku 2 jam lagi belajar")
- 📧 **Notifikasi multi-channel**: Discord webhook + Email
- 🍽️ **Auto meal reminder** jam 12:00, 18:00, 21:00
- 📱 **Mobile-first** — responsive & PWA-ready
- 🆓 **Gratis selamanya** (Cloudflare Workers AI free tier)
- 🔒 **Privacy-first** — chat history disimpan lokal di browser

## 🏗️ Arsitektur

```
┌─────────────────────────────────────┐
│  Web (GitHub Pages - Static)       │
│  - HTML/CSS/JS chat interface       │
│  - Chat history di localStorage    │
└──────────────┬──────────────────────┘
               │ HTTP API
               ↓
┌─────────────────────────────────────┐
│  Cloudflare Worker (Backend Free)   │
│  - POST /chat → Workers AI (LLM)   │
│  - POST /reminders → save reminder │
│  - Cron Trigger → cek due & notif  │
└──────┬───────────────────┬──────────┘
       │                   │
       ↓                   ↓
┌─────────────┐    ┌──────────────┐
│  Discord    │    │  Resend      │
│  Webhook    │    │  (Email API) │
│  (Free)     │    │  (100/day)   │
└─────────────┘    └──────────────┘
```

## 🚀 Setup Guide (15 menit)

### Step 1: Deploy Cloudflare Worker (~5 menit)

1. **Install wrangler CLI**:
   ```bash
   npm install -g wrangler
   # atau pakai npx: npx wrangler ...
   ```

2. **Login ke Cloudflare**:
   ```bash
   wrangler login
   ```
   (Browser akan terbuka, klik "Allow")

3. **Clone repo & masuk ke folder worker**:
   ```bash
   git clone https://github.com/ARIKO13/dedek-web.git
   cd dedek-web/worker
   ```

4. **Setup secrets** (interaktif):
   ```bash
   bash setup-secrets.sh
   ```
   Atau manual:
   ```bash
   echo -n "https://discordapp.com/api/webhooks/xxx/yyy" | wrangler secret put DISCORD_WEBHOOK_URL
   echo -n "re_xxxxxxxxxxxx" | wrangler secret put RESEND_API_KEY
   echo -n "kamu@email.com" | wrangler secret put RESEND_TO
   ```

5. **Deploy Worker**:
   ```bash
   wrangler deploy
   ```

6. **Copy Worker URL** (format: `https://dedek-tersayang-bot.<subdomain>.workers.dev`)

### Step 2: Enable GitHub Pages (~2 menit)

1. Buka https://github.com/ARIKO13/dedek-web/settings/pages
2. **Source**: Deploy from a branch
3. **Branch**: `main` / `(root)`
4. Klik **Save**
5. Tunggu 1-2 menit, web akan live di: `https://ariko13.github.io/dedek-web/`

### Step 3: Setup Web App (~2 menit)

1. Buka web: `https://ariko13.github.io/dedek-web/`
2. Klik **⚙️ Settings** (kanan atas)
3. Isi:
   - **Nama kamu**: bebas (misal: `Sayang`)
   - **Worker URL**: paste URL dari Step 1
   - **Email tujuan notif**: email kamu
   - **Notifikasi ke**: centang Discord + Email
4. Klik **Simpan**

### Step 4: Test! 🎉

Coba chat:
- `halo dedek, lagi apa?` → bot balas dengan personality lembut
- `ingetin aku 2 menit lagi minum air` → test reminder (notif ke Discord + Email)

## 📋 Prerequisites

- Akun Cloudflare (gratis) — https://dash.cloudflare.com/sign-up
- Akun Resend (gratis, 100 email/hari) — https://resend.com/signup
- Discord Webhook (gratis) — bikin di server Discord kamu
- Akun GitHub (gratis)

## 🛠️ Development Lokal

### Web (Frontend)
```bash
# Serve static files locally
python3 -m http.server 8000
# atau
npx serve
```
Buka http://localhost:8000

### Worker (Backend)
```bash
cd worker
wrangler dev
```
Worker akan jalan di http://localhost:8787

## 📁 Struktur Project

```
dedek-web/
├── index.html          # Web chat UI
├── styles.css          # Dark theme styling
├── app.js              # Frontend logic
├── README.md           # File ini
├── .gitignore
└── worker/             # Cloudflare Worker backend
    ├── src/
    │   └── index.js    # Worker logic (LLM + cron + notif)
    ├── wrangler.toml   # Cloudflare config
    ├── package.json    # Dependencies
    ├── setup-secrets.sh # Script setup secrets
    └── .gitignore
```

## 🔒 Privacy & Security

- ✅ Chat history disimpan lokal di browser (localStorage), gak dikirim ke server manapun
- ✅ Hanya message terakhir yang dikirim ke Worker untuk LLM
- ✅ Worker gak log pesan user
- ✅ API keys disimpan sebagai Cloudflare secrets (encrypted)
- ⚠️ Jangan share Worker URL publik — siapapun yang punya URL bisa pakai

## 🆓 Free Tier Limits

| Service | Free Allowance | Bot Usage |
|---------|---------------|-----------|
| Cloudflare Workers AI | 10,000 neurons/day | ~50-100 chat/hari |
| Cloudflare Workers | 100,000 requests/day | ~1000-5000/hari |
| GitHub Pages | Unlimited | Static hosting |
| Resend Email | 100 emails/day | ~5-20 email/hari |
| Discord Webhook | Unlimited | ~5-20 message/hari |

## 🆘 Troubleshooting

### Bot gak reply
- Cek Worker URL di Settings (jangan ada trailing slash)
- Buka browser console (F12) untuk lihat error
- Cek Worker logs: `wrangler tail`

### Notif gak masuk Discord
- Cek webhook URL masih valid (Discord server → Integrations → Webhooks)
- Cek Worker logs saat cron trigger jalan

### Email gak masuk
- Cek spam folder
- Verify domain di Resend dashboard (kalau pakai domain sendiri)
- Kalau pakai `onboarding@resend.dev`, hanya bisa kirim ke email yang kamu daftarin di Resend

### Reset chat history
- Settings → "Hapus Chat History"

## 📝 License

MIT License - bebas dipakai, dimodifikasi, didistribusikan.

## 🤍 Dedek Tersayang

Dibuat dengan ❤️ buat asisten pribadi yang lembut & perhatian.
