#!/bin/bash
# Setup secrets untuk Cloudflare Worker
# Jalankan: bash setup-secrets.sh

set -e

echo "🌸 Setup Secrets untuk Dedek Tersayang Worker"
echo "============================================="
echo

# Check wrangler installed
if ! command -v wrangler &> /dev/null; then
    echo "❌ wrangler belum terinstall"
    echo "   Install dengan: npm install -g wrangler"
    echo "   Atau pakai npx: npx wrangler ..."
    exit 1
fi

# Check login
if ! wrangler whoami &> /dev/null; then
    echo "🔐 Belum login. Buka browser untuk login..."
    wrangler login
fi

echo
echo "📋 Akan setup secrets berikut:"
echo "  1. DISCORD_WEBHOOK_URL"
echo "  2. RESEND_API_KEY"
echo "  3. RESEND_TO (email tujuan)"
echo "  4. RESEND_FROM (email sender - optional)"
echo
read -p "Lanjut? (y/N) " confirm
if [[ $confirm != [yY] ]]; then
    echo "❌ Dibatalkan"
    exit 0
fi

echo
echo "📝 Input Discord Webhook URL:"
echo "   (contoh: https://discordapp.com/api/webhooks/xxx/yyy)"
read -p "   > " discord_webhook

echo
echo "📝 Input Resend API Key:"
echo "   (contoh: re_xxxxxxxxxxxx)"
read -p "   > " resend_key

echo
echo "📝 Input email tujuan (untuk nerima notif):"
read -p "   > " email_to

echo
echo "📝 Input email sender (optional, enter untuk pakai default onboarding@resend.dev):"
echo "   Kalau punya domain sendiri yang udah diverify di Resend,"
echo "   format: 'Dedek <dedek@yourdomain.com>'"
read -p "   > " email_from

echo
echo "⏳ Setting secrets..."
cd "$(dirname "$0")"

echo -n "$discord_webhook" | wrangler secret put DISCORD_WEBHOOK_URL
echo -n "$resend_key" | wrangler secret put RESEND_API_KEY
echo -n "$email_to" | wrangler secret put RESEND_TO

if [[ -n "$email_from" ]]; then
    echo -n "$email_from" | wrangler secret put RESEND_FROM
fi

echo
echo "✅ Semua secrets udah diset!"
echo
echo "🚀 Sekarang deploy:"
echo "   wrangler deploy"
echo
echo "📋 Setelah deploy, copy Worker URL (https://dedek-tersayang-bot.<subdomain>.workers.dev)"
echo "   Lalu paste ke web app di Settings → Worker URL"
