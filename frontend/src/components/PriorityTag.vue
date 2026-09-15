<template>
  <el-tag :type="SeverityType[value] || 'info'" size="small" effect="dark">
    {{ SeverityText[value] || value }}
  </el-tag>
</template>

<script setup>
import { SeverityText, SeverityType } from '../constants';

/** 故障等级标签（一般/严重/危急） */
defineProps({ value: { type: String, required: true } });
</script>
