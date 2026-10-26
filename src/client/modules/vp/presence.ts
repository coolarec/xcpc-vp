import { onBeforeUnmount, watch, type Ref } from 'vue';
import { PRESENCE_ENDPOINT, PRESENCE_HEARTBEAT_MS } from '../../../common/vp-presence';

let tabSessionId: string;

function sessionId() {
  if (tabSessionId) return tabSessionId;
  try {
    const stored = sessionStorage.getItem('RanklandVP:presenceSession');
    if (stored && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(stored)) {
      tabSessionId = stored;
    }
  } catch {}
  tabSessionId ||= crypto.randomUUID();
  try { sessionStorage.setItem('RanklandVP:presenceSession', tabSessionId); } catch {}
  return tabSessionId;
}

export function useVPPresence(active: Readonly<Ref<boolean>>, contestId: Readonly<Ref<string>>) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let pending: AbortController | undefined;

  async function heartbeat() {
    if (!active.value || pending) return;
    const controller = new AbortController();
    pending = controller;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      await fetch(PRESENCE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionId(), contestId: contestId.value }),
        cache: 'no-store',
        signal: controller.signal,
      });
    } catch { /* Presence must not interrupt a VP session. */ }
    finally {
      clearTimeout(timeout);
      if (pending === controller) pending = undefined;
    }
  }

  function stop() {
    clearInterval(timer);
    timer = undefined;
    pending?.abort();
    pending = undefined;
  }

  watch(active, value => {
    stop();
    if (value) {
      void heartbeat();
      timer = setInterval(heartbeat, PRESENCE_HEARTBEAT_MS);
    }
  }, { immediate: true });
  onBeforeUnmount(stop);
}
