<script setup lang="ts">
/* eslint-disable complexity */
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onErrorCaptured,
  onMounted,
  reactive,
  ref,
  shallowRef,
  toRaw,
  useSlots,
  watch,
} from 'vue';
import { useRoute } from 'vue-router';
import type * as srk from '@algoux/standard-ranklist';
import {
  DefaultSolutionModal,
  Modal,
  ProgressBar,
  Ranklist,
} from '@algoux/standard-ranklist-renderer-component-vue';
import type {
  ProblemClickPayload,
  SolutionClickPayload,
  StaticRanklist,
  UserClickPayload,
} from '@algoux/standard-ranklist-renderer-component-vue';
import {
  EnumTheme,
  calculateProblemStatistics,
  convertToStaticRanklist,
  filterSolutionsUntil,
  getCCPC26ProblemLayout,
  getSortedCalculatedRawSolutions,
  numberToAlphabet,
  regenerateRanklistBySolutions,
  resolveContributor,
  resolveText,
  resolveUserMarkers,
} from '@algoux/standard-ranklist-utils';
import {
  CodeforcesGymGhostDATConverter,
  GeneralExcelConverter,
  VJudgeReplayConverter,
} from '@algoux/standard-ranklist-convert-to';
import FileSaver from 'file-saver';
import copy from 'copy-to-clipboard';
import { ChevronDown, Download, Eye, FilePenLine, Settings, Share2 } from 'lucide-vue-next';
import { ToggleGroupItem, ToggleGroupRoot } from 'radix-vue';
import { toast } from 'vue-sonner';
import { THEME_TOKEN } from '@/lib/theme';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getRanklandRuntimeConfig, RANKLAND_RSS_PATH, ranklandRoutes } from '@/app/config';
import { formatCurrentUrl } from '@/app/current-url';
import {
  registerInitialHydrationTask,
  shouldDeferInitialHydrationRender,
  waitForInitialHydrationFrame,
} from '@/app/hydration-flicker-guard';
import { LocalStorageKey } from '@/app/local-storage-key.config';
import { formatSrkAssetUrl } from '@/utils/srk-asset.util';
import { formatSrkContestTimeRange } from '@/utils/time-format.util';
import { scheduleRankTimeCalculation } from '@/utils/rank-time-scheduler';
import {
  createEmptyRankTimeData,
  createEmptyRankTimeDataSet,
  getAllRankTimeData,
  getProperRankTimeChunkUnit,
  selectUserMainRankTimeData,
} from '@/utils/rank-time-data.util';
import type { RankTimeData, RankTimeDataSet, SelectedUserMainRankTimeData } from '@/utils/rank-time-data.util';
import type { RankTimeWorkerRequest, RankTimeWorkerResponse } from '@/utils/rank-time-worker.types';
import ClientOnly from '@/components/common/ClientOnly.vue';
import ContactUs from '@/components/site/ContactUs.vue';
import BeianLink from '@/components/site/BeianLink.vue';
import { SSR_REQUEST_LANGUAGES_TOKEN } from '@/app/request-languages';
import SrkAssetImage from '@/components/ranklist/SrkAssetImage.vue';
import UserInfoModal from '@/components/ranklist/UserInfoModal.vue';
import ProblemInfoModal from '@/components/ranklist/ProblemInfoModal.vue';
import { preloadRankCurveRenderer } from '@/components/ranklist/rank-curve-loader';
import {
  DEFAULT_STYLED_RANKLIST_SETTINGS,
  getEmptyStatusPlaceholder,
  normalizeStyledRanklistSettings,
} from './styled-ranklist-settings';
import {
  hasRanklistPayloadReferenceChange,
  toRanklistPayloadWithoutVolatileFields,
} from './ranklist-data-memo';
import type {
  StyledRanklistEmptyStatusPlaceholder,
  StyledRanklistSettings,
} from './styled-ranklist-settings';
import type { StyledRanklistRendererProps } from './styled-ranklist-types';
import { isOfficialParticipant } from './styled-ranklist-filter';
import { useCCPC26Mode } from '@/composables/use-ccpc26-mode';
import { isCCPC26Ranklist } from '@/utils/ccpc26.util';
import SearchableMultiSelect from './SearchableMultiSelect.vue';
import SettingInfoTip from './SettingInfoTip.vue';
import RanklistQualityAction from './RanklistQualityAction.vue';
import './styled-ranklist-renderer.less';

const props = withDefaults(defineProps<StyledRanklistRendererProps>(), {
  showFooter: false,
  showFilter: false,
  showProgress: true,
  isLive: false,
  progressTimeDelta: 0,
  enableTimeTravel: true,
  ccpc26Mode: undefined,
  fitProblemColumns: false,
});

const saveAs = FileSaver.saveAs || FileSaver;
const slots = useSlots();
const route = useRoute();
const themeService = inject(THEME_TOKEN, undefined);
const injectedRequestLanguages = inject(SSR_REQUEST_LANGUAGES_TOKEN, undefined);
const renderError = ref<Error | null>(null);
const filter = reactive<{ organizations: string[]; officialOnly: boolean; marker: string }>({
  organizations: [],
  officialOnly: false,
  marker: '',
});
const timeTravelTime = ref<number | null>(null);
const clientClockReady = ref(false);
const rankTimeDataInitialized = ref(false);
const rankTimeDataSet = ref<RankTimeDataSet>(createEmptyRankTimeDataSet());
const rankTimeData = ref<RankTimeData>(createEmptyRankTimeData());
const currentShownUserId = ref('');
const userModalOpen = ref(false);
const activeUserPayload = ref<UserClickPayload | null>(null);
const activeSolutionPayload = ref<SolutionClickPayload | null>(null);
const problemModalOpen = ref(false);
const activeProblemPayload = ref<ProblemClickPayload | null>(null);
const settingsModalOpen = ref(false);
const settingsIntroModalOpen = ref(false);
const RANK_TIME_WORKER_RESET_MESSAGE = 'Rank time worker reset';
let rankTimeCalculationRequest = 0;
let rankTimeWorker: Worker | null = null;
let rankTimeWorkerCacheKey = '';
let rankTimeWorkerPreparedCacheKey = '';
let rankTimeWorkerPreparePromise: Promise<boolean> | null = null;
let rankTimeWorkerDisabled = false;
let rankTimeWorkerRequestId = 0;
const rankTimeWorkerRequests = new Map<
  number,
  {
    resolve: (response: RankTimeWorkerResponse) => void;
    reject: (error: Error) => void;
  }
>();
// Hydrate the SSR defaults first, then patch saved preferences on the same Ranklist instance.
const shouldDeferRanklistPreferences = shouldDeferInitialHydrationRender();
const ranklistClientRenderReady = ref(!shouldDeferRanklistPreferences);
let resolveInitialRanklistRender: (() => void) | null = null;
if (shouldDeferRanklistPreferences) {
  registerInitialHydrationTask(new Promise<void>((resolve) => {
    resolveInitialRanklistRender = resolve;
  }));
}
const clientWidth = ref(1024);
type RanklistActionMenu = 'download' | 'share' | 'ref-links';
const activeActionMenu = ref<RanklistActionMenu | ''>('');
const suppressedActionMenu = ref<RanklistActionMenu | ''>('');
const actionMenuCloseTimers: Record<RanklistActionMenu, ReturnType<typeof window.setTimeout> | null> = {
  download: null,
  share: null,
  'ref-links': null,
};

