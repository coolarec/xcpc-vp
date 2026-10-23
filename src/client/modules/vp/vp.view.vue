<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import type * as srk from '@algoux/standard-ranklist';
import { formatTimeDuration, getCCPC26ProblemLayout, resolveText } from '@algoux/standard-ranklist-utils';
import { Modal } from '@algoux/standard-ranklist-renderer-component-vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import Loading from '@/components/common/Loading.vue';
import StyledRanklist from '@/components/ranklist/StyledRanklist.vue';
import ScrollSolution from './ScrollSolution.vue';
import type { ScrollSolutionDataItem } from './ScrollSolution.vue';
import { useRanklandApi } from '@/services/ranklist-api';
import { formatTitle } from '@/app/title-format';
import { prepareReplay, type ManualSubmission } from './replay';
import { applyVPOptions, DEFAULT_VP_OPTIONS, readVPOptions, type VPOptions } from './options';
import { shouldEnableCCPC26 } from '@/utils/ccpc26.util';

const route = useRoute();
const router = useRouter();
const api = useRanklandApi();
const options = shallowRef<VPOptions>({ ...DEFAULT_VP_OPTIONS });
const replay = shallowRef<ReturnType<typeof prepareReplay>>();
const ranklist = shallowRef<srk.Ranklist>();
const error = ref('');
const savingError = ref('');
const loading = ref(false);
const elapsed = ref(0);
const running = ref(false);
const speed = ref(1);
const now = ref(Date.now());
const ownName = ref('');
const ownNameInput = ref('');
const manual = ref<ManualSubmission[]>([]);
const problem = ref(0);
const result = ref<'AC' | 'WA'>('AC');
const joinOpen = ref(false);
const resetOpen = ref(false);
const scrollSolution = ref<InstanceType<typeof ScrollSolution>>();
const feedKey = ref(0);
const clientWidth = ref(window.innerWidth);
const clientHeight = ref(window.innerHeight);
const key = computed(() => typeof route.query.contest === 'string' ? route.query.contest : '');
const run = computed(() => typeof route.query.run === 'string' ? route.query.run : 'default');
const enabledScrollSolution = computed(() => route.query.feed !== '0' && clientWidth.value >= 768);
const duration = computed(() => replay.value?.durationMs || 0);
const ended = computed(() => !!duration.value && elapsed.value >= duration.value);
const progressTimeDelta = computed(() => now.value - (Date.parse(ranklist.value?.contest.startAt || '') + elapsed.value));
const viewportStyle = computed(() => ({ marginLeft: enabledScrollSolution.value ? '250px' : undefined, width: enabledScrollSolution.value ? 'calc(100% - 250px)' : '100%', minWidth: '0' }));
const ccpc26Active = computed(() => !!ranklist.value && shouldEnableCCPC26(ranklist.value, { isLive: true, timeTravelTime: elapsed.value, now: now.value }));
const revealedProblems = computed(() => ccpc26Active.value && ranklist.value ? new Set(getCCPC26ProblemLayout(ranklist.value)?.revealedProblemIndexes || []) : null);
const storageKey = computed(() => `RanklandVP2:${key.value}:${run.value}:${options.value.rule}:${options.value.revealCount}:${options.value.revealRatio}:${options.value.penaltyMinutes}:${options.value.startMinutes}`);
let anchorTime = Date.now();
let anchorElapsed = 0;
let cursor = 0;
let generation = 0;
let lastSaved = 0;
let activeKey = '';

