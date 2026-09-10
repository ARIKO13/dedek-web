/* ========================================
   Dedek Tersayang - Web Chat App
   Frontend logic for chat + reminder
   ======================================== */

const STORAGE_KEY = 'dedek-chat-history';
const SETTINGS_KEY = 'dedek-settings';
const MAX_HISTORY = 50;

// Default settings
const DEFAULT_SETTINGS = {
    userName: 'Sayang',
    workerUrl: '',  // Will be set by user
    notifDiscord: true,
    notifEmail: true,
    notifBrowser: false,
    email: '',
    mealTimes: ['12:00', '18:00', '21:00'],
    photoUrl: '',  // URL foto profil (atau base64 data URL dari upload)
};

// State
let settings = { ...DEFAULT_SETTINGS };
let messages = [];
let isTyping = false;

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

// ============ Initialize ============
function init() {
    loadSettings();
    loadMessages();
    renderMessages();
    renderAvatar();
    setupEventListeners();
    setupServiceWorker();
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
    if (!settings.notifBrowser) return;

    const delay = reminder.time.getTime() - Date.now();
    if (delay <= 0) return;

    setTimeout(() => {
        if (Notification.permission === 'granted') {
            new Notification('🌸 Dedek Tersayang', {
                body: `Sayang, waktunya: ${reminder.task} ⏰`,
                icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🌸</text></svg>',
            });
        }
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
    if (settings.notifBrowser && Notification.permission === 'default') {
        Notification.requestPermission();
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
