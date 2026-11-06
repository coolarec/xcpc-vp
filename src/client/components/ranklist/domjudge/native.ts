import type * as srk from '@algoux/standard-ranklist';
import { Buffer } from 'buffer';
import { createArrayLoader, createEnvironment, createFilter, createFunction, createMarkup, isAMarkup } from 'twing';
import { convertToStaticRanklist, formatTimeDuration, numberToAlphabet, resolveStyle, resolveText, resolveUserMarkers } from '@algoux/standard-ranklist-utils';
import { isCCPC26Ranklist } from '@/utils/ccpc26.util';
import { formatChinaTime } from '@/modules/vp/china-time';

// Twing's HTML escaping uses Buffer's UTF-8 helpers in both Node and browsers.
if (!(globalThis as any).Buffer) (globalThis as any).Buffer = Buffer;

const sources = import.meta.glob('../vendor/domjudge/templates/**/*.twig', { as: 'raw', eager: true }) as Record<string, string>;
const templates = Object.fromEntries(Object.entries(sources).map(([name, source]) => [name.split('/templates/')[1], source]));
const assetRoot = '/scoreboards/domjudge/';

// Compose upstream sections; the loader adds the requested RankLand link beside the title.
templates['vp/scoreboard.twig'] = `{% include 'public/menu.html.twig' %}<main class="container-fluid"><div data-ajax-refresh-target data-ajax-refresh-after="initializeScoreboard">{% include 'partials/scoreboard.html.twig' %}</div><div data-submissions-modal>{% include 'public/team_submissions_modal.html.twig' %}</div>{% include 'public/partials/submission_list_template.html.twig' %}</main>`;
templates['vp/team.twig'] = `{% extends 'partials/modal.html.twig' %}{% block title %}{{ team.effectiveName }}{% endblock %}{% block content %}{% include 'partials/team.html.twig' with {size: 12} %}{% endblock %}`;
templates['vp/problems.twig'] = `{% include 'partials/problem_list.html.twig' %}`;

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]!));
const get = (value: any, key: string) => value instanceof Map ? value.get(key) : value?.[key];
const seconds = (time?: srk.TimeDuration) => time ? formatTimeDuration(time, 's') : 0;
const safeUrl = (url: string | undefined) => url && /^(https?:\/\/|\/[^/])/i.test(url) ? url : '';
const teamKey = (row: srk.RanklistRow, index: number) => 't' + Array.from(new TextEncoder().encode(String(row.user.id ?? resolveText(row.user.name) ?? index)), byte => byte.toString(16).padStart(2, '0')).join('');

// Server-side badge-color helpers from DOMjudge Utils::{relativeLuminance,apcaContrast}.
function nativeBadgeForeground(rgb: number[]) {
  const luminance = rgb.reduce((sum, channel, index) => sum + [0.2126, 0.7152, 0.0722][index] * (channel / 255) ** 2.4, 0);
  const contrast = (foreground: number) => Math.abs(luminance > foreground
    ? (luminance ** 0.56 - foreground ** 0.57) * 1.14
    : (luminance ** 0.65 - foreground ** 0.62) * 1.14);
  return contrast(0) > contrast(1) ? '#000000' : '#ffffff';
}

export function supportsNativeDomjudge(data: srk.Ranklist): boolean {
  return data.sorter?.algorithm === 'ICPC' && !isCCPC26Ranklist(data);
}

/** Match the upstream PHP problemBadge filter's markup; interpolate escaped data only. */
function badge(problem: any) {
  return `<span class="badge problem-badge" style="${escape(badgeStyle(problem))}"><span>${escape(problem?.shortname || '?')}</span></span>`;
}
function badgeStyle(problem: any) {
  return `background-color: ${problem?.color || '#ffffff'}; border: 1px solid ${problem?.border || '#bfbfbf'}; color: ${problem?.foreground || '#000000'};`;
}

export interface NativeDomjudgeOptions {
  elapsedMs?: number;
  startedAt?: string;
  contestKey?: string;
  languages?: readonly string[];
  affiliations?: string[];
  formatAssetUrl?: (url: string) => string;
}

