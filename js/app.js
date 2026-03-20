// ── State ──
const COLORS = ['blue', 'green', 'orange', 'pink', 'purple', 'yellow'];
const COLOR_DISPLAY = {
  blue: 'Bl\u00e5', green: 'Gr\u00f8nn', orange: 'Oransje', pink: 'Rosa', purple: 'Lilla', yellow: 'Gul'
};
const TOTAL_CHICKENS = 6;

const COLOR_REFS = {
  blue:   { h: 195, s: 45, l: 80 },
  green:  { h: 90,  s: 60, l: 45 },
  orange: { h: 30,  s: 85, l: 58 },
  pink:   { h: 325, s: 50, l: 75 },
  purple: { h: 305, s: 55, l: 45 },
  yellow: { h: 50,  s: 90, l: 70 },
};
const MAX_COLOR_DISTANCE = 60;

const CSS_COLORS = {
  blue: '#4A90D9', green: '#4CAF50', orange: '#FF8C00',
  pink: '#FF69B4', purple: '#9C27B0', yellow: '#FFD700'
};

let foundChickens = JSON.parse(localStorage.getItem('foundChickens') || '[]');
let stream = null;
let scanInterval = null;
let pendingColor = null;
let scanning = false;

// ── Init ──
document.addEventListener('DOMContentLoaded', () => updateUI());

function updateUI() {
  document.querySelectorAll('.chicken-card').forEach(card => {
    card.classList.toggle('found', foundChickens.includes(card.dataset.color));
  });
  const count = foundChickens.length;
  document.getElementById('progress-fill').style.width = `${(count / TOTAL_CHICKENS) * 100}%`;
  document.getElementById('progress-text').textContent = `${count} / ${TOTAL_CHICKENS} funnet`;
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

  // Clean up previous stream
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  video.srcObject = null;

  try {
    await new Promise(r => setTimeout(r, 300));
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    video.srcObject = stream;
    video.setAttribute('autoplay', '');
    video.setAttribute('playsinline', '');
    await video.play();
    startScanning();
  } catch (err) {
    document.getElementById('scanner-hint').textContent =
      'Kameratilgang kreves. Vennligst gi tilgang til kameraet.';
  }
}

function stopCamera() {
  stopScanning();
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  const video = document.getElementById('camera-feed');
  if (video) video.srcObject = null;
}

function stopScanning() {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
  scanning = false;
}

function resumeScanning() {
  if (stream && !scanning) {
    startScanning();
  }
}

