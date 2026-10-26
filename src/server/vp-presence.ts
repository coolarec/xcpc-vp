import { PRESENCE_TTL_MS } from '../common/vp-presence';

const BUCKET_MS = 60_000;
const PREFIX = 'heartbeats/';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const SESSION_ID = new RegExp(`^${UUID}$`);
const HEARTBEAT_KEY = new RegExp(`^heartbeats/(\\d+)/(\\d+)-(${UUID})\\.json$`);

export interface PresenceStore {
  setJSON(key: string, value: unknown, options?: { cacheControl?: string }): Promise<void>;
  list(options: { prefix: string; consistency: 'strong'; directories?: boolean; limit?: number }): Promise<{
    blobs: { key: string }[];
    directories: string[];
  }>;
  delete(key: string): Promise<void>;
}

function json(value: unknown, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'CDN-Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

async function readHeartbeat(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return;
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 1024) return;
  try {
    const data = await request.json() as { sessionId?: unknown; contestId?: unknown };
    if (JSON.stringify(data).length > 1024) return;
    if (!data || typeof data.sessionId !== 'string' || !SESSION_ID.test(data.sessionId) ||
        typeof data.contestId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(data.contestId)) return;
    return { sessionId: data.sessionId, contestId: data.contestId };
  } catch { return; }
}

async function countActive(store: PresenceStore, now: number) {
  const first = Math.floor((now - PRESENCE_TTL_MS) / BUCKET_MS);
  const last = Math.floor(now / BUCKET_MS);
  const buckets = await Promise.all(Array.from({ length: last - first + 1 }, (_, i) =>
    store.list({ prefix: `${PREFIX}${first + i}/`, consistency: 'strong' }),
  ));
  const sessions = new Set<string>();
  for (const bucket of buckets) for (const blob of bucket.blobs) {
    const match = HEARTBEAT_KEY.exec(blob.key);
    if (match && Number(match[2]) > now - PRESENCE_TTL_MS && Number(match[2]) <= now &&
        Number(match[1]) === Math.floor(Number(match[2]) / BUCKET_MS)) sessions.add(match[3]);
  }
  return sessions.size;
}

/** Only delete completed, expired time buckets; an in-flight heartbeat cannot be erased. */
async function removeExpired(store: PresenceStore, now: number) {
  const firstActiveBucket = Math.floor((now - PRESENCE_TTL_MS) / BUCKET_MS);
  const { directories } = await store.list({ prefix: PREFIX, directories: true, limit: 20, consistency: 'strong' });
  let remaining = 128;
  for (const directory of directories) {
    const match = /^heartbeats\/(\d+)\/$/.exec(directory);
    if (!match || Number(match[1]) >= firstActiveBucket) continue;
    const { blobs } = await store.list({ prefix: directory, limit: remaining, consistency: 'strong' });
    const expired = blobs.filter(blob => HEARTBEAT_KEY.test(blob.key));
    await Promise.all(expired.map(blob => store.delete(blob.key)));
    remaining -= blobs.length;
    if (remaining <= 0) break;
  }
}

export async function handlePresence(
  request: Request,
  store: PresenceStore,
  options: { now?: number; waitUntil?: (task: Promise<unknown>) => void } = {},
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, { Allow: 'GET, POST' });
  }
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'Forbidden' }, 403);
  const now = options.now ?? Date.now();
  try {
    let response: Response;
    if (request.method === 'POST') {
      const heartbeat = await readHeartbeat(request);
      if (!heartbeat) return json({ error: 'Invalid heartbeat' }, 400);
      // Separate immutable heartbeat keys prevent concurrent visitors from overwriting each other.
      const key = `${PREFIX}${Math.floor(now / BUCKET_MS)}/${now}-${heartbeat.sessionId}.json`;
      await store.setJSON(key, { contestId: heartbeat.contestId, lastSeen: now }, { cacheControl: 'no-store' });
      response = json({ ok: true });
    } else {
      response = json({ count: await countActive(store, now), updatedAt: now });
    }
    const cleanup = removeExpired(store, now).catch(() => {});
    if (options.waitUntil) options.waitUntil(cleanup);
    else await cleanup;
    return response;
  } catch {
    return json({ error: 'Presence unavailable' }, 503);
  }
}
