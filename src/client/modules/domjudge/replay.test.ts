import { expect, it } from 'vitest';
import type * as srk from '@algoux/standard-ranklist';
import { prepareDomjudgeReplay } from './replay';
import { readVPOptions } from '../vp/options';
import { createNativeDomjudgeRenderer } from '@/components/ranklist/domjudge/native';

const fixture = (): srk.Ranklist => ({
  type: 'general', version: '0.3.14',
  contest: { title: 'Freeze test', startAt: '2026-01-01T00:00:00Z', duration: [5, 'h'] },
  problems: [{ alias: 'A' }, { alias: 'B' }], series: [{ rule: { preset: 'Normal' } }],
  sorter: { algorithm: 'ICPC', config: {} },
  rows: [{ user: { id: 'team', name: 'Team' }, score: { value: 2 }, statuses: [
    { result: 'AC', tries: 1, time: [239, 'min'], solutions: [{ result: 'AC', time: [239, 'min'] }] },
    { result: 'AC', tries: 2, time: [250, 'min'], solutions: [{ result: 'WA', time: [240, 'min'] }, { result: 'AC', time: [250, 'min'] }] },
  ] }],
});

it.each([undefined, [0, 'min'], [30, 'min'], [2, 'h']] as const)('uses a one-hour freeze regardless of source frozenDuration %s', frozenDuration => {
  const data = fixture();
  if (frozenDuration) data.contest.frozenDuration = [...frozenDuration] as srk.TimeDuration;
  const original = JSON.stringify(data);
  const replay = prepareDomjudgeReplay(data, readVPOptions({}));
  expect(replay.frozenAtMs).toBe(240 * 60_000);
  const before = replay.snapshotAt(239 * 60_000).rows[0];
  expect(before.score.value).toBe(1);
  expect(before.statuses[1].result).toBeNull();
  const boundary = replay.snapshotAt(240 * 60_000).rows[0];
  expect(boundary.statuses[1].result).toBe('?');
  expect(boundary.statuses[1].solutions?.[0].result).toBe('?');
  const frozen = replay.snapshotAt(250 * 60_000).rows[0];
  expect(frozen.score.value).toBe(1);
  expect(frozen.statuses[1].result).toBe('?');
  expect(frozen.statuses[1].solutions?.map(solution => solution.result)).toEqual(['?', '?']);
  const final = replay.snapshotAt(300 * 60_000).rows[0];
  expect(final.score.value).toBe(2);
  expect(['AC', 'FB']).toContain(final.statuses[1].result);
  expect(JSON.stringify(data)).toBe(original);
});

it('shows the native one-hour freeze notice, pending cell and masked submission details', async () => {
  const replay = prepareDomjudgeReplay(fixture(), readVPOptions({}));
  const renderer = createNativeDomjudgeRenderer();
  const before = await renderer.render(replay.snapshotAt(239 * 60_000), { elapsedMs: 239 * 60_000 });
  expect(before.html).not.toContain('The scoreboard was frozen');
  const frozen = await renderer.render(replay.snapshotAt(250 * 60_000), { elapsedMs: 250 * 60_000 });
  expect(frozen.html).toContain('The scoreboard was frozen with 60 minutes remaining');
  expect(frozen.html).toContain('score_pending');
  const submissions = Object.values(frozen.submissions.submissions)[0]['problem-1'];
  expect(submissions.map(submission => submission.verdict)).toEqual(['pending', 'pending']);
  const final = await renderer.render(replay.snapshotAt(300 * 60_000), { elapsedMs: 300 * 60_000 });
  expect(final.html).toContain('final standings');
  expect(final.html).not.toContain('The scoreboard was frozen');
});

it('does not let a one-hour freeze exceed a shorter contest', () => {
  const data = fixture();
  data.contest.duration = [30, 'min'];
  expect(prepareDomjudgeReplay(data, readVPOptions({})).frozenAtMs).toBe(0);
});
