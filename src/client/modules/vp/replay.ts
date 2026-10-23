import type * as srk from '@algoux/standard-ranklist';
import {
  canRegenerateRanklist,
  filterSolutionsUntil,
  formatTimeDuration,
  getSortedCalculatedRawSolutions,
  regenerateRanklistBySolutions,
} from '@algoux/standard-ranklist-utils';
import type { CalculatedSolutionTetrad } from '@algoux/standard-ranklist-utils';
import { createCheckers } from 'ts-interface-checker';
import checkerSuite from '../../lib/srk-checker/index.d.ti';

export type { CalculatedSolutionTetrad } from '@algoux/standard-ranklist-utils';
export const OWN_ID = '__vp_self__';

export interface ManualSubmission {
  id: string;
  problemIndex: number;
  timeMs: number;
  result: 'AC' | 'WA';
}

export interface PreparedReplay {
  /** Clean starting board, ordered by user.id rather than final rank. */
  source: srk.Ranklist;
  durationMs: number;
  solutions: CalculatedSolutionTetrad[];
  snapshotAt(ms: number, manual?: ManualSubmission[], ownName?: string): srk.Ranklist;
}

const { Ranklist: ranklistChecker } = createCheckers(checkerSuite);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const emptyStatuses = (count: number): srk.RankProblemStatus[] =>
  Array.from({ length: count }, () => ({ result: null, solutions: [] }));
const byUserId = (a: srk.RanklistRow, b: srk.RanklistRow) =>
  a.user.id < b.user.id ? -1 : a.user.id > b.user.id ? 1 : 0;

function milliseconds(time: srk.TimeDuration, path: string): number {
  try {
    const value = formatTimeDuration(time, 'ms');
    if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) throw new Error('invalid duration');
    return value;
  } catch {
    throw new Error(`${path}: 无效时间，须为非负有限数及 SRK 时间单位。`);
  }
}

