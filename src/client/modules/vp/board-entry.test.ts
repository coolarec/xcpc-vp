import { expect, it } from 'vitest';
import type * as srk from '@algoux/standard-ranklist';
import { buildContestEntry, supportsDomjudgeEntry } from './board-entry';
import { readVPOptions } from './options';

it('chooses separate HTML documents before starting a contest and preserves its clock', () => {
  const options = readVPOptions({ at: '2026-11-06T12:00:00+08:00', anchor: '2026-11-06T12:30:00+08:00', play: '1', speed: '2', from: '30' });
  const rankland = new URL(buildContestEntry('rankland', 'test', options), 'http://localhost');
  const domjudge = new URL(buildContestEntry('domjudge', 'test', options), 'http://localhost');
  expect(rankland.pathname).toBe('/');
  expect(domjudge.pathname).toBe('/domjudge.html');
  expect([...rankland.searchParams]).toEqual([...domjudge.searchParams]);
  expect(readVPOptions(Object.fromEntries(domjudge.searchParams))).toEqual(options);
});

it('blocks new-format data from the DOMjudge entry unless the user explicitly chooses traditional rules', () => {
  const data: srk.Ranklist = {
    type: 'general', version: '0.3.14',
    contest: { title: 'Entry rules', startAt: '2026-11-06T00:00:00Z', duration: [5, 'h'] },
    rows: [], problems: [], series: [],
    sorter: { algorithm: 'ICPC', config: { extendedAlgorithms: [{ algorithm: 'CCPC26', config: { problemRevealAcceptedThreshold: { count: 50 } } }] } },
  };
  expect(supportsDomjudgeEntry(data, 'auto')).toBe(false);
  expect(supportsDomjudgeEntry(data, 'CCPC26')).toBe(false);
  expect(supportsDomjudgeEntry(data, 'ICPC')).toBe(true);
  data.sorter = { algorithm: 'ICPC', config: {} };
  expect(supportsDomjudgeEntry(data, 'auto')).toBe(true);
});
