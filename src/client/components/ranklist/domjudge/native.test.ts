import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type * as srk from '@algoux/standard-ranklist';
import { createDomjudgeModel, createNativeDomjudgeRenderer, supportsNativeDomjudge } from './native';
import manifest from '../vendor/domjudge/manifest.json';

const fixture = (): srk.Ranklist => ({
  type: 'general', version: '0.3.14',
  contest: { title: 'Native DOMjudge', startAt: '2026-11-06T00:00:00Z', duration: [5, 'h'], frozenDuration: [1, 'h'] },
  problems: [{ alias: 'A', title: 'Alpha', style: { backgroundColor: '#fc6d3e' } }, { alias: 'B', link: 'https://example.org/B' }],
  series: [{ title: 'Rank', rule: { preset: 'Normal' } }], sorter: { algorithm: 'ICPC', config: {} },
  rows: [{ user: { id: 'team[]"', name: 'Team <script>alert(1)</script>', organization: 'University A' }, score: { value: 1, time: [60, 'min'] }, statuses: [
    { result: 'FB', tries: 2, time: [40, 'min'], solutions: [{ result: 'WA', time: [20, 'min'] }, { result: 'AC', time: [40, 'min'] }, { result: 'CE', time: [45, 'min'] }] },
    { result: '?', tries: 3, solutions: [{ result: '?', time: [250, 'min'] }] },
  ] }, { user: { id: 'two', name: 'Other team', organization: 'University B', official: false }, score: { value: 0 }, statuses: [{ result: 'RJ', tries: 1 }, { result: null }] }],
});

it('uses only traditional ICPC in the native DOMjudge page', () => {
  const data = fixture();
  expect(supportsNativeDomjudge(data)).toBe(true);
  data.sorter = { algorithm: 'ICPC', config: { extendedAlgorithms: [{ algorithm: 'CCPC26', config: { problemRevealAcceptedThreshold: { count: 50 } } }] } };
  expect(supportsNativeDomjudge(data)).toBe(false);
  expect(() => createDomjudgeModel(data)).toThrow('传统 ICPC');
});

it('supplies effective tries, total penalty, pending data and safe selectors without mutating SRK', () => {
  const data = fixture();
  const original = JSON.stringify(data);
  const model = createDomjudgeModel(data, { elapsedMs: 250 * 60000 });
  const id = Object.keys(model.scores)[0];
  expect(model.scores[id].team.externalid).toBe(id);
  expect(model.scores[id].numPoints).toBe(1);
  expect(model.scores[id].totalTime).toBe(60);
  expect(model.context.scoreboard.matrix[id]['0']).toMatchObject({ numSubmissions: 2, isCorrect: true, isFirst: true, time: 2400 });
  expect(model.context.scoreboard.matrix[id]['1']).toMatchObject({ numSubmissions: 2, numSubmissionsPending: 1, isCorrect: false });
  expect(JSON.stringify(data)).toBe(original);
});

it('renders unmodified DOMjudge templates, including original filters, legends, problem list and team modal', async () => {
  const renderer = createNativeDomjudgeRenderer();
  const result = await renderer.render(fixture(), { elapsedMs: 250 * 60000 });
  expect(result.html).toContain('navbar navbar-expand-md');
  expect(result.html).toContain('scoreboard main-scoreboard');
  expect(result.html).toContain('score_correct score_first');
  expect(result.html).toContain('score_pending');
  expect(result.html).toContain('Cell colours');
  expect(result.html).toContain('scoreboard was frozen');
  expect(result.html).toContain('filter-toggle');
  expect(result.html).toContain('Summary');
  expect(result.html).toContain('2 tries');
  expect(result.html).toContain('&lt;script&gt;');
  expect(result.html).not.toContain('<script>alert(1)</script>');
  expect(result.html).not.toContain('srk-ranklist');
  expect(result.html).not.toContain('data-problem-badge="<span');
  expect(result.html).toContain('data-problem-badge="&lt;span');
  const modal = await renderer.renderTeam(Object.keys(createDomjudgeModel(fixture()).scores)[0]);
  expect(modal).toContain('modal fade');
  expect(modal).toContain('University A');
  const problems = await renderer.renderProblems();
  expect(problems).toContain('Native DOMjudge problems');
  expect(problems).toContain('Alpha');
});

it('keeps all upstream templates/assets unchanged and preserves the original RankLand renderer', () => {
  const digest = (path: string) => createHash('sha256').update(readFileSync(resolve(process.cwd(), path))).digest('hex');
  for (const [path, checksum] of Object.entries(manifest.sha256)) expect(digest(path), path).toBe(checksum);
  expect(digest(manifest.ranklandBaseline.file)).toBe(manifest.ranklandBaseline.sha256);
});

it('keeps favourite identifiers stable after ranks or filters change', () => {
  const data = fixture();
  const before = Object.values(createDomjudgeModel(data).scores).map(score => score.team.externalid);
  data.rows.reverse();
  const after = Object.values(createDomjudgeModel(data).scores).map(score => score.team.externalid);
  expect(before.sort()).toEqual(after.sort());
  expect(new Set(before).size).toBe(2);
  expect(before.every(id => /^t[\da-f]+$/.test(id))).toBe(true);
});

it('keeps accepted cells visible when the source has no attempt count', async () => {
  const data = fixture();
  delete data.rows[0].statuses[0].tries;
  const result = await createNativeDomjudgeRenderer().render(data);
  expect(result.html).toContain('? tries');
  expect(result.html).toContain('score_correct score_first');
});

it('filters by affiliation without recalculating or renumbering rankings', () => {
  const model = createDomjudgeModel(fixture(), { affiliations: ['University B'] });
  expect(Object.keys(model.scores)).toHaveLength(1);
  expect(Object.values(model.scores)[0].rank).toBe('*');
  expect(Object.keys(model.context.filterValues.affiliations)).toHaveLength(2);
});

it('links the original contest and displays the actual VP start/end in China time', async () => {
  const data = fixture();
  const options = { contestKey: 'icpc2026invitational-xi_an', startedAt: '2026-11-07T23:30:00+08:00', elapsedMs: 60_000 };
  const model = createDomjudgeModel(data, options);
  expect(model.contest.starttime).toBe(Date.parse(options.startedAt) / 1000);
  expect(model.contest.endtime - model.contest.starttime).toBe(5 * 3600);
  const { html } = await createNativeDomjudgeRenderer().render(data, options);
  expect(html).toContain('href="https://rl.algoux.cn/ranklist/icpc2026invitational-xi_an"');
  expect(html).toContain('aria-label="在 RankLand 查看原榜单"');
  expect(html).toContain('2026-11-07 23:30:00 UTC+8');
  expect(html).toContain('2026-11-08 04:30:00 UTC+8');
  expect(html).not.toContain('2026-11-06 00:00:00');
  expect(data.contest.startAt).toBe('2026-11-06T00:00:00Z');
});
