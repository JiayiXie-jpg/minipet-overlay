import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = parseInt(process.env.PORT || '3210', 10);
// __dirname is dist/ after compilation, project root is one level up
const ROOT_DIR = path.join(__dirname, '..');
const TTS_DIR = path.join(ROOT_DIR, 'assets', 'tts');
fs.mkdirSync(TTS_DIR, { recursive: true });

const DATA_DIR = path.join(os.homedir(), '.minipet-overlay');
const AVATARS_DIR = path.join(DATA_DIR, 'avatars');
const BINDINGS_FILE = path.join(DATA_DIR, 'bindings.json');

function loadBindings(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(BINDINGS_FILE, 'utf-8')); } catch { return {}; }
}

function resolveAvatar(dna: string): string | null {
  const bindings = loadBindings();
  const name = bindings[dna];
  if (name && hasAvatarForName(name)) return name;
  return null;
}

function hasAvatarForName(name: string): boolean {
  try {
    return fs.existsSync(path.join(AVATARS_DIR, name, 'matted', 'sitting.webm'));
  } catch { return false; }
}

// ---- TTS (豆包 seed-tts-2.0) ----

let TTS_ACCESS_KEY = process.env.TTS_ACCESS_KEY || '';
let TTS_APP_KEY = process.env.TTS_APP_KEY || '';

const DIY_SERVER = process.env.DIY_SERVER || 'http://118.196.36.27:8765';

async function fetchTTSCredentials() {
  if (TTS_ACCESS_KEY && TTS_APP_KEY) return; // already set via env
  try {
    const authPath = path.join(os.homedir(), '.claude-minipet', 'auth.json');
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    if (!auth?.token) return;
    const res = await fetch(`${DIY_SERVER}/api/credentials/tts`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    if (res.ok) {
      const data = await res.json() as { accessKey: string; appKey: string };
      TTS_ACCESS_KEY = data.accessKey;
      TTS_APP_KEY = data.appKey;
      console.log('[TTS] Credentials fetched from server');
    }
  } catch {
    console.log('[TTS] Could not fetch credentials, voice disabled');
  }
}

fetchTTSCredentials();

async function textToSpeech(text: string): Promise<string | null> {
  if (!TTS_ACCESS_KEY || !TTS_APP_KEY) {
    console.error('[TTS] Missing TTS_ACCESS_KEY or TTS_APP_KEY env vars');
    return null;
  }
  try {
    const resp = await fetch('https://openspeech.bytedance.com/api/v3/tts/unidirectional', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Access-Key': TTS_ACCESS_KEY,
        'X-Api-App-Key': TTS_APP_KEY,
        'X-Api-Resource-Id': 'seed-tts-2.0',
      },
      body: JSON.stringify({
        user: { uid: 'desktop_pet' },
        req_params: {
          text,
          speaker: 'zh_female_xiaohe_uranus_bigtts',
          audio_params: { format: 'mp3', sample_rate: 24000 },
        },
      }),
    });
    if (!resp.ok) { console.error('[TTS] HTTP error:', resp.status); return null; }
    const body = await resp.text();
    const lines = body.split('\n').filter(l => l.trim());
    const audioParts: Buffer[] = [];
    for (const line of lines) {
      try {
        const chunk = JSON.parse(line);
        if (chunk.data) audioParts.push(Buffer.from(chunk.data, 'base64'));
      } catch {}
    }
    if (audioParts.length === 0) { console.error('[TTS] No audio data in response'); return null; }
    const audio = Buffer.concat(audioParts);
    const filename = `tts_${Date.now()}.mp3`;
    fs.writeFileSync(path.join(TTS_DIR, filename), audio);
    console.log(`[TTS] "${text.slice(0, 20)}..." (${audio.length} bytes)`);
    // Keep last 50 files
    const files = fs.readdirSync(TTS_DIR).filter(f => f.endsWith('.mp3')).sort();
    while (files.length > 50) { fs.unlinkSync(path.join(TTS_DIR, files.shift()!)); }
    return `/assets/tts/${filename}`;
  } catch (err) {
    console.error('[TTS] Error:', err);
    return null;
  }
}

// ---- App ----

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const clients = new Set<WebSocket>();
wss.on('connection', (ws) => {
  clients.add(ws);
  // Send current state and active avatar on connect
  ws.send(JSON.stringify({ type: 'state_change', newState: currentState }));
  if (activeAvatar) {
    ws.send(JSON.stringify({ type: 'avatar_switch', dna: activeAvatar }));
  }
  ws.on('close', () => clients.delete(ws));
});

function broadcast(msg: Record<string, any>) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

let currentState = 'sitting';

