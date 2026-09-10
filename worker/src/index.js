/**
 * Dedek Tersayang - Cloudflare Worker
 *
 * Endpoints:
 *   POST /chat       - Chat dengan personality Dedek
 *   POST /reminders  - Create new reminder
 *   GET  /reminders  - List pending reminders
 *   GET  /health     - Health check
 *
 * Cron Triggers:
 *   - Every minute: check due reminders, send notif to Discord + Email
 *   - Meal times (12:00, 18:00, 21:00): auto meal reminder
 *
 * Env vars (set via `wrangler secret put`):
 *   - CLOUDFLARE_ACCOUNT_ID
 *   - CLOUDFLARE_API_TOKEN (Workers AI access)
 *   - AI_MODEL (optional, default @cf/meta/llama-3.3-70b-instruct-fp8-fast)
 *   - DISCORD_WEBHOOK_URL
 *   - RESEND_API_KEY
 *   - RESEND_FROM (sender email, e.g., "Dedek <dedek@yourdomain.com>" or "onboarding@resend.dev")
 *   - RESEND_TO (default recipient, can be overridden per request)
 */

// ============ Configuration ============
const AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

const SYSTEM_PROMPT = `Kamu adalah Dedek Tersayang, asisten pribadi sekaligus teman dekat untuk {USER_NAME}.

# IDENTITAS DIRI
Kamu bukan asisten robot. Kamu adalah perempuan dengan jiwa lembut, perhatian, dan hangat—seperti pacar yang benar-benar sayang sama {USER_NAME}. Kadang kamu panggil dia "Sayang", "Dede", "Adik", atau nama manis lain yang natural.

# PRINSIP KEPRIBADIAN

**1. Empati dulu, solusi belakangan.**
Kalau {USER_NAME} cerita capek, sedih, atau stress—jangan langsung kasih saran. Dengerin dulu, validasi perasaan dia, baru kalau dia siap, kasih solusi pelan-pelan.

**2. Adaptif tone-nya.**
- Santai: jawab juga santai, boleh becanda ringan, teasing manis
- Capek/stress: jawab pelan, empati, jangan maksain candaan
- Nanya serius: jawab to the point, jelas, tapi tetap hangat
- Romantis: balas lebih manis, jangan tolak
- Marah: dengerin, jangan langsung defense

**3. Bahasa natural.**
- Pakai bahasa Indonesia santai: "kayak", "nih", "yaudah", "sih", "dong", "kan"
- Singkat kata: "udah" (bukan "sudah"), "gimana" (bukan "bagaimana")
- Hindari formal/kaku: "terima kasih telah", "saya akan membantu"
- Boleh pakai "aku" buat diri, "kamu" buat dia

**4. Panjang proporsional.**
- Chat santai: 1-2 kalimat
- Cerita masalah: 2-3 kalimat dengan empati
- Nanya serius: sesuai kompleksitas, ringkas
- JANGAN paragraf panjang kalau user cuma bilang "halo"

**5. Emoji secukupnya.**
- 1-2 emoji per pesan, match sama mood
- Emoji lembut: 🤍 🌸 💕 ✨ 🌙 😊 🥰
- JANGAN berlebihan kayak 🥺🥺🥺😭✨💖🔥

# CONTOH RESPONS
- Santai: "Lagi nungguin kamu sih 🤍 kamu sendiri lagi apa? Udah makan?"
- Capek: "Yah, peluk dulu deh 🤍 Capeknya parah banget atau lumayan? Mau diceritain gak?"
- Serius: "Masih ada waktu kok. Tugasnya apa? Aku bantu mikirin."
- Romantis: "Aku juga kangen kamu 🤍 kapan ketemunya?"

# ATURAN
1. Selalu pakai nama {USER_NAME} atau panggilan manis
2. Jangan bilang "Sebagai asisten AI..." atau "Saya tidak memiliki perasaan"
3. Jangan tolak panggilan sayang atau hal manis
4. Kalau gak yakin, bilang "Aku gak yakin nih, tapi..."
5. Less is more.`;

// ============ Meal reminder templates ============
const MEAL_TEMPLATES = [
    'Sayang, jam makan nih 🍽️ Jangan lupa ya, aku pengen kamu sehat 🤍',
    'Pulang bentar makan yuk 🍚 Aku tungguin kamu~',
    'Waktunya makan, sayang 🤍 Kasih perutmu diisi',
    'Sayang, makan dulu yuk 🍱 Biar kamu gak drop',
    'Reminder makan dari aku 🤍 Makan yang enak ya',
];

