/* ========================================
   Dedek Tersayang - Web Chat App
   Frontend logic for chat + reminder
   ======================================== */

const STORAGE_KEY = 'dedek-chat-history';
const SETTINGS_KEY = 'dedek-settings';
const NOTIF_KEY = 'dedek-notifications';
const MAX_HISTORY = 50;
const MAX_NOTIFS = 50;

// Default settings
const DEFAULT_SETTINGS = {
    userName: 'Sayang',
    workerUrl: '',
    notifDiscord: true,
    notifEmail: true,
    notifBrowser: false,
    email: '',
    mealTimes: ['12:00', '18:00', '21:00'],
    photoUrl: '',
    soundType: 'bell',  // bell, chime, pop, soft, none, custom
    customSoundUrl: '',  // base64 data URL
};

// State
let settings = { ...DEFAULT_SETTINGS };
let messages = [];
let notifications = [];
let isTyping = false;
let scheduledMealTimers = [];  // Active setTimeout IDs for meal reminders
let audioContext = null;  // For Web Audio API sound generation

// DOM elements
const chatArea = document.getElementById('chat-area');
const messagesEl = document.getElementById('messages');
const welcomeMsg = document.getElementById('welcome-msg');
const typingIndicator = document.getElementById('typing-indicator');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeModal = document.getElementById('close-modal');
const saveSettings = document.getElementById('save-settings');
const clearChatBtn = document.getElementById('clear-chat-btn');

// Notif DOM elements
const notifBtn = document.getElementById('notif-btn');
const notifBadge = document.getElementById('notif-badge');
const notifPanel = document.getElementById('notif-panel');
const notifList = document.getElementById('notif-list');
const closeNotifPanel = document.getElementById('close-notif-panel');
const markAllReadBtn = document.getElementById('mark-all-read');

// ============ Initialize ============
function init() {
    loadSettings();
    loadMessages();
    loadNotifications();
    renderMessages();
    renderAvatar();
    renderNotifications();
    setupEventListeners();
    setupServiceWorker();
    scheduleMealReminders();  // Schedule local meal notifs
    requestNotifPermission();
}

// ============ Notifications ============
function loadNotifications() {
    try {
        const saved = localStorage.getItem(NOTIF_KEY);
        notifications = saved ? JSON.parse(saved) : [];
    } catch (e) {
        console.warn('Failed to load notifications:', e);
        notifications = [];
    }
}

function saveNotifications() {
    try {
        if (notifications.length > MAX_NOTIFS) {
            notifications = notifications.slice(0, MAX_NOTIFS);
        }
        localStorage.setItem(NOTIF_KEY, JSON.stringify(notifications));
    } catch (e) {
        console.warn('Failed to save notifications:', e);
    }
}

function addNotification({ title, body, icon = '🔔', type = 'general' }) {
    const notif = {
        id: Date.now() + Math.random(),
        title,
        body,
        icon,
        type,
        read: false,
        timestamp: Date.now(),
    };
    notifications.unshift(notif);
    saveNotifications();
    renderNotifications();
    playNotifSound();
    showBrowserNotif(title, body, icon);
}

function renderNotifications() {
    if (notifications.length === 0) {
        notifList.innerHTML = '<div class="notif-empty">Belum ada notifikasi 🌸</div>';
        notifBadge.style.display = 'none';
        return;
    }

    notifList.innerHTML = '';
    notifications.forEach(notif => {
        const item = document.createElement('div');
        item.className = `notif-item ${notif.read ? '' : 'unread'}`;
        item.innerHTML = `
            <div class="notif-icon">${notif.icon}</div>
            <div class="notif-content">
                <div class="notif-title">${escapeHtml(notif.title)}</div>
                <div class="notif-body">${escapeHtml(notif.body)}</div>
                <div class="notif-time">${formatNotifTime(notif.timestamp)}</div>
            </div>
        `;
        item.addEventListener('click', () => {
            notif.read = true;
            saveNotifications();
            renderNotifications();
        });
        notifList.appendChild(item);
    });

    // Update badge
    const unreadCount = notifications.filter(n => !n.read).length;
    if (unreadCount > 0) {
        notifBadge.textContent = unreadCount > 9 ? '9+' : unreadCount;
        notifBadge.style.display = 'flex';
    } else {
        notifBadge.style.display = 'none';
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatNotifTime(ts) {
    const now = Date.now();
    const diff = now - ts;
    if (diff < 60000) return 'Baru saja';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} menit lalu`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} jam lalu`;
    const d = new Date(ts);
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function showBrowserNotif(title, body, icon) {
    if (settings.notifBrowser && 'Notification' in window && Notification.permission === 'granted') {
        try {
            new Notification(title, {
                body,
                icon: icon || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🌸</text></svg>',
                tag: 'dedek-notif',
            });
        } catch (e) {
            console.warn('Browser notif failed:', e);
        }
    }
}

function requestNotifPermission() {
    if (settings.notifBrowser && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

// ============ Sound Generation (Web Audio API) ============
function playNotifSound() {
    if (settings.soundType === 'none') return;

    if (settings.soundType === 'custom' && settings.customSoundUrl) {
        // Play custom uploaded sound
        try {
            const audio = new Audio(settings.customSoundUrl);
            audio.volume = 0.7;
            audio.play().catch(e => console.warn('Custom sound play failed:', e));
        } catch (e) {
            console.warn('Custom sound error:', e);
        }
        return;
    }

    // Generate sound with Web Audio API
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        // Resume context if suspended (browser policy)
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }

        const sounds = {
            bell: () => playBellSound(audioContext),
            chime: () => playChimeSound(audioContext),
            pop: () => playPopSound(audioContext),
            soft: () => playSoftSound(audioContext),
        };

        if (sounds[settings.soundType]) {
            sounds[settings.soundType]();
        }
    } catch (e) {
        console.warn('Sound play failed:', e);
    }
}

function playBellSound(ctx) {
    const now = ctx.currentTime;
    // Two-tone bell (E5 + A5)
    [659.25, 880].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.connect(gain);
        gain.connect(ctx.destination);
        gain.gain.setValueAtTime(0, now + i * 0.15);
        gain.gain.linearRampToValueAtTime(0.3, now + i * 0.15 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 0.8);
        osc.start(now + i * 0.15);
        osc.stop(now + i * 0.15 + 0.8);
    });
}

function playChimeSound(ctx) {
    const now = ctx.currentTime;
    // Three ascending notes (C5, E5, G5)
    [523.25, 659.25, 783.99].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        osc.connect(gain);
        gain.connect(ctx.destination);
        gain.gain.setValueAtTime(0, now + i * 0.1);
        gain.gain.linearRampToValueAtTime(0.2, now + i * 0.1 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.4);
        osc.start(now + i * 0.1);
        osc.stop(now + i * 0.1 + 0.4);
    });
}

function playPopSound(ctx) {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(200, now + 0.1);
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.start(now);
    osc.stop(now + 0.15);
}

