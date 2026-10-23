<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ChevronRight, FileText, Folder, FolderOpen, Search, Settings, Shuffle, X } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import RightMenu from '@/components/layout/RightMenu.vue';
import Loading from '@/components/common/Loading.vue';
import { useRanklandApi, type IApiCollectionItem, type IApiRanklist } from '@/services/ranklist-api';
import { applyVPOptions, buildVPQuery, DEFAULT_VP_OPTIONS, readVPOptions } from './options';
import { prepareReplay } from './replay';
import { buildFinderTree, findFinderContestPath, flattenFinderContests, getFinderColumns, getFinderScope, selectedFinderNodes, type FinderContest, type FinderNode } from './finder-tree';
import ContestPreview from './ContestPreview.vue';
import icpcLogoBlack from '@/assets/icpc_logo_black.png';
import icpcLogoWhite from '@/assets/icpc_logo_white.png';
import ccpcLogoBlack from '@/assets/ccpc_logo_black.png';
import ccpcLogoWhite from '@/assets/ccpc_logo_white.png';
import provincialLogoBlack from '@/assets/provincial_cpc_logo_black.png';
import provincialLogoWhite from '@/assets/provincial_cpc_logo_white.png';
import universityLogoBlack from '@/assets/university-level_cpc_logo_black.png';
import universityLogoWhite from '@/assets/university-level_cpc_logo_white.png';
import ucupLogoBlack from '@/assets/ucup_logo_black.png';
import ucupLogoWhite from '@/assets/ucup_logo_white.png';

const directoryIcons: Record<string, { light: string; dark: string }> = {
  ICPC: { light: icpcLogoBlack, dark: icpcLogoWhite },
  CCPC: { light: ccpcLogoBlack, dark: ccpcLogoWhite },
  省赛: { light: provincialLogoBlack, dark: provincialLogoWhite },
  校赛: { light: universityLogoBlack, dark: universityLogoWhite },
  'Universal Cup': { light: ucupLogoBlack, dark: ucupLogoWhite },
};

const api = useRanklandApi();
const route = useRoute();
const router = useRouter();
const contests = shallowRef<FinderContest[]>([]);
const collectionItems = shallowRef<IApiCollectionItem[]>([]);
const search = ref('');
const selectedPath = ref<string[]>([]);
const columnsElement = ref<HTMLElement>();
const loading = ref(true);
const busy = ref(false);
const error = ref('');
const previewData = shallowRef<IApiRanklist>();
const previewLoading = ref(false);
const previewError = ref('');
const initialSelected = typeof route.query.selected === 'string' ? route.query.selected : '';
let initial = { ...DEFAULT_VP_OPTIONS };
let initialError = '';
let generation = 0;
let previewGeneration = 0;
try { initial = readVPOptions(route.query); } catch (e) { initialError = e instanceof Error ? e.message : '参数格式不正确。'; }
const options = reactive({ ...initial, autoplay: true });
const tree = computed(() => buildFinderTree(collectionItems.value, search.value));
const columns = computed(() => getFinderColumns(tree.value, selectedPath.value));
const selection = computed(() => selectedFinderNodes(tree.value, selectedPath.value));
const last = computed(() => selection.value[selection.value.length - 1]);
const current = computed(() => last.value?.contest);
const scope = computed(() => getFinderScope(tree.value, selectedPath.value));
const matches = computed(() => tree.value.reduce((sum, node) => sum + node.count, 0));

async function loadSelectedInfo() {
  const request = ++previewGeneration;
  const key = current.value?.key;
  previewData.value = undefined; previewError.value = ''; previewLoading.value = !!key;
  if (!key) return;
  try {
    if (!api) throw new Error('RankLand API 未初始化。');
    const data = await api.getRanklist({ uniqueKey: key });
    if (request === previewGeneration) previewData.value = data;
  } catch (e) {
    if (request === previewGeneration) previewError.value = e instanceof Error ? e.message : '比赛信息加载失败。';
  } finally {
    if (request === previewGeneration) previewLoading.value = false;
  }
}
watch(() => current.value?.key, loadSelectedInfo);