const storedRanklistSettings = ref<unknown>(readLocalStorageJson(LocalStorageKey.StyledRanklistSettings));
const settingsIntroRead = ref<string | undefined>(readLocalStorageString(LocalStorageKey.StyledRanklistSettingsIntroRead));
const memorizedData = shallowRef<srk.Ranklist>(toRanklistPayloadWithoutVolatileFields(toRaw(props.data)));
const rankTimeDataVersion = ref(0);
const ccpc26TimeEligible = useCCPC26Mode(() => memorizedData.value, () => props.isLive, () => props.replayElapsedMs ?? timeTravelTime.value);
const hasCCPC26 = computed(() => isCCPC26Ranklist(memorizedData.value));
const requiresClientClockForRanklist = computed(() => props.isLive && isCCPC26Ranklist(memorizedData.value));

const ranklistSettings = computed(() => normalizeStyledRanklistSettings(storedRanklistSettings.value));
const isScoreSorterRanklist = computed(() => memorizedData.value.sorter?.algorithm === 'score');
const renderedRanklistSettings = computed<StyledRanklistSettings>(() => {
  const settings = ranklistClientRenderReady.value ? ranklistSettings.value : DEFAULT_STYLED_RANKLIST_SETTINGS;
  if (!isScoreSorterRanklist.value) {
    return settings;
  }
  return {
    ...settings,
    statusColorAsText: true,
  };
});
// The saved preference stays enabled across the freeze boundary; only the effective mode changes.
const enableCCPC26 = computed(() => (props.ccpc26Mode ?? renderedRanklistSettings.value.preferCCPC26) && ccpc26TimeEligible.value);
const emptyStatusPlaceholder = computed(() =>
  getEmptyStatusPlaceholder(renderedRanklistSettings.value.emptyStatusPlaceholder),
);
const textLanguages = computed(() => props.languages || injectedRequestLanguages);
const rendererLanguages = computed(() => textLanguages.value ? [...textLanguages.value] : undefined);
const themeName = computed(() => (themeService?.state.theme || EnumTheme.light) as EnumTheme);
const ranklistRenderContainerClassName = computed(() => props.tableClass || '');
const ranklistRenderContainerStyle = computed(() => ({
  ...props.tableStyle,
}));

watch(
  () => props.data,
  (data, oldData) => {
    const rawData = toRaw(data);
    const rawOldData = oldData ? toRaw(oldData) : oldData;
    if (!hasRanklistPayloadReferenceChange(rawOldData, rawData)) {
      return;
    }

    memorizedData.value = toRanklistPayloadWithoutVolatileFields(rawData);
    rankTimeDataVersion.value += 1;
    resetRankTimeWorker();
    scheduleRankTimeDataPreparation();
  },
);

watch(
  storedRanklistSettings,
  (settings) => {
    writeLocalStorageJson(LocalStorageKey.StyledRanklistSettings, settings);
  },
  { deep: true },
);

watch(
  () => props.id,
  () => {
    userModalOpen.value = false;
    activeUserPayload.value = null;
    activeSolutionPayload.value = null;
    problemModalOpen.value = false;
    activeProblemPayload.value = null;
    currentShownUserId.value = '';
    timeTravelTime.value = null;
    rankTimeDataSet.value = createEmptyRankTimeDataSet();
    rankTimeData.value = createEmptyRankTimeData();
    rankTimeDataInitialized.value = false;
    rankTimeDataVersion.value += 1;
    resetRankTimeWorker();
    filter.organizations = [];
    filter.officialOnly = false;
    filter.marker = '';
  },
);

const solutions = computed(() => getSortedCalculatedRawSolutions(memorizedData.value.rows));
const currentSolutions = computed(() => timeTravelTime.value === null
  ? solutions.value
  : filterSolutionsUntil(solutions.value, [timeTravelTime.value, 'ms']));
const genData = computed(() => {
  if (timeTravelTime.value === null) {
    return memorizedData.value;
  }
  return regenerateRanklistBySolutions(memorizedData.value, currentSolutions.value);
});
const staticData = computed(() => convertToStaticRanklist(genData.value) as StaticRanklist);
// Reveal decisions always use the complete slice, before display-only row filtering.
const ccpc26ProblemLayout = computed(() => enableCCPC26.value
  ? getCCPC26ProblemLayout(staticData.value as srk.Ranklist)
  : undefined);
const problemVisibilityKey = computed(() => ccpc26ProblemLayout.value
  ? `ccpc26:${ccpc26ProblemLayout.value.revealedProblemIndexes.join(',')}`
  : 'normal');
const organizations = computed(() =>
  Array.from(
    new Set(staticData.value.rows.map((row) => resolveDisplayText(row.user?.organization)).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b)),
);
const markers = computed(() => staticData.value.markers || []);
const filteredSeriesIndexes = computed(() => {
  const indexes = new Array(staticData.value.series.length).fill(0).map((_, index) => index);
  if (!filter.marker) {
    return indexes;
  }
  return indexes.filter((seriesIndex) => {
    const series = staticData.value.series[seriesIndex];
    if (series.rule?.preset === 'ICPC') {
      return !series.rule.options?.filter?.byMarker || series.rule.options?.filter?.byMarker === filter.marker;
    }
    return true;
  });
});
const filteredSeries = computed(() =>
  staticData.value.series.filter((_, index) => filteredSeriesIndexes.value.includes(index)),
);
const filteredRows = computed(() => {
  const rows = staticData.value.rows.filter((row) => {
    let ok = true;
    if (ok && filter.organizations.length > 0) {
      ok = filter.organizations.includes(resolveDisplayText(row.user?.organization));
    }
    if (ok && filter.officialOnly) {
      ok = isOfficialParticipant(row.user);
    }
    if (ok && filter.marker) {
      ok = resolveUserMarkers(row.user, staticData.value.markers).some((marker) => marker.id === filter.marker);
    }
    return ok;
  });
  if (filteredSeriesIndexes.value.length === staticData.value.series.length) {
    return rows;
  }
  return rows.map((row) => ({
    ...row,
    rankValues: filteredSeriesIndexes.value.map((seriesIndex) => row.rankValues[seriesIndex]),
  }));
});
const problemStatistics = computed(() =>
  calculateProblemStatistics({
    ...(staticData.value as unknown as srk.Ranklist),
    rows: filteredRows.value as unknown as srk.RanklistRow[],
  }),
);
const usingData = computed<StaticRanklist>(() => ({
  ...staticData.value,
  problems: staticData.value.problems?.map((problem, index) => ({
    ...problem,
    statistics: problemStatistics.value[index] || problem.statistics || undefined,
  })),
  series: filteredSeries.value,
  rows: filteredRows.value,
}));
const showProfessionalProblemExtras = computed(() =>
  renderedRanklistSettings.value.professionalMode && usingData.value.problems.length > 0,
);
const contestTimeRange = computed(() =>
  formatSrkContestTimeRange(staticData.value.contest.startAt, staticData.value.contest.duration),
);
const progressBarRenderKey = computed(() => {
  const contest = memorizedData.value.contest;
  return JSON.stringify([
    props.id || props.name,
    contest.startAt || '',
    contest.duration || null,
    contest.frozenDuration || null,
  ]);
});
const fullUrl = computed(() => {
  if (typeof window === 'undefined') {
    return '';
  }
  return formatCurrentUrl({
    protocol: window.location.protocol,
    host: window.location.host,
    pathname: route.path,
    query: route.query,
  }).fullUrl;
});
const editSrkUrl = computed(() => {
  if (!props.srkUrl) {
    return '';
  }
  return ranklandRoutes.formatUrl('Playground', {
    src: props.srkUrl,
    id: props.id || undefined,
  });
});
const contributors = computed(() =>
  (staticData.value.contributors || [])
    .map((contributor) => resolveContributor(contributor))
    .filter((contributor): contributor is NonNullable<typeof contributor> => !!contributor),
);
const mainRefLinks = computed(() => (staticData.value.contest.refLinks || []).slice(0, 3));
const hiddenRefLinks = computed(() => (staticData.value.contest.refLinks || []).slice(3));
const hasMetaViewCount = computed(() => props.meta?.viewCnt !== undefined && props.meta.viewCnt !== null);
const activeUser = computed(() =>
  activeUserPayload.value
    ? usingData.value.rows.find((row) => row.user?.id === activeUserPayload.value?.user.id)?.user ||
      activeUserPayload.value.user
    : null,
);
const activeUserRowIndex = computed(() =>
  activeUserPayload.value && activeUser.value
    ? usingData.value.rows.findIndex((row) => row.user?.id === activeUser.value?.id)
    : -1,
);
const activeUserRow = computed(() =>
  activeUserRowIndex.value >= 0 ? usingData.value.rows[activeUserRowIndex.value] : activeUserPayload.value?.row,
);
const activeProblemRevealed = computed(() => isProblemRevealed(activeProblemPayload.value?.problemIndex));
const activeSolutionProblemRevealed = computed(() => isProblemRevealed(activeSolutionPayload.value?.problemIndex));
const activeProblemModalTitle = computed(() => {
  if (!activeProblemPayload.value || !activeProblemRevealed.value) {
    return undefined;
  }
  const { problem, problemIndex } = activeProblemPayload.value;
  const alias = problem.alias || numberToAlphabet(problemIndex);
  return `Info of Problem ${alias}`;
});
const shouldRenderInlineSettingsAction = computed(() => props.showFilter && clientWidth.value <= 768);
const hasExtraActionSlot = computed(() => !!slots['extra-action']);
const shouldRenderActions = computed(() => !shouldRenderInlineSettingsAction.value || hasExtraActionSlot.value);
const config = computed(() => getRanklandRuntimeConfig());
const ALL_MARKERS_VALUE = '__all_markers__';
const selectedMarkerValue = computed(() => filter.marker || ALL_MARKERS_VALUE);

