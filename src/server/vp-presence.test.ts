import { describe, expect, it, vi } from 'vitest';
import { handlePresence, type PresenceStore } from './vp-presence';

const NOW = 1_793_000_000_000;
const FIRST = '00000000-0000-4000-8000-000000000001';
const SECOND = '00000000-0000-4000-8000-000000000002';

function memoryStore() {
  const records = new Map<string, unknown>();
  const store: PresenceStore = {
    async setJSON(key, value) { records.set(key, value); },
    async delete(key) { records.delete(key); },
    async list({ prefix, directories, limit = Infinity, consistency }) {
      expect(consistency).toBe('strong');
      const keys = [...records.keys()].filter(key => key.startsWith(prefix)).sort();
      if (directories) return {
        blobs: [],
        directories: [...new Set(keys.map(key => key.slice(0, key.indexOf('/', prefix.length) + 1)))].slice(0, limit),
      };
      return { blobs: keys.slice(0, limit).map(key => ({ key })), directories: [] };
    },
  };
  return { store, records };
}

const heartbeat = (sessionId = FIRST, contestId = 'icpc2025invitational-xi_an') => new Request('https://vp.example/api/vp-presence', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://vp.example' },
  body: JSON.stringify({ sessionId, contestId }),
});
const query = () => new Request('https://vp.example/api/vp-presence');

describe('VP online presence', () => {
  it('deduplicates repeated heartbeats and counts concurrent visitors across contests', async () => {
    const { store } = memoryStore();
    expect((await handlePresence(heartbeat(), store, { now: NOW - 30_000 })).status).toBe(200);
    await Promise.all([
      handlePresence(heartbeat(), store, { now: NOW }),
      handlePresence(heartbeat(SECOND, 'another-contest'), store, { now: NOW }),
    ]);
    const response = await handlePresence(query(), store, { now: NOW });
    expect(await response.json()).toEqual({ count: 2, updatedAt: NOW });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('expires disconnected sessions after 90 seconds and removes old blobs', async () => {
    const { store, records } = memoryStore();
    await handlePresence(heartbeat(), store, { now: NOW });
    expect((await (await handlePresence(query(), store, { now: NOW + 89_999 })).json()).count).toBe(1);
    expect((await (await handlePresence(query(), store, { now: NOW + 90_000 })).json()).count).toBe(0);
    await handlePresence(query(), store, { now: NOW + 180_000 });
    expect(records.size).toBe(0);
  });

  it('keeps a new heartbeat while old buckets are cleaned up', async () => {
    const { store, records } = memoryStore();
    await handlePresence(heartbeat(), store, { now: NOW - 180_000 });
    await handlePresence(heartbeat(), store, { now: NOW });
    expect(records.size).toBe(1);
    expect((await (await handlePresence(query(), store, { now: NOW })).json()).count).toBe(1);
  });

  it('does not expose session IDs or contest IDs in query responses', async () => {
    const { store } = memoryStore();
    await handlePresence(heartbeat(), store, { now: NOW });
    const text = await (await handlePresence(query(), store, { now: NOW })).text();
    expect(text).not.toContain(FIRST);
    expect(text).not.toContain('icpc');
  });

  it('rejects cross-site writes, invalid IDs and oversized bodies without storing them', async () => {
    const { store, records } = memoryStore();
    const crossSite = heartbeat();
    crossSite.headers.set('Origin', 'https://other.example');
    expect((await handlePresence(crossSite, store)).status).toBe(403);
    expect((await handlePresence(heartbeat('../invalid'), store)).status).toBe(400);
    expect((await handlePresence(heartbeat(FIRST, '../invalid'), store)).status).toBe(400);
    expect((await handlePresence(new Request(query(), { method: 'POST', body: 'x'.repeat(1025), headers: { 'Content-Type': 'application/json' } }), store)).status).toBe(400);
    expect(records.size).toBe(0);
  });

  it('reports storage errors instead of reporting nobody online', async () => {
    const { store } = memoryStore();
    store.list = vi.fn().mockRejectedValue(new Error('Storage unavailable'));
    const response = await handlePresence(query(), store, { now: NOW });
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty('count');
  });
});