function choose(node: FinderNode, depth: number) {
  if (!busy.value) selectedPath.value = [...selectedPath.value.slice(0, depth), node.id];
}
async function focusRow(depth: number, index: number) {
  await nextTick();
  columnsElement.value?.querySelector<HTMLButtonElement>(`[data-column="${depth}"] [data-row="${index}"]`)?.focus();
}
function onColumnKey(event: KeyboardEvent, depth: number, index: number) {
  if (busy.value) return;
  const items = columns.value[depth].nodes;
  let next = index;
  if (event.key === 'ArrowDown') next = Math.min(index + 1, items.length - 1);
  else if (event.key === 'ArrowUp') next = Math.max(index - 1, 0);
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = items.length - 1;
  else if (event.key === 'ArrowRight' && items[index].kind === 'folder') {
    event.preventDefault(); choose(items[index], depth); void focusRow(depth + 1, 0); return;
  } else if (event.key === 'ArrowLeft' && depth > 0) {
    event.preventDefault();
    const parent = columns.value[depth - 1].nodes.findIndex(node => node.id === selectedPath.value[depth - 1]);
    void focusRow(depth - 1, Math.max(parent, 0)); return;
  } else return;
  event.preventDefault(); choose(items[next], depth); void focusRow(depth, next);
}

watch(search, () => {
  const key = current.value?.key;
  if (!search.value.trim()) { selectedPath.value = selection.value.map(node => node.id); return; }
  const candidate = key && findFinderContestPath(tree.value, key);
  const first = getFinderScope(tree.value, [])[0];
  selectedPath.value = candidate || (first ? findFinderContestPath(tree.value, first.key) || [] : []);
});
watch(selectedPath, async () => {
  await nextTick();
  const element = columnsElement.value;
  if (!element) return;
  const finalColumn = element.querySelector<HTMLElement>(`[data-column="${columns.value.length - 1}"]`);
  if (finalColumn) element.scrollTo({ left: Math.max(0, finalColumn.offsetLeft + finalColumn.offsetWidth - element.clientWidth), behavior: 'auto' });
});