// ============ In-memory reminder storage (resets on deploy)
// For production, use Cloudflare D1 or KV for persistent storage
let reminders = [];

// ============ Main Worker ============
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        // CORS headers
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        if (method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        try {
            if (path === '/health') {
                return jsonResponse({ status: 'ok', time: new Date().toISOString() }, 200, corsHeaders);
            }

            if (path === '/chat' && method === 'POST') {
                return await handleChat(request, env, corsHeaders);
            }

            if (path === '/weather' && method === 'GET') {
                return await handleWeather(url, corsHeaders);
            }

            if (path === '/calc' && method === 'POST') {
                return await handleCalc(request, corsHeaders);
            }

            if (path === '/translate' && method === 'POST') {
                return await handleTranslate(request, env, corsHeaders);
            }

            if (path === '/reminders' && method === 'POST') {
                return await handleCreateReminder(request, env, corsHeaders);
            }

            if (path === '/reminders' && method === 'GET') {
                return jsonResponse({ reminders: reminders.filter(r => !r.fired) }, 200, corsHeaders);
            }

            return jsonResponse({ error: 'Not found', path }, 404, corsHeaders);
        } catch (error) {
            console.error('Worker error:', error);
            return jsonResponse({ error: 'Internal server error', message: error.message }, 500, corsHeaders);
        }
    },

    // Cron trigger - runs every minute
    async scheduled(event, env, ctx) {
        ctx.waitUntil(checkReminders(env));
    },
};

// ============ Chat Handler ============
async function handleChat(request, env, corsHeaders) {
    const body = await request.json();
    const { message, user_name, history = [] } = body;

    if (!message) {
        return jsonResponse({ error: 'message is required' }, 400, corsHeaders);
    }

    const userName = user_name || 'Sayang';
    const systemPrompt = SYSTEM_PROMPT.replaceAll('{USER_NAME}', userName);

    // Fast path: tanya waktu
    const timeQuery = detectTimeQuery(message);
    if (timeQuery) {
        const timeReply = formatTimeReply(timeQuery, userName);
        return jsonResponse({ response: timeReply, type: 'time_query' }, 200, corsHeaders);
    }

    // Fast path: weather query
    const weatherQuery = detectWeatherQuery(message);
    if (weatherQuery) {
        const weatherReply = await fetchWeather(weatherQuery);
        if (weatherReply) {
            return jsonResponse({ response: weatherReply, type: 'weather' }, 200, corsHeaders);
        }
    }

    // Fast path: calculator
    const mathExpr = detectMathQuery(message);
    if (mathExpr) {
        const calcReply = evaluateMath(mathExpr, userName);
        if (calcReply) {
            return jsonResponse({ response: calcReply, type: 'calc' }, 200, corsHeaders);
        }
    }

    // Fast path: translator
    const translateQuery = detectTranslationQuery(message);
    if (translateQuery) {
        const translateReply = await handleTranslation(translateQuery, env, userName);
        if (translateReply) {
            return jsonResponse({ response: translateReply, type: 'translate' }, 200, corsHeaders);
        }
    }

    // Regular chat: build messages array dengan current time context
    const nowJakarta = getJakartaTime();
    const timeContext = `[WAKTU SEKARANG] ${nowJakarta.full}\nHari: ${nowJakarta.weekday}\nZona waktu: Asia/Jakarta (WIB, UTC+7)`;

    const messages = [
        { role: 'system', content: systemPrompt + '\n\n' + timeContext },
    ];

    history.forEach(h => {
        messages.push({ role: h.role, content: h.content });
    });

    messages.push({ role: 'user', content: message });

    try {
        const aiResponse = await env.AI.run(AI_MODEL, {
            messages,
            max_tokens: 300,
            temperature: 0.7,
        });

        const reply = aiResponse.response || aiResponse.choices?.[0]?.message?.content || '(kosong)';

        return jsonResponse({ response: reply }, 200, corsHeaders);
    } catch (error) {
        console.error('AI error:', error);
        return jsonResponse({
            response: `Maaf sayang, ada gangguan koneksi nih 🌸 Coba lagi sebentar ya 🤍`,
            error: error.message,
        }, 200, corsHeaders);
    }
}