onErrorCaptured((error) => {
  renderError.value = error instanceof Error ? error : new Error(String(error));
  return false;
});

onMounted(() => {
  // Live time comes from the browser; keep its initial markup independent of the SSR clock.
  clientClockReady.value = true;
  syncClientWidth();
  window.addEventListener('resize', syncClientWidth);
  void finishInitialRanklistHydrationRender();
  scheduleRankTimeDataPreparation();
  scheduleRankCurveRendererPreload();
  if (settingsIntroRead.value !== 'true') {
    settingsIntroModalOpen.value = true;
  }
});

onBeforeUnmount(() => {
  rankTimeCalculationRequest += 1;
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', syncClientWidth);
    (Object.keys(actionMenuCloseTimers) as RanklistActionMenu[]).forEach(cancelActionMenuClose);
  }
  resolveInitialRanklistRender?.();
  resolveInitialRanklistRender = null;
  resetRankTimeWorker();
});

watch(currentShownUserId, (userId) => {
  if (userId) {
    scheduleRankTimeDataForCurrentUser(userId);
  } else {
    rankTimeCalculationRequest += 1;
    rankTimeDataSet.value = createEmptyRankTimeDataSet();
    rankTimeData.value = createEmptyRankTimeData();
    rankTimeDataInitialized.value = false;
  }
});

watch(staticData, () => {
  recalcRankTimeDataForCurrentUser();
});

watch(ccpc26ProblemLayout, () => {
  if (!activeProblemRevealed.value) {
    problemModalOpen.value = false;
    activeProblemPayload.value = null;
  }
}, { flush: 'sync' });

watch(enableCCPC26, (enabled) => {
  if (enabled) {
    rankTimeCalculationRequest += 1;
    resetRankTimeWorker();
    rankTimeDataSet.value = createEmptyRankTimeDataSet();
    rankTimeData.value = createEmptyRankTimeData();
    rankTimeDataInitialized.value = false;
    return;
  }
  recalcRankTimeDataForCurrentUser();
  scheduleRankCurveRendererPreload();
});

watch(
  () => filter.marker,
  () => {
    recalcRankTimeDataForCurrentUser();
  },
);

function recalcRankTimeDataForCurrentUser() {
  if (currentShownUserId.value) {
    scheduleRankTimeDataForCurrentUser(currentShownUserId.value);
  } else {
    scheduleRankTimeDataPreparation();
  }
}

function scheduleRankTimeDataForCurrentUser(userId: string) {
  const request = (rankTimeCalculationRequest += 1);
  rankTimeData.value = createEmptyRankTimeData();
  if (enableCCPC26.value) {
    return;
  }
  scheduleRankTimeCalculation(() => {
    if (enableCCPC26.value || request !== rankTimeCalculationRequest || currentShownUserId.value !== userId) {
      return;
    }
    calcUserRankTimeData(userId, request);
  });
}

function scheduleRankTimeDataPreparation() {
  if (enableCCPC26.value) {
    return;
  }
  const request = rankTimeCalculationRequest;
  scheduleRankTimeCalculation(() => {
    if (enableCCPC26.value || request !== rankTimeCalculationRequest || currentShownUserId.value) {
      return;
    }
    void prepareRankTimeDataInWorker();
  });
}

function readLocalStorageString(key: string): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return window.localStorage.getItem(key) || undefined;
}

function readLocalStorageJson(key: string): unknown {
  const value = readLocalStorageString(key);
  if (!value) {
    return DEFAULT_STYLED_RANKLIST_SETTINGS;
  }
  try {
    return JSON.parse(value);
  } catch {
    return DEFAULT_STYLED_RANKLIST_SETTINGS;
  }
}

function writeLocalStorageJson(key: string, value: unknown) {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
}

function syncClientWidth() {
  clientWidth.value = window.innerWidth;
}

async function finishInitialRanklistHydrationRender() {
  if (!shouldDeferRanklistPreferences) {
    return;
  }
  try {
    ranklistClientRenderReady.value = true;
    await nextTick();
    await waitForInitialHydrationFrame(window);
  } finally {
    resolveInitialRanklistRender?.();
    resolveInitialRanklistRender = null;
  }
}

function updateRanklistSetting<K extends keyof StyledRanklistSettings>(key: K, value: StyledRanklistSettings[K]) {
  storedRanklistSettings.value = {
    ...ranklistSettings.value,
    [key]: value,
  };
}

function handleTimeTravel(time: number | null) {
  activeSolutionPayload.value = null;
  problemModalOpen.value = false;
  activeProblemPayload.value = null;
  timeTravelTime.value = time;
}

function handleMarkerFilterChange(value: string | string[] | undefined) {
  const nextValue = Array.isArray(value) ? value[0] : value;
  filter.marker = !nextValue || nextValue === ALL_MARKERS_VALUE ? '' : nextValue;
}

function singleToggleValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function handleStatusCellPresetChange(value: string | string[] | undefined) {
  const nextValue = singleToggleValue(value);
  if (!nextValue) {
    return;
  }
  updateRanklistSetting('statusCellPreset', nextValue as StyledRanklistSettings['statusCellPreset']);
}

function handleStatusHighlightChange(value: string | string[] | undefined) {
  const nextValue = singleToggleValue(value);
  if (!nextValue) {
    return;
  }
  updateRanklistSetting('statusColorAsText', nextValue === 'text');
}

function handleEmptyStatusPlaceholderChange(value: string | string[] | undefined) {
  const nextValue = singleToggleValue(value);
  if (!nextValue) {
    return;
  }
  updateRanklistSetting('emptyStatusPlaceholder', nextValue as StyledRanklistEmptyStatusPlaceholder);
}

function handleUserAvatarPlacementChange(value: string | string[] | undefined) {
  const nextValue = singleToggleValue(value);
  if (!nextValue) {
    return;
  }
  updateRanklistSetting('userAvatarPlacement', nextValue as StyledRanklistSettings['userAvatarPlacement']);
}

function download() {
  const blob = new Blob([JSON.stringify(memorizedData.value)], { type: 'application/json;charset=utf-8' });
  saveAs(blob, `${props.name}.srk.json`);
}