app.use(express.json());
app.use('/assets', express.static(path.join(ROOT_DIR, 'assets')));
app.use(express.static(path.join(ROOT_DIR, 'frontend')));

// Active avatar name (null = default shasha)
let activeAvatar: string | null = null;
let manualOverride = false; // true = user manually chose avatar via `use` command

// Serve avatar assets: /assets/avatar/:name/:file
app.get('/assets/avatar/:name/:file', (req, res) => {
  const { name, file } = req.params;
  const filePath = path.join(AVATARS_DIR, name, 'matted', file);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).end();
  }
});

app.get('/api/config', (_req, res) => {
  res.json({ activeDna: activeAvatar, customAvatar: activeAvatar !== null });
});

// ---- Persona messages (generated from structured events) ----

const EVENT_MESSAGES: Record<string, string[]> = {
  coding_start: [
    '开始干活啦～我陪你一起！',
    '加油写代码！坚持就是胜利～',
    '冲鸭！我在这里给你加油～',
  ],
  coding_done: [
    '任务完成啦！你真棒～',
    '搞定了！今天也是很厉害的一天～',
    '好耶！休息一下吧～',
  ],
  mood_up: [
    '代码跑通啦～越放下来的时候，反而你会更轻松！',
    '太棒了！继续保持这个状态～',
  ],
  mood_low: [
    '别灰心～在最痛苦的时候，也能够再多坚持一下！',
    '没关系的，杀不死我们的终会让我们更加强大～',
  ],
  session_start: [
    '嗨～又见面啦，今天也一起加油吧！',
    '欢迎回来！一直在等你～',
  ],
  level_up: [
    '升级啦～真正的伟大，永远知道如何重新出发！',
    '厉害了！只要为梦想拼尽全力，每个人都可以成为自己的冠军！',
  ],
  stage_up: [
    '进化啦～坚持就是胜利！',
  ],
  evolution: [
    '进化成功！这就是坚持的力量～',
  ],
  easter_egg: [
    '嘿嘿，被你发现了～',
  ],
  comment: [],  // no default message for comments
};

function pickMessage(type: string): string | null {
  const msgs = EVENT_MESSAGES[type];
  if (!msgs || msgs.length === 0) return null;
  return msgs[Math.floor(Math.random() * msgs.length)];
}

// ---- Cooldown for TTS (avoid spamming) ----

const ttsCooldowns = new Map<string, number>();
const TTS_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

// Events that always trigger TTS (no cooldown)
const ALWAYS_TTS = new Set(['coding_done', 'level_up', 'stage_up', 'evolution', 'session_start']);

function shouldTTS(type: string): boolean {
  if (ALWAYS_TTS.has(type)) return true;
  const last = ttsCooldowns.get(type) || 0;
  if (Date.now() - last < TTS_COOLDOWN_MS) return false;
  ttsCooldowns.set(type, Date.now());
  return true;
}

// Receive events from claude-minipet (structured data) or direct calls (with message)
app.post('/event', async (req, res) => {
  const { type, message, petState, withTTS, level, mood, dna } = req.body;
  console.log(`[Event] ${type} state=${petState || '-'} dna=${dna || '-'} msg=${message || '-'}`);

  // Manual avatar switch (from CLI `use` command)
  if (type === 'avatar_switch_manual') {
    const switchName = req.body.dna; // dna field reused as avatar name
    activeAvatar = switchName;
    manualOverride = true;
    broadcast({ type: 'avatar_switch', dna: switchName });
    res.json({ ok: true });
    return;
  }

  // Auto-resolve DNA to avatar name via bindings (skip if user manually chose)
  if (!manualOverride && dna) {
    const avatarName = resolveAvatar(dna);
    if (avatarName && avatarName !== activeAvatar) {
      activeAvatar = avatarName;
      broadcast({ type: 'avatar_switch', dna: avatarName });
    } else if (!avatarName && activeAvatar !== null) {
      // No binding for this DNA, switch to default
      activeAvatar = null;
      broadcast({ type: 'avatar_switch', dna: null });
    }
  }

  // Switch animation state
  if (petState && ['sitting', 'sleeping', 'eating', 'happy', 'talking'].includes(petState)) {
    currentState = petState;
    broadcast({ type: 'state_change', newState: petState });

    // Auto revert to sitting after a timeout (except sitting/sleeping)
    if (petState !== 'sitting' && petState !== 'sleeping') {
      const revertDelay = petState === 'eating' ? 30000 : 8000;
      setTimeout(() => {
        if (currentState === petState) {
          currentState = 'sitting';
          broadcast({ type: 'state_change', newState: 'sitting' });
        }
      }, revertDelay);
    }
  }

  // Determine message: use provided message, or generate from persona
  const text = message || pickMessage(type);

  if (text) {
    let audioUrl: string | null = null;
    // TTS if explicitly requested, or for structured events with cooldown
    if (withTTS || (!message && shouldTTS(type))) {
      audioUrl = await textToSpeech(text);
    }
    broadcast({ type: 'bubble', message: text, audioUrl });
  }

  res.json({ ok: true });
});

