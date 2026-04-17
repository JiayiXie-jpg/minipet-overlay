const petContainer = document.getElementById('pet-container');
const ttsPlayer = document.getElementById('tts-player');

const STATES = ['sitting', 'sleeping', 'eating', 'happy', 'talking'];
const videos = {};
for (const s of STATES) {
  videos[s] = document.getElementById('vid-' + s);
}

let currentState = 'sitting';

let currentDna = null;

function switchAvatar(dna) {
  if (dna === currentDna) return;
  currentDna = dna;
  const base = dna ? `/assets/avatar/${dna}` : '/assets/shasha';
  for (const s of STATES) {
    videos[s].src = `${base}/${s}.webm`;
    videos[s].load();
  }
  videos[currentState].oncanplay = () => {
    videos[currentState].play().catch(() => {});
  };
}

// Load initial avatar config
(async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    if (config.customAvatar && config.activeDna) {
      switchAvatar(config.activeDna);
    }
  } catch {}
})();

function switchState(newState) {
  if (!videos[newState] || newState === currentState) return;
  const prev = currentState;
  currentState = newState;
  const vid = videos[newState];
  vid.currentTime = 0;

  // Start loading new video, keep old one visible until new one plays
  vid.classList.add('active');

  function onPlaying() {
    vid.removeEventListener('playing', onPlaying);
    videos[prev].classList.remove('active');
    videos[prev].pause();
  }

  vid.addEventListener('playing', onPlaying);

  if (vid.readyState >= 3) {
    vid.play().catch(() => {});
  } else {
    vid.load();
    vid.oncanplay = () => {
      vid.oncanplay = null;
      vid.play().catch(() => {});
    };
  }
}

// Start default (for non-custom avatar)
videos.sitting.play().catch(() => {});

// Click: bounce + voice
const CLICK_MESSAGES = [
  '嘿～戳我干嘛，快去写代码！',
  '哎呀～被发现偷懒了！',
  '代码也像人生一样，坚持就会有收获～',
  '今天也要加油鸭，我陪着你！',
  '嘿嘿，摸摸头～继续写吧！',
  '累了就休息一下，我等你～',
  '你今天喝水了吗？记得补充水分哦～',
  '相信自己，你也可以成为自己的冠军！',
];
let clickCooldown = false;

// Drag + click detection
let dragStartX = 0, dragStartY = 0, isDragging = false;

petContainer.addEventListener('mousedown', (e) => {
  dragStartX = e.screenX;
  dragStartY = e.screenY;
  isDragging = false;

  const onMouseMove = (ev) => {
    const dx = ev.screenX - dragStartX;
    const dy = ev.screenY - dragStartY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) isDragging = true;
    if (isDragging && window.electronAPI) {
      window.electronAPI.windowDrag(dx, dy);
      dragStartX = ev.screenX;
      dragStartY = ev.screenY;
    }
  };

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    if (!isDragging) handleClick();
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
});

function handleClick() {
  petContainer.style.transform = 'translateX(-50%) scale(1.1)';
  setTimeout(() => { petContainer.style.transform = 'translateX(-50%) scale(1)'; }, 200);

  if (clickCooldown) return;
  clickCooldown = true;
  setTimeout(() => { clickCooldown = false; }, 3000);

  const msg = CLICK_MESSAGES[Math.floor(Math.random() * CLICK_MESSAGES.length)];
  switchState('happy');
  setTimeout(() => { if (currentState === 'happy') switchState('sitting'); }, 5000);

  fetch('/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'click', message: msg, petState: 'happy', withTTS: true }),
  }).catch(() => {});
}

// WebSocket
function connect() {
  const ws = new WebSocket('ws://127.0.0.1:3210/ws');

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'avatar_switch') {
      switchAvatar(data.dna);
    }

    if (data.type === 'state_change' && data.newState) {
      switchState(data.newState);
    }

    if (data.type === 'bubble') {
      if (data.audioUrl) {
        // Only switch to talking if in idle state (don't override happy/eating)
        const wasIdle = currentState === 'sitting' || currentState === 'sleeping';
        if (wasIdle) switchState('talking');
        playAudio(data.audioUrl, () => {
          if (currentState === 'talking') switchState('sitting');
        });
      }
    }
  };

  ws.onclose = () => setTimeout(connect, 3000);
  ws.onerror = () => ws.close();
}

function playAudio(url, onEnd) {
  ttsPlayer.src = url;
  ttsPlayer.load();
  if (onEnd) {
    ttsPlayer.onended = onEnd;
  }
  const p = ttsPlayer.play();
  if (p) p.catch(() => {
    const fallback = new Audio(url);
    if (onEnd) fallback.onended = onEnd;
    fallback.play().catch(() => {});
  });
}

connect();