function exportAsGymGhost() {
  const converter = new CodeforcesGymGhostDATConverter();
  const file = converter.convert(memorizedData.value);
  const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' });
  saveAs(blob, `${props.name}_gymghost.${file.ext}`);
}

function exportAsVJReplay() {
  const converter = new VJudgeReplayConverter();
  converter.convertAndWrite(memorizedData.value, `${props.name}_vjreplay.xlsx`);
}

function exportAsGeneralExcel() {
  const converter = new GeneralExcelConverter();
  converter.convertAndWrite(memorizedData.value, `${props.name}.xlsx`);
}

function cancelActionMenuClose(menu: RanklistActionMenu) {
  const timer = actionMenuCloseTimers[menu];
  if (timer !== null) {
    window.clearTimeout(timer);
    actionMenuCloseTimers[menu] = null;
  }
}

function openActionMenu(menu: RanklistActionMenu) {
  cancelActionMenuClose(menu);
  if (suppressedActionMenu.value === menu) {
    return;
  }
  activeActionMenu.value = menu;
}

function closeActionMenu(menu: RanklistActionMenu) {
  cancelActionMenuClose(menu);
  if (activeActionMenu.value === menu) {
    activeActionMenu.value = '';
  }
  if (suppressedActionMenu.value === menu) {
    suppressedActionMenu.value = '';
  }
}

function queueActionMenuClose(menu: RanklistActionMenu) {
  cancelActionMenuClose(menu);
  actionMenuCloseTimers[menu] = window.setTimeout(() => {
    closeActionMenu(menu);
  }, 80);
}

function shouldUseHoverPointer(event: PointerEvent) {
  return event.pointerType === 'mouse' && window.innerWidth > 768;
}

function handleActionMenuPointerEnter(menu: RanklistActionMenu, event: PointerEvent) {
  if (shouldUseHoverPointer(event)) {
    openActionMenu(menu);
  }
}

function handleActionMenuPointerLeave(menu: RanklistActionMenu, event: PointerEvent) {
  if (shouldUseHoverPointer(event)) {
    queueActionMenuClose(menu);
  }
}

function handleActionMenuOpenChange(menu: RanklistActionMenu, value: boolean) {
  if (value) {
    openActionMenu(menu);
    return;
  }
  closeActionMenu(menu);
}