function playSoftSound(ctx) {
    const now = ctx.currentTime;
    // Soft pad sound (A4 + E5)
    [440, 659.25].forEach(freq => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.connect(gain);
        gain.connect(ctx.destination);
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.15, now + 0.05);
        gain.gain.linearRampToValueAtTime(0.1, now + 0.3);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
        osc.start(now);
        osc.stop(now + 1.2);
    });
}

// ============ Meal Reminder Scheduling (Local) ============
function scheduleMealReminders() {
    // Clear existing timers
    scheduledMealTimers.forEach(id => clearTimeout(id));
    scheduledMealTimers = [];

    if (!settings.mealTimes || settings.mealTimes.length === 0) return;

    settings.mealTimes.forEach(timeStr => {
        const [h, m] = timeStr.split(':').map(s => parseInt(s));
        const now = new Date();
        const target = new Date();
        target.setHours(h, m, 0, 0);
        if (target <= now) {
            target.setDate(target.getDate() + 1);
        }
        const delay = target.getTime() - now.getTime();

        const timerId = setTimeout(() => {
            addNotification({
                title: '🍽️ Waktunya makan, Sayang!',
                body: 'Jangan lupa makan ya 🤍',
                icon: '🍽️',
                type: 'meal',
            });
            // Schedule next day
            scheduleMealReminders();
        }, delay);
        scheduledMealTimers.push(timerId);
    });
}

// ============ Avatar / Photo ============
function renderAvatar() {
    const emoji = document.getElementById('avatar-emoji');
    const photo = document.getElementById('avatar-photo');

    if (settings.photoUrl) {
        photo.src = settings.photoUrl;
        photo.style.display = 'block';
        emoji.style.display = 'none';
    } else {
        photo.style.display = 'none';
        photo.src = '';
        emoji.style.display = 'block';
        emoji.textContent = '🌸';
    }
}

function renderPhotoPreview() {
    const preview = document.getElementById('photo-preview');
    preview.innerHTML = '';

    if (settings.photoUrl) {
        const img = document.createElement('img');
        img.src = settings.photoUrl;
        preview.appendChild(img);
    } else {
        const emoji = document.createElement('span');
        emoji.className = 'photo-preview-emoji';
        emoji.textContent = '🌸';
        preview.appendChild(emoji);
    }
}

// ============ Settings ============
function loadSettings() {
    try {
        const saved = localStorage.getItem(SETTINGS_KEY);
        if (saved) {
            settings = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
        }
    } catch (e) {
        console.warn('Failed to load settings:', e);
    }
}

function saveSettingsToStorage() {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
        console.warn('Failed to save settings:', e);
    }
}

// ============ Messages ============
function loadMessages() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            messages = JSON.parse(saved);
        }
    } catch (e) {
        console.warn('Failed to load messages:', e);
        messages = [];
    }
}