/** Official SRK scoring only. Incomplete histories are rejected, never synthesized. */
export function prepareReplay(data: srk.Ranklist): PreparedReplay {
  ranklistChecker.check(data);
  if (!canRegenerateRanklist(data) || !/^0\.3\.\d+$/.test(data.version)) {
    throw new Error('VP 仅支持 SRK 0.3.x 的 ICPC 比赛，不支持积分赛。');
  }
  if (data.sorter?.algorithm === 'ICPC') {
    for (const extension of data.sorter.config.extendedAlgorithms || []) {
      if (extension.algorithm !== 'CCPC26') throw new Error('VP 暂不支持此扩展赛制。');
      const threshold = extension.config.problemRevealAcceptedThreshold;
      const validCount = threshold.count !== undefined && Number.isSafeInteger(threshold.count) && threshold.count > 0;
      const validRatio = threshold.ratio !== undefined && Number.isFinite(threshold.ratio) && threshold.ratio > 0 && threshold.ratio <= 1;
      if ((!validCount && !validRatio) || (threshold.count !== undefined && !validCount) || (threshold.ratio !== undefined && !validRatio)) {
        throw new Error('CCPC 2026 揭题阈值无效：需要正整数队伍数或 (0, 1] 的比例。');
      }
    }
  }
  const durationMs = milliseconds(data.contest.duration, 'contest.duration');
  if (!durationMs || !data.problems.length) throw new Error('VP 需要正数赛长及至少一道题目。');
  const startMs = Date.parse(data.contest.startAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(new Date(startMs + durationMs).getTime())) {
    throw new Error('contest.startAt: 无效比赛时间。');
  }
  if (data.sorter?.algorithm === 'ICPC' && data.sorter.config.penalty) {
    milliseconds(data.sorter.config.penalty, 'sorter.config.penalty');
  }
  const ids = new Set<string>();
  for (const row of data.rows) {
    const id = row.user.id;
    if (!id.trim() || id === OWN_ID || ids.has(id)) throw new Error(`无效、重复或保留的 user.id: ${id}`);
    ids.add(id);
    if (row.statuses.length !== data.problems.length) throw new Error(`${id}: statuses 数量与题目数不符。`);
    for (const [index, status] of row.statuses.entries()) {
      const path = `${id}.statuses[${index}]`;
      if (status.tries !== undefined && (!Number.isSafeInteger(status.tries) || status.tries < 0)) {
        throw new Error(`${path}: tries 必须是非负整数。`);
      }
      if (status.time) milliseconds(status.time, `${path}.time`);
      if (!status.solutions?.length && (status.result !== null || (status.tries || 0) > 0)) {
        throw new Error(`${path}: 提交历史不完整（partial），无法准确重放；需要完整 solutions，不会补造 WA 时间。`);
      }
      for (const solution of status.solutions || []) {
        if (!solution.result.trim() || milliseconds(solution.time, `${path}.solutions.time`) > durationMs) {
          throw new Error(`${path}: 提交结果为空或时间超出赛长。`);
        }
      }
    }
  }
  const template = clone(data);
  template.rows.sort(byUserId);
  // Clear summaries before extraction: the official extractor otherwise creates
  // synthetic RJ submissions for accepted statuses without detailed solutions.
  const timelineRows: srk.RanklistRow[] = template.rows.map((row) => ({
    user: row.user,
    score: { value: 0 },
    statuses: row.statuses.map((status) => ({ result: null, solutions: status.solutions || [] })),
  }));
  const solutions = getSortedCalculatedRawSolutions(timelineRows);
  const final = regenerateRanklistBySolutions({ ...template, rows: timelineRows }, solutions);
  const byId = new Map(final.rows.map((row) => [row.user.id, row]));
  const normalize = (result: srk.SolutionResultLite) => result === 'FB' ? 'AC' : result;
  for (const row of template.rows) {
    row.statuses.forEach((status, index) => {
      const calculated = byId.get(row.user.id)!.statuses[index];
      if (normalize(status.result) !== normalize(calculated.result) ||
          (status.tries !== undefined && status.tries !== (calculated.tries || 0))) {
        throw new Error(`${row.user.id}.statuses[${index}]: 提交历史不完整或汇总与官方重算不符（partial），无法准确重放。`);
      }
    });
  }
  const baseline = regenerateRanklistBySolutions({ ...template, rows: timelineRows }, []);
  baseline._now = new Date(startMs).toISOString();
  return {
    source: clone(baseline),
    durationMs,
    solutions: clone(solutions),
    snapshotAt(ms, manual = [], ownName = '') {
      if (!Number.isFinite(ms)) throw new Error('重放时间必须是有限数。');
      if (!Array.isArray(manual) || typeof ownName !== 'string') throw new Error('无效的手动提交或队伍名称。');
      const timeMs = Math.max(0, Math.min(ms, durationMs));
      const own: srk.RanklistRow = {
        user: { id: OWN_ID, name: ownName.trim() || '我的队伍', official: true },
        score: { value: 0 },
        statuses: emptyStatuses(template.problems.length),
      };
      const manualIds = new Set<string>();
      for (const submission of manual) {
        if (!submission || typeof submission.id !== 'string' || !submission.id.trim() || manualIds.has(submission.id) ||
            !Number.isInteger(submission.problemIndex) || submission.problemIndex < 0 || submission.problemIndex >= own.statuses.length ||
            !Number.isFinite(submission.timeMs) || submission.timeMs < 0 || submission.timeMs > durationMs ||
            (submission.result !== 'AC' && submission.result !== 'WA')) {
          throw new Error('无效的手动提交：需要唯一 id、有效题号、比赛内时间及 AC/WA。');
        }
        manualIds.add(submission.id);
        own.statuses[submission.problemIndex].solutions!.push({ result: submission.result, time: [submission.timeMs, 'ms'] });
      }
      const hasOwn = !!ownName.trim() || manual.length > 0;
      const events = hasOwn ? getSortedCalculatedRawSolutions([...timelineRows, own]) : solutions;
      const input = hasOwn ? { ...baseline, rows: [...baseline.rows, own].sort(byUserId) } : baseline;
      const snapshot = regenerateRanklistBySolutions(input, filterSolutionsUntil(events, [timeMs, 'ms']));
      snapshot._now = new Date(startMs + timeMs).toISOString();
      // Official regeneration reuses users/solution tuples; detach the public snapshot.
      return clone(snapshot);
    },
  };
}
