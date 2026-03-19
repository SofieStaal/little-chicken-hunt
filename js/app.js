// ── State ──
const COLORS = ['blue', 'green', 'pink', 'purple', 'yellow'];
const COLOR_DISPLAY = {
  blue: 'Blue', green: 'Green', pink: 'Pink', purple: 'Purple', yellow: 'Yellow'
};

// HSL ranges tuned to the actual fluffy Easter chickens:
// Blue: pastel baby blue (very light, low saturation)
// Green: bright lime green
// Pink: soft pink/light magenta (lighter, less saturated than purple)
// Purple: vivid magenta-purple (darker, more saturated than pink)
// Yellow: classic bright yellow
// Pink vs purple is tricky — we split on lightness: pink is lighter (l>50), purple is darker
const COLOR_RANGES = {
  blue:   { hMin: 170, hMax: 210, sMin: 15, lMin: 55, lMax: 90 },
  green:  { hMin: 70,  hMax: 160, sMin: 25, lMin: 30, lMax: 80 },
  pink:   { hMin: 290, hMax: 360, sMin: 15, lMin: 55, lMax: 90 },
  purple: { hMin: 270, hMax: 320, sMin: 25, lMin: 20, lMax: 55 },
  yellow: { hMin: 38,  hMax: 70,  sMin: 35, lMin: 45, lMax: 85 },
};

const CSS_COLORS = {
  blue: '#4A90D9', green: '#4CAF50', pink: '#FF69B4',
  purple: '#9C27B0', yellow: '#FFD700'
};

let foundChickens = JSON.parse(localStorage.getItem('foundChickens') || '[]');
let stream = null;
let scanInterval = null;
let detectionBuffer = [];
const DETECTION_THRESHOLD = 15; // frames of consistent detection before confirming

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  updateUI();
});

function updateUI() {
  const cards = document.querySelectorAll('.chicken-card');
  cards.forEach(card => {
    const color = card.dataset.color;
    if (foundChickens.includes(color)) {
      card.classList.add('found');
    } else {
      card.classList.remove('found');
    }
  });

  const count = foundChickens.length;
  document.getElementById('progress-fill').style.width = `${(count / 5) * 100}%`;
  document.getElementById('progress-text').textContent = `${count} / 5 found`;

  // Check victory
  if (count === 5) {
    showScreen('screen-victory');
    startConfetti();
  }
}

// ── Navigation ──
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function openScanner() {
  if (foundChickens.length === 5) {
    showScreen('screen-victory');
    startConfetti();
    return;
  }
  showScreen('screen-scanner');
  startCamera();
}

function closeScanner() {
  stopCamera();
  showScreen('screen-home');
  updateUI();
}

// ── Camera ──
async function startCamera() {
  const video = document.getElementById('camera-feed');
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    video.srcObject = stream;
    await video.play();
    startScanning();
  } catch (err) {
    document.getElementById('scanner-hint').textContent =
      'Camera access needed. Please allow camera permissions.';
  }
}

function stopCamera() {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  detectionBuffer = [];
}

// ── Color Detection ──
function startScanning() {
  const video = document.getElementById('camera-feed');
  const canvas = document.getElementById('camera-canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  scanInterval = setInterval(() => {
    if (video.readyState < 2) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    // Sample the center region (circle area)
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = Math.min(canvas.width, canvas.height) * 0.15;

    const colorCounts = {};
    let totalSampled = 0;

    // Sample pixels in a grid within the center circle
    const step = 4;
    for (let x = centerX - radius; x < centerX + radius; x += step) {
      for (let y = centerY - radius; y < centerY + radius; y += step) {
        const dx = x - centerX;
        const dy = y - centerY;
        if (dx * dx + dy * dy > radius * radius) continue;

        const pixel = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
        const [h, s, l] = rgbToHsl(pixel[0], pixel[1], pixel[2]);

        const matched = matchColor(h, s, l);
        if (matched) {
          colorCounts[matched] = (colorCounts[matched] || 0) + 1;
        }
        totalSampled++;
      }
    }

    // Find dominant color
    let dominant = null;
    let maxCount = 0;
    for (const [color, count] of Object.entries(colorCounts)) {
      if (count > maxCount) {
        maxCount = count;
        dominant = color;
      }
    }

    const ratio = totalSampled > 0 ? maxCount / totalSampled : 0;
    const dot = document.getElementById('detected-dot');
    const label = document.getElementById('detected-label');
    const reticle = document.querySelector('.scan-reticle');

    if (dominant && ratio > 0.3) {
      dot.style.background = CSS_COLORS[dominant];
      label.textContent = `${COLOR_DISPLAY[dominant]} detected!`;
      reticle.classList.add('detected');

      detectionBuffer.push(dominant);
      if (detectionBuffer.length > DETECTION_THRESHOLD) {
        detectionBuffer.shift();
      }

      // Check if we have consistent detection
      const consistent = detectionBuffer.length === DETECTION_THRESHOLD &&
        detectionBuffer.every(c => c === dominant);

      if (consistent) {
        registerChicken(dominant);
        detectionBuffer = [];
      }
    } else {
      dot.style.background = '#666';
      label.textContent = 'Searching...';
      reticle.classList.remove('detected');
      detectionBuffer = [];
    }
  }, 100);
}

