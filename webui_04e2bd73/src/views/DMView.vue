<script setup lang="ts">
import { computed, ref } from 'vue'
import MarkdownView from '../components/MarkdownView.vue'
import StatusBar from '../components/StatusBar.vue'
import RoundConsole from '../components/RoundConsole.vue'
import DicePanel from '../components/DicePanel.vue'
import { useRoundStore } from '../stores/round'

const round = useRoundStore()

const userConsole = ref(true)
const userDice = ref(true)

const consoleOpen = computed({
  get: () => userConsole.value || round.status === 'running' || round.status === 'starting',
  set: (v: boolean) => (userConsole.value = v),
})
</script>

<template>
  <div class="flex h-full min-w-0 flex-1 flex-col">
    <!-- DM toolbar -->
    <div
      class="flex items-center justify-between gap-3 border-b border-paper-300 bg-paper-100 px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-paper-700"
    >
      <div class="flex items-center gap-3">
        <span class="font-bold text-paper-900">DM 工作台</span>
        <span class="text-paper-300">|</span>
        <button
          @click="consoleOpen = !consoleOpen"
          class="rounded-sm border border-paper-300 bg-white px-2 py-0.5 hover:border-crimson-600 hover:text-crimson-700"
        >
          {{ consoleOpen ? '◣ 隐藏' : '◢ 显示' }} 控制台
        </button>
        <button
          @click="userDice = !userDice"
          class="rounded-sm border border-paper-300 bg-white px-2 py-0.5 hover:border-crimson-600 hover:text-crimson-700"
        >
          {{ userDice ? '◣ 隐藏' : '◢ 显示' }} 骰池
        </button>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-paper-500">STATUS</span>
        <span
          class="rounded-sm px-1.5 py-0.5 font-bold tracking-wide text-white"
          :class="
            round.status === 'running' || round.status === 'starting'
              ? 'bg-crimson-600 animate-pulse'
              : round.status === 'error'
              ? 'bg-ochre-600'
              : round.status === 'done'
              ? 'bg-forest-600'
              : 'bg-paper-500'
          "
        >
          {{ round.status.toUpperCase() }}
        </span>
      </div>
    </div>

    <div class="flex min-h-0 flex-1 flex-col">
      <!-- Round console + Dice panel (collapsible) -->
      <div
        v-if="consoleOpen || userDice"
        class="flex shrink-0 border-b-2 border-paper-950"
        style="height: 36vh; min-height: 220px"
      >
        <div v-if="consoleOpen" class="min-w-0 flex-1" :class="{ 'border-r border-paper-300': userDice }">
          <RoundConsole />
        </div>
        <div v-if="userDice" class="w-64 shrink-0" :class="{ 'border-l border-paper-300': consoleOpen }">
          <DicePanel />
        </div>
      </div>

      <!-- Doc area -->
      <div class="flex min-h-0 flex-1 flex-col">
        <StatusBar />
        <div class="min-h-0 flex-1">
          <MarkdownView />
        </div>
      </div>
    </div>
  </div>
</template>
