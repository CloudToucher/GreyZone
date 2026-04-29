<script setup lang="ts">
import type { OpencodeProbeResult, RoomSnapshot, SessionCredentials } from '@/lib/api'

defineProps<{
  session: SessionCredentials
  snapshot: RoomSnapshot
  activeTab: 'player' | 'dm' | 'shared'
  probing: boolean
  probeResult: OpencodeProbeResult | null
}>()

const emit = defineEmits<{
  switchTab: [tab: 'player' | 'dm' | 'shared']
  refresh: []
  probe: []
  leave: []
}>()
</script>

<template>
  <header class="border-b-2 border-paper-950 bg-white px-6 py-3">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div class="flex items-center gap-3">
        <div class="flex h-10 w-10 items-center justify-center rounded-sm bg-crimson-600 font-mono text-sm font-black text-white">
          GZ
        </div>
        <div>
          <div class="font-serif text-lg font-bold text-paper-950">
            {{ snapshot.room.title }}
          </div>
          <div class="font-mono text-[10px] uppercase tracking-[0.2em] text-paper-500">
            {{ snapshot.room.ruleset }} | {{ session.role }} | {{ session.seatName }}
          </div>
        </div>
      </div>

      <nav class="flex items-stretch overflow-hidden rounded-sm border-2 border-paper-950">
        <button
          v-if="session.role === 'player'"
          @click="emit('switchTab', 'player')"
          class="px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.15em]"
          :class="activeTab === 'player' ? 'bg-crimson-600 text-white' : 'bg-white text-paper-700 hover:bg-paper-100'"
        >
          Player Workspace
        </button>
        <button
          v-if="session.role === 'dm'"
          @click="emit('switchTab', 'dm')"
          class="px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.15em]"
          :class="activeTab === 'dm' ? 'bg-navy-800 text-white' : 'bg-white text-paper-700 hover:bg-paper-100'"
        >
          DM Console
        </button>
        <button
          @click="emit('switchTab', 'shared')"
          class="border-l-2 border-paper-950 px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.15em]"
          :class="activeTab === 'shared' ? 'bg-paper-950 text-white' : 'bg-white text-paper-700 hover:bg-paper-100'"
        >
          Shared Board
        </button>
      </nav>

      <div class="flex items-center gap-2">
        <div class="rounded-sm border border-paper-300 bg-paper-100 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-700">
          {{ snapshot.room.phase }}
        </div>
        <button
          @click="emit('probe')"
          class="rounded-sm border border-paper-300 bg-white px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] hover:border-crimson-600 hover:text-crimson-700"
        >
          {{ probing ? 'Probing...' : 'Opencode Probe' }}
        </button>
        <button
          @click="emit('refresh')"
          class="rounded-sm border border-paper-300 bg-white px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] hover:border-crimson-600 hover:text-crimson-700"
        >
          Refresh
        </button>
        <button
          @click="emit('leave')"
          class="rounded-sm border border-paper-300 bg-white px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] hover:border-crimson-600 hover:text-crimson-700"
        >
          Leave
        </button>
      </div>
    </div>
  </header>
</template>
