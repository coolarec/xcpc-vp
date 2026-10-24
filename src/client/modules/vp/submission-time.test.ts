import { describe, expect, it } from 'vitest';
import { parseSubmissionTime } from './submission-time';
import { prepareReplay, OWN_ID } from './replay';
import type * as srk from '@algoux/standard-ranklist';

describe('manual submission hours and minutes', () => {
  it('accepts zero and earlier contest times, including exact elapsed time', () => {
    expect(parseSubmissionTime('0', '0', 0, 18_000_000)).toBe(0);
    expect(parseSubmissionTime('01', '05', 3_900_000, 18_000_000)).toBe(3_900_000);
    expect(parseSubmissionTime('1', '59', 8_000_000, 18_000_000)).toBe(7_140_000);
  });
  it('rejects blank, fractional, negative, out-of-range and future times', () => {
    for (const [hours, minutes] of [['', '5'], ['1', ''], ['1.5', '0'], ['-1', '0'], ['0', '60'], ['5', '0'], ['2', '0'], ['999999999999999999', '0']]) {
      expect(() => parseSubmissionTime(hours, minutes, 3_900_000, 18_000_000)).toThrow();
    }
  });
  it('scores the entered time instead of the current replay time', () => {
    const data: srk.Ranklist = {
      type: 'general', version: '0.3.14',
      contest: { title: 'Time test', startAt: '2026-01-01T00:00:00Z', duration: [5, 'h'] },
      problems: [{ alias: 'A' }], series: [{ rule: { preset: 'Normal' } }],
      sorter: { algorithm: 'ICPC', config: { timePrecision: 'min' } }, rows: [],
    };
    const replay = prepareReplay(data);
    const timeMs = parseSubmissionTime('1', '5', 7_200_000, replay.durationMs);
    const own = replay.snapshotAt(7_200_000, [{ problemIndex: 0, timeMs, result: 'AC' }], 'Own').rows.find(row => row.user.id === OWN_ID)!;
    expect(own.score.value).toBe(1);
    expect(own.statuses[0].time).toEqual([3_900_000, 'ms']);
    expect(own.score.time?.[0]).toBe(3_900_000);
  });
});
