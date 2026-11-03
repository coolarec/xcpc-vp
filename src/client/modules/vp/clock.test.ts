import { expect, it } from 'vitest';
import { buildVPQuery, readVPOptions } from './options';
import { readVPClock, reanchorVPClock } from './clock';

const start = Date.parse('2026-11-03T15:00:00.000Z');
const duration = 5 * 60 * 60_000;
const initial = () => readVPOptions(buildVPQuery('test', readVPOptions({ play: '1' }), start));
const reload = (options: ReturnType<typeof initial>) => readVPOptions(buildVPQuery('test', options));

it('reconstructs a running clock from its URL after loading or returning later', () => {
  const options = reload(initial());
  expect(readVPClock(options, duration, start + 90_000)).toEqual({ elapsed: 90_000, running: true, waiting: false });
  expect(readVPClock(options, duration, start + 180_000).elapsed).toBe(180_000);
});

it('starts the same contest fresh after a completed session', () => {
  const previous = initial();
  expect(readVPClock(previous, duration, start + duration).running).toBe(false);
  const now = start + duration + 60_000;
  const next = readVPOptions(buildVPQuery('test', readVPOptions({ play: '1' }), now));
  expect(next.scheduledAt).not.toBe(previous.scheduledAt);
  expect(readVPClock(next, duration, now)).toEqual({ elapsed: 0, running: true, waiting: false });
});

it('catches up a scheduled clock when opening after the scheduled time', () => {
  const options = initial();
  expect(readVPClock(options, duration, start - 1000)).toEqual({ elapsed: 0, running: false, waiting: true });
  expect(readVPClock(options, duration, start + 120_000).elapsed).toBe(120_000);
});

it('keeps a scheduled contest paused after refreshing and resumes without a jump', () => {
  const options = initial();
  const paused = reload(reanchorVPClock(options, 60_000, start + 60_000, { autoplay: false }));
  expect(paused.scheduledAt).toBe(options.scheduledAt);
  expect(readVPClock(paused, duration, start + 600_000)).toEqual({ elapsed: 60_000, running: false, waiting: false });
  const resumed = reload(reanchorVPClock(paused, 60_000, start + 600_000, { autoplay: true }));
  expect(readVPClock(resumed, duration, start + 630_000).elapsed).toBe(90_000);
});

it('preserves progress through speed changes and refreshing', () => {
  const accelerated = reload(reanchorVPClock(initial(), 60_000, start + 60_000, { speed: 5 }));
  expect(readVPClock(accelerated, duration, start + 90_000).elapsed).toBe(210_000);
  expect(accelerated.scheduledAt).toBe(initial().scheduledAt);
});

it('resets a completed or scheduled run without restarting the old schedule', () => {
  const resetAt = start + duration + 1000;
  const reset = reload({ ...initial(), scheduledAt: new Date(resetAt).toISOString(), anchorAt: '', startMinutes: 0, autoplay: false });
  expect(readVPClock(reset, duration, resetAt + 60_000)).toEqual({ elapsed: 0, running: false, waiting: false });
  const resumed = reload(reanchorVPClock(reset, 0, resetAt + 60_000, { autoplay: true }));
  expect(readVPClock(resumed, duration, resetAt + 90_000)).toEqual({ elapsed: 30_000, running: true, waiting: false });
});

it('respects starting offsets and caps progress at the contest duration', () => {
  const options = { ...initial(), startMinutes: 10, speed: 60 };
  expect(readVPClock(options, duration, start - 1000).elapsed).toBe(600_000);
  expect(readVPClock(options, duration, start + duration)).toEqual({ elapsed: duration, running: false, waiting: false });
});