// ── Color Detection ──
function startScanning() {
  const video = document.getElementById('camera-feed');
  const canvas = document.getElementById('camera-canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  scanning = true;

  // Reset UI
  document.getElementById('detected-dot').style.background = '#666';
  document.getElementById('detected-label').textContent = 'Leter etter kyllinger...';
  document.querySelector('.scan-reticle').classList.remove('detected');

  scanInterval = setInterval(() => {
    if (video.readyState < 2 || !scanning) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const innerRadius = Math.min(canvas.width, canvas.height) * 0.12;
    const outerRadius = Math.min(canvas.width, canvas.height) * 0.22;

    const centerResult = sampleRegion(ctx, centerX, centerY, innerRadius, 0);
    const outerResult = sampleRegion(ctx, centerX, centerY, outerRadius, innerRadius);

    const dot = document.getElementById('detected-dot');
    const label = document.getElementById('detected-label');
    const reticle = document.querySelector('.scan-reticle');

    const isChickenShaped = centerResult.dominant &&
      centerResult.ratio > 0.10 &&
      (outerResult.dominant !== centerResult.dominant || outerResult.ratio < 0.10);

    if (isChickenShaped) {
      const color = centerResult.dominant;
      dot.style.background = CSS_COLORS[color];
      label.textContent = `${COLOR_DISPLAY[color]} oppdaget!`;
      reticle.classList.add('detected');

      // Immediately stop scanning and show confirm
      stopScanning();

      if (foundChickens.includes(color)) {
        showToast(`Du har allerede funnet den ${COLOR_DISPLAY[color].toLowerCase()} kyllingen!`);
        // Resume after toast
        setTimeout(() => resumeScanning(), 1500);
      } else {
        showConfirmOverlay(color);
      }
    } else {
      dot.style.background = '#666';
      label.textContent = 'Leter etter kyllinger...';
      reticle.classList.remove('detected');
    }
  }, 100);
}

function sampleRegion(ctx, cx, cy, maxR, minR) {
  const colorCounts = {};
  let totalSampled = 0;
  const step = 4;

  for (let x = cx - maxR; x < cx + maxR; x += step) {
    for (let y = cy - maxR; y < cy + maxR; y += step) {
      const dx = x - cx;
      const dy = y - cy;
      const distSq = dx * dx + dy * dy;
      if (distSq > maxR * maxR || distSq < minR * minR) continue;

      const pixel = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
      const [h, s, l] = rgbToHsl(pixel[0], pixel[1], pixel[2]);
      const matched = matchColor(h, s, l);
      if (matched) colorCounts[matched] = (colorCounts[matched] || 0) + 1;
      totalSampled++;
    }
  }

  let dominant = null;
  let maxCount = 0;
  for (const [color, count] of Object.entries(colorCounts)) {
    if (count > maxCount) { maxCount = count; dominant = color; }
  }
  return { dominant, ratio: totalSampled > 0 ? maxCount / totalSampled : 0 };
}

function matchColor(h, s, l) {
  if (s < 6 || l < 12 || l > 96) return null;
  if (h <= 15 && s > 40) return null;
  if (h > 15 && h <= 22 && s > 50) return null;

  let bestColor = null;
  let bestDist = Infinity;
  for (const [color, ref] of Object.entries(COLOR_REFS)) {
    let dh = Math.abs(h - ref.h);
    if (dh > 180) dh = 360 - dh;
    const dist = Math.sqrt((dh * 2.5) ** 2 + (s - ref.s) ** 2 + (l - ref.l) ** 2);
    if (dist < bestDist) { bestDist = dist; bestColor = color; }
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

// ── Confirm overlay ──
function showConfirmOverlay(color) {
  pendingColor = color;
  document.getElementById('confirm-chicken-img').src = `${color}.png`;
  document.getElementById('confirm-text').textContent =
    `Er dette den ${COLOR_DISPLAY[color].toLowerCase()} kyllingen?`;
  document.getElementById('confirm-overlay').classList.add('active');
}

function confirmChicken() {
  document.getElementById('confirm-overlay').classList.remove('active');
  if (pendingColor) {
    registerChicken(pendingColor);
    pendingColor = null;
  }
}

function cancelConfirm() {
  document.getElementById('confirm-overlay').classList.remove('active');
  pendingColor = null;
  // Resume scanning — camera stream is still alive
  resumeScanning();
}

// ── Register found chicken ──
function registerChicken(color) {
  if (foundChickens.includes(color)) return;

  foundChickens.push(color);
  localStorage.setItem('foundChickens', JSON.stringify(foundChickens));

  stopCamera();

  const popup = document.getElementById('popup-found');
  document.getElementById('popup-color-name').textContent = COLOR_DISPLAY[color];
  document.getElementById('popup-color-name').style.color = CSS_COLORS[color];
  document.getElementById('popup-count').textContent = `${foundChickens.length} / ${TOTAL_CHICKENS}`;
  document.getElementById('popup-chicken-icon').innerHTML =
    `<img src="${color}.png" alt="${COLOR_DISPLAY[color]} kylling" style="width:100%;height:100%;object-fit:contain;">`;

  if (foundChickens.length === TOTAL_CHICKENS) {
    document.querySelector('.popup-btn').textContent = 'Hent premien!';
    document.getElementById('popup-title').textContent = 'ALLE FUNNET!';
    document.getElementById('popup-message').innerHTML =
      'Du fant alle kyllingene! P\u00e5 tide \u00e5 hente <strong>p\u00e5skeegget</strong>!';
  } else {
    document.querySelector('.popup-btn').textContent = 'Fortsett jakten!';
    document.getElementById('popup-title').textContent = 'Du fant en!';
    document.getElementById('popup-message').innerHTML =
      `Den <strong style="color:${CSS_COLORS[color]}">${COLOR_DISPLAY[color].toLowerCase()}</strong> kyllingen er samlet inn!`;
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
