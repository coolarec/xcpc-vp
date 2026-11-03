import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRenderer, nextTick, reactive, ssrContextKey } from 'vue';
import VpView from './vp.view.vue';
import { formatChinaTime } from './china-time';

const harness = vi.hoisted(() => ({ route: undefined as any, replace: vi.fn(), getRanklist: vi.fn() }));
vi.mock('vue-router', () => ({
  useRoute: () => harness.route,
  useRouter: () => ({ replace: harness.replace, push: vi.fn() }),
}));
vi.mock('@/services/ranklist-api', () => ({ useRanklandApi: () => ({ getRanklist: harness.getRanklist }) }));
vi.mock('./presence', () => ({ useVPPresence: vi.fn() }));
vi.mock('@/components/ui/button', () => ({ Button: { template: '<button><slot /></button>' } }));
vi.mock('@/components/ui/input', () => ({ Input: { render: () => null } }));
vi.mock('@/components/ui/switch', () => ({ Switch: { render: () => null } }));
vi.mock('@algoux/standard-ranklist-renderer-component-vue', () => ({ Modal: { render: () => null } }));
vi.mock('@/components/common/Loading.vue', () => ({ default: { render: () => null } }));
vi.mock('@/components/ranklist/StyledRanklist.vue', () => ({ default: { render: () => null } }));
vi.mock('./ScrollSolution.vue', () => ({ default: { render: () => null } }));

// Mount the real view with Vue's renderer, without a browser or the heavy ranklist UI.
interface TestNode { parent?: TestNode; children: TestNode[]; text?: string }
const node = (text?: string): TestNode => ({ children: [], text });
const renderer = createRenderer<TestNode, TestNode>({
  createElement: () => node(), createText: text => node(text), createComment: text => node(text),
  setText: (target, text) => { target.text = text; },
  setElementText: (target, text) => { target.text = text; target.children = []; },
  patchProp: () => {},
  parentNode: target => target.parent || null,
  nextSibling: target => target.parent?.children[target.parent.children.indexOf(target) + 1] || null,
  insert(target, parent, anchor) {
    if (target.parent) target.parent.children.splice(target.parent.children.indexOf(target), 1);
    target.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    if (index < 0) parent.children.push(target);
    else parent.children.splice(index, 0, target);
  },
  remove(target) { target.parent?.children.splice(target.parent.children.indexOf(target), 1); },
});

const start = Date.parse('2026-11-03T15:00:00.000Z');
let now: number;
let stored: Map<string, string>;
let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn> };
let apps: ReturnType<typeof renderer.createApp>[];
async function flush() { for (let i = 0; i < 8; i++) await nextTick(); }
async function mount() {
  const app = renderer.createApp({ ...VpView, render: () => null });
  app.provide(ssrContextKey, {});
  apps.push(app);
  const instance = app.mount(node());
  await flush();
  return (instance.$ as any).setupState;
}

