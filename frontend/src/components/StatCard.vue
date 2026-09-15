<template>
  <el-card shadow="hover" class="stat-card">
    <div class="stat-title">{{ title }}</div>
    <div class="stat-value" :style="{ color }">{{ display }}</div>
    <div v-if="hint" class="stat-hint">{{ hint }}</div>
  </el-card>
</template>

<script setup>
import { computed } from 'vue';

/** 态势统计卡片 */
const props = defineProps({
  title: String,
  value: [Number, String],
  suffix: { type: String, default: '' },
  hint: { type: String, default: '' },
  color: { type: String, default: '#303133' },
});
const display = computed(() => (props.value === null || props.value === undefined ? '-' : `${props.value}${props.suffix}`));
</script>

<style scoped>
.stat-card { border-radius: 8px; }
.stat-title { font-size: 13px; color: #909399; }
.stat-value { font-size: 30px; font-weight: 700; margin: 6px 0 2px; }
.stat-hint { font-size: 12px; color: #a8abb2; }
</style>