async function load() {
  const request = ++generation;
  loading.value = true; error.value = initialError;
  try {
    if (!api) throw new Error('RankLand API 未初始化。');
    const collection = await api.getCollection({ uniqueKey: 'official' });
    if (request !== generation) return;
    collectionItems.value = collection.root.children;
    contests.value = flattenFinderContests(collectionItems.value);
    selectedPath.value = initialSelected ? findFinderContestPath(tree.value, initialSelected) || [] : [];
  } catch (e) { if (request === generation) error.value = e instanceof Error ? e.message : '合集加载失败，请重试。'; }
  finally { if (request === generation) loading.value = false; }
}
async function start(random = false) {
  if (busy.value) return;
  error.value = '';
  const request = ++generation;
  try {
    const candidates = random ? [...scope.value] : current.value ? [current.value] : [];
    if (!candidates.length) throw new Error('请先在分栏中选择一场比赛。');
    const settings = readVPOptions(buildVPQuery(candidates[0].key, options, 'validate'));
    if (random) for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor((crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    busy.value = true;
    let lastError: unknown;
    for (const candidate of candidates.slice(0, random ? 8 : 1)) {
      try {
        if (!api) throw new Error('RankLand API 未初始化。');
        const data = previewData.value?.info.uniqueKey === candidate.key ? previewData.value : await api.getRanklist({ uniqueKey: candidate.key });
        if (request !== generation) return;
        const replay = prepareReplay(applyVPOptions(data.srk, settings));
        if (settings.startMinutes * 60000 >= replay.durationMs) throw new Error('起始时间必须小于比赛时长。');
        selectedPath.value = findFinderContestPath(tree.value, candidate.key) || [];
        await router.push({ path: '/', query: buildVPQuery(candidate.key, settings, crypto.randomUUID()) });
        return;
      } catch (e) { lastError = e; if (!random) throw e; }
    }
    throw new Error(`本次抽取未找到可回放比赛，请重试。${lastError instanceof Error ? ` ${lastError.message}` : ''}`);
  } catch (e) { if (request === generation) error.value = e instanceof Error ? e.message : '比赛加载失败。'; }
  finally { if (request === generation) busy.value = false; }
}
onMounted(load);
onBeforeUnmount(() => { generation++; previewGeneration++; });
</script>

<template>
  <section class="finder-page" data-id="vp-setup">
    <Head><title>选择比赛 · VP</title></Head>
    <div class="finder-page-heading">
      <div class="finder-title"><h1>虚拟参赛</h1><span>选择比赛</span></div>
      <div class="finder-search"><Search :size="16" /><Input v-model="search" class="finder-search-input" aria-label="搜索比赛" placeholder="搜索赛制、年份、城市或比赛 ID" :disabled="loading || busy" /><button v-if="search" type="button" aria-label="清空搜索" @click="search = ''"><X :size="14" /></button></div>
      <RightMenu />
    </div>
    <div class="finder-window">
      <div class="finder-pathbar">
        <nav aria-label="当前选择路径"><button :disabled="busy" @click="selectedPath = []">全部赛事</button><template v-for="(node, index) in selection" :key="node.id"><ChevronRight :size="12" /><button :title="node.label" :disabled="busy" @click="selectedPath = selectedPath.slice(0, index + 1)">{{ node.label }}</button></template></nav>
        <span class="finder-source">RankLand 官方合集</span>
      </div>
      <div class="finder-body">
        <div v-if="loading" class="finder-loading"><Loading /><span>正在读取比赛合集…</span></div>
        <div v-else ref="columnsElement" class="finder-columns" aria-label="比赛分栏选择">
          <section v-for="(column, depth) in columns" :key="`${depth}:${selectedPath[depth - 1] || 'root'}`" :data-column="depth" class="finder-column" :class="{ 'finder-column-first': depth === 0 }">
            <div class="finder-column-list" role="listbox" :aria-label="column.title">
              <button v-for="(node, index) in column.nodes" :key="node.id" :data-row="index" type="button" role="option" :aria-selected="selectedPath[depth] === node.id" :tabindex="selectedPath[depth] === node.id || (!selectedPath[depth] && index === 0) ? 0 : -1" :title="node.label" :disabled="busy" class="finder-row" :class="{ selected: selectedPath[depth] === node.id }" @click="choose(node, depth)" @keydown="onColumnKey($event, depth, index)">
                <span v-if="depth === 0 && directoryIcons[node.label]" class="finder-event-icon" :style="{ '--finder-event-mask': `url('${directoryIcons[node.label].light}')` }" aria-hidden="true"><img :src="directoryIcons[node.label].light" alt="" class="block dark:hidden" /><img :src="directoryIcons[node.label].dark" alt="" class="hidden dark:block" /></span><FileText v-else-if="node.kind === 'contest'" :size="16" /><FolderOpen v-else-if="selectedPath[depth] === node.id" :size="16" class="finder-folder-icon" /><Folder v-else :size="16" class="finder-folder-icon" />
                <span class="finder-row-name">{{ node.label }}</span><small v-if="node.kind === 'folder'">{{ node.count }}</small><ChevronRight v-if="node.kind === 'folder'" :size="13" class="finder-row-chevron" />
              </button>
              <p v-if="!column.nodes.length" class="finder-empty-list">{{ search ? '没有找到匹配的比赛' : '暂无比赛' }}</p>
            </div>
          </section>
        </div>
        <div class="finder-details" aria-label="比赛详细信息">
          <ContestPreview v-if="current" :data="previewData" :loading="previewLoading" :error="previewError" @retry="loadSelectedInfo" />
          <div v-else class="finder-details-empty"><FileText :size="30" /><p>选择一场比赛以查看详细信息</p></div>
        </div>
        <aside class="finder-config" aria-label="参赛配置">
          <div class="finder-config-heading"><span class="finder-config-label">参赛配置</span><template v-if="current"><h2><Settings :size="18" />{{ current.name }}</h2><p>{{ current.path.join(' / ') }}</p></template><template v-else><h2>{{ last?.label || '尚未选择比赛' }}</h2><p>逐列选择比赛后，在这里开始 VP。</p></template></div>
          <div class="finder-config-fields">
            <label class="finder-field"><span>赛制</span><select v-model="options.rule" class="finder-select" aria-label="赛制" :disabled="busy"><option value="auto">跟随原比赛</option><option value="ICPC">ICPC / 传统 CCPC</option><option value="CCPC26">CCPC 2026</option></select></label>
            <div class="finder-field-grid"><label class="finder-field"><span>回放倍速</span><select v-model="options.speed" class="finder-select" aria-label="回放倍速" :disabled="busy"><option v-for="value in [1, 2, 5, 10, 30, 60]" :key="value" :value="value">{{ value }}×</option></select></label><label class="finder-field"><span>起始时间 / 分钟</span><Input v-model.number="options.startMinutes" class="h-8" aria-label="起始时间（分钟）" type="number" min="0" max="10080" step="1" :disabled="busy" /></label></div>
            <div v-if="options.rule === 'CCPC26'" class="finder-reveal"><span>CCPC 2026 揭题阈值</span><div class="finder-field-grid"><label class="finder-field"><span>通过队伍数</span><Input v-model.number="options.revealCount" class="h-8" aria-label="揭题队伍数" type="number" min="0" max="100000" step="1" :disabled="busy" /></label><label class="finder-field"><span>通过比例 / %</span><Input v-model.number="options.revealRatio" class="h-8" aria-label="揭题比例（%）" type="number" min="0" max="100" step="0.1" :disabled="busy" /></label></div><p>满足任一阈值即揭题；0 表示关闭该项。</p></div>
            <label class="finder-field"><span>我的队伍名称 <small>可选</small></span><Input v-model="options.team" class="h-8" aria-label="我的队伍名称" maxlength="80" placeholder="加入榜单，手动同步 AC / WA" :disabled="busy" /></label>
          </div>
          <div class="finder-config-actions"><p v-if="error" class="finder-error" role="alert">{{ error }}</p><Button v-if="!loading && !contests.length" variant="outline" size="sm" class="w-full" @click="load">重新加载合集</Button><Button size="sm" class="w-full" :disabled="loading || busy || !current" @click="start(false)">{{ busy ? '正在检查比赛数据…' : '开始虚拟参赛' }}<ChevronRight v-if="!busy" :size="14" /></Button><Button size="sm" variant="outline" class="w-full" :disabled="loading || busy || !scope.length" @click="start(true)"><Shuffle :size="14" />从当前范围随机一场</Button></div>
        </aside>
      </div>
      <div class="finder-statusbar"><span>{{ matches }} 场比赛<span v-if="selectedPath.length"> · 当前范围 {{ scope.length }} 场</span></span><span v-if="current" :title="current.key">{{ current.key }}</span><span v-else>选择一场比赛以开始</span></div>
    </div>
  </section>
</template>

<style scoped>
.finder-page { max-width: 1640px; margin: 0 auto; min-width: 0; }
.finder-page-heading { display: flex; align-items: center; gap: 20px; min-height: 40px; margin-bottom: 18px; }
.finder-title { display: flex; align-items: baseline; gap: 12px; flex-shrink: 0; }
.finder-title h1 { margin: 0; font-size: 24px; font-weight: 500; }
.finder-title > span { font-size: 12px; color: hsl(var(--muted-foreground)); }
.finder-search { display: flex; align-items: center; gap: 8px; flex: 1; max-width: 520px; margin-left: auto; border: 1px solid hsl(var(--input)); border-radius: 6px; padding: 0 10px; background: hsl(var(--background)); color: hsl(var(--muted-foreground)); min-width: 0; }
.finder-search:focus-within { border-color: hsl(var(--primary)); }
.finder-search-input { height: 34px; border: 0; box-shadow: none; padding: 0; background: transparent; font-size: 13px; }
.finder-search-input:focus-visible { box-shadow: none; outline: none; }
.finder-search > svg { flex-shrink: 0; }
.finder-search > button { display: flex; flex-shrink: 0; background: none; border: 0; padding: 3px; color: inherit; cursor: pointer; }
.finder-window { display: flex; flex-direction: column; height: calc(100dvh - 122px); min-height: 530px; border: 1px solid hsl(var(--border)); border-radius: 6px; background: hsl(var(--card)); overflow: hidden; }
.finder-pathbar { display: flex; align-items: center; gap: 7px; min-height: 42px; padding: 5px 12px; border-bottom: 1px solid hsl(var(--border)); background: hsl(var(--muted) / .35); }
.finder-pathbar nav { display: flex; align-items: center; gap: 7px; flex: 1; min-width: 0; overflow: hidden; font-size: 12px; }
.finder-pathbar nav > button { border: 0; padding: 2px 0; background: none; color: inherit; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; max-width: 240px; }
.finder-pathbar nav > button:hover { color: hsl(var(--primary)); }
.finder-pathbar nav > svg { flex-shrink: 0; color: hsl(var(--muted-foreground)); }
.finder-source { font-size: 11px; color: hsl(var(--muted-foreground)); white-space: nowrap; margin-left: 12px; }
.finder-body { --finder-config-width: 304px; display: flex; flex: 1; min-height: 0; min-width: 0; }
.finder-loading { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: hsl(var(--muted-foreground)); font-size: 12px; }
.finder-columns { position: relative; display: flex; flex: 0 1 auto; width: max-content; max-width: calc(100% - var(--finder-config-width) - 200px); min-width: 0; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; }
.finder-column { display: flex; flex-direction: column; flex: 0 0 220px; width: 220px; min-width: 0; border-right: 1px solid hsl(var(--border)); height: 100%; }
.finder-column-first { flex-basis: 180px; width: 180px; background: hsl(var(--muted) / .2); }
.finder-column-list { overflow-y: auto; overflow-x: hidden; padding: 8px 6px 12px; flex: 1; min-height: 0; scrollbar-width: thin; }
.finder-row { width: 100%; min-height: 35px; display: flex; align-items: center; gap: 8px; border: 0; border-radius: 3px; padding: 7px 8px; background: transparent; color: hsl(var(--foreground)); cursor: pointer; text-align: left; font: inherit; font-size: 13px; line-height: 1.5; }
.finder-row:hover { background: hsl(var(--muted) / .65); }
.finder-row.selected { background: rgb(var(--rankland-primary-rgb) / .12); color: hsl(var(--primary)); }
.finder-row:focus-visible { outline: 1px solid hsl(var(--primary)); outline-offset: -1px; }
.finder-row:disabled { opacity: .6; cursor: wait; }
.finder-row > svg { flex-shrink: 0; color: hsl(var(--muted-foreground)); }
.finder-event-icon { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; flex-shrink: 0; }
.finder-event-icon img { width: 28px; height: 28px; object-fit: contain; }
.finder-row.selected .finder-event-icon { background-color: currentColor; -webkit-mask: var(--finder-event-mask) center / contain no-repeat; mask: var(--finder-event-mask) center / contain no-repeat; }
.finder-row.selected .finder-event-icon img { visibility: hidden; }
.finder-row.selected > svg { color: hsl(var(--primary)); }
.finder-row-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.finder-row > small { font-size: 10px; opacity: .5; }
.finder-row-chevron { opacity: .55; }
.finder-empty-list { margin: 15px 8px; font-size: 12px; color: hsl(var(--muted-foreground)); line-height: 1.7; }
.finder-details { flex: 1; min-width: 200px; overflow-y: auto; scrollbar-width: thin; }
.finder-details-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; height: 100%; min-height: 160px; padding: 20px; color: hsl(var(--muted-foreground)); text-align: center; font-size: 12px; }
.finder-details-empty svg { opacity: .35; }
.finder-details-empty p { margin: 0; }
.finder-config { display: flex; flex-direction: column; flex: 0 0 var(--finder-config-width); min-width: 0; border-left: 1px solid hsl(var(--border)); background: hsl(var(--muted) / .13); overflow: hidden; }
.finder-config-heading { flex-shrink: 0; padding: 12px 18px; border-bottom: 1px solid hsl(var(--border)); }
.finder-config-label { font-size: 11px; color: hsl(var(--muted-foreground)); }
.finder-config-heading h2 { display: flex; align-items: flex-start; gap: 7px; margin: 6px 0 3px; font-size: 14px; font-weight: 500; line-height: 1.7; overflow-wrap: anywhere; }
.finder-config-heading h2 > svg { flex-shrink: 0; margin-top: 4px; color: hsl(var(--primary)); }
.finder-config-heading > p { margin: 0; font-size: 11px; color: hsl(var(--muted-foreground)); }
.finder-config-fields { display: flex; flex-direction: column; flex: 1; min-height: 0; gap: 8px; padding: 12px 18px; overflow-y: auto; scrollbar-width: thin; }
.finder-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; font-size: 12px; }
.finder-field > span > small { font-size: 10px; color: hsl(var(--muted-foreground)); margin-left: 4px; }
.finder-field-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
.finder-field :deep(input) { font-size: 12px; padding-left: 9px; padding-right: 9px; }
.finder-select { display: block; width: 100%; min-width: 0; height: 32px; border: 1px solid hsl(var(--input)); border-radius: 6px; padding: 0 9px; background: hsl(var(--background)); color: hsl(var(--foreground)); font: inherit; font-size: 12px; }
.finder-select:focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: 2px; }
.finder-select:disabled { opacity: .5; }
.finder-reveal { display: flex; flex-direction: column; gap: 10px; padding-top: 13px; border-top: 1px solid hsl(var(--border)); font-size: 12px; }
.finder-reveal > p { margin: 0; font-size: 10px; color: hsl(var(--muted-foreground)); line-height: 1.7; }
.finder-config-actions { display: flex; flex-direction: column; flex-shrink: 0; gap: 8px; padding: 12px 18px; margin-top: auto; border-top: 1px solid hsl(var(--border)); }
.finder-error { margin: 0; font-size: 11px; line-height: 1.75; color: hsl(var(--destructive)); overflow-wrap: anywhere; }
.finder-statusbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 31px; padding: 5px 14px; border-top: 1px solid hsl(var(--border)); font-size: 10px; color: hsl(var(--muted-foreground)); background: hsl(var(--muted) / .25); }
.finder-statusbar > span { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.finder-statusbar > span:last-child { max-width: 55%; text-align: right; }
@media (max-width: 1100px) {
  .finder-body { --finder-config-width: 282px; }
  .finder-column { flex-basis: 190px; width: 190px; }
  .finder-column-first { flex-basis: 150px; width: 150px; }
  .finder-source { display: none; }
  .finder-page-heading { gap: 12px; }
  .finder-title > span { display: none; }
}
@media (max-width: 760px) {
  .finder-page-heading { flex-wrap: wrap; margin-bottom: 14px; gap: 12px; }
  .finder-title { flex: 1; }
  .finder-title h1 { font-size: 22px; }
  .finder-search { order: 3; flex-basis: 100%; max-width: none; }
  .finder-page-heading :deep(.rankland-theme-mode) { margin-left: auto; }
  .finder-window { height: auto; min-height: 0; }
  .finder-body { flex-direction: column; min-height: 0; }
  .finder-columns { flex: none; width: 100%; max-width: none; height: 300px; min-height: 300px; }
  .finder-column { flex-basis: 185px; width: 185px; }
  .finder-column-first { flex-basis: 140px; width: 140px; }
  .finder-details { flex: none; width: 100%; min-width: 0; overflow: visible; border-top: 1px solid hsl(var(--border)); }
  .finder-config { flex: none; width: 100%; min-width: 0; border-left: 0; border-top: 1px solid hsl(var(--border)); overflow: visible; }
  .finder-config-heading { padding: 14px 16px; }
  .finder-config-fields { flex: none; overflow: visible; padding: 16px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
  .finder-config-fields > .finder-field, .finder-field-grid, .finder-reveal { grid-column: 1 / -1; }
  .finder-config-actions { padding: 14px 16px; }
  .finder-pathbar { padding: 5px 8px; }
  .finder-pathbar nav { font-size: 11px; }
  .finder-statusbar { padding: 6px 10px; font-size: 9px; }
  .finder-loading { min-height: 240px; }
}

</style>