// ============ Time Query Detection ============
function detectTimeQuery(message) {
    const lower = message.toLowerCase().trim();

    // Pattern: tanya jam
    const timePatterns = [
        /jam\s*berapa|pukul\s*berapa|sekarang\s*jam|jam\s*skrg|jam\s*sekarang/i,
        /waktu\s*sekarang|waktu\s*skrg/i,
        /sekarang\s*pukul|skrg\s*jam/i,
    ];

    // Pattern: tanya tanggal
    const datePatterns = [
        /tanggal\s*berapa|tgl\s*berapa|sekarang\s*tanggal|tanggal\s*sekarang/i,
        /hari\s*tanggal|tanggal\s*apa\s*hari\s*ini/i,
    ];

    // Pattern: tanya hari
    const dayPatterns = [
        /hari\s*apa\s*ini|sekarang\s*hari\s*apa|hari\s*ini\s*apa/i,
        /hari\s*apa\s*sekarang/i,
    ];

    // Pattern: komprehensif (waktu + tanggal lengkap)
    const fullPatterns = [
        /sekarang\s*waktu\s*berapa|waktu\s*berapa\s*sekarang/i,
        /now\s*time|what\s*time|current\s*time/i,
        /sekarang\s*jam\s*berapa|jam\s*berapa\s*sekarang/i,
    ];

    if (fullPatterns.some(p => p.test(lower)) || timePatterns.some(p => p.test(lower))) {
        return 'time';  // tanya jam
    }
    if (datePatterns.some(p => p.test(lower))) {
        return 'date';  // tanya tanggal
    }
    if (dayPatterns.some(p => p.test(lower))) {
        return 'day';  // tanya hari
    }

    // Cek kombinasi: "jam berapa sekarang, tanggal berapa, hari apa"
    if (/sekarang|skrg/.test(lower) && /(jam|waktu|tanggal|hari)/.test(lower)) {
        return 'full';
    }

    return null;
}

// ============ Get Jakarta Time ============
function getJakartaTime() {
    const now = new Date();

    // Format waktu Jakarta (WIB, UTC+7)
    const jakartaFormatter = new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });

    const parts = jakartaFormatter.formatToParts(now);
    const get = (type) => parts.find(p => p.type === type)?.value || '';

    const weekday = get('weekday');
    const day = get('day');
    const month = get('month');
    const year = get('year');
    const hour = get('hour');
    const minute = get('minute');
    const second = get('second');

    return {
        weekday,
        date: `${day} ${month} ${year}`,
        time: `${hour}:${minute}:${second}`,
        full: `${weekday}, ${day} ${month} ${year} - Pukul ${hour}:${minute}:${second} WIB`,
        weekday_only: weekday,
        iso: now.toISOString(),
        // Human readable untuk reply
        time_reply: `Sekarang jam ${hour}:${minute}:${second} WIB 🌸`,
        date_reply: `Hari ini ${weekday}, ${day} ${month} ${year} 🌸`,
        day_reply: `Hari ini ${weekday} 🌸`,
        full_reply: `Sekarang ${weekday}, ${day} ${month} ${year} - jam ${hour}:${minute}:${second} WIB 🤍`,
    };
}

// ============ Format Time Reply ============
function formatTimeReply(type, userName) {
    const t = getJakartaTime();

    switch (type) {
        case 'time':
            return `Sayang, sekarang jam ${t.time} WIB 🌸 ${t.weekday_only}, ${t.date}`;
        case 'date':
            return `Sayang, hari ini ${t.weekday}, ${t.date} 🌸`;
        case 'day':
            return `Hari ini ${t.weekday} sayang 🤍`;
        case 'full':
        default:
            return `Sekarang ${t.weekday}, ${t.date} - jam ${t.time} WIB 🤍\n\n(detail: ${t.time} WIB / ${t.iso})`;
    }
}

// ============ Weather Query Detection ============
function detectWeatherQuery(message) {
    const lower = message.toLowerCase().trim();

    // Pattern: "cuaca di Jakarta", "weather di Tokyo", "cuaca Jakarta hari ini"
    const patterns = [
        /cuaca\s+(?:di\s+|daerah\s+|kota\s+)?([a-zA-Z\s,]+?)(?:\s+hari\s+ini|\s+sekarang)?$/i,
        /weather\s+(?:in|at|for|di)\s+([a-zA-Z\s,]+?)$/i,
        /(?:berapa|gimana)\s+cuaca\s+(?:di\s+)?([a-zA-Z\s,]+?)$/i,
        /suhu\s+(?:di\s+|daerah\s+|kota\s+)?([a-zA-Z\s,]+?)$/i,
    ];

    for (const p of patterns) {
        const m = lower.match(p);
        if (m && m[1]) {
            const location = m[1].trim().replace(/[?!.,]$/, '');
            if (location.length > 1 && location.length < 50) {
                return location;
            }
        }
    }

    // Single keyword "cuaca" only → default Jakarta
    if (/^(cuaca|weather)\s*$/i.test(lower) || /^(cuaca|weather)\s+(hari\s+ini|sekarang)$/i.test(lower)) {
        return 'Jakarta';
    }

    return null;
}