beforeEach(() => {
  now = start;
  apps = [];
  stored = new Map();
  storage = {
    getItem: vi.fn((key: string) => stored.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { stored.set(key, value); }),
  };
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', { innerWidth: 1000, innerHeight: 800, setInterval: vi.fn(), clearInterval: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  harness.route = reactive({ query: { contest: 'test', play: '1', at: new Date(start).toISOString(), feed: '0' } });
  harness.replace.mockImplementation(async ({ query }) => {
    harness.route.query = Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined));
  });
  harness.getRanklist.mockResolvedValue({ srk: {
    type: 'general', version: '0.3.14',
    contest: { title: 'Clock regression', startAt: '2026-01-01T00:00:00Z', duration: [5, 'h'] },
    problems: [{ alias: 'A' }], series: [{ rule: { preset: 'Normal' } }],
    sorter: { algorithm: 'ICPC', config: {} },
    rows: [{ user: { id: 'team', name: 'Team' }, score: { value: 0 }, statuses: [{ result: null }] }],
  } });
});
afterEach(() => {
  apps.forEach(app => app.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('ignores a completed legacy clock and starts a new contest without saving timing state', async () => {
  stored.set('RanklandVP2:test:default:auto:50:20:null:0', JSON.stringify({ version: 2, elapsed: 18_000_000, savedAt: start, running: false, speed: 1, ownName: '', manual: [] }));
  const view = await mount();
  expect(view.error).toBe('');
  expect(view.running).toBe(true);
  expect(view.elapsed).toBe(0);
  now += 60_000;
  view.tick();
  expect(view.elapsed).toBe(60_000);
  expect(storage.getItem.mock.calls.every(([key]) => key.startsWith('RanklandVP:submissions:'))).toBe(true);
  expect(storage.setItem).not.toHaveBeenCalled();
});

it('adds a real start to bare links and uses the actual button click time when starting', async () => {
  delete harness.route.query.at;
  delete harness.route.query.play;
  const view = await mount();
  expect(view.error).toBe('');
  expect(harness.route.query.at).toBe(formatChinaTime(start));
  expect(view.running).toBe(false);
  await view.setSpeed({ target: { value: '2' } });
  now += 120_000;
  view.toggleRunning();
  await flush();
  expect(harness.route.query.at).toBe(formatChinaTime(now));
  expect(view.elapsed).toBe(0);
  expect(view.running).toBe(true);
  now += 1000;
  view.tick();
  expect(view.elapsed).toBe(2000);
});

it('puts a pause in the URL and stays paused after remounting a scheduled contest', async () => {
  let view = await mount();
  now += 60_000;
  view.toggleRunning();
  await flush();
  expect(harness.route.query).toMatchObject({ play: '0', from: '1', at: formatChinaTime(start), anchor: formatChinaTime(now) });
  apps[0].unmount();
  apps = [];
  now += 300_000;
  view = await mount();
  expect(view.elapsed).toBe(60_000);
  expect(view.running).toBe(false);
  view.toggleRunning();
  await flush();
  now += 30_000;
  view.tick();
  expect(view.elapsed).toBe(90_000);
  expect(view.running).toBe(true);
});

it('restarts a finished contest with a fresh actual start and clears old URL anchors', async () => {
  const view = await mount();
  now += 60_000;
  view.toggleRunning();
  await flush();
  view.toggleRunning();
  await flush();
  now += 18_000_000;
  view.tick();
  expect(view.ended).toBe(true);
  view.reset();
  await flush();
  expect(harness.route.query.at).toBe(formatChinaTime(now));
  expect(harness.route.query).not.toHaveProperty('anchor');
  expect(view.elapsed).toBe(0);
  expect(view.ended).toBe(false);
  now += 120_000;
  view.toggleRunning();
  await flush();
  expect(harness.route.query.at).toBe(formatChinaTime(now));
  expect(view.running).toBe(true);
  now += 1000;
  view.tick();
  expect(view.elapsed).toBe(1000);
});

it('restores only manual submissions for the same actual start', async () => {
  harness.route.query.team = 'My team';
  const view = await mount();
  now += 60_000;
  view.record();
  expect(storage.setItem).toHaveBeenCalledTimes(1);
  const [key, value] = storage.setItem.mock.calls[0];
  expect(key).toContain(new Date(start).toISOString());
  expect(JSON.parse(value)).toEqual([{ problemIndex: 0, timeMs: 60_000, result: 'AC' }]);
  apps[0].unmount();
  apps = [];
  now += 60_000;
  const restored = await mount();
  expect(restored.manual).toHaveLength(1);
  expect(restored.elapsed).toBe(120_000);
  harness.route.query = { ...harness.route.query, at: new Date(now).toISOString() };
  await flush();
  expect(restored.manual).toHaveLength(0);
  expect(restored.elapsed).toBe(0);
  expect(restored.running).toBe(true);
});

it('keeps the clock running when submission storage is unavailable', async () => {
  storage.getItem.mockImplementation(() => { throw new Error('Storage unavailable'); });
  const view = await mount();
  expect(view.error).toBe('');
  now += 60_000;
  view.tick();
  expect(view.elapsed).toBe(60_000);
  expect(view.running).toBe(true);
});

it('keeps a completed five-hour run at the finish when time passes and after reloading', async () => {
  let view = await mount();
  now += 18_000_000;
  view.tick();
  const finishedRanklist = view.ranklist;
  for (const delay of [250, 1000, 60_000, 18_000_000]) {
    now += delay;
    view.tick();
    expect(view.elapsed).toBe(18_000_000);
    expect(view.running).toBe(false);
    expect(view.ended).toBe(true);
    expect(view.ranklist).toBe(finishedRanklist);
  }
  apps[0].unmount();
  apps = [];
  view = await mount();
  expect(view.elapsed).toBe(18_000_000);
  expect(view.ended).toBe(true);
  expect(view.running).toBe(false);
});
