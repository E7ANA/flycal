// ── Demo data: real schedule from אולפנה תשפ״ו, class ז' 1 ──
const DEMO_DAYS = ["א", "ב", "ג", "ד", "ה"];
const DEMO_PERIODS = [1, 2, 3, 4, 5, 6, 7, 8];

const SUBJ = {
  תנך:       { label: "תנ״ך",     cls: "cell-success" },
  מדעים:     { label: "מדעים",    cls: "cell-purple" },
  לשון:      { label: "לשון",     cls: "cell-success" },
  אנגלית:    { label: "אנגלית",   cls: "cell-blue" },
  התמחויות:  { label: "התמחויות", cls: "cell-error" },
  מתמטיקה:   { label: "מתמטיקה",  cls: "cell-teal" },
  היסטוריה:  { label: "היסטוריה", cls: "cell-coral" },
  חינוך:     { label: "חינוך",    cls: "cell-error" },
  הלכה:      { label: "הלכה",     cls: "cell-teal" },
  ספורט:     { label: "חינ״ג",    cls: "cell-warning" },
  תושבע:     { label: "תושב״ע",   cls: "cell-purple" },
  גיאוגרפיה: { label: "גיאוגרפיה", cls: "cell-warning" },
  גשרים:     { label: "גשרים",    cls: "cell-coral" },
  נפגשים:    { label: "נפגשים",   cls: "cell-success" },
  ספרות:     { label: "ספרות",    cls: "cell-success" },
  קומי:      { label: "קומי אורי", cls: "cell-teal" },
};

const SCHEDULE = [
  { d: 0, p: 0, ...SUBJ.תנך, pinned: true },
  { d: 0, p: 1, ...SUBJ.מדעים },
  { d: 0, p: 2, ...SUBJ.לשון },
  { d: 0, p: 3, ...SUBJ.לשון },
  { d: 0, p: 4, ...SUBJ.אנגלית },
  { d: 0, p: 5, ...SUBJ.אנגלית },
  { d: 0, p: 6, ...SUBJ.התמחויות },
  { d: 0, p: 7, ...SUBJ.התמחויות },
  { d: 1, p: 0, ...SUBJ.מדעים },
  { d: 1, p: 1, ...SUBJ.מדעים },
  { d: 1, p: 2, ...SUBJ.תנך },
  { d: 1, p: 3, ...SUBJ.מתמטיקה },
  { d: 1, p: 4, ...SUBJ.היסטוריה },
  { d: 1, p: 5, ...SUBJ.היסטוריה },
  { d: 1, p: 6, ...SUBJ.חינוך },
  { d: 1, p: 7, ...SUBJ.הלכה },
  { d: 2, p: 0, ...SUBJ.ספורט },
  { d: 2, p: 1, ...SUBJ.תושבע },
  { d: 2, p: 2, ...SUBJ.תושבע },
  { d: 2, p: 3, ...SUBJ.אנגלית },
  { d: 2, p: 4, ...SUBJ.אנגלית },
  { d: 2, p: 5, ...SUBJ.גיאוגרפיה },
  { d: 3, p: 0, ...SUBJ.נפגשים },
  { d: 3, p: 1, ...SUBJ.לשון },
  { d: 3, p: 2, ...SUBJ.גשרים },
  { d: 3, p: 3, ...SUBJ.גשרים },
  { d: 3, p: 4, ...SUBJ.מתמטיקה },
  { d: 3, p: 5, ...SUBJ.מתמטיקה },
  { d: 3, p: 6, ...SUBJ.תנך },
  { d: 3, p: 7, ...SUBJ.ספורט },
  { d: 4, p: 0, ...SUBJ.מתמטיקה },
  { d: 4, p: 1, ...SUBJ.מתמטיקה },
  { d: 4, p: 2, ...SUBJ.ספרות },
  { d: 4, p: 3, ...SUBJ.תנך },
  { d: 4, p: 4, ...SUBJ.תנך },
  { d: 4, p: 5, ...SUBJ.היסטוריה },
  { d: 4, p: 6, ...SUBJ.קומי },
  { d: 4, p: 7, ...SUBJ.קומי },
];

const PHASES = [
  "טוען אילוצים...",
  "בודק התנגשויות מורים...",
  "ממקסם שעות כפולות...",
  "מחלק ימים חופשיים...",
  "משפר ציון כולל...",
  "פתרון אופטימלי נמצא ✓",
];

const CHIPS = [
  { icon: "pin", label: "שעה נעוצה (תנ״ך א׳-1)", threshold: 5 },
  { icon: "zap", label: "שעות כפולות", threshold: 15 },
  { icon: "home", label: "ישיבת מחנכת", threshold: 25 },
  { icon: "sun", label: "בוקר עדיף למקצועות ליבה", threshold: 35 },
  { icon: "car", label: "מורה מסיימת מוקדם", threshold: 45 },
  { icon: "calendar", label: "יום חופשי למורה", threshold: 55 },
  { icon: "ban", label: "אין חלונות לכיתה", threshold: 65 },
  { icon: "users", label: "סנכרון הקבצות", threshold: 75 },
  { icon: "target", label: "מינימום פיזור ימים", threshold: 85 },
];

