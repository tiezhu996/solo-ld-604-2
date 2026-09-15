<template>
  <el-empty :description="text" :image-size="80" />
</template>

<script setup>
/** 空状态占位 */
defineProps({ text: { type: String, default: '暂无数据' } });
</script>
