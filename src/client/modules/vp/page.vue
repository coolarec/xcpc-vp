<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import SetupView from './setup.view.vue';
import VpView from './vp.view.vue';

const route = useRoute();
const contestKey = computed(() => typeof route.query.contest === 'string' ? route.query.contest : '');
</script>

<template>
  <VpView v-if="contestKey" :key="`${contestKey}:${route.query.run || ''}`" />
  <SetupView v-else />
  <footer class="mt-6 text-center text-xs leading-6 text-muted-foreground">
    <div>本网站数据来源 Rankland，访问 <a href="https://rank.ac" class="text-primary hover:underline">rank.ac</a> 自动跳转</div>
    <div>Thanks to algoUX and CoolArec ❤️</div>
  </footer>
</template>