// ---- Meal reminders ----

const MEAL_REMINDERS: Record<string, string> = {
  '08:00': '早上好呀～该吃早饭啦！吃饱了才有力气写代码，一日之计在于晨嘛～',
  '12:00': '中午啦！放下键盘去吃饭吧～下午还要继续战斗呢，补充好能量才能赢！',
  '18:00': '晚饭时间到～今天辛苦了，好好吃一顿犒劳自己吧！杀不死我们的终会让我们更加强大～',
};
const mealTriggered = new Set<string>();

setInterval(async () => {
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const dateKey = `${now.toDateString()}_${hhmm}`;

  if (MEAL_REMINDERS[hhmm] && !mealTriggered.has(dateKey)) {
    mealTriggered.add(dateKey);
    const message = MEAL_REMINDERS[hhmm];
    console.log(`[Meal] ${hhmm} - ${message}`);

    currentState = 'eating';
    broadcast({ type: 'state_change', newState: 'eating' });

    const audioUrl = await textToSpeech(message);
    broadcast({ type: 'bubble', message, audioUrl });

    // 30s later switch back to sitting
    setTimeout(() => {
      if (currentState === 'eating') {
        currentState = 'sitting';
        broadcast({ type: 'state_change', newState: 'sitting' });
      }
    }, 30000);

    // Clean old triggers
    for (const key of mealTriggered) {
      if (!key.startsWith(now.toDateString())) mealTriggered.delete(key);
    }
  }
}, 30000);

// ---- Rest reminder (every ~1 hour of activity) ----

const REST_MESSAGES = [
  '已经写了一个小时代码啦～站起来活动活动吧！',
  '休息一下吧～眼睛看看远处，伸个懒腰～',
  '一小时到啦！去喝杯水，活动一下筋骨吧～',
  '别忘了休息哦～适当放松才能更高效！',
];

let lastRestReminder = Date.now();

setInterval(async () => {
  const elapsed = Date.now() - lastRestReminder;
  if (elapsed >= 60 * 60 * 1000) {
    lastRestReminder = Date.now();
    const message = REST_MESSAGES[Math.floor(Math.random() * REST_MESSAGES.length)];
    console.log(`[Rest] ${message}`);

    currentState = 'happy';
    broadcast({ type: 'state_change', newState: 'happy' });

    const audioUrl = await textToSpeech(message);
    broadcast({ type: 'bubble', message, audioUrl });

    setTimeout(() => {
      if (currentState === 'happy') {
        currentState = 'sitting';
        broadcast({ type: 'state_change', newState: 'sitting' });
      }
    }, 10000);
  }
}, 60000);

// ---- Migrate old custom/ to avatars/<dna>/ ----

function migrateOldCustom() {
  const oldDir = path.join(DATA_DIR, 'custom', 'matted');
  if (!fs.existsSync(path.join(oldDir, 'sitting.webm'))) return;
  // Read local DNA
  try {
    const statePath = path.join(os.homedir(), '.claude-minipet', 'state.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    const dna = state.dna;
    if (!dna) return;
    const newDir = path.join(AVATARS_DIR, dna);
    if (fs.existsSync(path.join(newDir, 'matted', 'sitting.webm'))) return; // already migrated
    console.log(`[Migrate] Moving custom/ to avatars/${dna}/`);
    fs.mkdirSync(path.join(newDir, 'matted'), { recursive: true });
    for (const file of fs.readdirSync(oldDir)) {
      fs.renameSync(path.join(oldDir, file), path.join(newDir, 'matted', file));
    }
    // Move manifest if exists
    const oldManifest = path.join(DATA_DIR, 'custom', 'manifest.json');
    if (fs.existsSync(oldManifest)) {
      fs.renameSync(oldManifest, path.join(newDir, 'manifest.json'));
    }
    activeAvatar = dna;
    console.log(`[Migrate] Done. Active avatar: ${dna}`);
  } catch (err) {
    console.error('[Migrate] Failed:', err);
  }
}

migrateOldCustom();

// ---- Start ----

export function startServer(): Promise<void> {
  return new Promise((resolve) => {
    server.listen(PORT, '127.0.0.1', () => {
      console.log(`minipet-overlay running on http://127.0.0.1:${PORT}`);
      resolve();
    });
  });
}

// Allow direct execution: node dist/server.js
if (process.argv[1]?.endsWith('server.js') || process.argv[1]?.endsWith('server.ts')) {
  startServer();
}
