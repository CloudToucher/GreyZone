<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { renderMarkdown, type TocItem } from '../lib/md'
import { useWorkspaceStore } from '../stores/workspace'

const ws = useWorkspaceStore()

const content = ref('')
const toc = ref<TocItem[]>([])
const scroller = ref<HTMLElement | null>(null)
const activeSlug = ref<string>('')

watch(
  () => ws.current,
  (cur) => {
    if (!cur) {
      content.value = ''
      toc.value = []
      return
    }
    const { html, toc: t } = renderMarkdown(cur.content)
    content.value = html
    toc.value = t
    nextTick(() => {
      if (scroller.value) scroller.value.scrollTop = 0
    })
  },
  { immediate: true },
)

function onScroll() {
  if (!scroller.value) return
  const el = scroller.value
  const headings = el.querySelectorAll<HTMLElement>('.md h1, .md h2, .md h3, .md h4')
  let cur = ''
  for (const h of headings) {
    if (h.getBoundingClientRect().top - el.getBoundingClientRect().top < 88) {
      cur = h.id
    } else break
  }
  activeSlug.value = cur
}

function jumpTo(slug: string) {
  if (!scroller.value) return
  const target = scroller.value.querySelector<HTMLElement>(`#${CSS.escape(slug)}`)
  if (!target) return
  const top = target.offsetTop - 24
  scroller.value.scrollTo({ top, behavior: 'smooth' })
}

const showToc = computed(() => toc.value.length > 2)

const meta = computed(() => {
  if (!ws.current) return ''
  const dt = new Date(ws.current.mtime)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}  ·  ${ws.current.size} B`
})
</script>

<template>
  <section class="flex h-full min-w-0 flex-1 bg-paper-100">
    <!-- Reading column -->
    <div class="flex min-w-0 flex-1 flex-col">
      <div
        v-if="ws.current"
        class="flex items-center justify-between gap-3 border-b border-paper-300 bg-white px-6 py-2"
      >
        <div class="flex min-w-0 items-center gap-3">
          <button
            v-if="ws.panel === 'player'"
            @click="ws.goHome()"
            class="shrink-0 rounded-sm border border-paper-300 px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.15em] text-paper-700 transition hover:border-crimson-600 hover:text-crimson-700"
            title="返回主控台"
          >
            ◂ HUB
          </button>
          <span
            class="font-mono text-[11px] uppercase tracking-[0.15em] text-paper-700 truncate"
          >
            <span class="text-crimson-600">▎</span>{{ ws.current.path }}
          </span>
        </div>
        <span class="shrink-0 font-mono text-[10px] text-paper-500">{{ meta }}</span>
      </div>

      <div
        ref="scroller"
        @scroll="onScroll"
        class="min-h-0 flex-1 overflow-y-auto px-6 py-8"
      >
        <div v-if="ws.fileLoading" class="text-center font-mono text-sm text-paper-500">
          载入中...
        </div>
        <div
          v-else-if="ws.fileError"
          class="mx-auto max-w-2xl rounded-sm border-l-4 border-crimson-600 bg-crimson-50 px-4 py-3 font-mono text-sm text-crimson-700"
        >
          {{ ws.fileError }}
        </div>
        <div
          v-else-if="!ws.current"
          class="flex h-full flex-col items-center justify-center font-mono text-sm text-paper-500"
        >
          <div class="mb-2 text-5xl text-paper-300">◆</div>
          <div>从左侧选择一个文档开始阅读</div>
        </div>
        <article v-else class="page-card mx-auto max-w-5xl px-12 py-10">
          <div class="md" v-html="content" />
        </article>
      </div>
    </div>

    <!-- TOC sidebar -->
    <div
      v-if="showToc"
      class="hidden w-60 shrink-0 border-l border-paper-300 bg-white px-3 py-5 lg:block"
    >
      <div
        class="mb-3 flex items-center gap-2 px-1 font-mono text-[10px] uppercase tracking-[0.15em]"
      >
        <span class="h-1 w-3 bg-crimson-600" />
        <span class="text-paper-700">本页目录</span>
      </div>
      <ul class="space-y-px text-[12.5px]">
        <li v-for="item in toc" :key="item.slug">
          <button
            @click="jumpTo(item.slug)"
            class="block w-full truncate rounded-sm border-l-2 px-2 py-1 text-left transition-colors"
            :class="
              activeSlug === item.slug
                ? 'border-crimson-600 bg-crimson-50 text-crimson-700 font-semibold'
                : 'border-transparent text-paper-600 hover:border-paper-300 hover:text-paper-950'
            "
            :style="{ paddingLeft: `${0.5 + (item.level - 1) * 0.7}rem` }"
            :title="item.text"
          >
            {{ item.text }}
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>
