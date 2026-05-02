import { DAILY_TASKS, QUOTES } from "@/data/protocol";
import { dayOfProgram, phaseForDay } from "@/lib/storage";
import { initOneSignal } from "@/lib/push";

// Boot OneSignal as early as possible
initOneSignal().catch(() => {});

let timer: number | null = null;
let alarmAudio: HTMLAudioElement | null = null;

/** subscribers to in-app alarm fires (used by AlarmDialog) */
type AlarmSub = (quote: string) => void;
const subs = new Set<AlarmSub>();
export function onAlarm(cb: AlarmSub) { subs.add(cb); return () => subs.delete(cb); }

export type NotifPermResult =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "ios-needs-install" | "denied" | "dismissed" };

function isIOS() {
  const ua = navigator.userAgent || "";
  // iPad on iPadOS reports as Mac — also detect via touch points
  const iPadOS = /Macintosh/.test(ua) && (navigator as any).maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || iPadOS;
}

function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as any).standalone === true
  );
}

export async function requestNotifPermission(): Promise<NotifPermResult> {
  if (!("Notification" in window)) {
    // iOS Safari only exposes Notification when the app is installed to home screen.
    if (isIOS() && !isStandalone()) return { ok: false, reason: "ios-needs-install" };
    return { ok: false, reason: "unsupported" };
  }
  if (Notification.permission === "granted") return { ok: true };
  if (Notification.permission === "denied") return { ok: false, reason: "denied" };
  try {
    const r = await Notification.requestPermission();
    if (r === "granted") return { ok: true };
    if (r === "denied") return { ok: false, reason: "denied" };
    return { ok: false, reason: "dismissed" };
  } catch {
    return { ok: false, reason: "denied" };
  }
}

export function pickQuote(): string {
  return QUOTES[Math.floor(Math.random() * QUOTES.length)];
}

function currentTaskForHour(hour: number) {
  try {
    const raw = localStorage.getItem("looksmax_v1");
    const startDate = raw ? JSON.parse(raw).startDate : undefined;
    const phase = phaseForDay(dayOfProgram(startDate));
    return DAILY_TASKS[phase].find((t) => t.hour === hour);
  } catch {
    return undefined;
  }
}

/** Synthesize a 3-beep alarm via WebAudio (no asset needed). */
function playAlarmTone() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const beep = (start: number, freq: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, ctx.currentTime + start);
      gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + start + 0.02);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + start + 0.45);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + 0.5);
    };
    beep(0,    880);
    beep(0.55, 1175);
    beep(1.10, 880);
    setTimeout(() => ctx.close().catch(() => {}), 2000);
  } catch {}
}

/** Vibrate phone if supported. */
function vibrate() {
  try { (navigator as any).vibrate?.([400, 150, 400, 150, 600]); } catch {}
}

export function startHourlyReminders(fromHour = 8, toHour = 22, alarmMode = false) {
  stopHourlyReminders();

  const fire = async () => {
    const h = new Date().getHours();
    if (h < fromHour || h > toHour) return;
    const quote = pickQuote();
    const task = currentTaskForHour(h);

    // 1) browser notification (works in PWA / installed)
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          await reg.showNotification(
            task ? `${task.emoji} ${task.title}` : alarmMode ? "🚨 ALARM — Check in" : "🔔 Hourly check-in",
            {
              body: task?.note ?? quote,
              icon: "/icon-192.png",
              badge: "/icon-192.png",
              tag: "looksmax-hourly",
              renotify: true,
              requireInteraction: alarmMode,
            } as NotificationOptions
          );
        }
      } catch {}
    }

    // 2) ALARM mode = loud sound + vibrate + in-app dialog
    if (alarmMode) {
      playAlarmTone();
      vibrate();
      subs.forEach((s) => s(quote));
    }
  };

  // schedule on the next top-of-hour, then every 60 min
  const now = new Date();
  const msToNext = (60 - now.getMinutes()) * 60_000 - now.getSeconds() * 1000;
  timer = window.setTimeout(() => {
    fire();
    timer = window.setInterval(fire, 60 * 60 * 1000) as unknown as number;
  }, msToNext);
}

/** Manual fire — for "Test alarm" button. */
export async function fireTestAlarm(alarmMode = true) {
  const quote = pickQuote();
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.showNotification(alarmMode ? "🚨 ALARM — Test" : "🔔 Test reminder", {
          body: quote,
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          tag: "looksmax-test",
          renotify: true,
          requireInteraction: alarmMode,
        } as NotificationOptions);
      }
    } catch {}
  }
  if (alarmMode) {
    playAlarmTone();
    vibrate();
    subs.forEach((s) => s(quote));
  }
}

export function stopHourlyReminders() {
  if (timer) { clearTimeout(timer); clearInterval(timer); timer = null; }
  if (alarmAudio) { alarmAudio.pause(); alarmAudio = null; }
}