/** Supply DOMjudge's server-side model to its original Twig templates. */
export function createDomjudgeModel(input: srk.Ranklist, options: NativeDomjudgeOptions = {}) {
  if (!supportsNativeDomjudge(input)) throw new Error('DOMjudge 榜单仅支持传统 ICPC 赛制。');
  const data = convertToStaticRanklist(input);
  const text = (value: srk.Text | undefined) => value ? resolveText(value, options.languages) : '';
  const duration = seconds(data.contest.duration);
  const elapsed = Math.max(0, Math.min((options.elapsedMs ?? duration * 1000) / 1000, duration));
  const frozenAt = duration - seconds(data.contest.frozenDuration);
  const start = Date.parse(options.startedAt ?? data.contest.startAt) / 1000;
  if (!Number.isFinite(start)) throw new Error('比赛开始时间无效。');
  const ranklandUrl = options.contestKey ? `https://rl.algoux.cn/ranklist/${encodeURIComponent(options.contestKey)}` : '';
  const affiliations: Record<string, string> = {};
  const logos: Record<string, string> = {};
  const problems = data.problems.map((problem, index) => {
    const color = resolveStyle(problem.style || {}).backgroundColor?.light;
    // CSS values become inline declarations in the native template; accept color literals only.
    const hex = typeof color === 'string' && /^#[\da-f]{6}$/i.test(color) ? color : '#ffffff';
    const rgb = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
    return {
      probid: String(index), externalid: String(index), externalId: String(index),
      shortname: problem.alias || numberToAlphabet(index), color: hex,
      border: '#' + rgb.map(channel => Math.max(0, channel - 64).toString(16).padStart(2, '0')).join(''),
      foreground: nativeBadgeForeground(rgb),
      link: safeUrl(problem.link),
      points: 1,
      problem: { name: text(problem.title), problemstatementType: problem.link ? 'link' : '', languages: [], typesAsString: 'pass-fail', attachments: [] },
    };
  });
  const matrix: Record<string, Record<string, any>> = {};
  const scores: Record<string, any> = {};
  const submissions: Record<string, Record<string, any[]>> = {};
  const summaries = problems.map(() => ({ accepted: 0, rejected: 0, pending: 0, first: null as number | null }));
  const allTeams: Record<string, any> = {};
  data.rows.forEach((row, index) => {
    // Synthetic DOM identifiers avoid interpolation of arbitrary SRK IDs in upstream selectors.
    const id = teamKey(row, index);
    const organization = text(row.user.organization);
    if (organization) affiliations[organization] = organization;
    if (row.user.avatar) logos[id] = safeUrl(options.formatAssetUrl?.(row.user.avatar) || row.user.avatar);
    const rank = row.rankValues[0];
    const segment = data.series[0]?.segments?.[rank?.segmentIndex ?? -1];
    const team = {
      teamid: id, externalid: id, effectiveName: text(row.user.name), sortorder: 0,
      affiliation: { externalid: id, shortname: organization, name: organization },
      categories: resolveUserMarkers(row.user, data.markers).map(marker => ({ name: text(marker.label) })),
      cssClassCategories: [], badgeCategories: [], topBadgeCategories: [],
      backgroundColorCategory: { color: '#FFFFFF' }, medal: typeof segment?.style === 'string' ? segment.style : '',
    };
    allTeams[id] = team;
    if (options.affiliations?.length && !options.affiliations.includes(organization)) return;
    matrix[id] = {};
    submissions[`team-${id}`] = {};
    row.statuses.forEach((status, problemIndex) => {
      const accepted = status.result === 'AC' || status.result === 'FB';
      const tries = Number.isInteger(status.tries) && status.tries >= 0 ? status.tries! : null;
      const hidden = status.result === '?';
      const pendingFromSolutions = (status.solutions || []).filter(solution => solution.result === '?' || hidden && seconds(solution.time) >= frozenAt).length;
      const pending = hidden ? pendingFromSolutions > 0 ? Math.min(tries ?? pendingFromSolutions, pendingFromSolutions) : tries ?? 0 : 0;
      const judged = hidden ? Math.max(0, (tries ?? 0) - pending) : tries ?? 0;
      matrix[id][String(problemIndex)] = {
        numSubmissions: tries === null && status.result !== null && !pending ? '?' : judged,
        numSubmissionsPending: pending, isPending: hidden,
        isCorrect: accepted, isFirst: status.result === 'FB', time: seconds(status.time),
      };
      const summary = summaries[problemIndex];
      if (!summary) return;
      if (accepted) { summary.accepted++; summary.first = Math.min(summary.first ?? Infinity, seconds(status.time) / 60); }
      summary.rejected += Math.max(0, judged - (accepted ? 1 : 0));
      summary.pending += pending;
      submissions[`team-${id}`][`problem-${problemIndex}`] = (status.solutions || []).map(solution => ({
        time: escape(String(Math.floor(seconds(solution.time) / 60))), language: '', score: null,
        verdict: escape(hidden && seconds(solution.time) >= frozenAt ? 'pending' : solution.result === '?' ? 'pending' : solution.result || 'pending'),
      }));
    });
    scores[id] = { team, rank: row.user.official === false ? '*' : rank?.rank ?? '', numPoints: row.score.value, totalTime: Math.floor(seconds(row.score.time) / 60) };
  });
  const contest = {
    name: text(data.contest.title), shortname: text(data.contest.title), externalid: 'vp',
    starttime: start, endtime: start + duration, penaltyTime: data.sorter?.algorithm === 'ICPC' ? seconds(data.sorter.config.penalty || [20, 'min']) : 1200,
    minutesRemaining: Math.ceil((duration - frozenAt) / 60), finalizetime: elapsed >= duration ? start + duration : null,
    freezeData: { started: true, stopped: elapsed >= duration, showFrozen: elapsed >= frozenAt && elapsed < duration, showFinal: () => elapsed >= duration, progress: duration ? elapsed / duration * 100 : 0 },
  };
  const scoreboard = {
    scores, matrix, problems, freezeData: contest.freezeData, showPoints: false, isScoring: false,
    colorCategories: () => [], categoryColors: () => false, bestInCategory: () => false,
    getRuntimeAsScoreTiebreaker: () => false,
    getCellStyle: () => '', cellHasScore: () => false,
    getCellCssClass: (team: any, problem: any) => {
      const cell = matrix[team.teamid]?.[problem.probid];
      if (cell?.isCorrect) return cell.isFirst ? 'score_correct score_first' : 'score_correct';
      if (cell?.isPending) return 'score_pending';
      return cell?.numSubmissions ? 'score_incorrect' : 'score_neutral';
    },
    summary: {
      numberOfPoints: () => Object.values(scores).reduce((sum, score) => sum + score.numPoints, 0),
      problem: (id: string) => {
        const summary = summaries[Number(id)];
        return {
          numSubmissionsCorrect: [summary.accepted, summary.accepted],
          numSubmissions: [summary.accepted + summary.rejected, summary.accepted + summary.rejected],
          numSubmissionsPending: [summary.pending, summary.pending],
          bestTimeInMinutes: () => summary.first === null ? null : Math.floor(summary.first),
        };
      },
    },
  };
  return { data, problems, scores, allTeams, submissions: { submissions }, logos, contest, context: {
    scoreboard, contest, current_contest: contest, current_public_contest: contest, current_public_contests: [contest], ranklandUrl,
    public: true, jury: false, static: false, maxWidth: 320, enable_ranking: true,
    medalsEnabled: false, showAffiliationLogos: Object.values(logos).some(Boolean), showFlags: false, showAffiliations: true,
    showTeamSubmissions: true, showPending: true, showPoints: false, scoreInSeconds: false,
    filterValues: { affiliations, countries: [], categories: [] },
    scoreFilter: { affiliations: options.affiliations || [], countries: [], categories: [], filteredOn: (options.affiliations || []).join(', ') },
    submissions_route: 'public_submissions', submissions_data_route: 'public_submissions_data',
    app: { request: { attributes: { get: () => 'public_index' } } },
  } };
}

