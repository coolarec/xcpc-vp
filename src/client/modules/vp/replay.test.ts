import { describe, expect, it } from 'vitest';
import type * as srk from '@algoux/standard-ranklist';
import { prepareReplay } from './replay';

function ranklist(status: srk.RankProblemStatus, noPenaltyResults?: srk.SolutionResultFull[]): srk.Ranklist {
  return {
    type: 'general', version: '0.3.14',
    contest: { title: 'Replay validation', startAt: '2026-10-18T01:00:00Z', duration: [5, 'h'] },
    problems: [{ alias: 'C' }], series: [{ rule: { preset: 'Normal' } }],
    sorter: { algorithm: 'ICPC', config: { ...(noPenaltyResults ? { noPenaltyResults } : {}) } },
    rows: [{ user: { id: 'Team257', name: 'Team257' }, score: { value: 0 }, statuses: [status] }],
  };
}

describe('replay history validation', () => {
  it('replays complete CE-only histories marked RJ with zero effective tries', () => {
    const solutions: srk.RankProblemStatus['solutions'] = [
      { result: 'CE', time: [16_766_923, 'ms'] },
      { result: 'CE', time: [17_775_263, 'ms'] },
    ];
    const data = ranklist({ result: 'RJ', tries: 0, time: [0, 's'], solutions });
    const original = JSON.stringify(data);
    const replay = prepareReplay(data);
    expect(replay.solutions).toHaveLength(2);
    expect(replay.snapshotAt(16_766_922).rows[0].statuses[0].solutions).toEqual([]);
    expect(replay.snapshotAt(16_766_923).rows[0].statuses[0].solutions).toEqual(solutions.slice(0, 1));
    const final = replay.snapshotAt(replay.durationMs).rows[0];
    expect(final.statuses[0]).toEqual({ result: null, solutions });
    expect(final.score.value).toBe(0);
    expect(final.score.time).toEqual([0, 'ms']);
    expect(JSON.stringify(data)).toBe(original);
  });

  it('uses the contest configuration when recognizing non-penalty submissions', () => {
    const data = ranklist(
      { result: 'RJ', solutions: [{ result: 'WA', time: [10, 'min'] }] },
      ['AC', 'FB', 'WA'],
    );
    expect(prepareReplay(data).snapshotAt(600_000).rows[0].statuses[0].solutions).toHaveLength(1);
  });

  it('replays submissions even when summary tries differ', () => {
    const data = ranklist({ result: 'RJ', tries: 1, solutions: [{ result: 'CE', time: [10, 'min'] }] });
    const final = prepareReplay(data).snapshotAt(600_000).rows[0];
    expect(final.statuses[0]).toEqual({ result: null, solutions: data.rows[0].statuses[0].solutions });
    expect(final.score.value).toBe(0);
  });

  it('scores submissions even when the summary result differs', () => {
    const data = ranklist({ result: 'AC', tries: 1, solutions: [{ result: 'WA', time: [10, 'min'] }] });
    const final = prepareReplay(data).snapshotAt(600_000).rows[0];
    expect(final.statuses[0]).toMatchObject({ result: 'RJ', tries: 1 });
    expect(final.score.value).toBe(0);
  });

  it('still rejects a rejected summary without any submission history', () => {
    expect(() => prepareReplay(ranklist({ result: 'RJ', tries: 0, solutions: [] }))).toThrow(/partial/);
  });

  it('counts CE when the contest config makes it a penalty result', () => {
    const data = ranklist(
      { result: 'RJ', tries: 1, solutions: [{ result: 'CE', time: [10, 'min'] }] },
      ['AC', 'FB'],
    );
    expect(prepareReplay(data).snapshotAt(600_000).rows[0].statuses[0]).toMatchObject({ result: 'RJ', tries: 1 });
  });
});
