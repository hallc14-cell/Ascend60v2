import OneSignal from 'react-onesignal';

const ONESIGNAL_APP_ID =
  import.meta.env.VITE_ONESIGNAL_APP_ID ?? '7f16f2a1-f352-48af-94af-91b7b384dd4a';

let initialized = false;
let initializing: Promise<void> | null = null;

function isIOS(): boolean {
  const ua = navigator.userAgent || '';
  const maxTouchPoints = (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints ?? 0;
  const iPadOS = /Macintosh/.test(ua) && maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || iPadOS;
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function parsePermission(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'granted';
  return Notification.permission === 'granted';
}

async function waitForPushSubscriptionId(timeoutMs = 12000): Promise<string | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const id = (OneSignal as any)?.User?.pushSubscription?.id;
    if (typeof id === 'string' && id.length > 0) return id;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

export function pushSupported() {
  if (!window.isSecureContext) return false;
  if (!('serviceWorker' in navigator) || !('Notification' in window)) return false;
  if (isIOS() && !isStandalone()) return false;
  return true;
}

export async function initOneSignal(): Promise<void> {
  if (initialized) return;
  if (initializing) return initializing;

  initializing = (async () => {
    try {
      const inIframe = window.self !== window.top;
      const isPreview =
        location.hostname.includes('lovableproject.com') ||
        location.hostname.includes('id-preview--');
      if (inIframe || isPreview || !ONESIGNAL_APP_ID) return;
    } catch {
      return;
    }

    try {
      await OneSignal.init({
        appId: ONESIGNAL_APP_ID,
        serviceWorkerParam: { scope: '/' },
        serviceWorkerPath: '/OneSignalSDKWorker.js',
        serviceWorkerUpdaterPath: '/OneSignalSDKUpdaterWorker.js',
        notifyButton: { enable: false },
        allowLocalhostAsSecureOrigin: false,
        promptOptions: {
          slidedown: {
            enabled: false,
          },
        },
      } as any);

      initialized = true;

      // Keep local subscription id cached when OneSignal creates/replaces it.
      (OneSignal as any)?.User?.pushSubscription?.addEventListener?.('change', (event: any) => {
        const nextId = event?.current?.id ?? event?.current?.token ?? null;
        if (typeof nextId === 'string' && nextId.length > 0) {
          localStorage.setItem('onesignal_player_id', nextId);
        }
      });
    } catch (e) {
      console.error('OneSignal init failed', e);
    }
  })();

  await initializing;
  initializing = null;
}

export async function ensureServiceWorker() {
  return null;
}

type PushSettings = {
  fromHour: number;
  toHour: number;
  alarmMode: boolean;
  startDate?: string;
  taskReminders?: boolean;
};

function toOneSignalTags(settings: PushSettings) {
  return {
    from_hour: String(settings.fromHour),
    to_hour: String(settings.toHour),
    alarm_mode: settings.alarmMode ? '1' : '0',
    task_reminders: settings.taskReminders ? '1' : '0',
    start_date: settings.startDate ?? '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    platform: isIOS() ? 'ios' : 'web',
  };
}

async function addTagsWithRetry(settings: PushSettings, retries = 5): Promise<boolean> {
  const tags = toOneSignalTags(settings);

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await OneSignal.User.addTags(tags);
      await new Promise((r) => setTimeout(r, 600));
      const saved = await OneSignal.User.getTags();
      if (saved && (saved as any).from_hour && (saved as any).to_hour) {
        return true;
      }
    } catch (e) {
      console.warn(`Tag attempt ${attempt + 1} failed`, e);
      await new Promise((r) => setTimeout(r, 700));
    }
  }

  return false;
}

export async function subscribePush(settings: PushSettings): Promise<boolean> {
  try {
    await initOneSignal();

    // On iOS web push, this must happen from the installed Home Screen app
    // and always from a direct user interaction.
    await OneSignal.Notifications.requestPermission();

    const granted = parsePermission((OneSignal as any).Notifications?.permission);
    if (!granted) return false;

    await (OneSignal as any)?.User?.pushSubscription?.optIn?.();

    const subscriptionId = await waitForPushSubscriptionId();
    if (subscriptionId) {
      localStorage.setItem('onesignal_player_id', subscriptionId);
    }

    const tagged = await addTagsWithRetry(settings);
    if (!tagged) {
      console.error('Failed to write OneSignal tags after retries');
    }

    return true;
  } catch (e) {
    console.error('subscribePush failed', e);
    return false;
  }
}

export async function updatePushWindow(settings: PushSettings) {
  try {
    await initOneSignal();
    await addTagsWithRetry(settings, 3);
  } catch (e) {
    console.error('updatePushWindow failed', e);
  }
}

export async function unsubscribePush() {
  try {
    await initOneSignal();
    await OneSignal.User.addTags({
      from_hour: '',
      to_hour: '',
      alarm_mode: '0',
      task_reminders: '0',
      start_date: '',
      timezone: '',
      platform: '',
    });
    await (OneSignal as any)?.User?.pushSubscription?.optOut?.();
    localStorage.removeItem('onesignal_player_id');
  } catch (e) {
    console.warn('unsubscribePush failed', e);
  }
}