function dismissActionMenu(menu: RanklistActionMenu) {
  cancelActionMenuClose(menu);
  if (activeActionMenu.value === menu) {
    activeActionMenu.value = '';
  }
  suppressedActionMenu.value = menu;
  void nextTick(() => {
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
}

function runDownloadAction(action: () => void) {
  try {
    action();
  } finally {
    dismissActionMenu('download');
  }
}

function copyText(text: string, message: string) {
  dismissActionMenu('share');
  if (!copy(text, { format: 'text/plain' })) {
    return;
  }
  toast.success(message);
}

function copyCurrentUrl() {
  copyText(fullUrl.value, '链接已复制');
}

function copyEmbedCode() {
  if (!props.id || typeof window === 'undefined') {
    return;
  }
  const content = `<iframe src="${window.location.origin}${ranklandRoutes.formatUrl(
    props.isLive ? 'Live' : 'Ranklist',
    { id: props.id, focus: 'yes' },
  )}" border="0" frameborder="no" framespacing="0" allowfullscreen="true" style="width: 100%; height: 600px"></iframe>`;
  copyText(content, '嵌入代码已复制');
}

function canUseRankTimeWorker() {
  return !rankTimeWorkerDisabled && typeof Worker !== 'undefined';
}

function toPlainRankTimePayload<T>(value: T): T {
  if (typeof value === 'undefined') {
    return value;
  }
  return JSON.parse(JSON.stringify(toRaw(value))) as T;
}

function getRankTimeWorkerCacheKey() {
  return JSON.stringify([
    props.id || props.name,
    rankTimeDataVersion.value,
    getProperRankTimeChunkUnit(memorizedData.value.contest),
    memorizedData.value.rows.length,
    solutions.value.length,
  ]);
}

function isRankTimeWorkerResetError(error: unknown) {
  return error instanceof Error && error.message === RANK_TIME_WORKER_RESET_MESSAGE;
}

function resetRankTimeWorker(error = new Error(RANK_TIME_WORKER_RESET_MESSAGE)) {
  rankTimeWorkerRequests.forEach(({ reject }) => reject(error));
  rankTimeWorkerRequests.clear();
  rankTimeWorker?.terminate();
  rankTimeWorker = null;
  rankTimeWorkerCacheKey = '';
  rankTimeWorkerPreparedCacheKey = '';
  rankTimeWorkerPreparePromise = null;
}

function ensureRankTimeWorker(cacheKey: string) {
  if (!canUseRankTimeWorker()) {
    return null;
  }
  if (rankTimeWorker && rankTimeWorkerCacheKey !== cacheKey) {
    resetRankTimeWorker();
  }
  if (rankTimeWorker) {
    return rankTimeWorker;
  }

  rankTimeWorker = new Worker(new URL('../../utils/rank-time-data.worker.ts', import.meta.url), { type: 'module' });
  rankTimeWorkerCacheKey = cacheKey;
  rankTimeWorker.onmessage = (event: MessageEvent<RankTimeWorkerResponse>) => {
    const response = event.data;
    const request = rankTimeWorkerRequests.get(response.requestId);
    if (!request) {
      return;
    }
    rankTimeWorkerRequests.delete(response.requestId);
    if (response.error) {
      request.reject(new Error(response.error));
      return;
    }
    request.resolve(response);
  };
  rankTimeWorker.onerror = (event) => {
    rankTimeWorkerDisabled = true;
    resetRankTimeWorker(new Error(event.message || 'Rank time worker failed'));
  };
  return rankTimeWorker;
}

type RankTimeWorkerRequestPayload =
  | Omit<Extract<RankTimeWorkerRequest, { kind: 'prepare' }>, 'requestId'>
  | Omit<Extract<RankTimeWorkerRequest, { kind: 'select' }>, 'requestId'>;

function postRankTimeWorkerRequest(payload: RankTimeWorkerRequestPayload) {
  const worker = ensureRankTimeWorker(payload.cacheKey);
  if (!worker) {
    return Promise.reject(new Error('Rank time worker is unavailable'));
  }

  const requestId = ++rankTimeWorkerRequestId;
  const message = { ...payload, requestId } as RankTimeWorkerRequest;
  return new Promise<RankTimeWorkerResponse>((resolve, reject) => {
    rankTimeWorkerRequests.set(requestId, { resolve, reject });
    try {
      worker.postMessage(message);
    } catch (error) {
      rankTimeWorkerRequests.delete(requestId);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function makeRankTimeWorkerDataPayload() {
  return {
    ranklist: toPlainRankTimePayload(memorizedData.value),
    solutions: toPlainRankTimePayload(solutions.value),
    unit: getProperRankTimeChunkUnit(memorizedData.value.contest),
  };
}

async function prepareRankTimeDataInWorker() {
  if (enableCCPC26.value || !canUseRankTimeWorker()) {
    return false;
  }

  const cacheKey = getRankTimeWorkerCacheKey();
  if (rankTimeWorkerPreparedCacheKey === cacheKey) {
    return true;
  }
  if (rankTimeWorkerPreparePromise) {
    return rankTimeWorkerPreparePromise;
  }

  const promise = postRankTimeWorkerRequest({
    kind: 'prepare',
    cacheKey,
    ...makeRankTimeWorkerDataPayload(),
  })
    .then(() => {
      if (rankTimeWorkerCacheKey === cacheKey) {
        rankTimeWorkerPreparedCacheKey = cacheKey;
      }
      return true;
    })
    .catch((error) => {
      if (!rankTimeWorkerDisabled && !isRankTimeWorkerResetError(error)) {
        console.warn('[RankTimeData] worker preparation failed:', error);
      }
      return false;
    })
    .finally(() => {
      if (rankTimeWorkerPreparePromise === promise) {
        rankTimeWorkerPreparePromise = null;
      }
    });

  rankTimeWorkerPreparePromise = promise;
  return promise;
}

function scheduleRankCurveRendererPreload() {
  if (enableCCPC26.value || typeof window === 'undefined') {
    return;
  }

  const run = () => {
    if (enableCCPC26.value) {
      return;
    }
    void preloadRankCurveRenderer().catch((error) => {
      console.warn('[RankCurve] renderer preload failed:', error);
    });
  };

  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  };
  if (idleWindow.requestIdleCallback) {
    idleWindow.requestIdleCallback(run, { timeout: 3000 });
    return;
  }

  scheduleRankTimeCalculation(run);
}

async function waitForPreparedRankTimeWorkerCache(cacheKey: string) {
  if (rankTimeWorkerPreparedCacheKey === cacheKey) {
    return true;
  }
  if (!rankTimeWorkerPreparePromise) {
    return false;
  }

  try {
    await rankTimeWorkerPreparePromise;
    return rankTimeWorkerPreparedCacheKey === cacheKey;
  } catch (error) {
    return isRankTimeWorkerResetError(error) ? false : rankTimeWorkerPreparedCacheKey === cacheKey;
  }
}

function isCurrentRankTimeRequest(userId: string, request: number) {
  return !enableCCPC26.value && request === rankTimeCalculationRequest && currentShownUserId.value === userId;
}

async function selectRankTimeDataInWorker(userId: string, request: number) {
  if (!canUseRankTimeWorker()) {
    throw new Error('Rank time worker is unavailable');
  }
  const cacheKey = getRankTimeWorkerCacheKey();
  const hasPreparedCache = await waitForPreparedRankTimeWorkerCache(cacheKey);
  if (!isCurrentRankTimeRequest(userId, request) || cacheKey !== getRankTimeWorkerCacheKey()) {
    return null;
  }
  const response = await postRankTimeWorkerRequest({
    kind: 'select',
    cacheKey,
    ...(hasPreparedCache ? {} : makeRankTimeWorkerDataPayload()),
    staticRows: toPlainRankTimePayload(staticData.value.rows),
    staticSeries: toPlainRankTimePayload(staticData.value.series),
    staticMarkers: toPlainRankTimePayload(staticData.value.markers),
    userId,
    fixedMarker: filter.marker,
  });
  return response.data || null;
}

function selectRankTimeDataSync(userId: string) {
  let rankTimeDataSetValue = rankTimeDataSet.value;
  if (!rankTimeDataInitialized.value) {
    rankTimeDataSetValue = getAllRankTimeData(
      memorizedData.value,
      solutions.value,
      getProperRankTimeChunkUnit(memorizedData.value.contest),
    );
    rankTimeDataSet.value = rankTimeDataSetValue;
    rankTimeDataInitialized.value = true;
  }
  return selectUserMainRankTimeData({
    rankTimeDataSet: rankTimeDataSetValue,
    staticRows: staticData.value.rows,
    staticSeries: staticData.value.series,
    staticMarkers: staticData.value.markers,
    userId,
    fixedMarker: filter.marker,
  });
}

async function selectRankTimeData(userId: string, request: number) {
  if (!isCurrentRankTimeRequest(userId, request)) {
    return null;
  }
  if (canUseRankTimeWorker()) {
    try {
      return await selectRankTimeDataInWorker(userId, request);
    } catch (error) {
      if (!isCurrentRankTimeRequest(userId, request) || isRankTimeWorkerResetError(error)) {
        return null;
      }
      console.warn('[RankTimeData] worker selection failed, falling back to main thread:', error);
    }
  }
  if (!isCurrentRankTimeRequest(userId, request)) {
    return null;
  }
  return selectRankTimeDataSync(userId);
}

async function calcUserRankTimeData(userId: string, request: number) {
  if (enableCCPC26.value) {
    return;
  }
  rankTimeData.value = createEmptyRankTimeData();
  const selectedRankTimeData = await selectRankTimeData(userId, request);
  if (!isCurrentRankTimeRequest(userId, request)) {
    return;
  }
  if (!selectedRankTimeData) {
    return;
  }
  rankTimeData.value = {
    key: `${userId}_${Date.now()}`,
    initialized: true,
    ...selectedRankTimeData,
  };
  await nextTick();
}

async function handleUserClick(payload: UserClickPayload) {
  activeUserPayload.value = payload;
  userModalOpen.value = true;
  activeSolutionPayload.value = null;
  problemModalOpen.value = false;
  activeProblemPayload.value = null;
  currentShownUserId.value = `${payload.user.id}`;
}

function handleSolutionClick(payload: SolutionClickPayload) {
  activeSolutionPayload.value = payload;
  userModalOpen.value = false;
  problemModalOpen.value = false;
  activeProblemPayload.value = null;
  currentShownUserId.value = '';
}

function handleProblemClick(payload: ProblemClickPayload) {
  if (!isProblemRevealed(payload.problemIndex)) {
    return;
  }
  activeProblemPayload.value = payload;
  problemModalOpen.value = true;
  userModalOpen.value = false;
  activeSolutionPayload.value = null;
  currentShownUserId.value = '';
}

function isProblemRevealed(problemIndex: number | undefined) {
  return problemIndex === undefined || !ccpc26ProblemLayout.value ||
    ccpc26ProblemLayout.value.revealedProblemIndexes.includes(problemIndex);
}

function handleSettingsIntroModalClose() {
  settingsIntroModalOpen.value = false;
  settingsIntroRead.value = 'true';
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(LocalStorageKey.StyledRanklistSettingsIntroRead, 'true');
  }
}

function formatRendererAssetUrl(url: string) {
  return formatSrkAssetUrl(url, props.id);
}

function resolveDisplayText(text: Parameters<typeof resolveText>[0]) {
  return resolveText(text, textLanguages.value);
}
</script>

<template>
  <div v-if="renderError" role="alert" class="mx-auto my-24 max-w-md rounded border border-destructive/50 p-4 text-destructive">
    <h2 class="mb-2 text-base font-semibold">Error occurred when rendering srk</h2>
    <p class="text-sm">{{ renderError.message }}</p>
  </div>
  <template v-else>
    <div v-if="staticData.contest.banner" class="flex items-center justify-center">
      <SrkAssetImage
        :image="typeof staticData.contest.banner === 'object' ? staticData.contest.banner.link : staticData.contest.banner"
        :asset-scope="id"
        alt="Contest Banner"
        class="mb-2"
        style="max-width: min(100%, 1820px); max-height: 40vh"
      />
    </div>
    <h1 class="srk-ranklist-title">{{ resolveDisplayText(staticData.contest.title) }}</h1>
    <div class="srk-ranklist-meta">
      <span v-if="hasMetaViewCount" class="srk-ranklist-meta-item">
        <Eye class="srk-ranklist-meta-icon" /> {{ meta?.viewCnt }}
      </span>
      <ClientOnly>
        <span v-if="hasMetaViewCount" class="srk-ranklist-meta-divider" />
        <router-link
          v-if="editSrkUrl"
          :to="editSrkUrl"
          class="srk-ranklist-action-menu srk-ranklist-action-trigger"
          data-id="ranklist-edit-srk-action"
          aria-label="编辑 srk"
        >
          <FilePenLine class="srk-ranklist-meta-icon srk-ranklist-action-icon" />
          <span
            class="srk-ranklist-action-tooltip"
            data-id="ranklist-edit-srk-tooltip"
            role="tooltip"
          >
            在演练场中编辑 srk
          </span>
        </router-link>
        <span v-if="editSrkUrl" class="srk-ranklist-meta-divider" />
        <DropdownMenu
          :open="activeActionMenu === 'download'"
          :modal="false"
          @update:open="handleActionMenuOpenChange('download', $event)"
        >
          <DropdownMenuTrigger as-child>
            <span
              class="srk-ranklist-action-menu srk-ranklist-action-trigger"
              :class="{
                'is-menu-open': activeActionMenu === 'download',
                'is-menu-suppressed': suppressedActionMenu === 'download',
              }"
              data-id="ranklist-download-action"
              tabindex="0"
              aria-label="下载"
              @pointerenter="handleActionMenuPointerEnter('download', $event)"
              @pointerleave="handleActionMenuPointerLeave('download', $event)"
            >
              <Download class="srk-ranklist-meta-icon srk-ranklist-action-icon" />
            </span>
          </DropdownMenuTrigger>
            <DropdownMenuContent
              class="srk-ranklist-menu"
              data-id="ranklist-download-menu"
              side="bottom"
              align="end"
              :side-offset="0"
              :collision-padding="8"
              @pointerenter="handleActionMenuPointerEnter('download', $event)"
              @pointerleave="handleActionMenuPointerLeave('download', $event)"
              @close-auto-focus.prevent
            >
              <DropdownMenuGroup>
                <DropdownMenuLabel
                  class="srk-ranklist-menu-label"
                  data-id="ranklist-download-menu-label"
                >
                  导出为...
                </DropdownMenuLabel>
                <DropdownMenuItem as-child class="srk-ranklist-menu-item" @select.prevent="runDownloadAction(download)">
                  <button type="button">标准榜单格式 (srk)</button>
                </DropdownMenuItem>
                <DropdownMenuItem as-child class="srk-ranklist-menu-item" @select.prevent="runDownloadAction(exportAsGymGhost)">
                  <button type="button">Codeforces Gym Ghost (dat)</button>
                </DropdownMenuItem>
                <DropdownMenuItem as-child class="srk-ranklist-menu-item" @select.prevent="runDownloadAction(exportAsVJReplay)">
                  <button type="button">Virtual Judge Replay (xlsx)</button>
                </DropdownMenuItem>
                <DropdownMenuItem as-child class="srk-ranklist-menu-item" @select.prevent="runDownloadAction(exportAsGeneralExcel)">
                  <button type="button">Excel 表格 (xlsx)</button>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
        <span class="srk-ranklist-meta-divider" />
        <DropdownMenu
          :open="activeActionMenu === 'share'"
          :modal="false"
          @update:open="handleActionMenuOpenChange('share', $event)"
        >
          <DropdownMenuTrigger as-child>
            <span
              class="srk-ranklist-action-menu srk-ranklist-action-trigger"
              :class="{
                'is-menu-open': activeActionMenu === 'share',
                'is-menu-suppressed': suppressedActionMenu === 'share',
              }"
              data-id="ranklist-share-action"
              tabindex="0"
              aria-label="分享"
              @pointerenter="handleActionMenuPointerEnter('share', $event)"
              @pointerleave="handleActionMenuPointerLeave('share', $event)"
            >
              <Share2 class="srk-ranklist-meta-icon srk-ranklist-action-icon" />
            </span>
          </DropdownMenuTrigger>
            <DropdownMenuContent
              class="srk-ranklist-menu"
              data-id="ranklist-share-menu"
              side="bottom"
              align="end"
              :side-offset="0"
              :collision-padding="8"
              @pointerenter="handleActionMenuPointerEnter('share', $event)"
              @pointerleave="handleActionMenuPointerLeave('share', $event)"
              @close-auto-focus.prevent
            >
              <DropdownMenuGroup>
                <DropdownMenuItem as-child class="srk-ranklist-menu-item" @select.prevent="copyCurrentUrl">
                  <button type="button">复制本页链接</button>
                </DropdownMenuItem>
                <DropdownMenuItem v-if="id" as-child class="srk-ranklist-menu-item" @select.prevent="copyEmbedCode">
                  <button type="button">复制嵌入代码</button>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
        <RanklistQualityAction :data="memorizedData" :client-width="clientWidth" />
      </ClientOnly>
      <p v-if="contributors.length > 0" class="srk-ranklist-meta-line">
        贡献者：
        <template v-for="(contributor, index) in contributors" :key="`${contributor.name}-${index}`">
          <span v-if="index > 0">, </span>
          <a v-if="contributor.url" :href="contributor.url" target="_blank" rel="noopener">{{ contributor.name }}</a>
          <span v-else>{{ contributor.name }}</span>
        </template>
      </p>
      <p v-if="mainRefLinks.length > 0" class="srk-ranklist-meta-line">
        相关链接：
        <template v-for="(refLink, index) in mainRefLinks" :key="`${index}-${refLink.link}`">
          <span v-if="index > 0">, </span>
          <a :href="refLink.link" target="_blank" rel="noopener">{{ resolveDisplayText(refLink.title) }}</a>
        </template>
        <span v-if="hiddenRefLinks.length > 0"> </span>
        <DropdownMenu
          v-if="hiddenRefLinks.length > 0"
          :open="activeActionMenu === 'ref-links'"
          :modal="false"
          @update:open="handleActionMenuOpenChange('ref-links', $event)"
        >
          <span
            class="srk-ranklist-action-menu srk-ranklist-ref-links-more"
            :class="{
              'is-menu-open': activeActionMenu === 'ref-links',
              'is-menu-suppressed': suppressedActionMenu === 'ref-links',
            }"
            @pointerenter="handleActionMenuPointerEnter('ref-links', $event)"
            @pointerleave="handleActionMenuPointerLeave('ref-links', $event)"
          >
            <DropdownMenuTrigger as-child>
              <span
                class="srk-ranklist-ref-links-trigger"
                data-id="ranklist-ref-links-more"
                tabindex="0"
              >
                and {{ hiddenRefLinks.length }} more
                <ChevronDown class="srk-ranklist-ref-links-more-icon" />
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              class="srk-ranklist-menu"
              data-id="ranklist-ref-links-menu"
              side="bottom"
              align="start"
              :side-offset="0"
              :collision-padding="8"
              @pointerenter="handleActionMenuPointerEnter('ref-links', $event)"
              @pointerleave="handleActionMenuPointerLeave('ref-links', $event)"
              @close-auto-focus.prevent
            >
              <DropdownMenuGroup>
                <DropdownMenuItem
                  v-for="(refLink, index) in hiddenRefLinks"
                  :key="`${index}-${refLink.link}`"
                  as-child
                  class="srk-ranklist-menu-item"
                  @select="dismissActionMenu('ref-links')"
                >
                  <a
                    :href="refLink.link"
                    target="_blank"
                    rel="noopener"
                  >
                    {{ resolveDisplayText(refLink.title) }}
                  </a>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </span>
        </DropdownMenu>
      </p>
    </div>
    <p class="srk-ranklist-time">
      {{ contestTimeRange.startText }} ~ {{ contestTimeRange.endText }}
    </p>
    <div class="mx-4" data-id="ranklist-progress">
      <ProgressBar
        v-if="!isLive || clientClockReady"
        :key="progressBarRenderKey"
        :data="memorizedData"
        :enable-time-travel="enableTimeTravel"
        :td="progressTimeDelta"
        :live="isLive"
        @time-travel="handleTimeTravel"
      >
        <template #timeMachine>
          <div class="srk-progress-time-machine-status srk-ranklist-time-machine-status">
            <div class="srk-progress-time-machine-text">Time Travel Mode</div>
            <label v-if="hasCCPC26" class="srk-ranklist-ccpc26-switch">
              <span>CCPC26</span>
              <Switch
                class="srk-ranklist-switch"
                :checked="ranklistSettings.preferCCPC26"
                aria-label="CCPC26"
                @update:checked="updateRanklistSetting('preferCCPC26', $event)"
              />
            </label>
          </div>
        </template>
      </ProgressBar>
    </div>
    <div class="mx-4 mt-3 srk-ranklist-toolbar" :class="{ 'srk-ranklist-toolbar-with-filter': showFilter }">
      <div v-if="showFilter" class="srk-ranklist-filter">
        <div class="srk-ranklist-filter-primary">
          <label class="srk-ranklist-org-filter">
            <span class="srk-ranklist-filter-title">筛选</span>
            <SearchableMultiSelect v-model="filter.organizations" :options="organizations" />
          </label>
          <label class="srk-ranklist-official-filter">
            <span class="mr-1">仅正式参赛</span>
            <Switch
              class="srk-ranklist-switch"
              :checked="filter.officialOnly"
              aria-label="仅正式参赛"
              @update:checked="filter.officialOnly = $event"
            />
          </label>
          <span class="srk-ranklist-mobile-settings-action">
            <button
              type="button"
              class="srk-ranklist-icon-button"
              data-id="ranklist-mobile-settings-action"
              aria-label="Ranklist 设置"
              @click="settingsModalOpen = true"
            >
              <Settings class="h-4 w-4" />
            </button>
          </span>
        </div>
        <ToggleGroupRoot
          v-if="markers.length > 0"
          type="single"
          class="srk-ranklist-marker-filter"
          data-id="ranklist-marker-toggle-group"
          :model-value="selectedMarkerValue"
          @update:model-value="handleMarkerFilterChange"
        >
          <ToggleGroupItem
            class="srk-ranklist-marker-filter-item"
            :value="ALL_MARKERS_VALUE"
          >
            全部
          </ToggleGroupItem>
          <ToggleGroupItem
            v-for="marker in markers"
            :key="marker.id"
            class="srk-ranklist-marker-filter-item"
            :value="marker.id"
          >
            {{ resolveDisplayText(marker.label) }}
          </ToggleGroupItem>
        </ToggleGroupRoot>
      </div>
      <div v-if="shouldRenderActions" class="srk-ranklist-actions">
        <slot name="extra-action" :ranklist="memorizedData" />
        <span
          v-if="!shouldRenderInlineSettingsAction"
          class="srk-ranklist-settings-action"
        >
          <button
            type="button"
            class="srk-ranklist-icon-button"
            data-id="ranklist-settings-action"
            aria-label="榜单偏好设置"
            @click="settingsModalOpen = true"
          >
            <Settings class="h-4 w-4" />
          </button>
          <span
            class="srk-ranklist-settings-action-tooltip"
            data-id="ranklist-settings-tooltip"
            role="tooltip"
          >
            榜单偏好设置
          </span>
        </span>
      </div>
    </div>

    <Modal
      :open="settingsModalOpen"
      title="榜单偏好设置"
      :width="clientWidth >= 640 ? 520 : Math.max(clientWidth - 20, 280)"
      root-class-name="srk-general-modal-root"
      @close="settingsModalOpen = false"
      @update:open="settingsModalOpen = $event"
    >
      <div class="srk-ranklist-settings-modal">
        <section class="srk-ranklist-settings-section">
          <h3>功能设置</h3>
          <div class="srk-ranklist-setting-item">
            <span class="srk-ranklist-setting-label srk-ranklist-setting-label-with-tip">
              <span>Pro 模式</span>
              <SettingInfoTip id="professionalMode" content="显示统计底栏和额外 Dirt/SE 列" />
            </span>
            <span class="srk-ranklist-setting-control">
              <Switch
                class="srk-ranklist-switch"
                :checked="ranklistSettings.professionalMode"
                aria-label="Pro 模式"
                @update:checked="updateRanklistSetting('professionalMode', $event)"
              />
            </span>
          </div>
        </section>
        <section class="srk-ranklist-settings-section">
          <h3>视觉设置</h3>
          <div class="srk-ranklist-setting-item">
            <span class="srk-ranklist-setting-label">提交状态风格预设</span>
            <span class="srk-ranklist-setting-control">
              <ToggleGroupRoot
                type="single"
                class="srk-ranklist-marker-filter srk-ranklist-setting-toggle-group"
                data-id="ranklist-setting-status-cell-preset"
                :model-value="ranklistSettings.statusCellPreset"
                @update:model-value="handleStatusCellPresetChange"
              >
                <ToggleGroupItem class="srk-ranklist-marker-filter-item srk-ranklist-setting-toggle-item" value="classic">经典</ToggleGroupItem>
                <ToggleGroupItem class="srk-ranklist-marker-filter-item srk-ranklist-setting-toggle-item" value="detailed">详细</ToggleGroupItem>
                <ToggleGroupItem class="srk-ranklist-marker-filter-item srk-ranklist-setting-toggle-item" value="minimal">极简</ToggleGroupItem>
                <ToggleGroupItem class="srk-ranklist-marker-filter-item srk-ranklist-setting-toggle-item" value="compact">紧凑</ToggleGroupItem>
              </ToggleGroupRoot>
            </span>
          </div>
          <div class="srk-ranklist-setting-item">
            <span class="srk-ranklist-setting-label srk-ranklist-setting-label-with-tip">
              <span>提交高亮模式</span>
              <SettingInfoTip id="statusHighlight" content="可改变提交结果（通过/错误/冻结）的高亮形式" />
            </span>
            <span class="srk-ranklist-setting-control">
              <ToggleGroupRoot
                type="single"
                class="srk-ranklist-marker-filter srk-ranklist-setting-toggle-group"
                data-id="ranklist-setting-status-highlight"
                :model-value="ranklistSettings.statusColorAsText ? 'text' : 'background'"
                @update:model-value="handleStatusHighlightChange"
              >
                <ToggleGroupItem class="srk-ranklist-marker-filter-item srk-ranklist-setting-toggle-item" value="background">背景</ToggleGroupItem>
                <ToggleGroupItem class="srk-ranklist-marker-filter-item srk-ranklist-setting-toggle-item" value="text">文字</ToggleGroupItem>
              </ToggleGroupRoot>
            </span>
          </div>
          <div class="srk-ranklist-setting-item">
            <span class="srk-ranklist-setting-label">空提交占位符</span>
            <span class="srk-ranklist-setting-control">
              <ToggleGroupRoot
                type="single"
                class="srk-ranklist-marker-filter srk-ranklist-setting-toggle-group"
                data-id="ranklist-setting-empty-placeholder"
                :model-value="ranklistSettings.emptyStatusPlaceholder"
                @update:model-value="handleEmptyStatusPlaceholderChange"
              >
                <ToggleGroupItem class="srk-ranklist-marker-filter-item srk-ranklist-setting-toggle-item" value="none">无</ToggleGroupItem>
                <ToggleGroupItem class="srk-ranklist-marker-filter-item srk-ranklist-setting-toggle-item" value="dot">Dot</ToggleGroupItem>
                <ToggleGroupItem class="srk-ranklist-marker-filter-item srk-ranklist-setting-toggle-item" value="dash">Dash</ToggleGroupItem>
              </ToggleGroupRoot>
            </span>
          </div>
          <div class="srk-ranklist-setting-item">
            <span class="srk-ranklist-setting-label">表格斑马纹</span>
            <span class="srk-ranklist-setting-control">
              <Switch
                class="srk-ranklist-switch"
                :checked="ranklistSettings.rowStriped"
                aria-label="表格斑马纹"
                @update:checked="updateRanklistSetting('rowStriped', $event)"
              />
            </span>
          </div>
          <div class="srk-ranklist-setting-item">
            <span class="srk-ranklist-setting-label">表格边框</span>
            <span class="srk-ranklist-setting-control">
              <Switch
                class="srk-ranklist-switch"
                :checked="ranklistSettings.tableBordered"
                aria-label="表格边框"
                @update:checked="updateRanklistSetting('tableBordered', $event)"
              />
            </span>
          </div>
          <div class="srk-ranklist-setting-item">
            <span class="srk-ranklist-setting-label srk-ranklist-setting-label-with-tip">
              <span>分离 Organization 列</span>
              <SettingInfoTip id="splitOrganization" content="将参赛者 Organization 信息单独作为一列显示" />
            </span>
            <span class="srk-ranklist-setting-control">
              <Switch
                class="srk-ranklist-switch"
                :checked="ranklistSettings.splitOrganization"
                aria-label="分离 Organization 列"
                @update:checked="updateRanklistSetting('splitOrganization', $event)"
              />
            </span>
          </div>
          <div v-if="ranklistSettings.splitOrganization" class="srk-ranklist-setting-item">
            <span class="srk-ranklist-setting-label srk-ranklist-setting-label-with-tip">
              <span>徽标/头像位置</span>
              <SettingInfoTip id="avatarPlacement" content="如果存在参赛者徽标/头像，可决定其显示在哪一列上" />
            </span>
            <span class="srk-ranklist-setting-control">
              <ToggleGroupRoot
                type="single"
                class="srk-ranklist-marker-filter srk-ranklist-setting-toggle-group"
                data-id="ranklist-setting-avatar-placement"
                :model-value="ranklistSettings.userAvatarPlacement"
                @update:model-value="handleUserAvatarPlacementChange"
              >
                <ToggleGroupItem class="srk-ranklist-marker-filter-item srk-ranklist-setting-toggle-item" value="organization">Organization</ToggleGroupItem>
                <ToggleGroupItem class="srk-ranklist-marker-filter-item srk-ranklist-setting-toggle-item" value="user">Name</ToggleGroupItem>
              </ToggleGroupRoot>
            </span>
          </div>
        </section>
      </div>
    </Modal>

    <Modal
      :open="settingsIntroModalOpen"
      title="现可自定义榜单的显示样式！"
      :width="clientWidth >= 640 ? 420 : Math.max(clientWidth - 20, 280)"
      root-class-name="srk-general-modal-root"
      wrap-class-name="srk-ranklist-settings-intro-wrap"
      @close="handleSettingsIntroModalClose"
      @update:open="settingsIntroModalOpen = $event"
    >
      <div class="srk-ranklist-settings-intro">
        <p>点击榜单上方的设置按钮，随心调整喜欢的风格。</p>
        <div class="srk-ranklist-settings-intro-actions">
          <Button @click="handleSettingsIntroModalClose">OK</Button>
        </div>
      </div>
    </Modal>

    <div class="mt-6" />
    <div :class="ranklistRenderContainerClassName" :style="ranklistRenderContainerStyle">
      <div v-if="staticData.remarks" class="mb-4 text-center">
        <span class="srk-remarks">备注：{{ resolveDisplayText(staticData.remarks) }}</span>
      </div>
      <div class="srk-ranklist-table-scroll" :class="{ 'srk-fit-problems': fitProblemColumns }" role="region" aria-label="比赛榜单">
        <Ranklist
          v-if="!requiresClientClockForRanklist || clientClockReady"
          :data="usingData"
          :enable-c-c-p-c26="enableCCPC26"
          :ccpc26-problem-layout="ccpc26ProblemLayout"
          :theme="themeName"
          :status-cell-preset="renderedRanklistSettings.statusCellPreset"
          :status-color-as-text="renderedRanklistSettings.statusColorAsText"
          :show-problem-statistics-footer="showProfessionalProblemExtras"
          :show-dirt-column="showProfessionalProblemExtras"
          :show-s-e-column="showProfessionalProblemExtras"
          :row-bordered="renderedRanklistSettings.tableBordered"
          :column-bordered="renderedRanklistSettings.tableBordered"
          :row-striped="renderedRanklistSettings.rowStriped"
          :empty-status-placeholder="emptyStatusPlaceholder"
          :split-organization="renderedRanklistSettings.splitOrganization"
          :user-avatar-placement="renderedRanklistSettings.userAvatarPlacement"
          :format-srk-asset-url="formatRendererAssetUrl"
          :languages="rendererLanguages"
          @user-click="handleUserClick"
          @solution-click="handleSolutionClick"
          @problem-click="handleProblemClick"
        />
      </div>
      <Modal
        :open="userModalOpen && !!activeUser && !!activeUserRow"
        :title="activeUser ? resolveDisplayText(activeUser.name) : undefined"
        :width="clientWidth >= 980 ? 960 : clientWidth - 20"
        root-class-name="srk-general-modal-root"
        @close="userModalOpen = false"
        @update:open="userModalOpen = $event"
      >
        <UserInfoModal
          v-if="activeUser && activeUserRow"
          :user="activeUser"
          :row="activeUserRow"
          :index="activeUserRowIndex >= 0 ? activeUserRowIndex : activeUserPayload?.rowIndex || 0"
          :ranklist="usingData as any"
          :assets-scope="id || ''"
          :filter-marker="filter.marker"
          :rank-time-data="rankTimeData"
          :show-rank-curve="!enableCCPC26"
          :languages="textLanguages"
        />
      </Modal>
      <Modal
        v-if="activeProblemRevealed"
        :key="`problem:${problemVisibilityKey}`"
        :open="problemModalOpen && !!activeProblemPayload && activeProblemRevealed"
        :title="activeProblemModalTitle"
        :width="clientWidth >= 700 ? 680 : clientWidth - 20"
        root-class-name="srk-general-modal-root"
        @close="problemModalOpen = false"
        @update:open="problemModalOpen = $event"
      >
        <ProblemInfoModal
          v-if="activeProblemPayload && activeProblemRevealed"
          :problem="activeProblemPayload.problem"
          :problem-index="activeProblemPayload.problemIndex"
          :ranklist="staticData as any"
          :solutions="currentSolutions"
          :languages="textLanguages"
        />
      </Modal>
      <DefaultSolutionModal
        :key="`solutions:${problemVisibilityKey}`"
        :open="!!activeSolutionPayload"
        :user="activeSolutionPayload?.user"
        :problem="activeSolutionPayload?.problem"
        :problem-index="activeSolutionPayload?.problemIndex ?? 0"
        :problem-revealed="activeSolutionProblemRevealed"
        :solutions="activeSolutionPayload?.solutions || []"
        :languages="rendererLanguages"
        @close="activeSolutionPayload = null"
        @update:open="!$event && (activeSolutionPayload = null)"
      />
    </div>

    <div v-if="showFooter" class="mt-8 text-center text-sm text-muted-foreground">
      <p class="mb-0">© 2022-present algoUX. All Rights Reserved.</p>
      <p class="mt-1 mb-0">
        Find us on <a href="https://github.com/algoux" target="_blank" rel="noopener">GitHub</a>
      </p>
      <p class="mt-1 mb-0">
        Powered by <a href="https://github.com/algoux/standard-ranklist" target="_blank" rel="noopener">Standard Ranklist</a>
      </p>
      <p class="mt-1 mb-0">
        欢迎补充榜单数据至
        <a href="https://github.com/algoux/srk-collection" target="_blank" rel="noopener">榜单合集</a>
      </p>
      <p class="mt-1 mb-0">
        榜单更新订阅：<a :href="RANKLAND_RSS_PATH">RSS</a>
      </p>
      <p class="mt-1 mb-0">
        需要专业的赛事外榜托管？
        <ContactUs><a>联系我们</a></ContactUs>
      </p>
      <p v-if="config.siteAlias === 'cnn'" class="mt-1 mb-0">
        备案号：<BeianLink />
      </p>
    </div>
  </template>
</template>