function save() {
  if (!replay.value || activeKey !== key.value) return;
  try {
    localStorage.setItem(storageKey.value, JSON.stringify({
      version: 2, elapsed: elapsed.value, savedAt: Date.now(), running: running.value,
      speed: speed.value, ownName: ownName.value, manual: manual.value,
    }));
    lastSaved = Date.now();
  } catch { savingError.value = '浏览器无法保存进度，关闭页面前请注意记录比赛时间。'; }
}
function restore() {
  const stored = localStorage.getItem(storageKey.value);
  if (!stored) return false;
  const state = JSON.parse(stored);
  if (state.version !== 2 || typeof state.elapsed !== 'number' || !Number.isFinite(state.elapsed) ||
      state.elapsed < 0 || state.elapsed > duration.value || typeof state.savedAt !== 'number' ||
      !Number.isFinite(state.savedAt) || ![1, 2, 5, 10, 30, 60].includes(state.speed) ||
      typeof state.running !== 'boolean' || typeof state.ownName !== 'string' || state.ownName.length > 80 ||
      !Array.isArray(state.manual) || state.manual.length > 10000) throw new Error('保存的 VP 进度格式无效。');
  const ids = new Set<string>();
  for (const submission of state.manual) {
    if (!submission || typeof submission.id !== 'string' || ids.has(submission.id) ||
        !Number.isInteger(submission.problemIndex) || submission.problemIndex < 0 || submission.problemIndex >= replay.value.source.problems.length ||
        !['AC', 'WA'].includes(submission.result) || typeof submission.timeMs !== 'number' || !Number.isFinite(submission.timeMs) ||
        submission.timeMs < 0 || submission.timeMs > duration.value) throw new Error('保存的提交记录格式无效。');
    ids.add(submission.id);
  }
  ownName.value = state.ownName;
  manual.value = state.manual;
  speed.value = state.speed;
  elapsed.value = Math.min(duration.value, state.elapsed + (state.running ? Math.max(0, Date.now() - state.savedAt) * state.speed : 0));
  running.value = state.running && !ended.value;
  return true;
}
function reanchor() { anchorTime = Date.now(); anchorElapsed = elapsed.value; }
function solutionTime(index: number) {
  const solution = replay.value?.solutions[index];
  return solution?.[3] ? formatTimeDuration(solution[3], 'ms') : Infinity;
}
function redraw(pushEvents = true) {
  if (!replay.value) return;
  const previous = cursor;
  while (cursor < replay.value.solutions.length && solutionTime(cursor) <= elapsed.value) cursor++;
  ranklist.value = replay.value.snapshotAt(elapsed.value, manual.value, ownName.value);
  if (!pushEvents || !enabledScrollSolution.value || cursor <= previous) return;
  const rowsById = new Map(ranklist.value.rows.map(row => [row.user.id, row]));
  const messages: ScrollSolutionDataItem[] = replay.value.solutions.slice(Math.max(previous, cursor - 40), cursor).map(solution => {
    const row = rowsById.get(solution[0]);
    return {
      problem: { alias: revealedProblems.value && !revealedProblems.value.has(solution[1]) ? '?' : ranklist.value.problems[solution[1]].alias || String(solution[1] + 1) },
      score: { value: row?.score.value || 0 },
      result: (revealedProblems.value && !revealedProblems.value.has(solution[1]) && solution[2] === 'FB' ? 'AC' : solution[2]) as ScrollSolutionDataItem['result'],
      user: { name: row?.user.name || solution[0], organization: row?.user.organization },
    };
  });
  scrollSolution.value?.pushSolutions(messages);
}
function tick() {
  now.value = Date.now();
  if (!running.value || !replay.value) return;
  elapsed.value = Math.min(duration.value, anchorElapsed + Math.max(0, now.value - anchorTime) * speed.value);
  if (solutionTime(cursor) <= elapsed.value) redraw();
  if (ended.value) { running.value = false; save(); }
  else if (now.value - lastSaved > 5000) save();
}
function toggleRunning() {
  tick();
  if (ended.value) return;
  running.value = !running.value;
  reanchor(); save();
}
function setSpeed(event: Event) {
  tick(); speed.value = Number((event.target as HTMLSelectElement).value); reanchor(); save();
}
function reset() {
  running.value = false; elapsed.value = 0; manual.value = []; ownName.value = ''; ownNameInput.value = ''; cursor = 0;
  resetOpen.value = false; feedKey.value++; reanchor(); redraw(false); save();
}
function join() {
  const name = ownNameInput.value.trim();
  if (!name || name.length > 80) return;
  ownName.value = name; joinOpen.value = false; redraw(false); save();
}
function record() {
  tick();
  if (!running.value || !ownName.value || ended.value) return;
  const own = ranklist.value?.rows.find(row => row.user.id === '__vp_self__');
  if (['AC', 'FB'].includes(own?.statuses[problem.value]?.result || '')) return;
  manual.value = [...manual.value, { id: crypto.randomUUID(), problemIndex: problem.value, timeMs: elapsed.value, result: result.value }];
  redraw(false); save();
  const updatedOwn = ranklist.value.rows.find(row => row.user.id === '__vp_self__');
  scrollSolution.value?.pushSolutions([{
    problem: { alias: revealedProblems.value && !revealedProblems.value.has(problem.value) ? '?' : ranklist.value.problems[problem.value].alias || String(problem.value + 1) },
    score: { value: updatedOwn?.score.value || 0 }, result: result.value,
    user: { name: ownName.value, organization: 'Virtual Participant' },
  }]);
}
async function changeScroll(checked: boolean) {
  await router.replace({ query: { ...route.query, feed: checked ? '1' : '0' } });
}
function resize() { clientWidth.value = window.innerWidth; clientHeight.value = window.innerHeight; }
function saveOnLeave() { tick(); save(); }

