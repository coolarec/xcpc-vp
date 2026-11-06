import 'reflect-metadata';
import '@/app/install-contest-find';
import Axios from 'axios';
import { formatTimeDuration } from '@algoux/standard-ranklist-utils';
import { ApiClientFactory } from '@/api';
import { getRanklandRuntimeConfig } from '@/app/config';
import { createClientRanklandApi } from '@/services/ranklist-api/factory.client';
import { createNativeDomjudgeRenderer } from '@/components/ranklist/domjudge/native';
import { formatSrkAssetUrl } from '@/utils/srk-asset.util';
import { buildVPQuery, readVPOptions } from '../vp/options';
import type { ManualSubmission } from '../vp/replay';
import { readVPClock } from '../vp/clock';
import { prepareDomjudgeReplay } from './replay';

// Separate document: no Vue app, RankLand CSS, VP toolbar, submission feed or iframe.
const root = document.getElementById('vp-native-root')!;
const query = Object.fromEntries(new URLSearchParams(window.location.search));
const contest = query.contest;
const renderer = createNativeDomjudgeRenderer();
let affiliations: string[] = [];

const respond = (detail: Record<string, unknown>) => window.dispatchEvent(new CustomEvent('domjudge-vp-response', { detail }));

async function bootstrap() {
  if (!contest) { window.location.replace('/?board=domjudge'); return; }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(contest)) throw new Error('比赛 ID 格式不正确。');
  let options = readVPOptions(query);
  if (!options.scheduledAt) {
    const canonical = buildVPQuery(contest, options);
    options = readVPOptions(canonical);
    history.replaceState(null, '', `/domjudge.html?${new URLSearchParams(canonical)}`);
  }
  const config = getRanklandRuntimeConfig();
  const request = Axios.create({ baseURL: `${config.legacyApiBaseClient.replace(/\/$/, '')}/`, timeout: 30_000 });
  const api = createClientRanklandApi(ApiClientFactory.createInstance(request));
  const source = await api.getRanklist({ uniqueKey: contest });
  const replay = prepareDomjudgeReplay(source.srk, options);
  if (options.startMinutes * 60000 > replay.durationMs) throw new Error('起始时间不能超过比赛时长。');
  document.title = `${typeof source.srk.contest.title === 'string' ? source.srk.contest.title : contest} - DOMjudge`;
  const storageKey = `RanklandVP:submissions:${contest}:${new Date(options.scheduledAt).toISOString()}:${options.rule}:${options.revealCount}:${options.revealRatio}`;
  let manual: ManualSubmission[] = [];
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed) || parsed.length > 10000) throw new Error('提交记录格式无效。');
      // The shared replay engine validates each stored record before producing a snapshot.
      replay.snapshotAt(0, parsed, options.team, options.organization);
      manual = parsed;
    }
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof Error && error.message.includes('提交')) throw error;
    // A browser that blocks storage can still display the source contest.
  }
  let rendering = false;
  let dirty = false;
  let lastSignature = '';
  let visibleEvents = 0;
  const languages = navigator.languages;

  async function redraw() {
    dirty = true;
    if (rendering) return;
    rendering = true;
    try {
      while (dirty) {
        dirty = false;
        const clock = readVPClock(options, replay.durationMs, Date.now());
        const snapshot = replay.snapshotAt(clock.elapsed, manual, options.team, options.organization);
        const output = await renderer.render(snapshot, {
          elapsedMs: clock.elapsed, startedAt: options.scheduledAt, contestKey: contest, affiliations, languages,
          formatAssetUrl: url => formatSrkAssetUrl(url, contest),
        });
        root.removeAttribute('role');
        respond({ type: 'snapshot', ...output });
      }
    } catch (error) { showError(error); }
    finally { rendering = false; }
  }
  function tick() {
    const clock = readVPClock(options, replay.durationMs, Date.now());
    while (visibleEvents < replay.solutions.length) {
      const eventTime = replay.solutions[visibleEvents][3];
      if (formatTimeDuration(eventTime, 'ms') > clock.elapsed) break;
      visibleEvents++;
    }
    const signature = `${visibleEvents}:${Math.floor(clock.elapsed / 60000)}:${clock.elapsed >= replay.frozenAtMs}:${clock.elapsed >= replay.durationMs}`;
    if (signature !== lastSignature) { lastSignature = signature; redraw(); }
  }
  async function onRequest(event: Event) {
    const message = (event as CustomEvent).detail;
    try {
      if (message.type === 'filter' && Array.isArray(message.affiliations)) {
        affiliations = message.affiliations.filter(value => typeof value === 'string'); redraw();
      } else if (message.type === 'team' && typeof message.teamId === 'string' && /^t[\da-f]+$/.test(message.teamId)) {
        respond({ type: 'team-result', requestId: message.requestId, html: await renderer.renderTeam(message.teamId) });
      } else if (message.type === 'problems') respond({ type: 'problems-result', html: await renderer.renderProblems() });
    } catch (error) {
      if (message.type === 'team') respond({ type: 'team-result', requestId: message.requestId, error: error instanceof Error ? error.message : String(error) });
      else showError(error);
    }
  }
  window.addEventListener('domjudge-vp-request', onRequest);
  tick();
  let timer = window.setInterval(tick, 250);
  window.addEventListener('pagehide', () => window.clearInterval(timer));
  window.addEventListener('pageshow', event => { if (event.persisted) { tick(); timer = window.setInterval(tick, 250); } });
}

function showError(error: unknown) {
  root.setAttribute('role', 'alert');
  root.textContent = error instanceof Error ? error.message : String(error);
}

bootstrap().catch(showError);
