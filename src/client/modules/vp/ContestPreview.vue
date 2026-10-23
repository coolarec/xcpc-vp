<script setup lang="ts">
import { computed } from 'vue';
import { ExternalLink, FileText, Info } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import Loading from '@/components/common/Loading.vue';
import type { IApiRanklist } from '@/services/ranklist-api';
import { summarizeContest } from './contest-summary';

const props = defineProps<{ data?: IApiRanklist; loading: boolean; error: string }>();
const emit = defineEmits<{ (event: 'retry'): void }>();
const summary = computed(() => props.data ? summarizeContest(props.data.srk) : undefined);
const durationText = computed(() => {
  const minutes = summary.value?.durationMinutes;
  return minutes == null ? '未提供' : minutes % 60 === 0 ? `${minutes / 60} 小时` : `${minutes} 分钟`;
});
</script>

<template>
  <section class="contest-preview" aria-label="比赛基本信息" data-contest-preview>
    <div v-if="loading" class="preview-state"><Loading /><p>正在读取比赛信息…</p></div>
    <div v-else-if="error" class="preview-state"><Info :size="22" /><p role="alert">{{ error }}</p><Button size="sm" variant="outline" @click="emit('retry')">重新加载</Button></div>
    <template v-else-if="summary">
      <div class="preview-heading"><FileText :size="22" /><h2>{{ summary.title || data?.info.name }}</h2><p>{{ summary.date || '日期未提供' }} · {{ durationText }}</p><span>{{ summary.rule }}</span></div>
      <dl class="preview-metrics">
        <div><dt>学校 / 单位</dt><dd>{{ summary.schools || (summary.missingOrganizations ? '未提供' : 0) }}</dd></div>
        <div><dt>参赛队伍</dt><dd>{{ summary.teams }}</dd></div>
        <div><dt>参赛人数</dt><dd :class="{ unknown: !summary.peopleComplete }">{{ summary.people == null ? '未提供' : `${summary.peopleComplete ? '' : '已知 '}${summary.people}` }}</dd></div>
        <div><dt>题目数量</dt><dd>{{ summary.problems }}</dd></div>
      </dl>
      <div class="preview-notes"><p>正式 {{ summary.officialTeams }} 队 · 非正式 {{ summary.teams - summary.officialTeams }} 队</p><p v-if="summary.missingOrganizations">{{ summary.missingOrganizations }} 支队伍未提供学校 / 单位。</p><p v-if="summary.people == null">源榜单未提供队员名单，人数不作估算。</p><p v-else-if="!summary.peopleComplete">{{ summary.rosterTeams }} / {{ summary.teams }} 支队伍提供了可识别的队员名单。</p><p v-else>人数按队员名单统计，不含教练。</p></div>
      <section class="preview-section"><h3>金银铜奖项</h3><template v-if="summary.medals.length"><div v-for="(medals, index) in summary.medals" :key="index" class="preview-awards"><p v-if="summary.medals.length > 1">{{ medals.title }}</p><div class="preview-medals"><span><i class="gold"></i>金 <strong>{{ medals.gold ?? '—' }}</strong></span><span><i class="silver"></i>银 <strong>{{ medals.silver ?? '—' }}</strong></span><span><i class="bronze"></i>铜 <strong>{{ medals.bronze ?? '—' }}</strong></span></div></div><p class="preview-caption">按源榜单的奖项分段统计。</p></template><p v-else class="preview-caption">{{ summary.medalError ? '奖项分段暂时无法计算。' : '源榜单未提供金银铜分段。' }}</p></section>
      <section class="preview-section"><h3>题目链接 <small v-if="summary.problemLinks.length">{{ summary.problemLinks.length }} / {{ summary.problems }}</small></h3><div v-if="summary.problemLinks.length" class="preview-problems"><a v-for="problem in summary.problemLinks" :key="`${problem.alias}:${problem.url}`" :href="problem.url" target="_blank" rel="noopener noreferrer"><b>{{ problem.alias }}</b><span>{{ problem.title || `题目 ${problem.alias}` }}</span><ExternalLink :size="12" /></a></div><p v-else class="preview-caption">源榜单未提供单题链接。</p></section>
      <section v-if="summary.referenceLinks.length" class="preview-section"><h3>相关链接</h3><a v-for="(link, index) in summary.referenceLinks" :key="index" class="preview-reference" :href="link.url" target="_blank" rel="noopener noreferrer">{{ link.title }}<ExternalLink :size="12" /></a></section>
    </template>
  </section>
</template>

<style scoped>
.contest-preview{min-width:0;padding:20px 18px;background:hsl(var(--background) / .25)}
.preview-state{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;min-height:180px;color:hsl(var(--muted-foreground));font-size:12px;line-height:1.7;text-align:center;overflow-wrap:anywhere}.preview-state p{margin:0}
.preview-heading>svg{color:hsl(var(--primary));margin-bottom:9px}.preview-heading h2{margin:0 0 8px;font-size:15px;line-height:1.7;font-weight:500;overflow-wrap:anywhere}.preview-heading p{margin:0 0 6px;font-size:11px;color:hsl(var(--muted-foreground))}.preview-heading>span{font-size:10px;color:hsl(var(--muted-foreground))}
.preview-metrics{display:grid;grid-template-columns:1fr 1fr;gap:17px 15px;margin:22px 0 14px}.preview-metrics dt{font-size:11px;color:hsl(var(--muted-foreground))}.preview-metrics dd{margin:3px 0 0;font-size:22px;font-weight:500;line-height:1.5}.preview-metrics dd.unknown{font-size:15px;line-height:2.2}
.preview-notes{font-size:10px;color:hsl(var(--muted-foreground));line-height:1.8}.preview-notes p{margin:0 0 3px}.preview-section{margin-top:19px;padding-top:15px;border-top:1px solid hsl(var(--border))}.preview-section h3{display:flex;align-items:center;justify-content:space-between;margin:0 0 10px;font-size:12px;font-weight:500}.preview-section h3>small{font-size:10px;color:hsl(var(--muted-foreground));font-weight:400}.preview-caption{margin:7px 0 0;font-size:10px;color:hsl(var(--muted-foreground));line-height:1.8}.preview-awards>p{margin:8px 0 6px;font-size:11px;color:hsl(var(--muted-foreground))}
.preview-medals{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px}.preview-medals>span{display:flex;align-items:center;gap:5px}.preview-medals strong{font-weight:500}.preview-medals i{width:7px;height:7px;display:inline-block;border-radius:50%}.gold{background:#f8bf29}.silver{background:#c0c0c0}.bronze{background:#d69872}
.preview-problems{display:flex;flex-direction:column;gap:7px}.preview-problems a{display:flex;align-items:center;gap:8px;font-size:12px;min-width:0}.preview-problems b{font-size:11px;font-weight:500;flex-shrink:0}.preview-problems span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.preview-problems svg{flex-shrink:0;margin-left:auto}.preview-reference{display:flex;align-items:center;gap:6px;margin:6px 0;font-size:11px;overflow-wrap:anywhere}
@media(max-width:760px){.contest-preview{padding:17px 15px}}
</style>
