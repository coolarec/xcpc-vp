const { defineConfig } = require('vite');
const path = require('path');
const vue = require('@vitejs/plugin-vue');
const vpPresenceDev = require('./scripts/vp-presence-dev.cjs');

module.exports = defineConfig(({ command }) => {
  const isBuild = command === 'build';
  return {
    appType: 'spa',
    base: '/',
    define: {
      'process.env.BWCX_RUNTIME_SCOPE': JSON.stringify('client'),
      'process.env.NODE_ENV': JSON.stringify(isBuild ? 'production' : 'development'),
      __VUE_PROD_DEVTOOLS__: false,
      __RANKLAND_CLIENT_ENV__: JSON.stringify({
        LEGACY_API_BASE_CLIENT: process.env.LEGACY_API_BASE_CLIENT || 'https://rl.algoux.cn/api',
        SRK_STORAGE_BASE: process.env.SRK_STORAGE_BASE || 'https://cdn.algoux.cn/srk-storage',
        VIN_URL: process.env.VIN_URL || 'https://cdn.algoux.cn/rankland/vin.txt',
        HOST_GLOBAL: process.env.HOST_GLOBAL || 'rl.algoux.org',
        HOST_CN: process.env.HOST_CN || 'rl.algoux.cn',
        SITE_ALIAS: process.env.SITE_ALIAS || 'global',
        BEIAN: process.env.BEIAN || '',
        LIVE_POLLING_INTERVAL: process.env.LIVE_POLLING_INTERVAL || '10000',
        WS_BASE: process.env.WS_BASE || '',
        GTAG: process.env.GTAG || '',
        BUILD_COMMIT: process.env.BUILD_COMMIT || '',
      }),
    },
    resolve: {
      alias: [
        { find: '@public', replacement: path.resolve(__dirname, 'public') },
        { find: '@client', replacement: path.resolve(__dirname, 'src/client') },
        { find: '@common', replacement: path.resolve(__dirname, 'src/common') },
        { find: '@', replacement: path.resolve(__dirname, 'src/client') },
      ],
    },
    build: {
      outDir: 'dist',
    },
    plugins: [
      vue(),
      vpPresenceDev(),
    ],
  };
});