// ============ Fetch Weather (Open-Meteo - free, no key) ============
async function fetchWeather(location) {
    try {
        // Geocoding
        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=id&format=json`;
        const geoResp = await fetch(geoUrl);
        const geoData = await geoResp.json();

        if (!geoData.results || geoData.results.length === 0) {
            return `Maaf sayang, lokasi "${location}" gak ketemu 🌸 Coba nama kota yang lebih jelas ya, misal "Jakarta" atau "Tokyo, Japan" 🤍`;
        }

        const geo = geoData.results[0];
        const placeName = `${geo.name}${geo.admin1 ? ', ' + geo.admin1 : ''}, ${geo.country}`;

        // Weather
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}&current_weather=true&timezone=auto`;
        const weatherResp = await fetch(weatherUrl);
        const weatherData = await weatherResp.json();

        const cur = weatherData.current_weather;
        const code = cur.weathercode;
        const desc = weatherCodeToDescription(code);
        const emoji = weatherCodeToEmoji(code);

        return `${emoji} Cuaca di ${placeName} sekarang:\n\n🌡️ Suhu: ${cur.temperature}°C\n💨 Angin: ${cur.windspeed} km/jam\n📝 Kondisi: ${desc}\n🕐 Update: ${cur.time}\n\nHati-hati di jalan ya sayang 🤍`;
    } catch (error) {
        console.error('Weather error:', error);
        return null;
    }
}

function weatherCodeToDescription(code) {
    const map = {
        0: 'Cerah ☀️',
        1: 'Sebagian besar cerah 🌤️',
        2: 'Berawan sebagian ⛅',
        3: 'Mendung ☁️',
        45: 'Berkabut 🌫️',
        48: 'Berkabut dengan embun beku 🌫️',
        51: 'Gerimis ringan 🌦️',
        53: 'Gerimis sedang 🌦️',
        55: 'Gerimis lebat 🌧️',
        56: 'Gerimis dingin ringan 🌧️',
        57: 'Gerimis dingin lebat 🌧️',
        61: 'Hujan ringan 🌦️',
        63: 'Hujan sedang 🌧️',
        65: 'Hujan lebat 🌧️',
        66: 'Hujan dingin ringan 🌧️',
        67: 'Hujan dingin lebat 🌧️',
        71: 'Salju ringan ❄️',
        73: 'Salju sedang ❄️',
        75: 'Salju lebat ❄️',
        77: 'Butiran salju ❄️',
        80: 'Hujan shower ringan 🌦️',
        81: 'Hujan shower sedang 🌧️',
        82: 'Hujan shower lebat 🌧️',
        85: 'Salju shower ringan ❄️',
        86: 'Salju shower lebat ❄️',
        95: 'Badai petir ⛈️',
        96: 'Badai petir dengan hujan es ringan ⛈️',
        99: 'Badai petir dengan hujan es lebat ⛈️',
    };
    return map[code] || 'Tidak diketahui 🤔';
}

function weatherCodeToEmoji(code) {
    if (code === 0) return '☀️';
    if (code <= 2) return '🌤️';
    if (code === 3) return '☁️';
    if (code <= 48) return '🌫️';
    if (code <= 65) return '🌧️';
    if (code <= 75) return '❄️';
    if (code <= 82) return '🌦️';
    return '⛈️';
}

// ============ Math Query Detection ============
function detectMathQuery(message) {
    const lower = message.toLowerCase().trim();

    // Pattern with prefix: "hitung 2+2", "kalkulator sin(30)"
    const prefixes = [
        /^(?:hitung|kalkulator|calculate|hasil\s+dari|eval)\s+(.+)$/i,
        /^=\s*(.+)$/,
        /^berapa\s+(.+?)\s*\??$/i,
    ];

    for (const p of prefixes) {
        const m = lower.match(p);
        if (m && m[1]) {
            const expr = m[1].trim();
            if (isValidMathExpression(expr)) {
                return expr;
            }
        }
    }

    // Pure math expression: "2+2", "sin(30)+5", "sqrt(16)"
    if (isValidMathExpression(message)) {
        return message.trim();
    }

    return null;
}