function matchColor(h, s, l) {
  for (const [color, range] of Object.entries(COLOR_RANGES)) {
    if (h >= range.hMin && h <= range.hMax &&
        s >= range.sMin &&
        l >= range.lMin && l <= range.lMax) {
      return color;
    }
  }
  return null;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;

  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

// ── Register found chicken ──
function registerChicken(color) {
  if (foundChickens.includes(color)) {
    showToast(`You already found the ${COLOR_DISPLAY[color]} chicken!`);
    return;
  }

  foundChickens.push(color);
  localStorage.setItem('foundChickens', JSON.stringify(foundChickens));

  stopCamera();

  // Show popup
  const popup = document.getElementById('popup-found');
  document.getElementById('popup-color-name').textContent = COLOR_DISPLAY[color];
  document.getElementById('popup-color-name').style.color = CSS_COLORS[color];
  document.getElementById('popup-count').textContent = `${foundChickens.length} / 5`;

  // Show the actual chicken photo
  document.getElementById('popup-chicken-icon').innerHTML =
    `<img src="${color}.png" alt="${COLOR_DISPLAY[color]} chicken" style="width:100%;height:100%;object-fit:contain;">`;

  if (foundChickens.length === 5) {
    document.querySelector('.popup-btn').textContent = 'Claim Your Reward!';
    document.getElementById('popup-title').textContent = 'ALL FOUND!';
    document.getElementById('popup-message').innerHTML =
      'You found every chicken! Time to claim your <strong>Easter egg</strong>!';
  } else {
    document.querySelector('.popup-btn').textContent = 'Keep Hunting!';
    document.getElementById('popup-title').textContent = 'You found one!';
    document.getElementById('popup-message').innerHTML =
      `The <strong style="color:${CSS_COLORS[color]}">${COLOR_DISPLAY[color]}</strong> chicken has been collected!`;
  }

  popup.classList.add('active');
}

function closePopup() {
  document.getElementById('popup-found').classList.remove('active');
  if (foundChickens.length === 5) {
    showScreen('screen-victory');
    startConfetti();
  } else {
    showScreen('screen-home');
    updateUI();
  }
}

function showToast(msg) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

// ── Reset ──
function resetProgress() {
  foundChickens = [];
  localStorage.removeItem('foundChickens');
  updateUI();
}

function resetAndGoHome() {
  resetProgress();
  showScreen('screen-home');
}

// ── Confetti ──
function startConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const pieces = [];
  const confettiColors = ['#FFD700', '#FF69B4', '#4A90D9', '#4CAF50', '#9C27B0',
                          '#FF6B6B', '#FFA726', '#66BB6A'];

  for (let i = 0; i < 150; i++) {
    pieces.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height - canvas.height,
      w: Math.random() * 10 + 5,
      h: Math.random() * 6 + 3,
      color: confettiColors[Math.floor(Math.random() * confettiColors.length)],
      vy: Math.random() * 3 + 2,
      vx: Math.random() * 2 - 1,
      angle: Math.random() * 360,
      va: Math.random() * 6 - 3,
    });
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of pieces) {
      p.y += p.vy;
      p.x += p.vx;
      p.angle += p.va;
      if (p.y < canvas.height + 20) alive = true;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.angle * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (alive) requestAnimationFrame(draw);
  }
  draw();
}