function saveMessages() {
    try {
        // Keep only last MAX_HISTORY messages
        if (messages.length > MAX_HISTORY) {
            messages = messages.slice(-MAX_HISTORY);
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch (e) {
        console.warn('Failed to save messages:', e);
    }
}

function renderMessages() {
    messagesEl.innerHTML = '';

    if (messages.length === 0) {
        welcomeMsg.style.display = 'block';
        return;
    }

    welcomeMsg.style.display = 'none';

    messages.forEach(msg => {
        addMessageToDOM(msg.text, msg.role, msg.timestamp, false);
    });

    scrollToBottom();
}

function addMessageToDOM(text, role, timestamp, animate = true) {
    const msgEl = document.createElement('div');
    msgEl.className = `message ${role}`;
    if (!animate) msgEl.style.animation = 'none';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = text;

    const time = document.createElement('div');
    time.className = 'message-time';
    time.textContent = formatTime(timestamp);

    msgEl.appendChild(bubble);
    msgEl.appendChild(time);

    messagesEl.appendChild(msgEl);
    scrollToBottom();
}

function scrollToBottom() {
    setTimeout(() => {
        chatArea.scrollTop = chatArea.scrollHeight;
    }, 50);
}

function formatTime(timestamp) {
    const d = new Date(timestamp);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();

    if (isToday) {
        return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ============ Send Message ============
async function sendMessage(text) {
    text = text.trim();
    if (!text || isTyping) return;

    // Hide welcome
    welcomeMsg.style.display = 'none';

    // Add user message
    const userMsg = {
        text,
        role: 'user',
        timestamp: Date.now(),
    };
    messages.push(userMsg);
    addMessageToDOM(text, 'user', userMsg.timestamp);
    saveMessages();

    // Clear input
    messageInput.value = '';
    autoResize();

    // Show typing
    showTyping();

    try {
        // Check if it's a note command (auto-route to Notes page)
        const noteContent = detectNoteCommand(text);
        if (noteContent) {
            await handleNoteFromChat(noteContent);
            return;
        }

        // Check if it's a reminder request (auto-route to Schedule page)
        const reminderMatch = parseReminder(text);
        if (reminderMatch) {
            await handleReminder(reminderMatch);
            return;
        }

        // Regular chat - call Worker
        const response = await callWorker(text);
        hideTyping();

        const botMsg = {
            text: response,
            role: 'bot',
            timestamp: Date.now(),
        };
        messages.push(botMsg);
        addMessageToDOM(response, 'bot', botMsg.timestamp);
        saveMessages();
    } catch (error) {
        hideTyping();
        const errorMsg = {
            text: `Maaf sayang, ada gangguan koneksi nih 🌸 (${error.message})`,
            role: 'bot',
            timestamp: Date.now(),
        };
        messages.push(errorMsg);
        addMessageToDOM(errorMsg.text, 'bot', errorMsg.timestamp);
        saveMessages();
    }
}

// ============ Cloudflare Worker API ============
async function callWorker(userMessage) {
    if (!settings.workerUrl) {
        return 'Sayang, aku belum terhubung ke server 🌸\nBuka pengaturan (ikon gear di kanan atas) lalu isi Worker URL. Kalau belum punya, ketik "lanjut" di chat aku bantu setup ya 🤍';
    }

    const response = await fetch(`${settings.workerUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message: userMessage,
            user_name: settings.userName,
            history: messages.slice(-10).map(m => ({
                role: m.role === 'user' ? 'user' : 'assistant',
                content: m.text,
            })),
        }),
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errText.substring(0, 100)}`);
    }

    const data = await response.json();
    return data.response || data.message || '(kosong)';
}

// ============ Reminder Parser ============
function parseReminder(text) {
    const lower = text.toLowerCase();

    // Pattern: "ingetin aku [time] [task]" or "inget [time] [task]"
    const patterns = [
        /(?:inget(?:in)?|ingetin aku)\s+(?:aku\s+)?(.+)/i,
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            const remaining = match[1].trim();

            // Extract time patterns
            const timePatterns = [
                { regex: /(\d+)\s*jam\s*lagi/i, type: 'hours' },
                { regex: /(\d+)\s*menit\s*lagi/i, type: 'minutes' },
                { regex: /(\d+)\s*hari\s*lagi/i, type: 'days' },
                { regex: /besok\s*jam\s*(\d{1,2})[:.](\d{2})/i, type: 'tomorrow_at' },
                { regex: /jam\s*(\d{1,2})[:.](\d{2})/i, type: 'today_at' },
                { regex: /(\d{1,2})[:.](\d{2})/i, type: 'time_only' },
            ];

            for (const tp of timePatterns) {
                const tm = remaining.match(tp.regex);
                if (tm) {
                    let remindAt = null;
                    let taskDesc = remaining.replace(tm[0], '').trim();
                    taskDesc = taskDesc.replace(/^(untuk|buat)\s+/i, '');

                    const now = new Date();

                    if (tp.type === 'hours') {
                        remindAt = new Date(now.getTime() + parseInt(tm[1]) * 3600000);
                    } else if (tp.type === 'minutes') {
                        remindAt = new Date(now.getTime() + parseInt(tm[1]) * 60000);
                    } else if (tp.type === 'days') {
                        remindAt = new Date(now.getTime() + parseInt(tm[1]) * 86400000);
                    } else if (tp.type === 'tomorrow_at') {
                        remindAt = new Date(now);
                        remindAt.setDate(remindAt.getDate() + 1);
                        remindAt.setHours(parseInt(tm[1]), parseInt(tm[2]), 0, 0);
                    } else if (tp.type === 'today_at' || tp.type === 'time_only') {
                        remindAt = new Date(now);
                        remindAt.setHours(parseInt(tm[1]), parseInt(tm[2]), 0, 0);
                        if (remindAt <= now) {
                            remindAt.setDate(remindAt.getDate() + 1);
                        }
                    }

                    if (remindAt && taskDesc) {
                        return { time: remindAt, task: taskDesc, rawTime: tm[0] };
                    }
                }
            }
        }
    }
    return null;
}

async function handleReminder(reminder) {
    // Save to local Schedule page (localStorage)
    const localReminder = {
        id: Date.now() + Math.random(),
        title: reminder.task,
        description: '',
        datetime: reminder.time.toISOString(),
        repeat: 'none',
        notify: {
            local: true,
            discord: settings.notifDiscord,
            email: settings.notifEmail && !!settings.email,
        },
        createdAt: Date.now(),
        fromChat: true,
    };
    reminders.push(localReminder);
    saveReminders();
    renderNavBadges();
    scheduleLocalReminders();

    try {
        // Save reminder to Worker (for Discord/email notif)
        const response = await fetch(`${settings.workerUrl}/reminders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                task: reminder.task,
                remind_at: reminder.time.toISOString(),
                user_name: settings.userName,
                notify: {
                    discord: settings.notifDiscord,
                    email: settings.notifEmail && settings.email,
                    email_to: settings.email,
                },
            }),
        });

        if (!response.ok) throw new Error('Failed to save reminder');

        hideTyping();
        const timeStr = reminder.time.toLocaleString('id-ID', {
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
        });
        const replyText = `✅ Siap sayang! Aku ingetin kamu untuk **${reminder.task}** pada ${timeStr} ya 🌸\n\n📅 Udah aku simpan ke halaman Jadwal juga, bisa kamu cek di sidebar 🤍`;

        const botMsg = { text: replyText, role: 'bot', timestamp: Date.now() };
        messages.push(botMsg);
        addMessageToDOM(replyText, 'bot', botMsg.timestamp);
        saveMessages();
    } catch (error) {
        hideTyping();
        // Even if Worker fails, reminder udah tersimpan di local Schedule page
        const timeStr = reminder.time.toLocaleString('id-ID', {
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
        });
        const replyText = `✅ Aku catet ya sayang! **${reminder.task}** pada ${timeStr} 🌸\n\n📅 Udah masuk ke halaman Jadwal. Notif Discord/email belum jalan (Worker belum setup), tapi browser notif bakal muncul kalau web ini kebuka 🤍`;

        const botMsg = { text: replyText, role: 'bot', timestamp: Date.now() };
        messages.push(botMsg);
        addMessageToDOM(replyText, 'bot', botMsg.timestamp);
        saveMessages();
    }
}

// ============ Auto-route Notes from Chat ============
function detectNoteCommand(message) {
    const lower = message.toLowerCase().trim();

    // Patterns: "catat X", "catet X", "catatan: X", "ingetin catat X", "simpan catatan X"
    const patterns = [
        /^(?:catat|catet|catatan)\s*[:\-]?\s*(.+)$/i,
        /^(?:simpan\s+catatan|catatan\s+buat)\s+(.+)$/i,
        /^(?:inget\s+catat|ingetin\s+catat)\s+(.+)$/i,
        /^#catatan\s+(.+)$/i,
        /^note\s*[:\-]?\s*(.+)$/i,
    ];

    for (const p of patterns) {
        const m = message.match(p);
        if (m && m[1]) {
            const content = m[1].trim();
            if (content.length > 0 && content.length < 1000) {
                return content;
            }
        }
    }

    return null;
}

// ============ Detect Time in Natural Language (Indonesian) ============
// Returns Date object or null
function detectTimeInText(text) {
    const lower = text.toLowerCase().trim();
    const now = new Date();
    const target = new Date(now);

    // Pattern 1: explicit time "jam HH:MM" or "pukul HH:MM"
    let m = lower.match(/(?:jam|pukul)\s*(\d{1,2})[:.](\d{2})/i);
    if (m) {
        target.setHours(parseInt(m[1]), parseInt(m[2]), 0, 0);
        if (target <= now) target.setDate(target.getDate() + 1);
        return { date: target, source: m[0] };
    }

    m = lower.match(/(?:jam|pukul)\s*(\d{1,2})(?!\d|[:.])/i);
    if (m) {
        target.setHours(parseInt(m[1]), 0, 0, 0);
        if (target <= now) target.setDate(target.getDate() + 1);
        return { date: target, source: m[0] };
    }

    // Pattern 2: HH:MM without "jam"
    m = lower.match(/(\d{1,2})[:.](\d{2})\s*(?:wib|pagi|siang|sore|malam)?/i);
    if (m && !lower.includes('tgl') && !lower.includes('tanggal')) {
        target.setHours(parseInt(m[1]), parseInt(m[2]), 0, 0);
        if (target <= now) target.setDate(target.getDate() + 1);
        return { date: target, source: m[0] };
    }

    // Pattern 3: relative days
    if (/\b(lusa|besok\s+lusa|2\s+hari\s+lagi)\b/i.test(lower)) {
        target.setDate(target.getDate() + 2);
        target.setHours(9, 0, 0, 0);
        const matched = lower.match(/\b(lusa|besok\s+lusa|2\s+hari\s+lagi)\b/i);
        return { date: target, source: matched[0] };
    }

    if (/\b(besok|bsk)\b/i.test(lower)) {
        target.setDate(target.getDate() + 1);

        // Check for time of day
        if (/pagi/i.test(lower)) {
            target.setHours(8, 0, 0, 0);
            return { date: target, source: 'besok pagi' };
        }
        if (/siang/i.test(lower)) {
            target.setHours(12, 0, 0, 0);
            return { date: target, source: 'besok siang' };
        }
        if (/sore/i.test(lower)) {
            target.setHours(16, 0, 0, 0);
            return { date: target, source: 'besok sore' };
        }
        if (/malam/i.test(lower)) {
            target.setHours(19, 0, 0, 0);
            return { date: target, source: 'besok malam' };
        }
        target.setHours(9, 0, 0, 0);
        return { date: target, source: 'besok' };
    }

    // Pattern 4: "nanti pagi/siang/sore/malam"
    m = lower.match(/\bnanti\s+(pagi|siang|sore|malam)\b/i);
    if (m) {
        const times = { pagi: 8, siang: 12, sore: 16, malam: 19 };
        target.setHours(times[m[1]], 0, 0, 0);
        if (target <= now) target.setDate(target.getDate() + 1);
        return { date: target, source: m[0] };
    }

    // Pattern 5: hari ini + time of day
    m = lower.match(/\b(?:hari\s+ini)?\s*(pagi|siang|sore|malam)\b/i);
    if (m && !lower.includes('besok')) {
        const times = { pagi: 8, siang: 12, sore: 16, malam: 19 };
        target.setHours(times[m[1]], 0, 0, 0);
        if (target <= now) target.setDate(target.getDate() + 1);
        return { date: target, source: m[0] };
    }

    // Pattern 6: next week days
    const days = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];
    for (let i = 0; i < days.length; i++) {
        const re = new RegExp(`\\b(?:${days[i]})\\s*(?:depan|besok)?\\b`, 'i');
        m = lower.match(re);
        if (m) {
            const today = now.getDay();
            let diff = (i - today + 7) % 7;
            if (diff === 0) diff = 7;  // Next same day = next week
            target.setDate(target.getDate() + diff);

            if (/pagi/i.test(lower)) target.setHours(8, 0, 0, 0);
            else if (/siang/i.test(lower)) target.setHours(12, 0, 0, 0);
            else if (/sore/i.test(lower)) target.setHours(16, 0, 0, 0);
            else if (/malam/i.test(lower)) target.setHours(19, 0, 0, 0);
            else target.setHours(9, 0, 0, 0);

            return { date: target, source: m[0] };
        }
    }

    // Pattern 7: "akhir bulan" / "pertengahan bulan"
    if (/akhir\s+bulan/i.test(lower)) {
        const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
        target.setDate(lastDay);
        target.setHours(9, 0, 0, 0);
        if (target <= now) target.setMonth(target.getMonth() + 1);
        return { date: target, source: 'akhir bulan' };
    }

    if (/pertengahan\s+bulan/i.test(lower)) {
        target.setDate(15);
        target.setHours(9, 0, 0, 0);
        if (target <= now) target.setMonth(target.getMonth() + 1);
        return { date: target, source: 'pertengahan bulan' };
    }

    // Pattern 8: "X jam lagi", "X menit lagi", "X hari lagi"
    m = lower.match(/(\d+)\s*jam\s*lagi/i);
    if (m) {
        target.setTime(target.getTime() + parseInt(m[1]) * 3600000);
        return { date: target, source: m[0] };
    }
    m = lower.match(/(\d+)\s*menit\s*lagi/i);
    if (m) {
        target.setTime(target.getTime() + parseInt(m[1]) * 60000);
        return { date: target, source: m[0] };
    }
    m = lower.match(/(\d+)\s*hari\s*lagi/i);
    if (m) {
        target.setDate(target.getDate() + parseInt(m[1]));
        target.setHours(9, 0, 0, 0);
        return { date: target, source: m[0] };
    }

    return null;
}

// Clean note content (remove time references for cleaner note body)
function cleanTimeFromText(text, timeSource) {
    if (!timeSource) return text;
    // Replace time source with empty, clean up extra spaces
    let cleaned = text.replace(new RegExp(timeSource.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '');
    // Remove common filler words left behind
    cleaned = cleaned.replace(/\b(di|ke|pada|untuk|buat|yang)\s*$/i, '').trim();
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    return cleaned || text;  // Return original if cleaning made it empty
}

function addNoteFromChat(content) {
    // Cek apakah ada title (sebelum ":") dan body (setelah ":")
    let title = 'Catatan dari chat';
    let body = content;

    const colonIdx = content.indexOf(':');
    if (colonIdx > 0 && colonIdx < 50) {
        title = content.substring(0, colonIdx).trim();
        body = content.substring(colonIdx + 1).trim();
    } else {
        // Auto-generate title dari first 30 chars
        title = content.length > 30 ? content.substring(0, 30) + '...' : content;
    }

    const note = {
        id: Date.now() + Math.random(),
        title,
        body,
        timestamp: Date.now(),
        fromChat: true,
    };

    notes.unshift(note);
    saveNotes();
    renderNavBadges();

    return note;
}

async function handleNoteFromChat(content) {
    hideTyping();

    // Save note locally
    const note = addNoteFromChat(content);

    // Check if note contains time info → also save as reminder
    const timeInfo = detectTimeInText(content);

    let replyText = `📝 Udah aku catat ke halaman Catatan ya sayang 🌸\n\n**${note.title}**\n${note.body}\n\nCek di sidebar → 📝 Catatan 🤍`;

    if (timeInfo) {
        // Also save to Schedule page as reminder
        const reminderTitle = content.length > 50 ? content.substring(0, 50) + '...' : content;
        const localReminder = {
            id: Date.now() + Math.random(),
            title: reminderTitle,
            description: `Catatan dari chat: ${content}`,
            datetime: timeInfo.date.toISOString(),
            repeat: 'none',
            notify: {
                local: true,
                discord: settings.notifDiscord,
                email: settings.notifEmail && !!settings.email,
            },
            createdAt: Date.now(),
            fromChat: true,
            fromNote: true,
        };
        reminders.push(localReminder);
        saveReminders();
        renderNavBadges();
        scheduleLocalReminders();

        // Sync to Worker
        if (settings.workerUrl && (settings.notifDiscord || settings.notifEmail)) {
            try {
                await fetch(`${settings.workerUrl}/reminders`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        task: reminderTitle,
                        remind_at: timeInfo.date.toISOString(),
                        user_name: settings.userName,
                        notify: {
                            discord: settings.notifDiscord,
                            email: settings.notifEmail && settings.email,
                            email_to: settings.email,
                        },
                    }),
                });
            } catch (e) {
                console.warn('Failed to sync reminder to Worker:', e);
            }
        }

        const timeStr = timeInfo.date.toLocaleString('id-ID', {
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
        });
        replyText = `📝 Udah aku catat ke halaman Catatan ya sayang 🌸\n\n**${note.title}**\n${note.body}\n\n📅 Aku juga bikin reminder di halaman Jadwal: **${reminderTitle}** pada ${timeStr} (${timeInfo.source})\n\nCek di sidebar → 📝 Catatan & 📅 Jadwal 🤍`;
    }

    const botMsg = { text: replyText, role: 'bot', timestamp: Date.now() };
    messages.push(botMsg);
    addMessageToDOM(replyText, 'bot', botMsg.timestamp);
    saveMessages();
}

function scheduleBrowserReminder(reminder) {
    const delay = reminder.time.getTime() - Date.now();
    if (delay <= 0) return;

    setTimeout(() => {
        addNotification({
            title: `⏰ ${reminder.task}`,
            body: 'Waktunya nih sayang! 🤍',
            icon: '⏰',
            type: 'reminder',
        });
    }, delay);
}

// ============ Typing Indicator ============
function showTyping() {
    isTyping = true;
    typingIndicator.style.display = 'block';
    scrollToBottom();
}

function hideTyping() {
    isTyping = false;
    typingIndicator.style.display = 'none';
}

// ============ Auto-resize textarea ============
function autoResize() {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
}

// ============ Settings Modal ============
function openSettings() {
    document.getElementById('user-name-input').value = settings.userName;
    document.getElementById('worker-url-input').value = settings.workerUrl;
    document.getElementById('notif-discord').checked = settings.notifDiscord;
    document.getElementById('notif-email').checked = settings.notifEmail;
    document.getElementById('notif-browser').checked = settings.notifBrowser;
    document.getElementById('email-input').value = settings.email;

    // Photo preview
    renderPhotoPreview();
    document.getElementById('photo-url-input').value = '';
    document.getElementById('photo-url-input').style.display = 'none';

    // Sound settings
    document.querySelectorAll('.sound-preset').forEach(p => {
        p.classList.toggle('active', p.dataset.sound === settings.soundType);
    });

    // Update meal time pills
    document.querySelectorAll('.time-pill').forEach(pill => {
        const time = pill.dataset.time;
        pill.classList.toggle('active', settings.mealTimes.includes(time));
    });

    // Show/hide email group
    document.getElementById('email-group').style.display = settings.notifEmail ? 'block' : 'none';

    settingsModal.style.display = 'flex';
}

function closeSettingsModal() {
    settingsModal.style.display = 'none';
}

function saveSettingsFromModal() {
    const prevMealTimes = [...settings.mealTimes];
    const prevNotifBrowser = settings.notifBrowser;

    settings.userName = document.getElementById('user-name-input').value || 'Sayang';
    settings.workerUrl = document.getElementById('worker-url-input').value.replace(/\/+$/, '');
    settings.notifDiscord = document.getElementById('notif-discord').checked;
    settings.notifEmail = document.getElementById('notif-email').checked;
    settings.notifBrowser = document.getElementById('notif-browser').checked;
    settings.email = document.getElementById('email-input').value;

    // Meal times
    settings.mealTimes = Array.from(document.querySelectorAll('.time-pill.active'))
        .map(pill => pill.dataset.time);

    saveSettingsToStorage();
    renderAvatar();
    closeSettingsModal();
    showBadge('✅ Pengaturan tersimpan');

    // Request notification permission if browser notif enabled
    if (settings.notifBrowser && !prevNotifBrowser && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                showBadge('✅ Notifikasi browser diaktifkan');
                // Test notification
                setTimeout(() => {
                    addNotification({
                        title: '🔔 Notif browser aktif!',
                        body: 'Sekarang kamu bakal dapat notif sistem dari aku 🤍',
                        icon: '🔔',
                        type: 'system',
                    });
                }, 1000);
            } else {
                showBadge('⚠️ Permission notif ditolak');
            }
        });
    }

    // Reschedule meal reminders if changed
    if (JSON.stringify(prevMealTimes) !== JSON.stringify(settings.mealTimes)) {
        scheduleMealReminders();
    }
}

// ============ Photo Upload Handlers ============
function handlePhotoUpload(file) {
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
        showBadge('❌ File harus gambar');
        return;
    }

    // Validate size (max 2MB to avoid localStorage issues)
    if (file.size > 2 * 1024 * 1024) {
        showBadge('❌ Ukuran foto max 2MB');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const base64 = e.target.result;
        settings.photoUrl = base64;
        saveSettingsToStorage();
        renderPhotoPreview();
        showBadge('✅ Foto tersimpan');
    };
    reader.onerror = () => {
        showBadge('❌ Gagal baca file');
    };
    reader.readAsDataURL(file);
}

function handlePhotoUrl() {
    const urlInput = document.getElementById('photo-url-input');
    const url = urlInput.value.trim();

    if (!url) {
        showBadge('❌ URL kosong');
        return;
    }

    // Validate URL format
    try {
        new URL(url);
    } catch (e) {
        showBadge('❌ URL tidak valid');
        return;
    }

    settings.photoUrl = url;
    saveSettingsToStorage();
    renderPhotoPreview();
    urlInput.value = '';
    urlInput.style.display = 'none';
    showBadge('✅ Foto dari URL tersimpan');
}

function removePhoto() {
    settings.photoUrl = '';
    saveSettingsToStorage();
    renderPhotoPreview();
    document.getElementById('photo-url-input').style.display = 'none';
    showBadge('🗑️ Foto direset ke 🌸');
}

// ============ Sound Upload Handler ============
function handleSoundUpload(file) {
    if (!file) return;

    if (!file.type.startsWith('audio/')) {
        showBadge('❌ File harus audio (mp3/wav/ogg)');
        return;
    }

    if (file.size > 1 * 1024 * 1024) {
        showBadge('❌ Ukuran audio max 1MB');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        settings.customSoundUrl = e.target.result;
        settings.soundType = 'custom';
        saveSettingsToStorage();

        // Update UI
        document.querySelectorAll('.sound-preset').forEach(p => p.classList.remove('active'));
        const customPreset = document.querySelector('[data-sound="custom"]');
        if (customPreset) {
            customPreset.classList.add('active');
            // Add label if not exists
            if (!customPreset.textContent.includes('✓')) {
                customPreset.textContent = '📁 Custom ✓';
            }
        } else {
            // Create custom preset button
            const customBtn = document.createElement('button');
            customBtn.className = 'sound-preset active';
            customBtn.dataset.sound = 'custom';
            customBtn.textContent = '📁 Custom ✓';
            customBtn.addEventListener('click', () => {
                settings.soundType = 'custom';
                document.querySelectorAll('.sound-preset').forEach(p => p.classList.remove('active'));
                customBtn.classList.add('active');
                playNotifSound();
                saveSettingsToStorage();
            });
            document.querySelector('.sound-presets').appendChild(customBtn);
        }

        showBadge('✅ Bunyi custom tersimpan');
        playNotifSound();  // Test play
    };
    reader.onerror = () => {
        showBadge('❌ Gagal baca file audio');
    };
    reader.readAsDataURL(file);
}

function showBadge(text) {
    const badge = document.createElement('div');
    badge.className = 'notif-badge';
    badge.textContent = text;
    document.body.appendChild(badge);
    setTimeout(() => badge.remove(), 2500);
}

function clearChat() {
    if (!confirm('Hapus semua chat history? Tindakan ini tidak bisa dibatalkan.')) return;
    messages = [];
    saveMessages();
    renderMessages();
    showBadge('🗑️ Chat history dihapus');
}

// ============ Event Listeners ============
function setupEventListeners() {
    // Send button
    sendBtn.addEventListener('click', () => {
        sendMessage(messageInput.value);
    });

    // Enter to send (Shift+Enter for new line)
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage(messageInput.value);
        }
    });

    // Auto-resize
    messageInput.addEventListener('input', autoResize);

    // Settings
    settingsBtn.addEventListener('click', openSettings);
    closeModal.addEventListener('click', closeSettingsModal);
    document.querySelector('.modal-overlay').addEventListener('click', closeSettingsModal);
    saveSettings.addEventListener('click', saveSettingsFromModal);
    clearChatBtn.addEventListener('click', clearChat);

    // Notifications
    notifBtn.addEventListener('click', () => {
        notifPanel.style.display = notifPanel.style.display === 'none' ? 'flex' : 'none';
        // Mark all read when panel opened
        setTimeout(() => {
            notifications.forEach(n => n.read = true);
            saveNotifications();
            renderNotifications();
        }, 2000);
    });
    closeNotifPanel.addEventListener('click', () => {
        notifPanel.style.display = 'none';
    });
    markAllReadBtn.addEventListener('click', () => {
        notifications.forEach(n => n.read = true);
        saveNotifications();
        renderNotifications();
    });

    // Sound presets
    document.querySelectorAll('.sound-preset').forEach(preset => {
        preset.addEventListener('click', () => {
            const sound = preset.dataset.sound;
            settings.soundType = sound;
            if (sound === 'custom' && !settings.customSoundUrl) {
                // Trigger upload
                document.getElementById('custom-sound-file').click();
                return;
            }
            // Update UI
            document.querySelectorAll('.sound-preset').forEach(p => p.classList.remove('active'));
            preset.classList.add('active');
            // Test sound immediately
            if (sound !== 'none') {
                playNotifSound();
            }
            saveSettingsToStorage();
        });
    });

    // Custom sound upload
    document.getElementById('upload-sound-btn').addEventListener('click', () => {
        document.getElementById('custom-sound-file').click();
    });

    document.getElementById('custom-sound-file').addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            handleSoundUpload(e.target.files[0]);
            e.target.value = '';
        }
    });

    // Test sound button
    document.getElementById('test-sound-btn').addEventListener('click', () => {
        playNotifSound();
    });

    // Email checkbox toggle
    document.getElementById('notif-email').addEventListener('change', (e) => {
        document.getElementById('email-group').style.display = e.target.checked ? 'block' : 'none';
    });

    // Meal time pills
    document.querySelectorAll('.time-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            pill.classList.toggle('active');
        });
    });

    // Photo upload handlers
    document.getElementById('upload-photo-btn').addEventListener('click', () => {
        document.getElementById('photo-file').click();
    });

    document.getElementById('photo-file').addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            handlePhotoUpload(e.target.files[0]);
            e.target.value = '';  // Reset input
        }
    });

    document.getElementById('use-url-btn').addEventListener('click', () => {
        const urlInput = document.getElementById('photo-url-input');
        urlInput.style.display = urlInput.style.display === 'none' ? 'block' : 'none';
        if (urlInput.style.display === 'block') {
            urlInput.focus();
        }
    });

    document.getElementById('photo-url-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            handlePhotoUrl();
        }
    });

    document.getElementById('remove-photo-btn').addEventListener('click', removePhoto);

    // Suggestion chips
    document.querySelectorAll('.suggestion-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const msg = chip.dataset.msg;
            messageInput.value = msg;
            autoResize();
            sendMessage(msg);
        });
    });

    // ============ Page Navigation ============
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            switchPage(item.dataset.page);
        });
    });

    // Mobile sidebar toggle
    const menuToggle = document.getElementById('menu-toggle');
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');

    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            sidebarOverlay.style.display = sidebar.classList.contains('open') ? 'block' : 'none';
        });
    }
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            sidebarOverlay.style.display = 'none';
        });
    }

    // Mobile notif button (opens panel like desktop)
    const notifBtnMobile = document.getElementById('notif-btn-mobile');
    if (notifBtnMobile) {
        notifBtnMobile.addEventListener('click', () => {
            document.getElementById('notif-panel').style.display = 'flex';
            setTimeout(() => {
                notifications.forEach(n => n.read = true);
                saveNotifications();
                renderNotifications();
            }, 2000);
        });
    }

    // ============ Notes ============
    const addNoteBtn = document.getElementById('add-note-btn');
    if (addNoteBtn) {
        addNoteBtn.addEventListener('click', () => openNoteModal());
    }

    // ============ Schedule ============
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const tabName = tab.dataset.tab;
            document.getElementById('weekly-content').style.display = tabName === 'weekly' ? 'block' : 'none';
            document.getElementById('gcal-content').style.display = tabName === 'gcal' ? 'block' : 'none';
            if (tabName === 'gcal') renderGCalEvents();
        });
    });

    // Week navigation
    const prevWeek = document.getElementById('prev-week');
    const todayWeek = document.getElementById('today-week');
    const nextWeek = document.getElementById('next-week');

    if (prevWeek) {
        prevWeek.addEventListener('click', () => {
            currentWeekStart.setDate(currentWeekStart.getDate() - 7);
            renderWeekView();
        });
    }
    if (todayWeek) {
        todayWeek.addEventListener('click', () => {
            currentWeekStart = getWeekStart(new Date());
            renderWeekView();
        });
    }
    if (nextWeek) {
        nextWeek.addEventListener('click', () => {
            currentWeekStart.setDate(currentWeekStart.getDate() + 7);
            renderWeekView();
        });
    }

    // Reminder modal
    const closeReminderModalBtn = document.getElementById('close-reminder-modal');
    const cancelReminderBtn = document.getElementById('cancel-reminder');
    const saveReminderBtn = document.getElementById('save-reminder');
    const reminderModal = document.getElementById('add-reminder-modal');

    if (closeReminderModalBtn) closeReminderModalBtn.addEventListener('click', closeReminderModal);
    if (cancelReminderBtn) cancelReminderBtn.addEventListener('click', closeReminderModal);
    if (saveReminderBtn) saveReminderBtn.addEventListener('click', saveReminderFromModal);
    if (reminderModal) {
        reminderModal.querySelector('.modal-overlay').addEventListener('click', closeReminderModal);
    }

    // ICS export
    const exportIcsBtn = document.getElementById('export-ics-btn');
    if (exportIcsBtn) {
        exportIcsBtn.addEventListener('click', exportICS);
    }
}

// ============ Service Worker (for PWA) ============
async function setupServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            // Will register SW later when created
            // await navigator.serviceWorker.register('sw.js');
        } catch (e) {
            console.warn('SW registration failed:', e);
        }
    }
}

// ============ Page Navigation ============
const STORAGE_NOTES_KEY = 'dedek-notes';
const STORAGE_REMINDERS_KEY = 'dedek-reminders';
const MAX_NOTES = 100;

let notes = [];
let reminders = [];  // Local reminders (separate from Worker KV)
let currentWeekStart = getWeekStart(new Date());

function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();  // 0 = Sunday
    const diff = d.getDate() - day;
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

function loadNotes() {
    try {
        const saved = localStorage.getItem(STORAGE_NOTES_KEY);
        notes = saved ? JSON.parse(saved) : [];
    } catch (e) {
        console.warn('Failed to load notes:', e);
        notes = [];
    }
}

function saveNotes() {
    try {
        if (notes.length > MAX_NOTES) {
            notes = notes.slice(0, MAX_NOTES);
        }
        localStorage.setItem(STORAGE_NOTES_KEY, JSON.stringify(notes));
    } catch (e) {
        console.warn('Failed to save notes:', e);
    }
}

function loadReminders() {
    try {
        const saved = localStorage.getItem(STORAGE_REMINDERS_KEY);
        reminders = saved ? JSON.parse(saved) : [];
    } catch (e) {
        console.warn('Failed to load reminders:', e);
        reminders = [];
    }
}

function saveReminders() {
    try {
        localStorage.setItem(STORAGE_REMINDERS_KEY, JSON.stringify(reminders));
        renderNavBadges();
    } catch (e) {
        console.warn('Failed to save reminders:', e);
    }
}

function switchPage(pageName) {
    // Hide all pages
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    // Show selected page
    const page = document.getElementById(`page-${pageName}`);
    if (page) page.classList.add('active');

    // Update nav items
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const navItem = document.querySelector(`.nav-item[data-page="${pageName}"]`);
    if (navItem) navItem.classList.add('active');

    // Update mobile header title
    const titles = { chat: 'Chat', notes: 'Catatan', schedule: 'Jadwal' };
    document.getElementById('mobile-page-title').textContent = titles[pageName] || pageName;

    // Close sidebar on mobile
    if (window.innerWidth <= 768) {
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('sidebar-overlay').style.display = 'none';
    }

    // Render page-specific content
    if (pageName === 'notes') renderNotes();
    if (pageName === 'schedule') renderWeekView();

    // Scroll chat to bottom
    if (pageName === 'chat') {
        setTimeout(() => {
            document.getElementById('chat-area').scrollTop = document.getElementById('chat-area').scrollHeight;
        }, 100);
    }
}

// ============ Notes Feature ============
function renderNotes() {
    const container = document.getElementById('notes-container');
    if (notes.length === 0) {
        container.innerHTML = `
            <div class="notes-empty">
                <div class="empty-icon">📝</div>
                <p>Belum ada catatan</p>
                <small>Klik "Tambah" untuk bikin catatan pertama kamu</small>
            </div>
        `;
        return;
    }

    container.innerHTML = '';
    notes.forEach(note => {
        const card = document.createElement('div');
        card.className = 'note-card';
        card.innerHTML = `
            <div class="note-title">${escapeHtml(note.title || 'Tanpa judul')}</div>
            <div class="note-body">${escapeHtml(note.body || '')}</div>
            <div class="note-time">${formatNotifTime(note.timestamp)}</div>
            <div class="note-actions">
                <button class="note-action-btn edit-note" data-id="${note.id}">✏️</button>
                <button class="note-action-btn danger delete-note" data-id="${note.id}">🗑️</button>
            </div>
        `;
        card.querySelector('.edit-note').addEventListener('click', (e) => {
            e.stopPropagation();
            openNoteModal(note);
        });
        card.querySelector('.delete-note').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteNote(note.id);
        });
        card.addEventListener('click', () => openNoteModal(note));
        container.appendChild(card);
    });
}

function openNoteModal(note = null) {
    // Use simple prompt for now (can be replaced with modal later)
    const isEdit = !!note;
    const title = prompt('Judul catatan:', note?.title || '');
    if (title === null) return;  // User cancelled
    const body = prompt('Isi catatan:', note?.body || '');
    if (body === null) return;

    if (isEdit) {
        note.title = title;
        note.body = body;
        note.updatedAt = Date.now();
    } else {
        notes.unshift({
            id: Date.now() + Math.random(),
            title,
            body,
            timestamp: Date.now(),
        });
    }
    saveNotes();
    renderNotes();
    renderNavBadges();
    showBadge(isEdit ? '✅ Catatan diupdate' : '✅ Catatan tersimpan');
}

function deleteNote(id) {
    if (!confirm('Hapus catatan ini?')) return;
    notes = notes.filter(n => n.id !== id);
    saveNotes();
    renderNotes();
    renderNavBadges();
    showBadge('🗑️ Catatan dihapus');
}

// ============ Schedule Feature ============
function renderWeekView() {
    const grid = document.getElementById('week-grid');
    grid.innerHTML = '';

    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < 7; i++) {
        const date = new Date(currentWeekStart);
        date.setDate(date.getDate() + i);
        const isToday = date.getTime() === today.getTime();

        const dayEvents = reminders.filter(r => {
            const rDate = new Date(r.datetime);
            return rDate.toDateString() === date.toDateString();
        }).sort((a, b) => new Date(a.datetime) - new Date(b.datetime));

        const col = document.createElement('div');
        col.className = `day-column ${isToday ? 'today' : ''}`;
        col.innerHTML = `
            <div class="day-header">
                <div class="day-name">${days[i]}</div>
                <div class="day-number">${date.getDate()}</div>
            </div>
            <div class="day-events">
                ${dayEvents.length > 0
                    ? dayEvents.map(e => `
                        <div class="event-pill" data-id="${e.id}">
                            <div class="event-time">${formatTime(e.datetime)}</div>
                            <div class="event-title">${escapeHtml(e.title)}</div>
                        </div>
                    `).join('')
                    : '<div class="no-events">Tidak ada jadwal</div>'
                }
            </div>
        `;

        // Click on empty area to add event
        col.addEventListener('click', (e) => {
            if (e.target.classList.contains('day-column') || e.target.classList.contains('day-events') || e.target.classList.contains('no-events')) {
                openReminderModal(date);
            }
        });

        // Click event to view/edit
        col.querySelectorAll('.event-pill').forEach(pill => {
            pill.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = parseFloat(pill.dataset.id);
                const reminder = reminders.find(r => r.id === id);
                if (reminder) openReminderModal(null, reminder);
            });
        });

        grid.appendChild(col);
    }
}

function formatTime(datetime) {
    const d = new Date(datetime);
    return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function openReminderModal(date = null, existingReminder = null) {
    const modal = document.getElementById('add-reminder-modal');
    const isEdit = !!existingReminder;

    // Reset form
    document.getElementById('reminder-title').value = '';
    document.getElementById('reminder-desc').value = '';
    document.getElementById('reminder-time').value = '09:00';
    document.getElementById('reminder-repeat').value = 'none';
    document.getElementById('reminder-notif-local').checked = true;
    document.getElementById('reminder-notif-discord').checked = false;
    document.getElementById('reminder-notif-email').checked = false;

    // Set date
    const dateInput = document.getElementById('reminder-date');
    if (date) {
        dateInput.value = date.toISOString().split('T')[0];
    } else if (existingReminder) {
        const d = new Date(existingReminder.datetime);
        dateInput.value = d.toISOString().split('T')[0];
        document.getElementById('reminder-title').value = existingReminder.title;
        document.getElementById('reminder-desc').value = existingReminder.description || '';
        document.getElementById('reminder-time').value = d.toTimeString().substring(0, 5);
        document.getElementById('reminder-repeat').value = existingReminder.repeat || 'none';
        document.getElementById('reminder-notif-local').checked = existingReminder.notify?.local ?? true;
        document.getElementById('reminder-notif-discord').checked = existingReminder.notify?.discord ?? false;
        document.getElementById('reminder-notif-email').checked = existingReminder.notify?.email ?? false;
    } else {
        dateInput.value = new Date().toISOString().split('T')[0];
    }

    modal.style.display = 'flex';
    modal.dataset.editId = isEdit ? existingReminder.id : '';
}

function closeReminderModal() {
    document.getElementById('add-reminder-modal').style.display = 'none';
}

function saveReminderFromModal() {
    const title = document.getElementById('reminder-title').value.trim();
    const date = document.getElementById('reminder-date').value;
    const time = document.getElementById('reminder-time').value;
    const desc = document.getElementById('reminder-desc').value.trim();
    const repeat = document.getElementById('reminder-repeat').value;

    if (!title) {
        showBadge('❌ Judul wajib diisi');
        return;
    }
    if (!date || !time) {
        showBadge('❌ Tanggal dan jam wajib diisi');
        return;
    }

    const datetime = new Date(`${date}T${time}:00`);
    const editId = document.getElementById('add-reminder-modal').dataset.editId;

    const reminderData = {
        id: editId ? parseFloat(editId) : Date.now() + Math.random(),
        title,
        description: desc,
        datetime: datetime.toISOString(),
        repeat,
        notify: {
            local: document.getElementById('reminder-notif-local').checked,
            discord: document.getElementById('reminder-notif-discord').checked,
            email: document.getElementById('reminder-notif-email').checked,
        },
        createdAt: Date.now(),
    };

    if (editId) {
        const idx = reminders.findIndex(r => r.id === parseFloat(editId));
        if (idx >= 0) reminders[idx] = { ...reminders[idx], ...reminderData };
    } else {
        reminders.push(reminderData);
    }

    saveReminders();
    closeReminderModal();
    renderWeekView();
    scheduleLocalReminders();
    showBadge(editId ? '✅ Jadwal diupdate' : '✅ Jadwal ditambahkan');

    // Sync to Worker if Discord/email enabled
    if (reminderData.notify.discord || reminderData.notify.email) {
        syncReminderToWorker(reminderData);
    }
}

function deleteReminder(id) {
    if (!confirm('Hapus jadwal ini?')) return;
    reminders = reminders.filter(r => r.id !== id);
    saveReminders();
    renderWeekView();
    scheduleLocalReminders();
    showBadge('🗑️ Jadwal dihapus');
}

// ============ Local Reminder Scheduling ============
let scheduledReminderTimers = [];

function scheduleLocalReminders() {
    // Clear existing
    scheduledReminderTimers.forEach(id => clearTimeout(id));
    scheduledReminderTimers = [];

    const now = Date.now();

    reminders.forEach(reminder => {
        const fireTime = new Date(reminder.datetime).getTime();
        const delay = fireTime - now;

        // Schedule if within next 24 hours
        if (delay > 0 && delay < 86400000 && reminder.notify?.local) {
            const timerId = setTimeout(() => {
                addNotification({
                    title: `⏰ ${reminder.title}`,
                    body: reminder.description || 'Waktunya nih sayang! 🤍',
                    icon: '⏰',
                    type: 'reminder',
                });
            }, delay);
            scheduledReminderTimers.push(timerId);
        }
    });
}

async function syncReminderToWorker(reminder) {
    if (!settings.workerUrl) return;

    try {
        await fetch(`${settings.workerUrl}/reminders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                task: reminder.title,
                remind_at: reminder.datetime,
                user_name: settings.userName,
                notify: {
                    discord: reminder.notify.discord,
                    email: reminder.notify.email && settings.email,
                    email_to: settings.email,
                },
            }),
        });
    } catch (e) {
        console.warn('Failed to sync reminder to Worker:', e);
    }
}

