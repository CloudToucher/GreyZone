<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRoundStore } from '../stores/round'
import { useWorkspaceStore } from '../stores/workspace'

const round = useRoundStore()
const ws = useWorkspaceStore()

const scroller = ref<HTMLElement | null>(null)
const autoScroll = ref(true)

const statusText = computed(() => {
  switch (round.status) {
    case 'idle': return '等待玩家提交本轮...'
    case 'starting': return '正在启动 opencode...'
    case 'running': return 'DM 研判进行中'
    case 'done': return `本轮结束 · 退出码 ${round.exitCode ?? '?'}`
    case 'error': return `错误：${round.errorMsg || '未知'}`
  }
})

const elapsed = computed(() => {
  if (!round.startedAt) return ''
  const end = round.endedAt ?? Date.now()
  const s = Math.floor((end - round.startedAt) / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
})

// Parse DM output into structured blocks
interface OutputBlock {
  type: 'header' | 'scene' | 'rule' | 'dice' | 'update' | 'text'
  content: string
  /** Filename being edited (guessed from DM output) */
  file?: string
}

const blocks = computed<OutputBlock[]>(() => {
  const text = round.output
  if (!text) return []
  const result: OutputBlock[] = []
  const lines = text.split('\n')
  for (const l of lines) {
    if (!l.trim()) continue
    // Heuristic classification
    if (l.startsWith('##') || l.startsWith('###')) {
      result.push({ type: 'header', content: l.replace(/^#+\s*/, '') })
    } else if (l.match(/d100|d10|d8|d6|d4/i) && l.match(/\d+/)) {
      result.push({ type: 'dice', content: l })
    } else if (l.match(/HP|SP|AP|生命|体力/) && l.match(/\d+/)) {
      result.push({ type: 'update', content: l })
    } else if (l.match(/判定|检定|裁决|规则/i)) {
      result.push({ type: 'rule', content: l })
    } else if (l.match(/^[>]/)) {
      result.push({ type: 'scene', content: l.replace(/^>\s*/, '') })
    } else {
      // Merge into last text block if possible
      const last = result[result.length - 1]
      if (last && last.type === 'text') last.content += '\n' + l
      else result.push({ type: 'text', content: l })
    }
  }
  return result
})

const classBy = (t: OutputBlock['type']) => {
  switch (t) {
    case 'header': return 'text-paper-950 font-bold text-[13px] border-l-2 border-crimson-600 pl-2'
    case 'scene': return 'text-navy-800 italic bg-navy-50/50 px-2 py-1 rounded-sm'
    case 'dice': return 'text-ochre-700 font-mono bg-ochre-50 px-2 py-1 rounded-sm border-l border-ochre-400'
    case 'update': return 'text-forest-700 font-mono bg-forest-50 px-2 py-1 rounded-sm border-l border-forest-400'
    case 'rule': return 'text-navy-700 font-mono bg-paper-100 px-2 py-1 rounded-sm'
    default: return 'text-paper-800'
  }
}

watch(() => round.events.length, () => {
  if (!autoScroll.value) return
  nextTick(() => { if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight })
})

watch(() => round.status, (s) => {
  if (s === 'done' || s === 'error') { ws.loadTree(); if (ws.currentPath) ws.openFile(ws.currentPath).catch(() => {}) }
})
</script>

<template>
  <div class="flex h-full flex-col bg-white">
    <!-- Header -->
    <div class="flex flex-wrap items-center justify-between gap-2 border-b-2 border-paper-950 bg-paper-100 px-3 py-2">
      <div class="flex items-center gap-2">
        <span class="h-2 w-2 rounded-full"
          :class="round.status === 'running' || round.status === 'starting' ? 'bg-crimson-600 animate-pulse' : round.status === 'done' ? 'bg-forest-600' : round.status === 'error' ? 'bg-ochre-600' : 'bg-paper-400'" />
        <span class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-700">DM 裁决</span>
        <span class="font-mono text-[10px] font-bold"
          :class="round.status === 'done' ? 'text-forest-700' : round.status === 'error' ? 'text-ochre-700' : 'text-paper-600'">
          {{ statusText }}
        </span>
        <span v-if="elapsed" class="font-mono text-[10px] text-paper-500">{{ elapsed }}</span>
      </div>
      <div class="flex items-center gap-1">
        <label class="flex items-center gap-1 font-mono text-[10px] text-paper-600 cursor-pointer">
          <input v-model="autoScroll" type="checkbox" class="accent-crimson-600" /> 自动滚动
        </label>
        <button @click="round.reset()" :disabled="round.status === 'running' || round.status === 'starting'"
          class="rounded-sm border border-paper-300 px-1.5 py-0.5 font-mono text-[10px] text-paper-700 hover:border-crimson-600 hover:text-crimson-700 disabled:opacity-40">
          清屏
        </button>
      </div>
    </div>

    <!-- Body -->
    <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto bg-paper-950 p-3">
      <template v-if="round.status === 'idle' && !round.output">
        <div class="flex flex-col items-center gap-2 py-8">
          <div class="font-mono text-2xl text-paper-700">◆</div>
          <div class="font-mono text-xs text-paper-500">提交本轮后，DM 裁决会显示在这里</div>
          <div class="font-mono text-[10px] text-paper-600">包括：场景叙事 · 检定结果 · 状态变更 · 骰池消耗</div>
        </div>
      </template>
      <div v-else class="space-y-2 font-sans text-[12px] leading-relaxed">
        <div v-for="(b, i) in blocks" :key="i" :class="[classBy(b.type), 'px-2 py-1 rounded-sm']"
          :style="{ color: b.type === 'text' ? '#cbd5e1' : undefined }">
          <span class="font-mono text-[9px] text-paper-600 mr-1" v-if="b.type !== 'text'">
            {{ b.type === 'header' ? '§' : b.type === 'dice' ? '⚄' : b.type === 'update' ? '↻' : b.type === 'rule' ? '⚖' : b.type === 'scene' ? '▸' : '' }}
          </span>
          {{ b.content }}
        </div>
      </div>
      <div v-if="round.errorMsg" class="mt-2 rounded border-l-2 border-crimson-500 bg-crimson-900/40 px-2 py-1 font-mono text-[11px] text-crimson-200">
        ⚠ {{ round.errorMsg }}
      </div>
    </div>
  </div>
</template>
