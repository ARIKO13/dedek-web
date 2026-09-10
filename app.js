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
        // Check if it's a reminder request
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
    try {
        // Save reminder to Worker
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
        const replyText = `✅ Siap sayang! Aku ingetin kamu untuk **${reminder.task}** pada ${timeStr} ya 🌸`;

        const botMsg = { text: replyText, role: 'bot', timestamp: Date.now() };
        messages.push(botMsg);
        addMessageToDOM(replyText, 'bot', botMsg.timestamp);
        saveMessages();
    } catch (error) {
        hideTyping();
        // Even if Worker fails, save locally for browser notification
        scheduleBrowserReminder(reminder);
        const replyText = `✅ Aku catet ya sayang! Tapi Worker belum setup, jadi cuma bisa ingetin via browser kalau web ini kebuka 🌸\nReminder: **${reminder.task}** pada ${reminder.time.toLocaleString('id-ID')}`;

        const botMsg = { text: replyText, role: 'bot', timestamp: Date.now() };
        messages.push(botMsg);
        addMessageToDOM(replyText, 'bot', botMsg.timestamp);
        saveMessages();
    }
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

// ============ Init on load ============
window.addEventListener('DOMContentLoaded', init);