onBeforeRouteLeave(saveOnLeave);
onBeforeRouteUpdate((to, from) => {
  if (to.query.contest !== from.query.contest || to.query.run !== from.query.run) saveOnLeave();
});

function backToSetup() {
  return router.push({ path: '/', query: { ...route.query, selected: key.value, contest: undefined, run: undefined, play: undefined, speed: String(speed.value), team: ownName.value || undefined } });
}

watch(key, async value => {
  const request = ++generation;
  save(); running.value = false; replay.value = undefined; ranklist.value = undefined;
  loading.value = true; error.value = ''; savingError.value = '';
  try {
    if (!api) throw new Error('RankLand API 未初始化。');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) throw new Error('比赛 ID 格式不正确。');
    if (!/^[a-zA-Z0-9._-]{1,128}$/.test(run.value)) throw new Error('参赛标识格式不正确。');
    options.value = readVPOptions(route.query);
    const data = await api.getRanklist({ uniqueKey: value });
    if (request !== generation) return;
    replay.value = prepareReplay(applyVPOptions(data.srk, options.value));
    if (options.value.startMinutes * 60000 >= duration.value) throw new Error('起始时间必须小于比赛时长。');
    activeKey = value; elapsed.value = options.value.startMinutes * 60000; speed.value = options.value.speed; manual.value = []; ownName.value = options.value.team;
    running.value = options.value.autoplay;
    try { restore(); } catch (e) { running.value = false; savingError.value = e instanceof Error ? e.message : '无法恢复本地进度。'; }
    cursor = 0; feedKey.value++; problem.value = 0; reanchor(); redraw(false);
    save();
  } catch (e) { if (request === generation) error.value = e instanceof Error ? e.message : '比赛加载失败，请返回合集重选。'; }
  finally { if (request === generation) loading.value = false; }
}, { immediate: true });

const timer = window.setInterval(tick, 250);
window.addEventListener('resize', resize);
window.addEventListener('pagehide', saveOnLeave);
document.addEventListener('visibilitychange', saveOnLeave);
onBeforeUnmount(() => {
  saveOnLeave(); generation++; window.clearInterval(timer);
  window.removeEventListener('resize', resize); window.removeEventListener('pagehide', saveOnLeave);
  document.removeEventListener('visibilitychange', saveOnLeave);
});
</script>

