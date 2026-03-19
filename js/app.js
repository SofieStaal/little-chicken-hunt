// ── State ──
const COLORS = ['blue', 'green', 'orange', 'pink', 'purple', 'yellow'];
const COLOR_DISPLAY = {
  blue: 'Blue', green: 'Green', orange: 'Orange', pink: 'Pink', purple: 'Purple', yellow: 'Yellow'
};
const TOTAL_CHICKENS = 6;

// Reference HSL values sampled from the actual chicken photos.
// We use distance-based matching: find the closest reference color.
// Hue is circular (0-360), so we handle wraparound.
const COLOR_REFS = {
  blue:   { h: 195, s: 45, l: 80 },   // pastel baby blue
  green:  { h: 80,  s: 65, l: 50 },   // lime green (shifted toward yellow-green for real lighting)
  orange: { h: 30,  s: 85, l: 55 },   // warm orange
  pink:   { h: 325, s: 50, l: 75 },   // soft light pink
  purple: { h: 305, s: 55, l: 45 },   // vivid magenta-purple
  yellow: { h: 54,  s: 85, l: 65 },   // bright yellow (bumped lightness to separate from orange)
};
// Maximum distance to accept a match (prevents matching random objects)
const MAX_COLOR_DISTANCE = 55;

const CSS_COLORS = {
  blue: '#4A90D9', green: '#4CAF50', orange: '#FF8C00',
  pink: '#FF69B4', purple: '#9C27B0', yellow: '#FFD700'
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
  document.getElementById('progress-fill').style.width = `${(count / TOTAL_CHICKENS) * 100}%`;
  document.getElementById('progress-text').textContent = `${count} / ${TOTAL_CHICKENS} found`;

  // Check victory
  if (count === TOTAL_CHICKENS) {
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
  if (foundChickens.length === TOTAL_CHICKENS) {
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
    const radius = Math.min(canvas.width, canvas.height) * 0.08;

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

    if (dominant && ratio > 0.15) {
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
  // Skip very dark, very light, or very desaturated pixels (not a colored chicken)
  if (s < 12 || l < 15 || l > 92) return null;

  let bestColor = null;
  let bestDist = Infinity;

  for (const [color, ref] of Object.entries(COLOR_REFS)) {
    // Hue distance with circular wraparound (0-360)
    let dh = Math.abs(h - ref.h);
    if (dh > 180) dh = 360 - dh;

    // Weight hue most heavily, then saturation, then lightness
    const dist = Math.sqrt(
      (dh * 2.0) ** 2 +
      (s - ref.s) ** 2 +
      (l - ref.l) ** 2
    );

    if (dist < bestDist) {
      bestDist = dist;
      bestColor = color;
    }
  }

  return bestDist <= MAX_COLOR_DISTANCE ? bestColor : null;
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
  document.getElementById('popup-count').textContent = `${foundChickens.length} / ${TOTAL_CHICKENS}`;

  // Show the actual chicken photo
  document.getElementById('popup-chicken-icon').innerHTML =
    `<img src="${color}.png" alt="${COLOR_DISPLAY[color]} chicken" style="width:100%;height:100%;object-fit:contain;">`;

  if (foundChickens.length === TOTAL_CHICKENS) {
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
  if (foundChickens.length === TOTAL_CHICKENS) {
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
