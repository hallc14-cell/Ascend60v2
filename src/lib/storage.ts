const KEY = "looksmax_v1";

type Store = {
  startDate?: string;          // ISO date when user pressed Start
  checks: Record<string, Record<string, boolean>>; // date -> taskId -> done
  weights: Record<string, number>;  // date -> weight
  notes: Record<string, string>;    // date -> note
  lastQuoteIdx?: number;
  notifEnabled?: boolean;
  remindFromHour?: number;          // default 8
  remindToHour?: number;            // default 22
  alarmMode?: boolean;              // loud alarm + dialog vs just notification
  studyDone?: Record<string, boolean>; // lessonId -> completed
  prayerDone?: Record<string, boolean>; // dateKey -> prayed today
  /** date -> array of logged meal entries */
  meals?: Record<string, MealEntry[]>;
};

export type MealEntry = {
  id: string;       // unique per entry (timestamp-based)
  foodId?: string;  // ref to RECOMMENDED_FOODS, or undefined for custom
  name: string;
  kcal: number;
  protein: number;
  servings: number; // multiplier
  at: number;       // ms since epoch
};

const defaults: Store = {
  checks: {},
  weights: {},
  notes: {},
  remindFromHour: 8,
  remindToHour: 22,
  alarmMode: false,
  studyDone: {},
  prayerDone: {},
  meals: {},
};

export function loadStore(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaults };
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return { ...defaults };
  }
}

export function saveStore(s: Store) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}

export function todayKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function dayOfProgram(startDate?: string): number {
  if (!startDate) return 0;
  // Compare calendar dates only — strip time entirely so timezone
  // offsets and partial days never corrupt the day count.
  const [sY, sM, sD] = startDate.split('-').map(Number);
  const now = new Date();
  const todayYear = now.getFullYear();
  const todayMonth = now.getMonth() + 1;
  const todayDay = now.getDate();
  // Use UTC date math to avoid DST edge cases
  const startMs = Date.UTC(sY, sM - 1, sD);
  const todayMs = Date.UTC(todayYear, todayMonth - 1, todayDay);
  const diff = Math.floor((todayMs - startMs) / 86400000) + 1;
  return Math.max(1, Math.min(60, diff));
}

export function phaseForDay(day: number): 0 | 1 | 2 {
  if (day <= 14) return 0;
  if (day <= 42) return 1;
  return 2;
}

export function streakCount(checks: Store["checks"], requiredPct = 0.7): number {
  // count back from today
  const days = Object.keys(checks).sort().reverse();
  let s = 0;
  for (const d of days) {
    const tasks = checks[d];
    const done = Object.values(tasks).filter(Boolean).length;
    const total = Object.keys(tasks).length;
    if (total === 0) break;
    if (done / total >= requiredPct) s++;
    else break;
  }
  return s;
}

export function totalXP(
  checks: Store["checks"],
  resolveXP: (taskId: string) => number
): number {
  let total = 0;
  for (const day of Object.keys(checks)) {
    for (const [tid, on] of Object.entries(checks[day])) {
      if (on) total += resolveXP(tid);
    }
  }
  return total;
}

/** Returns whether an unlock requirement is met. */
export function isUnlocked(
  unlock: { requireDay?: number; requireStreak?: number; requireXP?: number },
  ctx: { day: number; streak: number; xp: number }
): boolean {
  if (unlock.requireDay && ctx.day < unlock.requireDay) return false;
  if (unlock.requireStreak && ctx.streak < unlock.requireStreak) return false;
  if (unlock.requireXP && ctx.xp < unlock.requireXP) return false;
  return true;
}