// ── Build static grid skeleton ──
function buildGridSkeleton() {
  const grid = document.getElementById("demoGrid");
  if (!grid) return;
  grid.innerHTML = "";
  // header row: empty corner + day labels
  grid.appendChild(document.createElement("div"));
  for (const d of DEMO_DAYS) {
    const el = document.createElement("div");
    el.className = "demo-cell-header";
    el.textContent = d;
    grid.appendChild(el);
  }
  // rows
  for (const period of DEMO_PERIODS) {
    const rowLabel = document.createElement("div");
    rowLabel.className = "demo-cell-row";
    rowLabel.textContent = period;
    grid.appendChild(rowLabel);
    for (let dayIdx = 0; dayIdx < DEMO_DAYS.length; dayIdx++) {
      const cell = document.createElement("div");
      cell.className = "demo-cell";
      cell.dataset.key = `${dayIdx}-${period - 1}`;
      grid.appendChild(cell);
    }
  }
}

function buildChipsSkeleton() {
  const container = document.getElementById("demoChips");
  if (!container) return;
  container.innerHTML = "";
  const iconLib = (typeof ICONS !== "undefined") ? ICONS : {};
  CHIPS.forEach((c) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.dataset.threshold = c.threshold;
    const iconSvg = iconLib[c.icon] || "";
    chip.innerHTML = `<span class="chip-icon">${iconSvg}</span> ${c.label}`;
    container.appendChild(chip);
  });
}

// ── Animation loop ──
let animTimeouts = [];
function clearAnim() {
  animTimeouts.forEach(clearTimeout);
  animTimeouts = [];
}

function runAnimation() {
  clearAnim();
  // Reset
  document.querySelectorAll(".demo-cell.filled").forEach((c) => {
    c.className = "demo-cell";
    c.innerHTML = "";
  });
  document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
  document.getElementById("demoProgress").style.width = "0%";
  document.getElementById("demoScore").textContent = "0";
  document.getElementById("demoPhase").textContent = PHASES[0];

  const totalCells = SCHEDULE.length;
  const cellInterval = 100;
  const totalDuration = cellInterval * totalCells;

  // Fill cells
  SCHEDULE.forEach((s, i) => {
    const t = setTimeout(() => {
      const cell = document.querySelector(`.demo-cell[data-key="${s.d}-${s.p}"]`);
      if (cell) {
        cell.className = `demo-cell filled ${s.cls}`;
        const pinSvg = (typeof ICONS !== "undefined" && ICONS.pin) ? ICONS.pin : "";
        cell.innerHTML = `<span>${s.label}</span>${s.pinned ? `<span class="pinned">${pinSvg}</span>` : ""}`;
      }
      // Progress
      const pct = Math.round(((i + 1) / totalCells) * 100);
      document.getElementById("demoProgress").style.width = pct + "%";
      // Score
      document.getElementById("demoScore").textContent = Math.min(Math.round(pct * 0.97), 97);
      // Chips
      document.querySelectorAll(".chip").forEach((chip) => {
        if (pct >= parseInt(chip.dataset.threshold)) chip.classList.add("active");
      });
    }, i * cellInterval);
    animTimeouts.push(t);
  });

  // Phase progression
  PHASES.forEach((phase, i) => {
    const t = setTimeout(() => {
      document.getElementById("demoPhase").textContent = phase;
    }, (totalDuration / PHASES.length) * i);
    animTimeouts.push(t);
  });

  // Restart loop
  const restart = setTimeout(runAnimation, totalDuration + 4000);
  animTimeouts.push(restart);
}

// ── Stats counter ──
function animateCounters() {
  document.querySelectorAll(".stat-value").forEach((el) => {
    const target = parseInt(el.dataset.target);
    const suffix = el.dataset.suffix || "";
    const duration = 1500;
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      const pct = Math.min(elapsed / duration, 1);
      const value = Math.round(target * (1 - Math.pow(1 - pct, 3)));
      el.textContent = value.toLocaleString("he") + suffix;
      if (pct < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

// ── Priority sliders ──
function initSliders() {
  const s1 = document.getElementById("slider1");
  const s2 = document.getElementById("slider2");
  const v1 = document.getElementById("val1");
  const v2 = document.getElementById("val2");
  const bar1 = document.getElementById("bar1");
  const bar2 = document.getElementById("bar2");
  const text = document.getElementById("resultText");
  if (!s1 || !s2) return;

  const update = () => {
    const a = parseInt(s1.value);
    const b = parseInt(s2.value);
    v1.textContent = a;
    v2.textContent = b;
    const total = a + b;
    const pct1 = Math.round((a / total) * 100);
    const pct2 = 100 - pct1;
    bar1.style.width = pct1 + "%";
    bar1.textContent = pct1 >= 15 ? `כפולה ${pct1}%` : "";
    bar2.style.width = pct2 + "%";
    bar2.textContent = pct2 >= 15 ? `סיום מוקדם ${pct2}%` : "";
    if (a > b) text.textContent = "המודל יעדיף לתת שעות כפולות — גם אם זה ידחוף ימים מסוימים לסיום מאוחר";
    else if (a < b) text.textContent = "המודל יעדיף לסיים מוקדם — פחות שעות יהיו כפולות, יופיעו בודדות";
    else text.textContent = "איזון — המודל יחפש פשרה בין שני הצרכים";
  };
  s1.addEventListener("input", update);
  s2.addEventListener("input", update);
  update();
}

// ── Init ──
document.addEventListener("DOMContentLoaded", () => {
  buildGridSkeleton();
  buildChipsSkeleton();
  runAnimation();
  initSliders();

  // Stats animate when in view
  const statsObserver = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting) {
        animateCounters();
        statsObserver.disconnect();
      }
    },
    { threshold: 0.3 }
  );
  const statsEl = document.querySelector(".stats");
  if (statsEl) statsObserver.observe(statsEl);

  // Year
  const year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();
});
