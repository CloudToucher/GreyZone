<script setup lang="ts">
import { computed } from 'vue'
import type { OpencodeProbeResult, RoomSnapshot, SessionCredentials } from '@/lib/api'

const props = defineProps<{
  session: SessionCredentials
  snapshot: RoomSnapshot
  activeTab: 'player' | 'dm' | 'shared'
  probing: boolean
  probeResult: OpencodeProbeResult | null
  probeError: string | null
  probeCheckedAt: string | null
  currentPath: string | null
}>()

const emit = defineEmits<{
  switchTab: [tab: 'player' | 'dm' | 'shared']
  refresh: []
  probe: []
  leave: []
  enableDm: []
}>()

const hasDmConsole = computed(() => props.session.role === 'dm' || !!props.session.dmEnabled)

const probeLabel = computed(() => {
  if (props.probing) return '自检中'
  if (props.probeResult?.ok) return 'opencode OK'
  if (props.probeError || props.probeResult) return 'opencode FAIL'
  return 'opencode 未检'
})

const probeTone = computed(() => {
  if (props.probing) return 'border-ochre-300 bg-ochre-50 text-ochre-800'
  if (props.probeResult?.ok) return 'border-forest-300 bg-forest-50 text-forest-800'
  if (props.probeError || props.probeResult) return 'border-crimson-300 bg-crimson-50 text-crimson-800'
  return 'border-paper-300 bg-paper-100 text-paper-800'
})

const probeDetail = computed(() => {
  if (props.probing) return '正在后台调用 opencode run --pure'
  if (props.probeResult?.ok) return `${props.probeResult.model} · ${props.probeResult.durationMs}ms`
  if (props.probeResult?.diagnosis) return props.probeResult.diagnosis
  if (props.probeError) return props.probeError
  return 'DM 入房后会自动自检，也可以手动重跑'
})
</script>

<template>
  <header class="border-b-2 border-paper-950 bg-white px-6 py-3">
    <div class="grid items-center gap-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
      <div class="flex min-w-0 items-center gap-3">
        <div class="flex h-10 w-10 items-center justify-center rounded-sm bg-crimson-600 font-mono text-sm font-black text-white">GZ</div>
        <div class="min-w-0">
          <div class="font-serif text-lg font-bold text-paper-950">{{ snapshot.room.title }}</div>
          <div class="font-mono text-[10px] uppercase tracking-[0.2em] text-paper-700">
            {{ snapshot.room.ruleset }} · {{ session.role === 'dm' ? 'DM' : '玩家' }} · {{ session.seatName }}
          </div>
        </div>
      </div>

      <nav class="flex items-stretch overflow-hidden rounded-sm border-2 border-paper-950 lg:justify-self-center">
        <button
          v-if="session.role === 'player'"
          @click="emit('switchTab', 'player')"
          class="px-4 py-2 font-mono text-[11px] font-bold tracking-[0.15em]"
          :class="activeTab === 'player' ? 'bg-crimson-600 text-white' : 'bg-white text-paper-800 hover:bg-paper-100'"
        >
          玩家工作台
        </button>
        <button
          v-if="hasDmConsole"
          @click="emit('switchTab', 'dm')"
          class="px-4 py-2 font-mono text-[11px] font-bold tracking-[0.15em]"
          :class="activeTab === 'dm' ? 'bg-navy-800 text-white' : 'bg-white text-paper-800 hover:bg-paper-100'"
        >
          DM 控制台
        </button>
        <button
          @click="emit('switchTab', 'shared')"
          class="border-l-2 border-paper-950 px-4 py-2 font-mono text-[11px] font-bold tracking-[0.15em]"
          :class="activeTab === 'shared' ? 'bg-paper-950 text-white' : 'bg-white text-paper-800 hover:bg-paper-100'"
        >
          共享看板
        </button>
      </nav>

      <div class="flex min-w-0 items-center justify-end gap-2 lg:justify-self-end">
        <div class="rounded-sm border border-paper-300 bg-paper-100 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-800">
          {{ snapshot.room.phase }}
        </div>
        <div v-if="hasDmConsole" class="hidden max-w-[18rem] rounded-sm border px-2 py-1 md:block" :class="probeTone" :title="probeDetail">
          <div class="font-mono text-[10px] font-bold tracking-[0.12em]">{{ probeLabel }}</div>
          <div class="truncate text-[10px] leading-tight opacity-80">{{ probeDetail }}</div>
        </div>
        <div class="hidden max-w-[20rem] truncate font-mono text-[10px] tracking-[0.14em] text-paper-700 md:block">
          {{ currentPath || '未选择文件' }}
        </div>
        <button
          v-if="!hasDmConsole"
          @click="emit('enableDm')"
          class="rounded-sm border border-paper-300 bg-white px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800 hover:border-crimson-600 hover:text-crimson-700"
        >
          添加 DM 控制台
        </button>
        <button
          @click="emit('probe')"
          :disabled="probing"
          class="rounded-sm border border-paper-300 bg-white px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800 hover:border-crimson-600 hover:text-crimson-700"
        >
          {{ probing ? '自检中...' : '重跑自检' }}
        </button>
        <button
          @click="emit('refresh')"
          class="rounded-sm border border-paper-300 bg-white px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800 hover:border-crimson-600 hover:text-crimson-700"
        >
          刷新
        </button>
        <button
          @click="emit('leave')"
          class="rounded-sm border border-paper-300 bg-white px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800 hover:border-crimson-600 hover:text-crimson-700"
        >
          离开
        </button>
      </div>
    </div>
  </header>
</template>