// ============ ICS Export (Google Calendar) ============
function exportICS() {
    if (reminders.length === 0) {
        showBadge('❌ Belum ada jadwal untuk di-export');
        return;
    }

    let ics = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Dedek Tersayang//Web App//ID',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
    ];

    reminders.forEach(r => {
        const dt = new Date(r.datetime);
        const dtStart = dt.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
        const dtEnd = new Date(dt.getTime() + 3600000).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
        const dtStamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

        ics.push('BEGIN:VEVENT');
        ics.push(`UID:${r.id}@dedek-tersayang`);
        ics.push(`DTSTAMP:${dtStamp}`);
        ics.push(`DTSTART:${dtStart}`);
        ics.push(`DTEND:${dtEnd}`);
        ics.push(`SUMMARY:${escapeICS(r.title)}`);
        if (r.description) ics.push(`DESCRIPTION:${escapeICS(r.description)}`);
        ics.push('END:VEVENT');
    });

    ics.push('END:VCALENDAR');

    // Download
    const blob = new Blob([ics.join('\r\n')], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dedek-jadwal-${new Date().toISOString().split('T')[0]}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showBadge('✅ File .ics terdownload! Import ke Google Calendar');
}

function escapeICS(text) {
    return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function renderGCalEvents() {
    const list = document.getElementById('gcal-events-list');
    if (reminders.length === 0) {
        list.innerHTML = '<p style="color: var(--text-muted); font-size: 13px;">Belum ada jadwal</p>';
        return;
    }

    const upcoming = reminders
        .filter(r => new Date(r.datetime) >= new Date())
        .sort((a, b) => new Date(a.datetime) - new Date(b.datetime))
        .slice(0, 10);

    list.innerHTML = upcoming.map(r => `
        <div class="event-pill" style="margin-bottom: 6px">
            <div class="event-time">${new Date(r.datetime).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</div>
            <div class="event-title">${escapeHtml(r.title)}</div>
        </div>
    `).join('');
}

// ============ Navigation Badges ============
function renderNavBadges() {
    const notesBadge = document.getElementById('notes-badge');
    const scheduleBadge = document.getElementById('schedule-badge');

    notesBadge.textContent = notes.length;
    notesBadge.style.display = notes.length > 0 ? 'flex' : 'none';

    const upcoming = reminders.filter(r => new Date(r.datetime) >= new Date()).length;
    scheduleBadge.textContent = upcoming;
    scheduleBadge.style.display = upcoming > 0 ? 'flex' : 'none';
}

// ============ Init on load ============
window.addEventListener('DOMContentLoaded', () => {
    init();
    loadNotes();
    loadReminders();
    renderNavBadges();
    scheduleLocalReminders();
});
