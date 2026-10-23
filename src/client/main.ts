import './index.less';
import './index.css';
import Axios from 'axios';
import { createApp } from 'vue';
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { createHead, Head } from '@vueuse/head';
import App from './App.vue';
import VpPage from './modules/vp/page.vue';
import ClientOnly from './components/common/ClientOnly.vue';
import { ApiClientFactory, API_REQUEST_TOKEN, API_CLIENT_TOKEN } from './api';
import { ApiClientPlugin } from './plugins/api-client.plugin';
import { createClientRanklandApi } from './services/ranklist-api/factory.client';
import { RANKLAND_API_TOKEN } from './services/ranklist-api';
import { createThemeService, THEME_TOKEN } from './lib/theme';
import { installRanklandAnalytics } from './app/analytics';
import { applyMacBlinkOptimizations } from './app/platform';
import { installRouteProgress } from './app/route-progress';
import { getRanklandRuntimeConfig } from './app/config';

async function bootstrap() {
  const routes: RouteRecordRaw[] = [{ path: '/', name: 'VP', component: VpPage }];
  const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes,
  });

  const app = createApp(App);
  const head = createHead();
  const theme = createThemeService();

  const runtimeConfig = getRanklandRuntimeConfig();
  const apiRequest = Axios.create({
    baseURL: runtimeConfig.legacyApiBaseClient.endsWith('/')
      ? runtimeConfig.legacyApiBaseClient
      : `${runtimeConfig.legacyApiBaseClient}/`,
    timeout: 30_000,
    withCredentials: false,
  });
  const apiClient = ApiClientFactory.createInstance(apiRequest);
  const api = createClientRanklandApi(apiClient);

  app.use(head);
  app.use(ApiClientPlugin, { apiClient });
  app.provide(THEME_TOKEN, theme);
  app.provide(API_REQUEST_TOKEN, apiRequest);
  app.provide(API_CLIENT_TOKEN, apiClient);
  app.provide(RANKLAND_API_TOKEN, api);

  app.config.globalProperties.$theme = theme;
  app.config.globalProperties.$ranklandApi = api;

  app.component(Head.name, Head);
  app.component(ClientOnly.name || 'ClientOnly', ClientOnly);

  installRouteProgress(router);
  theme.mount(window);
  applyMacBlinkOptimizations(window);
  installRanklandAnalytics(router, window);

  app.use(router);
  await router.isReady();
  app.mount('#app');
}

void bootstrap().catch((error) => {
  console.error('[VP] Failed to start RankLand VP:', error);
});
