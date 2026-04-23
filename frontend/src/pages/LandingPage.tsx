import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Brain,
  Clock,
  RefreshCw,
  Check,
  Sparkles,
  Zap,
  Target,
  ArrowLeft,
  Calendar,
  Sliders,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";

// ── Animated counter hook ────────────────────────────────────
function useCountUp(target: number, duration = 1500, trigger = true) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!trigger) return;
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      const pct = Math.min(elapsed / duration, 1);
      setValue(Math.round(target * (1 - Math.pow(1 - pct, 3))));
      if (pct < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [target, duration, trigger]);
  return value;
}

// ── Fade-in on scroll ────────────────────────────────────────
function useInView<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setInView(true),
      { threshold: 0.15 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return { ref, inView };
}

// ── Section wrapper with fade-in ─────────────────────────────
function FadeSection({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ${
        inView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
      } ${className}`}
    >
      {children}
    </div>
  );
}

// ── Priority slider demo ─────────────────────────────────────
function PriorityDemo() {
  const [doubleWeight, setDoubleWeight] = useState(80);
  const [lateEndWeight, setLateEndWeight] = useState(55);

  const total = doubleWeight + lateEndWeight;
  const doublePct = Math.round((doubleWeight / total) * 100);
  const latePct = 100 - doublePct;

  return (
    <div className="bg-card border rounded-2xl p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Sliders className="h-5 w-5 text-primary" />
        <h4 className="font-semibold">דוגמה: מי מנצח בהתנגשות?</h4>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        שעה כפולה למקצוע <span className="font-semibold">מול</span> הימנעות מסיום יום מאוחר.
        הזז את הסליידרים — המודל יחליט לפי התעדוף שלך.
      </p>

      <div className="space-y-5">
        <div>
          <div className="flex justify-between text-sm mb-2">
            <span className="font-medium">שעה כפולה למקצוע</span>
            <span className="text-primary font-bold">{doubleWeight}</span>
          </div>
          <input
            type="range"
            min="1"
            max="100"
            value={doubleWeight}
            onChange={(e) => setDoubleWeight(Number(e.target.value))}
            className="w-full accent-primary cursor-pointer"
          />
        </div>

        <div>
          <div className="flex justify-between text-sm mb-2">
            <span className="font-medium">הימנעות מסיום יום מאוחר</span>
            <span className="text-primary font-bold">{lateEndWeight}</span>
          </div>
          <input
            type="range"
            min="1"
            max="100"
            value={lateEndWeight}
            onChange={(e) => setLateEndWeight(Number(e.target.value))}
            className="w-full accent-primary cursor-pointer"
          />
        </div>
      </div>

      <div className="mt-6 pt-6 border-t">
        <div className="text-xs text-muted-foreground mb-2">תוצאה צפויה</div>
        <div className="flex h-10 rounded-lg overflow-hidden bg-muted">
          <div
            className="bg-primary flex items-center justify-center text-primary-foreground text-xs font-semibold transition-all duration-300"
            style={{ width: `${doublePct}%` }}
          >
            {doublePct >= 15 && `כפולה ${doublePct}%`}
          </div>
          <div
            className="bg-success flex items-center justify-center text-xs font-semibold transition-all duration-300"
            style={{ width: `${latePct}%` }}
          >
            {latePct >= 15 && `סיום מוקדם ${latePct}%`}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          {doubleWeight > lateEndWeight
            ? "המודל יעדיף לתת שעות כפולות — גם אם זה ידחוף ימים מסוימים לסיום מאוחר"
            : doubleWeight < lateEndWeight
              ? "המודל יעדיף לסיים מוקדם — פחות שעות יהיו כפולות, יופיעו בודדות"
              : "איזון — המודל יחפש פשרה בין שני הצרכים"}
        </p>
      </div>
    </div>
  );
}

// ── Stat card ────────────────────────────────────────────────
function StatCard({
  target,
  suffix = "",
  label,
  inView,
}: {
  target: number;
  suffix?: string;
  label: string;
  inView: boolean;
}) {
  const value = useCountUp(target, 1500, inView);
  return (
    <div className="text-center">
      <div className="text-4xl md:text-5xl font-bold text-primary mb-1">
        {value.toLocaleString("he")}
        {suffix}
      </div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

// ── AI Solver Demo (animated) ───────────────────────────────
// Real schedule + real subject colors from אולפנה תשפ״ו, class ז' 1
const DEMO_DAYS = ["א", "ב", "ג", "ד", "ה"];
const DEMO_PERIODS = [1, 2, 3, 4, 5, 6, 7, 8];

type Cell = {
  day: number;
  period: number;
  label: string;
  bg: string;
  text: string;
  border: string;
  pinned?: boolean;
};

// Real subject colors from the app's palette (lib/subjectColors.ts)
const C = {
  coral:   { bg: "#FDE8E4", text: "#8B3A2F", border: "#F0B8AD" },
  purple:  { bg: "#EDE5F5", text: "#5B3A8C", border: "#C9B3E0" },
  teal:    { bg: "#E8F0ED", text: "#2D5E4F", border: "#B5D5C8" },
  success: { bg: "#E8F1E4", text: "#3D5A2E", border: "#BCD8B0" },
  warning: { bg: "#FBF0E0", text: "#6B4423", border: "#E8D0A8" },
  error:   { bg: "#FAE0E4", text: "#9B2C3B", border: "#E8A8B4" },
  blue:    { bg: "#DEEAF6", text: "#2C5F9B", border: "#A8C8E8" },
};

// Real subjects from the DB with their actual colors
const SUBJ = {
  תנך:       { label: "תנ״ך",     ...C.success },
  מדעים:     { label: "מדעים",    ...C.purple },
  לשון:      { label: "לשון",     ...C.success },
  אנגלית:    { label: "אנגלית",   ...C.blue },
  התמחויות:  { label: "התמחויות", ...C.error },
  מתמטיקה:   { label: "מתמטיקה",  ...C.teal },
  היסטוריה:  { label: "היסטוריה", ...C.coral },
  חינוך:     { label: "חינוך",    ...C.error },
  הלכה:      { label: "הלכה",     ...C.teal },
  ספורט:     { label: "חינ״ג",    ...C.warning },
  תושבע:     { label: "תושב״ע",   ...C.purple },
  גיאוגרפיה: { label: "גיאוגרפיה", ...C.warning },
  גשרים:     { label: "גשרים",    ...C.coral },
  נפגשים:    { label: "נפגשים",   ...C.success },
  ספרות:     { label: "ספרות",    ...C.success },
  קומי:      { label: "קומי אורי", ...C.teal },
};

// Actual schedule: class ז' 1 from אולפנה תשפ״ו
const OPTIMAL_SCHEDULE: Cell[] = [
  // Sunday (day 0) — תנ״ך pinned at period 1 (homeroom opener)
  { day: 0, period: 0, ...SUBJ.תנך, pinned: true },
  { day: 0, period: 1, ...SUBJ.מדעים },
  { day: 0, period: 2, ...SUBJ.לשון },
  { day: 0, period: 3, ...SUBJ.לשון },
  { day: 0, period: 4, ...SUBJ.אנגלית },
  { day: 0, period: 5, ...SUBJ.אנגלית },
  { day: 0, period: 6, ...SUBJ.התמחויות },
  { day: 0, period: 7, ...SUBJ.התמחויות },
  // Monday (day 1)
  { day: 1, period: 0, ...SUBJ.מדעים },
  { day: 1, period: 1, ...SUBJ.מדעים },
  { day: 1, period: 2, ...SUBJ.תנך },
  { day: 1, period: 3, ...SUBJ.מתמטיקה },
  { day: 1, period: 4, ...SUBJ.היסטוריה },
  { day: 1, period: 5, ...SUBJ.היסטוריה },
  { day: 1, period: 6, ...SUBJ.חינוך },
  { day: 1, period: 7, ...SUBJ.הלכה },
  // Tuesday (day 2)
  { day: 2, period: 0, ...SUBJ.ספורט },
  { day: 2, period: 1, ...SUBJ.תושבע },
  { day: 2, period: 2, ...SUBJ.תושבע },
  { day: 2, period: 3, ...SUBJ.אנגלית },
  { day: 2, period: 4, ...SUBJ.אנגלית },
  { day: 2, period: 5, ...SUBJ.גיאוגרפיה },
  // Wednesday (day 3)
  { day: 3, period: 0, ...SUBJ.נפגשים },
  { day: 3, period: 1, ...SUBJ.לשון },
  { day: 3, period: 2, ...SUBJ.גשרים },
  { day: 3, period: 3, ...SUBJ.גשרים },
  { day: 3, period: 4, ...SUBJ.מתמטיקה },
  { day: 3, period: 5, ...SUBJ.מתמטיקה },
  { day: 3, period: 6, ...SUBJ.תנך },
  { day: 3, period: 7, ...SUBJ.ספורט },
  // Thursday (day 4)
  { day: 4, period: 0, ...SUBJ.מתמטיקה },
  { day: 4, period: 1, ...SUBJ.מתמטיקה },
  { day: 4, period: 2, ...SUBJ.ספרות },
  { day: 4, period: 3, ...SUBJ.תנך },
  { day: 4, period: 4, ...SUBJ.תנך },
  { day: 4, period: 5, ...SUBJ.היסטוריה },
  { day: 4, period: 6, ...SUBJ.קומי },
  { day: 4, period: 7, ...SUBJ.קומי },
];

const PHASES = [
  "טוען אילוצים...",
  "בודק התנגשויות מורים...",
  "ממקסם שעות כפולות...",
  "מחלק ימים חופשיים...",
  "משפר ציון כולל...",
  "פתרון אופטימלי נמצא ✓",
];

function AIDemo() {
  const [filled, setFilled] = useState<Cell[]>([]);
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [running, setRunning] = useState(true);

  useEffect(() => {
    if (!running) return;
    let cellIdx = 0;
    let phaseTimer: ReturnType<typeof setInterval>;
    let cellTimer: ReturnType<typeof setInterval>;
    let scoreTimer: ReturnType<typeof setInterval>;

    const totalCells = OPTIMAL_SCHEDULE.length;
    const cellInterval = 120;

    // Reset
    setFilled([]);
    setPhaseIdx(0);
    setScore(0);

    // Fill cells one by one
    cellTimer = setInterval(() => {
      cellIdx++;
      if (cellIdx > totalCells) {
        clearInterval(cellTimer);
        return;
      }
      setFilled(OPTIMAL_SCHEDULE.slice(0, cellIdx));
    }, cellInterval);

    // Cycle phases
    const phaseInterval = (cellInterval * totalCells) / PHASES.length;
    phaseTimer = setInterval(() => {
      setPhaseIdx((p) => Math.min(p + 1, PHASES.length - 1));
    }, phaseInterval);

    // Animate score
    scoreTimer = setInterval(() => {
      setScore((s) => Math.min(s + 2, 97));
    }, 80);

    // Restart after a pause
    const restart = setTimeout(() => {
      setRunning(false);
      setTimeout(() => setRunning(true), 500);
    }, cellInterval * totalCells + 3500);

    return () => {
      clearInterval(cellTimer);
      clearInterval(phaseTimer);
      clearInterval(scoreTimer);
      clearTimeout(restart);
    };
  }, [running]);

  const filledMap = new Map<string, Cell>();
  filled.forEach((c) => filledMap.set(`${c.day}-${c.period}`, c));
  const progress = Math.round((filled.length / OPTIMAL_SCHEDULE.length) * 100);

  return (
    <div className="relative bg-card border rounded-2xl shadow-lg overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-l from-primary to-primary/90 text-primary-foreground px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <Brain className="h-5 w-5" />
            <div className="absolute -top-1 -right-1 h-2 w-2 bg-success rounded-full animate-pulse" />
          </div>
          <div>
            <div className="text-sm font-semibold">כיתה ז׳ 1 — אולפנה (פתרון אמיתי)</div>
            <div className="text-[10px] opacity-80 tabular-nums">{PHASES[phaseIdx]}</div>
          </div>
        </div>
        <div className="text-left">
          <div className="text-2xl font-bold tabular-nums">{score}</div>
          <div className="text-[10px] opacity-80">ציון</div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-muted">
        <div
          className="h-full bg-primary transition-all duration-200 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Grid */}
      <div className="p-4" dir="rtl">
        <div className="grid grid-cols-[auto_repeat(5,1fr)] gap-1">
          {/* Empty corner */}
          <div />
          {/* Day headers */}
          {DEMO_DAYS.map((d) => (
            <div
              key={d}
              className="text-center text-xs font-semibold text-muted-foreground py-1"
            >
              {d}
            </div>
          ))}

          {/* Rows */}
          {DEMO_PERIODS.map((period) => (
            <div key={`row-${period}`} className="contents">
              <div className="flex items-center justify-center text-[10px] text-muted-foreground w-6">
                {period}
              </div>
              {DEMO_DAYS.map((_, dayIdx) => {
                const cell = filledMap.get(`${dayIdx}-${period - 1}`);
                return (
                  <div
                    key={`${dayIdx}-${period}`}
                    className="h-8 rounded-md border transition-all duration-300 flex items-center justify-center text-[10px] font-medium relative overflow-hidden"
                    style={{
                      backgroundColor: cell ? cell.bg : "transparent",
                      color: cell ? cell.text : undefined,
                      borderColor: cell ? cell.border : "#E8E6E3",
                      borderStyle: cell ? "solid" : "dashed",
                      animation: cell ? "popIn 0.3s ease-out" : undefined,
                    }}
                  >
                    {cell && (
                      <>
                        <span className="truncate px-1">{cell.label}</span>
                        {cell.pinned && (
                          <span
                            className="absolute top-0 right-0.5 text-[8px]"
                            title="שעה נעוצה"
                          >
                            📌
                          </span>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Constraint ticker */}
        <div className="mt-4 pt-4 border-t">
          <div className="text-[10px] text-muted-foreground mb-2 font-medium">
            אילוצים ותעדופים שמטופלים בזמן אמת:
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[
              { icon: "📌", label: "שעה נעוצה (תנ״ך א׳-1)", active: progress > 5 },
              { icon: "⚡", label: "שעות כפולות", active: progress > 15 },
              { icon: "🏠", label: "ישיבת מחנכת", active: progress > 25 },
              { icon: "🌅", label: "בוקר עדיף למקצועות ליבה", active: progress > 35 },
              { icon: "🚗", label: "מורה מסיימת מוקדם", active: progress > 45 },
              { icon: "📅", label: "יום חופשי למורה", active: progress > 55 },
              { icon: "🚫", label: "אין חלונות לכיתה", active: progress > 65 },
              { icon: "🤝", label: "סנכרון הקבצות", active: progress > 75 },
              { icon: "🎯", label: "מינימום פיזור ימים", active: progress > 85 },
            ].map((chip, i) => (
              <span
                key={chip.label}
                className={`text-[10px] px-2 py-1 rounded-full border transition-all duration-300 ${
                  chip.active
                    ? "bg-success/20 border-success/40 text-foreground"
                    : "bg-muted/30 border-dashed text-muted-foreground"
                }`}
                style={{
                  animation: chip.active ? `fadeInChip 0.3s ease-out ${i * 30}ms backwards` : undefined,
                }}
              >
                <span className="ml-1">{chip.icon}</span>
                {chip.label}
                {chip.active && <span className="mr-1 text-success">✓</span>}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Floating optimization chips */}
      <div className="absolute top-20 left-4 flex flex-col gap-1.5 pointer-events-none">
        {[
          { label: "שעה כפולה", weight: 90, delay: 0 },
          { label: "סיום מוקדם", weight: 70, delay: 600 },
          { label: "בוקר עדיף", weight: 60, delay: 1200 },
        ].map((chip) => (
          <div
            key={chip.label}
            className="bg-card/90 backdrop-blur border shadow-sm rounded-full px-2.5 py-1 text-[10px] font-medium flex items-center gap-1.5 opacity-0"
            style={{
              animation: `slideInChip 0.4s ease-out ${chip.delay}ms forwards`,
            }}
          >
            <div className="h-1 w-8 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary"
                style={{ width: `${chip.weight}%` }}
              />
            </div>
            <span>{chip.label}</span>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes popIn {
          0% { transform: scale(0.5); opacity: 0; }
          70% { transform: scale(1.05); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes slideInChip {
          0% { transform: translateX(-10px); opacity: 0; }
          100% { transform: translateX(0); opacity: 1; }
        }
        @keyframes fadeInChip {
          0% { transform: translateY(-4px); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ── Main landing page ───────────────────────────────────────
export default function LandingPage() {
  const statsSection = useInView<HTMLDivElement>();

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      {/* ── Navbar ── */}
      <header className="sticky top-0 z-50 backdrop-blur bg-background/80 border-b">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-6">
          <Link to="/welcome" className="flex items-center gap-3 hover:opacity-80 transition-opacity shrink-0">
            <img src="/logiclass.svg" alt="logiclass" className="h-11 w-11" />
            <span className="text-2xl font-semibold tracking-tight">logiclass</span>
          </Link>

          <nav className="hidden lg:flex items-center gap-1 flex-1 justify-center">
            {[
              { href: "#experts", label: "אנשי המקצוע" },
              { href: "#comparison", label: "אנושי vs אלגוריתם" },
              { href: "#how", label: "איך זה עובד" },
              { href: "#improvements", label: "מקצי שיפורים" },
              { href: "#sync", label: "סנכרון ואילוצים" },
              { href: "#features", label: "תכונות" },
              { href: "#case-study", label: "מקרה בוחן" },
            ].map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="text-sm text-muted-foreground hover:text-foreground hover:bg-muted px-3 py-2 rounded-md transition-colors whitespace-nowrap"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <Link
              to="/login"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              התחברות
            </Link>
            <a
              href="#contact"
              className="text-sm bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:opacity-90 transition-opacity whitespace-nowrap"
            >
              התחל ניסיון
            </a>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="max-w-6xl mx-auto px-6 pt-16 pb-20">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <FadeSection>
            <div className="inline-flex items-center gap-2 bg-primary/5 border border-primary/10 rounded-full px-4 py-1.5 mb-6">
              <Brain className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-medium text-primary">
                מודל AI שפותר במקומך
              </span>
            </div>
            <h1 className="text-5xl md:text-6xl font-bold tracking-tight mb-6 leading-[1.1]">
              בינה מלאכותית
              <br />
              <span className="text-primary">שבונה מערכת שעות</span>
              <br />
              מיטבית.
            </h1>
            <p className="text-lg text-muted-foreground mb-8 leading-relaxed">
              מודל אופטימיזציה חוקר מיליוני אפשרויות, משקלל תעדופים סותרים,
              ומוציא את המערכת הטובה ביותר עבורך —
              <span className="font-semibold text-foreground"> לא מכוונת, אלא ממקסמת</span>.
            </p>
            <div className="flex items-center gap-4">
              <a
                href="#contact"
                className="bg-primary text-primary-foreground px-8 py-3.5 rounded-xl font-medium hover:opacity-90 transition-all hover:-translate-y-0.5 shadow-sm"
              >
                התחל ניסיון חינם
              </a>
              <a
                href="#how"
                className="px-8 py-3.5 rounded-xl font-medium hover:bg-muted transition-colors inline-flex items-center gap-2"
              >
                צפה בדוגמה
                <ArrowLeft className="h-4 w-4" />
              </a>
            </div>
          </FadeSection>

          <FadeSection>
            <AIDemo />
          </FadeSection>
        </div>
      </section>

      {/* ── Stats ── */}
      <section ref={statsSection.ref} className="border-y bg-card">
        <div className="max-w-6xl mx-auto px-6 py-16 grid grid-cols-2 md:grid-cols-4 gap-8">
          <StatCard target={10} suffix="+" label="שנות ניסיון בבניית מערכות" inView={statsSection.inView} />
          <StatCard target={95} suffix="%" label="אחוז אילוצים שמתקיימים" inView={statsSection.inView} />
          <StatCard target={27} label="סוגי אילוצים נתמכים" inView={statsSection.inView} />
          <StatCard target={5} label="פתרונות חלופיים לבחירה" inView={statsSection.inView} />
        </div>
      </section>

      {/* ── Built by experts (moved to top) ── */}
      <section id="experts" className="bg-gradient-to-b from-background to-card scroll-mt-20">
        <div className="max-w-6xl mx-auto px-6 py-24">
          <FadeSection className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 bg-primary/5 border border-primary/10 rounded-full px-3 py-1 mb-4">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-medium text-primary">מי עומד מאחורי המערכת</span>
              </div>
              <h2 className="text-5xl md:text-6xl font-bold mb-6 leading-[1.05] tracking-tight">
                נבנתה על ידי
                <br />
                <span className="text-primary">אנשי מקצוע מנוסים</span>
              </h2>
              <p className="text-lg text-muted-foreground mb-6 leading-relaxed">
                מעל <span className="font-semibold text-foreground">10 שנים</span> של ניסיון בבניית מערכות שעות
                במספר מוסדות חינוך. הכרנו מקרוב את כל הפתרונות החיצוניים בשוק —
                שחף, תכנון אנושי ידני, ועוד — ולמדנו את היתרונות והחסרונות של כל אחד.
              </p>
              <p className="text-lg text-muted-foreground mb-6 leading-relaxed">
                <span className="font-semibold text-foreground">logiclass</span> היא הסינתזה:
                כל הניסיון המעשי של בונה מערכות ותיק, משולב עם אלגוריתמי אופטימיזציה מתקדמים
                (OR-Tools של Google) — שפשוט לא היו זמינים למוסדות חינוך עד היום.
              </p>
              <div className="grid grid-cols-2 gap-4 mt-8">
                <div className="bg-card border rounded-xl p-4">
                  <div className="text-2xl font-bold text-primary mb-1">מוסדות</div>
                  <div className="text-xs text-muted-foreground">
                    מערכות אופטימליות נוצרו בהצלחה במספר מוסדות חינוך בפועל
                  </div>
                </div>
                <div className="bg-card border rounded-xl p-4">
                  <div className="text-2xl font-bold text-primary mb-1">ליווי צמוד</div>
                  <div className="text-xs text-muted-foreground">
                    אנשי מקצוע זמינים ללוות את ההטמעה מהרגע הראשון
                  </div>
                </div>
              </div>
            </div>
            <div id="case-study" className="bg-card border rounded-2xl p-6 shadow-sm scroll-mt-20">
              <div className="text-xs text-muted-foreground mb-1">מקרה בוחן — אולפנה תשפ״ו</div>
              <div className="text-lg font-bold mb-5">מוסד פעיל שהמערכת נבנתה עבורו</div>
              <div className="space-y-4">
                {[
                  { label: "מורים", value: "44" },
                  { label: "כיתות (ז׳–יב׳)", value: "12" },
                  { label: "מקצועות", value: "37" },
                  { label: "דרישות שעות", value: "309" },
                  { label: "סה״כ שעות שבועיות", value: "867" },
                  { label: "אילוצים פעילים", value: "27+" },
                ].map((stat) => (
                  <div key={stat.label} className="flex items-center justify-between pb-3 border-b last:border-b-0 last:pb-0">
                    <span className="text-sm text-muted-foreground">{stat.label}</span>
                    <span className="text-xl font-bold tabular-nums">{stat.value}</span>
                  </div>
                ))}
              </div>
              <div className="mt-5 pt-5 border-t">
                <div className="flex items-center gap-2 text-sm">
                  <Check className="h-4 w-4 text-success" />
                  <span className="font-medium">מערכת אופטימלית התקבלה תוך ~8 שעות עבודה</span>
                </div>
                <div className="flex items-center gap-2 text-sm mt-2">
                  <Check className="h-4 w-4 text-success" />
                  <span className="font-medium">95% מהאילוצים הרכים התקיימו במלואם</span>
                </div>
                <div className="flex items-center gap-2 text-sm mt-2">
                  <Check className="h-4 w-4 text-success" />
                  <span className="font-medium">שודרה חזרה לשחף בלחיצה אחת</span>
                </div>
              </div>
            </div>
          </FadeSection>
        </div>
      </section>

      {/* ── Human vs Algorithmic ── */}
      <section id="comparison" className="border-y bg-card scroll-mt-20">
        <div className="max-w-6xl mx-auto px-6 py-24">
          <FadeSection className="text-center mb-16">
            <div className="inline-flex items-center gap-2 bg-primary/5 border border-primary/10 rounded-full px-3 py-1 mb-4">
              <Brain className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-medium text-primary">ההבדל הגדול</span>
            </div>
            <h2 className="text-5xl md:text-6xl font-bold mb-6 leading-[1.05] tracking-tight">
              תכנון אנושי מול
              <br />
              <span className="text-primary">אופטימיזציה רוחבית</span>
            </h2>
            <p className="text-lg text-muted-foreground max-w-3xl mx-auto leading-relaxed">
              מתכנן אנושי, גם מנוסה, בונה את המערכת <span className="font-semibold text-foreground">הדרגתית</span> —
              שיעור אחרי שיעור, מתקן התנגשויות תוך כדי, ומגיע לפתרון שעובד. אבל האם זה
              <span className="italic"> הפתרון הטוב ביותר שיכול היה להיות?</span> אין דרך לדעת.
            </p>
          </FadeSection>

          <FadeSection className="grid md:grid-cols-2 gap-6">
            {/* Human planning */}
            <div className="bg-background border rounded-2xl p-8 relative overflow-hidden">
              <div className="absolute top-0 right-0 h-1 w-full bg-muted-foreground/20" />
              <div className="flex items-center gap-3 mb-5">
                <div className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center text-2xl">
                  👤
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">הדרך הישנה</div>
                  <h3 className="text-xl font-bold">תכנון אנושי</h3>
                </div>
              </div>
              <div className="space-y-3">
                {[
                  "חושב שיעור-שיעור, יום-יום",
                  "כל החלטה מוקדמת מגבילה את הבאות",
                  "התנגשויות מתגלות רק בדיעבד",
                  "'עובד' ≠ 'אופטימלי' — אין דרך למדוד",
                  "שינוי קטן = לעתים שבירת חצי מערכת",
                  "3–4 שבועות של עבודה מאומצת",
                ].map((point) => (
                  <div key={point} className="flex items-start gap-2 text-sm">
                    <span className="text-muted-foreground mt-0.5">◆</span>
                    <span className="text-muted-foreground">{point}</span>
                  </div>
                ))}
              </div>
              <div className="mt-6 pt-6 border-t">
                <div className="text-xs text-muted-foreground mb-2">תוצאה:</div>
                <div className="text-sm font-semibold">פתרון שעובד — אבל לא בהכרח הטוב ביותר</div>
              </div>
            </div>

            {/* Algorithmic model */}
            <div className="bg-background border-2 border-primary rounded-2xl p-8 relative overflow-hidden shadow-lg">
              <div className="absolute top-0 right-0 h-1 w-full bg-primary" />
              <div className="flex items-center gap-3 mb-5">
                <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Brain className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <div className="text-xs text-primary font-medium">logiclass</div>
                  <h3 className="text-xl font-bold">מודל אופטימיזציה רוחבית</h3>
                </div>
              </div>
              <div className="space-y-3">
                {[
                  "חושב על כל המערכת בבת אחת",
                  "שוקל מיליוני אפשרויות במקביל",
                  "אלגוריתם מקסימום (CP-SAT) מוכיח אופטימליות",
                  "כל אילוץ מקבל משקל — ציון מדיד",
                  "שינוי נקודתי = חישוב מחדש מיידי",
                  "שעות עבודה במקום שבועות",
                ].map((point) => (
                  <div key={point} className="flex items-start gap-2 text-sm">
                    <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span className="text-foreground">{point}</span>
                  </div>
                ))}
              </div>
              <div className="mt-6 pt-6 border-t">
                <div className="text-xs text-muted-foreground mb-2">תוצאה:</div>
                <div className="text-sm font-semibold text-primary">
                  פתרון מוכח-אופטימלי לפי התעדופים שלך
                </div>
              </div>
            </div>
          </FadeSection>

          <FadeSection className="mt-10 text-center">
            <div className="inline-block bg-primary/5 border border-primary/10 rounded-2xl px-6 py-4">
              <p className="text-sm text-foreground max-w-2xl">
                <span className="font-semibold">זה לא שה-AI יודע יותר מהמתכנן.</span>{" "}
                זה שהמתכנן <span className="italic">פשוט לא יכול</span> לשקול מיליארדי קומבינציות בראש —
                וגם לא אמור.
              </p>
            </div>
          </FadeSection>
        </div>
      </section>

      {/* ── Feature 1: Optimization Model ── */}
      <section id="how" className="max-w-6xl mx-auto px-6 py-24 scroll-mt-20">
        <FadeSection className="grid md:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 bg-primary/5 border border-primary/10 rounded-full px-3 py-1 mb-4">
              <Brain className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-medium text-primary">שלב 1</span>
            </div>
            <h2 className="text-5xl md:text-6xl font-bold mb-6 leading-[1.05] tracking-tight">
              מודל שממקסם את
              <br />
              <span className="text-primary">התעדוף של המנהל/ת</span>
            </h2>
            <p className="text-lg text-muted-foreground mb-6 leading-relaxed">
              לא כלי שמציע פתרונות — מודל מתמטי שחוקר מיליוני אפשרויות ובוחר
              את המערכת שמיטיבה עם <span className="font-semibold text-foreground">מה שחשוב לך</span>.
              אתה קובע: שעה כפולה לשיעור חשובה יותר מיום חופשי למורה? המודל יכבד את זה.
            </p>
            <ul className="space-y-3">
              {[
                "תעדוף לפי משקלים — אתה שולט",
                "התנגשויות נפתרות לטובת מה שמוגדר כחשוב",
                "אילוצים קשים (HARD) — לעולם לא מופרים",
                "אילוצים רכים (SOFT) — ממוקסמים לפי משקל",
              ].map((t) => (
                <li key={t} className="flex items-start gap-3">
                  <div className="mt-0.5 h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Check className="h-3 w-3 text-primary" />
                  </div>
                  <span className="text-foreground">{t}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <PriorityDemo />
          </div>
        </FadeSection>
      </section>

      {/* ── Feature 2: 24 hours + improvements ── */}
      <section id="improvements" className="border-y bg-card scroll-mt-20">
        <div className="max-w-6xl mx-auto px-6 py-24">
          <FadeSection className="grid md:grid-cols-2 gap-12 items-center">
            <div className="order-2 md:order-1">
              <div className="bg-background border rounded-2xl p-6 shadow-sm">
                <div className="flex items-center gap-3 mb-5">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Clock className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <div className="font-semibold">מסלול טיפוסי לבית ספר בינוני</div>
                    <div className="text-xs text-muted-foreground">~30 מורים, 18 כיתות, 40 מקצועות</div>
                  </div>
                </div>
                <div className="space-y-4">
                  {[
                    { time: "15 דק'", action: "ייבוא נתונים משחף או קליטה מאקסל", icon: RefreshCw },
                    { time: "1–2 שעות", action: "הגדרת תעדופים, אילוצים וחסימות", icon: Sliders },
                    { time: "30 דק'", action: "הרצת הסולבר — 5 פתרונות מדורגים", icon: Zap },
                    { time: "3–4 שעות", action: "מקצי שיפורים: כיול, 'מה-אם', אופטימיזציה נוספת", icon: TrendingUp, highlight: true },
                    { time: "5 דק'", action: "מערכת סופית מייוצאת חזרה לשחף", icon: Check },
                  ].map((step, i, arr) => (
                    <div key={step.time} className="flex gap-4 relative">
                      {i < arr.length - 1 && (
                        <div className="absolute right-4 top-9 bottom-0 w-px bg-border" />
                      )}
                      <div
                        className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 relative z-10 ${
                          step.highlight
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        <step.icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 pb-2">
                        <div className="text-xs text-muted-foreground tabular-nums">{step.time}</div>
                        <div className={`text-sm ${step.highlight ? "font-semibold" : ""}`}>
                          {step.action}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-5 pt-5 border-t text-xs text-muted-foreground">
                  במקום 3–4 שבועות של עבודה ידנית — <span className="font-semibold text-foreground">כ-8 שעות עבודה בלבד</span>, כולל ליווי מקצועי.
                </div>
              </div>
            </div>
            <div className="order-1 md:order-2">
              <div className="inline-flex items-center gap-2 bg-primary/5 border border-primary/10 rounded-full px-3 py-1 mb-4">
                <TrendingUp className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-medium text-primary">שלב 2 — הלב של המערכת</span>
              </div>
              <h2 className="text-5xl md:text-6xl font-bold mb-6 leading-[1.05] tracking-tight">
                מקצי שיפורים —
                <br />
                <span className="text-primary">הקסם האמיתי</span>
              </h2>
              <p className="text-lg text-muted-foreground mb-6 leading-relaxed">
                הפתרון הראשון הוא רק נקודת התחלה. הכוח האמיתי הוא
                <span className="font-semibold text-foreground"> מקצי השיפורים</span> —
                שינויים קטנים ומהירים שמעדנים את המערכת בדיוק לצרכים שלך.
                "מה יקרה אם אמעיף את שרית ליום שלישי?" — תשובה תוך שניות, לא ימים.
              </p>
              <div className="space-y-3">
                <div className="bg-background border rounded-xl p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-start gap-3">
                    <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <TrendingUp className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <div className="font-semibold text-sm mb-1">שינוי נקודתי, חישוב מחדש מיידי</div>
                      <div className="text-xs text-muted-foreground">
                        העבר שעה אחת — הסולבר מעדכן את כל ההשלכות אוטומטית, בלי לשבור שום אילוץ.
                      </div>
                    </div>
                  </div>
                </div>
                <div className="bg-background border rounded-xl p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-start gap-3">
                    <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Target className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <div className="font-semibold text-sm mb-1">תרחישי "מה-אם"</div>
                      <div className="text-xs text-muted-foreground">
                        "מה אם מורה X יחסר ביום רביעי?" — תרחיש מלא, השוואה, ובחירה מושכלת.
                      </div>
                    </div>
                  </div>
                </div>
                <div className="bg-background border rounded-xl p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-start gap-3">
                    <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Sparkles className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <div className="font-semibold text-sm mb-1">שיפור אינקרמנטלי</div>
                      <div className="text-xs text-muted-foreground">
                        כל שיפור שומר על הפתרון הקודם כגיבוי — אפשר לחזור תמיד. לנסות ולא לדאוג.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </FadeSection>
        </div>
      </section>

      {/* ── Feature 3: Constraints + Shahaf sync ── */}
      <section id="sync" className="max-w-6xl mx-auto px-6 py-24 scroll-mt-20">
        <FadeSection className="grid md:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 bg-primary/5 border border-primary/10 rounded-full px-3 py-1 mb-4">
              <RefreshCw className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-medium text-primary">שלב 3</span>
            </div>
            <h2 className="text-5xl md:text-6xl font-bold mb-6 leading-[1.05] tracking-tight">
              הזנת אילוצים
              <br />
              <span className="text-primary">מהירה ומסונכרנת</span>
            </h2>
            <p className="text-lg text-muted-foreground mb-6 leading-relaxed">
              הזן תעדופים ואילוצים בממשק פשוט ומהיר — המערכת מסתנכרנת עם
              <span className="font-semibold text-foreground"> שחף </span>
              בלחיצה אחת. ייבוא נתונים קיימים, ייצוא של הפתרון הסופי — לא
              צריך להקליד שום דבר פעמיים.
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                "ייבוא משחף",
                "ייצוא לשחף",
                "ייבוא מאקסל",
                "ייצוא לאקסל",
                "27 סוגי אילוצים",
                "אילוצים קשים + רכים",
              ].map((tag) => (
                <span
                  key={tag}
                  className="bg-muted text-foreground text-xs font-medium px-3 py-1.5 rounded-full border"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <div className="bg-card border rounded-xl p-5 hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3 mb-3">
                <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                  <RefreshCw className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-sm">סנכרון דו-כיווני עם שחף</div>
                  <div className="text-xs text-muted-foreground">מורים, כיתות, מקצועות, שיעורים</div>
                </div>
                <span className="text-xs bg-success/20 text-success-foreground px-2 py-1 rounded">
                  מקושר
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>ייבוא: תוך 2 שניות</span>
                <span>•</span>
                <span>ייצוא: תוך 5 שניות</span>
              </div>
            </div>
            <div className="bg-card border rounded-xl p-5 hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3 mb-3">
                <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Sliders className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-sm">גיליון אילוצים — הכל במקום אחד</div>
                  <div className="text-xs text-muted-foreground">גרר, הגדר, הפעל/כבה בלחיצה</div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="bg-muted rounded px-2 py-1.5 text-center">מורים</div>
                <div className="bg-muted rounded px-2 py-1.5 text-center">מקצועות</div>
                <div className="bg-muted rounded px-2 py-1.5 text-center">כיתות</div>
                <div className="bg-muted rounded px-2 py-1.5 text-center">הקבצות</div>
                <div className="bg-muted rounded px-2 py-1.5 text-center">ישיבות</div>
                <div className="bg-muted rounded px-2 py-1.5 text-center">שיעורים</div>
              </div>
            </div>
            <div className="bg-card border rounded-xl p-5 hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-sm">אימות אוטומטי לפני הרצה</div>
                  <div className="text-xs text-muted-foreground">
                    המערכת מאתרת אילוצים סותרים לפני שאתה מבזבז זמן
                  </div>
                </div>
              </div>
            </div>
          </div>
        </FadeSection>
      </section>

      {/* ── Feature grid ── */}
      <section id="features" className="border-y bg-card scroll-mt-20">
        <div className="max-w-6xl mx-auto px-6 py-24">
          <FadeSection className="text-center mb-12">
            <h2 className="text-5xl md:text-6xl font-bold mb-6 leading-[1.05] tracking-tight">
              כל מה שמנהל/ת
              <br />
              <span className="text-primary">בית ספר צריך/ה</span>
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              ממשק מותאם למציאות הישראלית — RTL, מסודר, מהיר, ומבין את הייחודיות של מערכת החינוך אצלנו.
            </p>
          </FadeSection>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                icon: Calendar,
                title: "מערכת עברית, מציאות ישראלית",
                desc: "שבוע ראשון-שישי, שכבות ז-יב, הקבצות (מתמטיקה, אנגלית), מפגשי חינוך ובגרויות — הכל בנוי לבית ספר ישראלי.",
              },
              {
                icon: Target,
                title: "תעדוף לפי משקלים",
                desc: "כל אילוץ רך מקבל משקל 1-100. המודל מחפש פתרון שמטיב עם האילוצים בעלי המשקלים הגבוהים ביותר.",
              },
              {
                icon: Sparkles,
                title: "5 פתרונות לבחירה",
                desc: "לא מערכת אחת — המערכת מייצרת כמה פתרונות שונים זה מזה ומציגה דירוג לפי ניקוד, כך שאתה בוחר את הטוב.",
              },
              {
                icon: ShieldCheck,
                title: "אין מצב של 'לא הצלחתי'",
                desc: "אם יש בעיה — המערכת אומרת לך בדיוק מה הפריע: איזה אילוץ סותר, איזה מורה לא זמין מספיק, איפה יש חוסר.",
              },
              {
                icon: TrendingUp,
                title: "ניתוח מה-אם",
                desc: "רוצה לראות מה יקרה אם תוסיף עוד שעה לאנגלית? הפעל תרחיש, השווה ובחר. שום דבר לא בלי נתונים.",
              },
              {
                icon: Zap,
                title: "ייצוא לכל מה שאתה צריך",
                desc: "שחף, אקסל, PDF. לכל מורה המערכת האישית, לכל כיתה המערכת שלה, ולמנהל התמונה הכללית.",
              },
            ].map((f) => (
              <div
                key={f.title}
                className="bg-background border rounded-xl p-6 hover:shadow-md transition-all hover:-translate-y-0.5"
              >
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <f.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section id="contact" className="max-w-4xl mx-auto px-6 py-24 text-center scroll-mt-20">
        <FadeSection>
          <h2 className="text-5xl md:text-6xl font-bold mb-6 leading-[1.05] tracking-tight">
            מוכן/ה לחסוך
            <br />
            <span className="text-primary">שבועות של עבודה?</span>
          </h2>
          <p className="text-lg text-muted-foreground mb-10 max-w-2xl mx-auto">
            בשנה הראשונה — ליווי מלא ממקצוען/ית שמבין/ה גם מערכות שעות וגם אופטימיזציה.
            הזן את הנתונים שלך, ותראה תוך שעות את המערכת הראשונה שלך.
          </p>
          <div className="flex items-center justify-center gap-4 mb-10">
            <a
              href="mailto:eranassulin@mail.tau.ac.il"
              className="bg-primary text-primary-foreground px-8 py-3.5 rounded-xl font-medium hover:opacity-90 transition-all hover:-translate-y-0.5 shadow-sm"
            >
              התחל ניסיון חינם
            </a>
            <Link
              to="/login"
              className="px-8 py-3.5 rounded-xl font-medium hover:bg-muted transition-colors border"
            >
              יש לי חשבון
            </Link>
          </div>
          <div className="text-sm text-muted-foreground">
            שאלות? כתוב ל-
            <a href="mailto:eranassulin@mail.tau.ac.il" className="text-primary hover:underline mr-1">
              eranassulin@mail.tau.ac.il
            </a>
          </div>
        </FadeSection>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t bg-card">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/logiclass.svg" alt="logiclass" className="h-8 w-8" />
            <span className="font-semibold text-lg">logiclass</span>
          </div>
          <div className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} logiclass — מערכת שעות חכמה לבתי ספר
          </div>
        </div>
      </footer>
    </div>
  );
}