export function createNativeDomjudgeRenderer() {
  // Authentication and a wall-clock countdown do not apply to a local VP view.
  // The template files stay intact; only these server-provided includes are omitted.
  const environment = createEnvironment(createArrayLoader({ ...templates,
    // Requested VP addition; keep the vendor source and all other original markup intact.
    'partials/scoreboard.html.twig': templates['partials/scoreboard.html.twig'].replace(
      '<span style="font-weight: bold;">{{ current_contest.name }}</span>',
      '<span style="font-weight: bold;">{{ current_contest.name }}</span>{% if ranklandUrl %} <a href="{{ ranklandUrl }}" target="_blank" rel="noopener noreferrer" class="ms-2 small" aria-label="在 RankLand 查看原榜单">RankLand <i class="fas fa-external-link-alt" aria-hidden="true"></i></a>{% endif %}',
    ),
    'partials/menu_login_logout_button.html.twig': '', 'partials/menu_countdown.html.twig': '',
  }), { autoEscapingStrategy: 'html' });
  // PHP Twig re-escapes safe HTML when explicitly requested for an attribute.
  // Twing otherwise treats Markup as safe for every context, corrupting data-problem-badge.
  for (const name of ['escape', 'e']) {
    const original = environment.filters.get(name)!;
    environment.addFilter(createFilter(name, (executionContext, value, strategy, charset) =>
      original.callable(executionContext, isAMarkup(value) ? value.content : value, strategy, charset), original.acceptedArguments));
  }
  let active: ReturnType<typeof createDomjudgeModel>;
  const filter = (name: string, callback: (...args: any[]) => any, arguments_: string[] = []) => environment.addFilter(createFilter(name, async (_, ...args) => callback(...args), arguments_.map(name => ({ name, defaultValue: null }))));
  const fn = (name: string, callback: (...args: any[]) => any, arguments_: string[] = []) => environment.addFunction(createFunction(name, async (_, ...args) => callback(...args), arguments_.map(name => ({ name, defaultValue: null }))));
  fn('is_granted', () => false, ['role']);
  fn('path', (name: string, parameters: any) => {
    if (name === 'public_index') return '#scoreboard';
    if (name === 'public_problems') return '#problemset';
    if (name === 'public_team') return `/__domjudge_vp/team/${get(parameters, 'teamId')}`;
    if (name === 'public_submissions_data') return '/__domjudge_vp/submissions';
    if (name === 'public_problem_statement') return active.problems[Number(get(parameters, 'probId'))]?.link || '#problemset';
    return '#scoreboard';
  }, ['name', 'parameters', 'relative']);
  fn('asset', (path: string) => safeUrl(path) || assetRoot + path, ['path']);
  fn('calculatePenaltyTime', (penalty: number, solved: boolean, count: number) => solved ? Math.max(0, count - 1) * penalty : 0, ['penaltyTime', 'solved', 'num_submissions']);
  filter('assetPath', (id: string, type: string) => type === 'affiliation' ? active.logos[id] || '' : '', ['type']);
  filter('relativePath', (path: string) => path, ['static']);
  filter('countryFlag', () => '', ['full', 'static']);
  filter('medalType', (team: any) => ['gold', 'silver', 'bronze'].includes(team.medal) ? `${team.medal}-medal` : '', ['contest', 'scoreboard']);
  filter('problemBadge', (problem: any) => createMarkup(badge(problem)), ['grayedOut']);
  filter('problemBadgeVars', (problem: any) => `--badge-bg: ${problem.color}; --badge-border: ${problem.border}; --badge-fg: ${problem.foreground};`, ['grayedOut']);
  filter('scoreTime', (time: number) => Math.floor(time / 60));
  filter('printTimeRelative', (time: number) => `${Math.floor(time / 3600)}:${String(Math.floor(time / 60) % 60).padStart(2, '0')}:${String(Math.floor(time) % 60).padStart(2, '0')}`);
  filter('printtime', (time: any) => `${formatChinaTime(typeof time === 'number' ? time * 1000 : Date.now()).slice(0, 19).replace('T', ' ')} UTC+8`, ['format']);
  filter('printContestStart', () => '');
  filter('printelapsedminutes', () => '');
  filter('printSize', (bytes: number) => String(bytes));
  filter('fileTypeIcon', () => 'fas fa-file');

  return {
    async render(data: srk.Ranklist, options?: NativeDomjudgeOptions) {
      active = createDomjudgeModel(data, options);
      const html = await environment.render('vp/scoreboard.twig', active.context);
      return { html, submissions: active.submissions };
    },
    async renderTeam(id: string) {
      const team = active?.allTeams[id];
      if (!team) throw new Error('队伍不存在。');
      return environment.render('vp/team.twig', { ...active.context, team });
    },
    async renderProblems() {
      return environment.render('vp/problems.twig', {
        ...active.context, problems: active.problems, samples: {}, showLimits: false,
        showSamples: false, show_contest_problemset: true, show_jury_warning: false,
        current_team_contest: null, problem_statement_path: 'public_problem_statement',
      });
    },
  };
}
