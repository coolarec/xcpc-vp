import { afterEach, expect, it, vi } from 'vitest';
import { h } from 'vue';
import { renderToString } from '@vue/server-renderer';
import type * as srk from '@algoux/standard-ranklist';
import ReplayProgressBar from './ReplayProgressBar.vue';

const duration = 5 * 60 * 60_000;
const data: srk.Ranklist = {
  type: 'general', version: '0.3.14',
  contest: { title: 'Progress regression', startAt: '2026-01-01T00:00:00Z', duration: [5, 'h'], frozenDuration: [1, 'h'] },
  problems: [], rows: [], series: [], sorter: { algorithm: 'ICPC', config: {} },
};

const render = (elapsedMs: number) => renderToString(h(ReplayProgressBar, { data, elapsedMs, live: true }));

afterEach(() => { vi.restoreAllMocks(); });

it('counts forward across the final second and stops at five hours', async () => {
  const before = await render(duration - 1000);
  expect(before).toContain('Elapsed: 4:59:59');
  expect(before).toContain('Remaining: 0:00:01');
  const ended = await render(duration);
  expect(ended).toContain('Elapsed: 5:00:00');
  expect(ended).toContain('Remaining: 0:00:00');
  expect(ended).toContain('aria-valuenow="100"');
  expect(ended).not.toContain('>Live<');
  expect(await render(duration + 60_000)).toBe(ended);
});

it('does not reverse after finishing as wall time continues to pass', async () => {
  let now = Date.parse('2026-11-03T15:00:00+08:00');
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const ended = await render(duration);
  for (const delay of [250, 1000, 60_000, duration, 24 * 60 * 60_000]) {
    now += delay;
    expect(await render(duration)).toBe(ended);
  }
});

it('uses virtual progress for pauses and can show a new run after an ended one', async () => {
  expect(await render(duration)).toContain('Elapsed: 5:00:00');
  const reset = await render(0);
  expect(reset).toContain('Elapsed: 0:00:00');
  expect(reset).toContain('Remaining: 5:00:00');
  expect(await render(60_000)).toContain('Elapsed: 0:01:00');
  expect(await render(60_000)).toContain('Remaining: 4:59:00');
});

it('retains the SRK freeze segments and supports contest durations other than five hours', async () => {
  const frozen = await render(4.5 * 60 * 60_000);
  const fills = [...frozen.matchAll(/class="srk-progress-bar-fill" style="width:([\d.]+)%/g)];
  expect(Number(fills[0][1])).toBe(100);
  expect(Number(fills[1][1])).toBeCloseTo(50);
  const shorter = { ...data, contest: { ...data.contest, duration: [2, 'h'] as srk.TimeDuration } };
  const ended = await renderToString(h(ReplayProgressBar, { data: shorter, elapsedMs: duration, live: true }));
  expect(ended).toContain('Elapsed: 2:00:00');
  expect(ended).toContain('Remaining: 0:00:00');
});
