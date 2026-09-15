<template>
  <el-tag :type="tagType" size="small" effect="light" round>{{ text }}</el-tag>
</template>

<script setup>
import { computed } from 'vue';
import {
  TicketStatusText, TicketStatusType, ReportStatusText, ReportStatusType,
  UsageStatusText, UsageStatusType, AssetHealthStatusText, AssetHealthType,
} from '../constants';

/** 通用状态徽标：kind = ticket | report | usage | health */
const props = defineProps({
  kind: { type: String, required: true },
  value: { type: String, required: true },
});

const maps = {
  ticket: [TicketStatusText, TicketStatusType],
  report: [ReportStatusText, ReportStatusType],
  usage: [UsageStatusText, UsageStatusType],
  health: [AssetHealthStatusText, AssetHealthType],
};
const text = computed(() => (maps[props.kind]?.[0] || {})[props.value] || props.value);
const tagType = computed(() => (maps[props.kind]?.[1] || {})[props.value] || 'info');
</script>