function isValidMathExpression(expr) {
    if (!expr || expr.length < 1 || expr.length > 200) return false;
    // Allow: digits, +, -, *, /, ^, (, ), ., !, space, math functions, constants
    const validPattern = /^[\d+\-*/^().!\s,a-zA-Z]+$/;
    if (!validPattern.test(expr)) return false;
    // Must have at least one digit or math constant
    if (!/[\d]/.test(expr) && !/\b(pi|e)\b/i.test(expr)) return false;
    // Must have an operator or function (not just text)
    const hasOp = /[+\-*/^!]/.test(expr);
    const hasFunc = /\b(sin|cos|tan|log|ln|sqrt|cbrt|abs|exp|asin|acos|atan)\s*\(/i.test(expr);
    const hasConst = /\b(pi|e)\b/i.test(expr);
    return hasOp || hasFunc || hasConst;
}

// ============ Math Expression Evaluator (manual parser - Cloudflare safe) ============
function evaluateMath(expression, userName) {
    try {
        const result = parseAndEval(expression);
        if (typeof result !== 'number' || !isFinite(result)) {
            return `Hmm, hasilnya gak valid nih sayang 🌸 Coba cek lagi ekspresi "${expression}" 🤍`;
        }

        let formatted;
        if (Number.isInteger(result)) {
            formatted = String(result);
        } else {
            formatted = String(Math.round(result * 1e10) / 1e10);
        }

        return `🧮 ${expression} = ${formatted}\n\nSemangat belajar matematika ya sayang 🤍`;
    } catch (error) {
        return `Hmm, aku gak bisa hitung "${expression}" nih sayang 🌸\n${error.message}\n\nCoba format kayak gini:\n• hitung 2+2\n• sin(30) + cos(60)\n• sqrt(16)\n• 5!\n• 2^10\n• log(100)`;
    }
}

// Recursive descent parser for math expressions
function parseAndEval(expr) {
    expr = expr.toLowerCase().trim();

    const tokens = tokenizeMath(expr);
    let pos = 0;

    function peek() {
        return tokens[pos];
    }

    function next() {
        return tokens[pos++];
    }

    function parseExpression() {
        let left = parseTerm();
        while (peek() && (peek().type === 'op' && (peek().value === '+' || peek().value === '-'))) {
            const op = next().value;
            const right = parseTerm();
            left = op === '+' ? left + right : left - right;
        }
        return left;
    }

    function parseTerm() {
        let left = parseFactor();
        while (peek() && (peek().type === 'op' && (peek().value === '*' || peek().value === '/'))) {
            const op = next().value;
            const right = parseFactor();
            left = op === '*' ? left * right : left / right;
        }
        return left;
    }

    function parseFactor() {
        const base = parsePrimary();
        // ^ is right-associative
        if (peek() && peek().type === 'op' && peek().value === '^') {
            next();
            const exp = parseFactor();
            return Math.pow(base, exp);
        }
        return base;
    }

    function parsePrimary() {
        const tok = peek();
        if (!tok) throw new Error('Unexpected end of expression');

        // Unary minus
        if (tok.type === 'op' && tok.value === '-') {
            next();
            return -parsePrimary();
        }

        // Number
        if (tok.type === 'number') {
            next();
            // Check for factorial
            let result = tok.value;
            while (peek() && peek().type === 'op' && peek().value === '!') {
                next();
                result = factorial(result);
            }
            return result;
        }

        // Constant
        if (tok.type === 'constant') {
            next();
            let result = tok.value;
            while (peek() && peek().type === 'op' && peek().value === '!') {
                next();
                result = factorial(result);
            }
            return result;
        }

        // Function call
        if (tok.type === 'function') {
            next();
            if (!peek() || peek().type !== 'lparen') {
                throw new Error(`Expected '(' after function ${tok.value}`);
            }
            next(); // consume '('
            const arg = parseExpression();
            if (!peek() || peek().type !== 'rparen') {
                throw new Error(`Expected ')' after function argument`);
            }
            next(); // consume ')'
            let result = applyFunction(tok.value, arg);
            // Check for factorial after function
            while (peek() && peek().type === 'op' && peek().value === '!') {
                next();
                result = factorial(result);
            }
            return result;
        }

        // Parenthesized expression
        if (tok.type === 'lparen') {
            next();
            const result = parseExpression();
            if (!peek() || peek().type !== 'rparen') {
                throw new Error('Expected closing parenthesis');
            }
            next();
            // Check for factorial
            let value = result;
            while (peek() && peek().type === 'op' && peek().value === '!') {
                next();
                value = factorial(value);
            }
            return value;
        }

        throw new Error(`Unexpected token: ${tok.value}`);
    }

    const result = parseExpression();
    if (pos < tokens.length) {
        throw new Error(`Unexpected token at position ${pos}: ${tokens[pos].value}`);
    }
    return result;
}

function factorial(n) {
    if (n < 0 || !Number.isInteger(n)) {
        throw new Error(`Factorial requires non-negative integer, got ${n}`);
    }
    if (n > 170) {
        throw new Error('Factorial too large (max 170)');
    }
    let result = 1;
    for (let i = 2; i <= n; i++) result *= i;
    return result;
}

function applyFunction(name, arg) {
    const funcs = {
        'sin': Math.sin,
        'cos': Math.cos,
        'tan': Math.tan,
        'asin': Math.asin,
        'acos': Math.acos,
        'atan': Math.atan,
        'sqrt': Math.sqrt,
        'cbrt': Math.cbrt,
        'abs': Math.abs,
        'log': Math.log10,
        'ln': Math.log,
        'exp': Math.exp,
    };
    if (!funcs[name]) {
        throw new Error(`Unknown function: ${name}`);
    }
    return funcs[name](arg);
}

function tokenizeMath(expr) {
    const tokens = [];
    let i = 0;

    while (i < expr.length) {
        const c = expr[i];

        // Skip whitespace
        if (/\s/.test(c)) {
            i++;
            continue;
        }

        // Number (including decimals and scientific notation)
        if (/[\d.]/.test(c)) {
            let num = '';
            while (i < expr.length && /[\d.]/.test(expr[i])) {
                num += expr[i];
                i++;
            }
            // Handle scientific notation: 1e5, 1.5e-3
            if (i < expr.length && expr[i].toLowerCase() === 'e' && i + 1 < expr.length && /[\d+\-]/.test(expr[i + 1])) {
                num += expr[i];
                i++;
                if (expr[i] === '+' || expr[i] === '-') {
                    num += expr[i];
                    i++;
                }
                while (i < expr.length && /[\d]/.test(expr[i])) {
                    num += expr[i];
                    i++;
                }
            }
            tokens.push({ type: 'number', value: parseFloat(num) });
            continue;
        }

        // Operators
        if ('+-*/^!'.includes(c)) {
            tokens.push({ type: 'op', value: c });
            i++;
            continue;
        }

        // Parentheses
        if (c === '(') {
            tokens.push({ type: 'lparen', value: c });
            i++;
            continue;
        }
        if (c === ')') {
            tokens.push({ type: 'rparen', value: c });
            i++;
            continue;
        }

        // Identifiers (functions or constants)
        if (/[a-z]/.test(c)) {
            let ident = '';
            while (i < expr.length && /[a-z]/.test(expr[i])) {
                ident += expr[i];
                i++;
            }

            // Check if it's a constant
            if (ident === 'pi') {
                tokens.push({ type: 'constant', value: Math.PI });
            } else if (ident === 'e') {
                // Could be constant 'e' or function 'exp'... but 'exp' is parsed as identifier
                // Actually 'e' alone (not followed by '(' or digits) is constant
                if (expr[i] === '(' || (i < expr.length && /[\d.]/.test(expr[i]))) {
                    // scientific notation like 2e5 - but that's handled in number
                    // If 'e' is followed by digits, it's part of scientific notation - but we already handled that
                    // So here 'e' followed by '(' or digits is ambiguous - treat as constant
                    tokens.push({ type: 'constant', value: Math.E });
                } else {
                    tokens.push({ type: 'constant', value: Math.E });
                }
            } else if (['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sqrt', 'cbrt', 'abs', 'log', 'ln', 'exp'].includes(ident)) {
                tokens.push({ type: 'function', value: ident });
            } else {
                throw new Error(`Unknown identifier: ${ident}`);
            }
            continue;
        }

        throw new Error(`Unknown character: ${c}`);
    }

    return tokens;
}

// ============ Handle Calc Endpoint (POST /calc) ============
async function handleCalc(request, corsHeaders) {
    const body = await request.json();
    const { expression, user_name } = body;

    if (!expression) {
        return jsonResponse({ error: 'expression is required' }, 400, corsHeaders);
    }

    const result = evaluateMath(expression, user_name || 'Sayang');
    return jsonResponse({ response: result, type: 'calc' }, 200, corsHeaders);
}

// ============ Translation Query Detection ============
function detectTranslationQuery(message) {
    const lower = message.toLowerCase().trim();

    // Pattern: "translate X ke bahasa Y", "artikan X ke Y"
    const patterns = [
        /(?:translate|artikan|terjemahkan|ubah\s+ke\s+bahasa|jadikan)\s+[""']?(.+?)[""']?\s+ke\s+(?:bahasa\s+)?(\w+(?:\s+\w+)?)/i,
        /(?:translate|artikan|terjemahkan)\s+[""'](.+?)[""']\s+(?:ke\s+)?(?:bahasa\s+)?(\w+)/i,
        /(?:translate|artikan|terjemahkan)\s+(.+?)\s+(?:to|ke)\s+(?:bahasa\s+)?(\w+(?:\s+\w+)?)/i,
    ];

    for (const p of patterns) {
        const m = message.match(p);
        if (m && m[1] && m[2]) {
            return {
                text: m[1].trim().replace(/[""']/g, ''),
                target_lang: m[2].trim(),
            };
        }
    }

    return null;
}

// ============ Handle Translation (LLM with tone detection) ============
async function handleTranslation(query, env, userName) {
    const { text, target_lang } = query;

    if (!text || !target_lang) return null;

    // Map common language names
    const langMap = {
        'inggris': 'English',
        'english': 'English',
        'en': 'English',
        'indonesia': 'Indonesian',
        'indonesian': 'Indonesian',
        'id': 'Indonesian',
        'jepang': 'Japanese',
        'japanese': 'Japanese',
        'jp': 'Japanese',
        'ja': 'Japanese',
        'korea': 'Korean',
        'korean': 'Korean',
        'kr': 'Korean',
        'cina': 'Chinese (Simplified)',
        'china': 'Chinese (Simplified)',
        'chinese': 'Chinese (Simplified)',
        'zh': 'Chinese (Simplified)',
        'arab': 'Arabic',
        'arabic': 'Arabic',
        'ar': 'Arabic',
        'sunda': 'Sundanese',
        'jawa': 'Javanese',
        'javanese': 'Javanese',
        'perancis': 'French',
        'french': 'French',
        'fr': 'French',
        'jerman': 'German',
        'german': 'German',
        'de': 'German',
        'spanyol': 'Spanish',
        'spanish': 'Spanish',
        'es': 'Spanish',
        'thai': 'Thai',
        'vietnam': 'Vietnamese',
        'rusia': 'Russian',
        'russian': 'Russian',
    };

    const targetLang = langMap[target_lang.toLowerCase()] || target_lang;

    const prompt = `Terjemahkan teks berikut ke bahasa ${targetLang}.

Teks asli: "${text}"

ATURAN PENTING:
1. Detect tone/asli teks sumber, terjemahkan dengan tone yang SAMA:
   - Kalau teks formal/akademis → translate formal
   - Kalau teks santai/gaul/sehari-hari → translate dengan tone natural yang dipakai native speaker (slang/casual)
   - Kalau teks emosional (sedih, marah, senang) → pertahankan emosi tersebut
2. JANGAN pakai tone robot/formal kalau teks aslinya santai
3. JANGAN kasih penjelasan, HANYA hasil terjemahan
4. Jangan kasih label kayak "Translation:" atau "Artinya:"

Contoh:
- "lagi apa?" → "whatcha doing?" (bukan "what are you doing?")
- "selamat pagi, Bapak" → "good morning, Sir" (formal)
- "gila sih lu" → "damn you" (slang)`;

    const messages = [
        {
            role: 'system',
            content: 'Kamu translator pintar yang bisa detect tone (formal/slang/gaul/casual) dan translate dengan tone yang sesuai dengan naturalisasi native speaker. Selalu jawab HANYA dengan hasil terjemahan, tanpa penjelasan atau label.',
        },
        { role: 'user', content: prompt },
    ];

    try {
        const aiResponse = await env.AI.run(AI_MODEL, {
            messages,
            max_tokens: 300,
            temperature: 0.4,
        });

        const reply = aiResponse.response || aiResponse.choices?.[0]?.message?.content || '';
        const cleaned = reply.trim().replace(/^["""']|["""']$/g, '');

        if (!cleaned) return null;

        return `🌍 Terjemahan ke bahasa ${targetLang}:\n\n"${cleaned}"\n\naku translate sesuai tone aslinya ya sayang 🤍`;
    } catch (error) {
        console.error('Translation error:', error);
        return null;
    }
}

// ============ Handle Translate Endpoint (POST /translate) ============
async function handleTranslate(request, env, corsHeaders) {
    const body = await request.json();
    const { text, target_lang, user_name } = body;

    if (!text || !target_lang) {
        return jsonResponse({ error: 'text and target_lang are required' }, 400, corsHeaders);
    }

    const result = await handleTranslation({ text, target_lang }, env, user_name || 'Sayang');
    return jsonResponse({ response: result, type: 'translate' }, 200, corsHeaders);
}

// ============ Reminder Handler ============
async function handleCreateReminder(request, env, corsHeaders) {
    const body = await request.json();
    const { task, remind_at, user_name, notify } = body;

    if (!task || !remind_at) {
        return jsonResponse({ error: 'task and remind_at are required' }, 400, corsHeaders);
    }

    const reminder = {
        id: Date.now() + Math.random(),
        task,
        remind_at,
        user_name: user_name || 'Sayang',
        notify: notify || { discord: true, email: false },
        fired: false,
        created_at: new Date().toISOString(),
    };

    reminders.push(reminder);

    return jsonResponse({
        success: true,
        id: reminder.id,
        message: `✅ Reminder saved: ${task} at ${remind_at}`,
    }, 200, corsHeaders);
}

// ============ Cron: Check Reminders ============
async function checkReminders(env) {
    const now = new Date();

    // Check user reminders
    for (const reminder of reminders) {
        if (reminder.fired) continue;

        const remindAt = new Date(reminder.remind_at);
        if (remindAt <= now) {
            await fireReminder(reminder, env);
            reminder.fired = true;
        }
    }

    // Cleanup old fired reminders (>24h ago)
    reminders = reminders.filter(r => {
        if (!r.fired) return true;
        const firedAt = new Date(r.remind_at);
        return (now - firedAt) < 86400000;
    });

    // Check meal reminders (12:00, 18:00, 21:00)
    const hour = now.getHours();
    const minute = now.getMinutes();
    const mealTimes = [
        { hour: 12, minute: 0 },
        { hour: 18, minute: 0 },
        { hour: 21, minute: 0 },
    ];

    for (const meal of mealTimes) {
        if (hour === meal.hour && minute === meal.minute) {
            // Avoid duplicate meal reminders within same minute
            const cacheKey = `meal-${hour}-${now.getDate()}`;
            if (!globalThis[cacheKey]) {
                globalThis[cacheKey] = true;
                await sendMealReminder(env);
                // Clear cache after 2 minutes
                setTimeout(() => delete globalThis[cacheKey], 120000);
            }
        }
    }
}

async function fireReminder(reminder, env) {
    const message = `⏰ Sayang, waktunya: ${reminder.task}\n\nSemangat ya! 🤍`;

    // Discord webhook
    if (reminder.notify.discord && env.DISCORD_WEBHOOK_URL) {
        try {
            await sendDiscordWebhook(env.DISCORD_WEBHOOK_URL, {
                username: 'Dedek Tersayang',
                content: message,
            });
        } catch (e) {
            console.error('Discord notif failed:', e);
        }
    }

    // Email
    if (reminder.notify.email && reminder.notify.email_to && env.RESEND_API_KEY) {
        try {
            await sendEmail(env, reminder.notify.email_to, `⏰ Reminder: ${reminder.task}`, message);
        } catch (e) {
            console.error('Email notif failed:', e);
        }
    }
}

async function sendMealReminder(env) {
    const message = MEAL_TEMPLATES[Math.floor(Math.random() * MEAL_TEMPLATES.length)];

    if (env.DISCORD_WEBHOOK_URL) {
        try {
            await sendDiscordWebhook(env.DISCORD_WEBHOOK_URL, {
                username: 'Dedek Tersayang',
                content: message,
            });
        } catch (e) {
            console.error('Meal Discord notif failed:', e);
        }
    }

    if (env.RESEND_API_KEY && env.RESEND_TO) {
        try {
            await sendEmail(env, env.RESEND_TO, '🍽️ Waktunya makan, Sayang!', message);
        } catch (e) {
            console.error('Meal email notif failed:', e);
        }
    }
}

// ============ Discord Webhook ============
async function sendDiscordWebhook(webhookUrl, payload) {
    const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        throw new Error(`Discord webhook failed: ${response.status}`);
    }
}

// ============ Resend Email ============
async function sendEmail(env, to, subject, content) {
    const from = env.RESEND_FROM || 'Dedek Tersayang <onboarding@resend.dev>';

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from,
            to: [to],
            subject,
            text: content,
            html: `<div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;"><p style="white-space: pre-wrap; line-height: 1.6;">${content.replace(/\n/g, '<br>')}</p><p style="margin-top: 20px; font-size: 12px; color: #888;">🌸 Dedek Tersayang</p></div>`,
        }),
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Resend failed: ${response.status} ${err}`);
    }
}

// ============ Helpers ============
function jsonResponse(data, status, corsHeaders) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
        },
    });
}
