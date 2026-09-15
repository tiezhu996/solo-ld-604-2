<template>
  <el-empty v-if="!logs || !logs.length" description="暂无记录" :image-size="60" />
  <el-timeline v-else class="timeline">
    <el-timeline-item v-for="log in logs" :key="log.id" :timestamp="fmtTime(log.created_at)" placement="top">
      <div class="log-line">
        <el-tag size="small" effect="plain">{{ AuditActionText[log.action] || log.action }}</el-tag>
        <span class="actor">{{ log.actor_name }}</span>
      </div>
      <div class="detail">{{ log.detail }}</div>
    </el-timeline-item>
  </el-timeline>
</template>

<script setup>
import { AuditActionText, fmtTime } from '../constants';

/** 审计/进度时间线（工单详情、审计页共用） */
defineProps({ logs: { type: Array, default: () => [] } });
</script>

<style scoped>
.timeline { padding-left: 4px; }
.log-line { display: flex; align-items: center; gap: 8px; }
.actor { font-size: 13px; color: #606266; }
.detail { font-size: 13px; color: #303133; margin-top: 4px; }
</style>