<template>
  <section v-if="loading" class="mt-16 text-center"><Loading /></section>
  <section v-else-if="error" class="mt-16 text-center">
    <p class="mb-4 text-muted-foreground" role="alert">{{ error }}</p>
    <Button size="sm" @click="backToSetup">返回选赛配置</Button>
  </section>
  <section v-else-if="ranklist" class="vp-board min-w-0" :style="viewportStyle" data-id="vp-ranklist-content">
    <Head><title>{{ formatTitle(`VP: ${resolveText(ranklist.contest.title)}`) }}</title></Head>
    <p v-if="savingError" class="mx-4 mb-4 text-sm text-muted-foreground" role="status">{{ savingError }}</p>
    <div class="mx-4 mb-4 flex flex-wrap items-center gap-3">
      <Button size="sm" :disabled="ended" @click="toggleRunning">{{ ended ? '比赛结束' : running ? '暂停' : elapsed ? '继续虚拟参赛' : '开始虚拟参赛' }}</Button>
      <label class="inline-flex items-center gap-2 text-sm">倍速
        <select class="srk-ranklist-org-select !w-auto" :value="speed" aria-label="虚拟参赛倍速" @change="setSpeed">
          <option v-for="value in [1, 2, 5, 10, 30, 60]" :key="value" :value="value">{{ value }}×</option>
        </select>
      </label>
      <Button size="sm" variant="outline" @click="resetOpen = true">重新开始</Button>
      <Button size="sm" variant="outline" @click="backToSetup">选赛配置</Button>
      <span v-if="ccpc26Active" class="text-sm text-primary">CCPC 2026 · 动态揭题</span>
      <Button v-if="!ownName" size="sm" variant="outline" @click="joinOpen = true">加入我的队伍</Button>
      <template v-else>
        <span class="text-sm">{{ ownName }}</span>
        <select v-model="problem" class="srk-ranklist-org-select !w-auto" aria-label="题目">
          <option v-for="(item, index) in ranklist.problems" :key="index" :value="index">{{ item.alias || index + 1 }}</option>
        </select>
        <select v-model="result" class="srk-ranklist-org-select !w-auto" aria-label="结果"><option value="AC">AC</option><option value="WA">WA</option></select>
        <Button size="sm" :disabled="!running" @click="record">记录提交</Button>
      </template>
      <span class="text-sm text-muted-foreground">进度自动保存在此浏览器；做题与判题请使用原 OJ。</span>
    </div>
    <StyledRanklist
      :data="ranklist" :name="key" :id="key" show-filter show-progress is-live fit-problem-columns
      :progress-time-delta="progressTimeDelta" :enable-time-travel="false" :replay-elapsed-ms="elapsed" :ccpc26-mode="true" table-class="ml-4 min-w-0 max-md:ml-0"
    >
      <template #extra-action>
        <span v-if="clientWidth >= 768" class="inline-flex items-center gap-2 text-sm">
          <span>实时滚动提交状态</span>
          <Switch class="srk-ranklist-switch" :checked="enabledScrollSolution" aria-label="实时滚动提交状态" @update:checked="changeScroll" />
        </span>
      </template>
    </StyledRanklist>
    <ScrollSolution v-if="enabledScrollSolution" :key="feedKey" ref="scrollSolution" :container-max-height="clientHeight" />
    <Modal :open="joinOpen" title="加入我的队伍" :width="420" root-class-name="srk-general-modal-root" @close="joinOpen = false" @update:open="joinOpen = $event">
      <form @submit.prevent="join"><Input v-model="ownNameInput" placeholder="队伍名称" aria-label="队伍名称" maxlength="80" required /><p class="my-4 text-sm text-muted-foreground">在原 OJ 做题，判题后在此手动记录 AC / WA，与历史队伍同榜。</p><Button size="sm" type="submit" :disabled="!ownNameInput.trim()">加入</Button></form>
    </Modal>
    <Modal :open="resetOpen" title="重新开始虚拟参赛" :width="420" root-class-name="srk-general-modal-root" @close="resetOpen = false" @update:open="resetOpen = $event">
      <p class="mb-4">计时归零，并清空这场比赛中手动记录的提交。</p>
      <div class="flex gap-2"><Button size="sm" @click="reset">确认重新开始</Button><Button size="sm" variant="outline" @click="resetOpen = false">取消</Button></div>
    </Modal>
  </section>
</template>
