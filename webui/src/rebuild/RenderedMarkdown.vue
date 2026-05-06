<script setup lang="ts">
import { computed } from 'vue'
import { renderMarkdown } from '@/lib/md'

const props = withDefaults(
  defineProps<{
    content?: string | null
    empty?: string
    compact?: boolean
    maxHeight?: string
  }>(),
  {
    content: '',
    empty: '暂无内容。',
    compact: false,
    maxHeight: '',
  },
)

const rendered = computed(() => renderMarkdown((props.content || '').trim()).html)
const hasContent = computed(() => Boolean((props.content || '').trim()))
</script>

<template>
  <div
    class="markdown-reader overflow-auto"
    :class="compact ? 'markdown-reader-compact' : ''"
    :style="maxHeight ? { maxHeight } : undefined"
  >
    <article v-if="hasContent" class="md" v-html="rendered" />
    <div v-else class="text-sm leading-7 text-paper-700">{{ empty }}</div>
  </div>
</template>
