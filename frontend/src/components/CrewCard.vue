<template>
  <el-card shadow="hover" class="crew-card" :class="{ off: crew.duty_status !== 'ON' }">
    <div class="crew-head">
      <span class="crew-name">{{ crew.name }}</span>
      <el-tag size="small" :type="crew.duty_status === 'ON' ? 'success' : 'info'" effect="dark">
        {{ crew.duty_status === 'ON' ? '值班中' : '休息' }}
      </el-tag>
    </div>
    <div class="crew-line">班长：{{ crew.leader_name }} · {{ crew.contact_phone }}</div>
    <div class="crew-skills">
      <el-tag v-for="s in crew.skill_tags" :key="s" size="small" effect="plain" class="skill">
        {{ FaultTypeText[s] || s }}
      </el-tag>
    </div>
    <div class="crew-task">
      <template v-if="crew.active_ticket || crew.active_ticket_no">
        <el-tag type="danger" size="small" effect="dark">在途</el-tag>
        <span class="ticket-no">{{ crew.active_ticket?.ticket_no || crew.active_ticket_no }}</span>
      </template>
      <span v-else class="muted">空闲，可派工</span>
    </div>
  </el-card>
</template>

<script setup>
import { FaultTypeText } from '../constants';

/** 班组状态卡片（态势页/派工面板共用） */
defineProps({ crew: { type: Object, required: true } });
</script>

<style scoped>
.crew-card { border-radius: 8px; }
.crew-card.off { opacity: 0.65; }
.crew-head { display: flex; justify-content: space-between; align-items: center; }
.crew-name { font-weight: 700; font-size: 15px; }
.crew-line { color: #909399; font-size: 12px; margin: 6px 0; }
.crew-skills { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.crew-task { display: flex; align-items: center; gap: 6px; font-size: 13px; }
.ticket-no { font-family: monospace; color: #f56c6c; }
</style>
