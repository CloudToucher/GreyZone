<script setup lang="ts">
import type { FilePayload } from '@/lib/api'
import RenderedMarkdown from './RenderedMarkdown.vue'

defineProps<{
  file: FilePayload | null
  title?: string
  returnLabel?: string
}>()

const emit = defineEmits<{
  close: []
}>()
</script>

<template>
  <section class="flex min-h-full flex-col">
    <div class="sticky top-0 z-10 mb-4 border-2 border-paper-950 bg-white">
      <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div class="min-w-0">
          <div class="font-mono text-[10px] font-bold tracking-[0.18em] text-crimson-700">
            {{ title || '文件阅读' }}
          </div>
          <div class="mt-1 truncate font-serif text-xl font-bold text-paper-950">
            {{ file?.path || '未选择文件' }}
          </div>
        </div>
        <button
          @click="emit('close')"
          class="rounded-sm border-2 border-crimson-700 bg-crimson-600 px-4 py-3 text-center font-mono text-[12px] font-bold tracking-[0.12em] text-white hover:bg-crimson-700"
        >
          {{ returnLabel || '返回主界面' }}
        </button>
      </div>
    </div>

    <article class="page-card flex-1 px-8 py-7 md:px-12 md:py-10">
      <RenderedMarkdown
        v-if="file"
        :content="file.content"
        empty="这个文件目前没有可显示内容。"
      />
      <div v-else class="text-sm leading-7 text-paper-800">
        从左侧目录或快捷入口打开文件后，会在这里完整阅读。
      </div>
    </article>
  </section>
</template>
