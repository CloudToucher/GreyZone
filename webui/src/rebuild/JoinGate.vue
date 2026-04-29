<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  busy: boolean
  error: string | null
  lastSeatName: string
}>()

const emit = defineEmits<{
  join: [name: string]
}>()

const name = ref(props.lastSeatName || '')

function submit() {
  emit('join', name.value)
}
</script>

<template>
  <div class="min-h-screen bg-paper-100 text-paper-900">
    <div class="mx-auto flex min-h-screen max-w-6xl items-center px-6 py-12">
      <div class="grid w-full gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <section class="hud-frame bg-white">
          <span class="corner-bl"></span><span class="corner-br"></span>
          <div class="mb-3 flex items-center gap-2">
            <span class="live-dot"></span>
            <span class="font-mono text-[10px] uppercase tracking-[0.22em] text-crimson-700">
              Single-Room TRPG Shell
            </span>
          </div>
          <h1 class="font-serif text-4xl font-black leading-tight text-paper-950">
            同一网址，<span class="text-crimson-600">按名字入席</span>。
          </h1>
          <p class="mt-4 max-w-3xl text-sm leading-7 text-paper-700">
            这是围绕柔性语义跑团重构后的房间壳层。文件系统仍是唯一权威，网站负责席位、控制权、玩家输入、DM 编排和 AI 回合执行。
          </p>

          <div class="mt-8 grid gap-3 sm:grid-cols-3">
            <div class="data-card">
              <div class="data-card-label"><span class="h-1 w-3 bg-crimson-600"></span>Identity</div>
              <div class="data-card-value !text-2xl">名字占座</div>
              <div class="data-card-foot">REJOIN SAFE</div>
            </div>
            <div class="data-card">
              <div class="data-card-label"><span class="h-1 w-3 bg-navy-800"></span>Control</div>
              <div class="data-card-value !text-2xl">角色托管</div>
              <div class="data-card-foot">TRANSFER READY</div>
            </div>
            <div class="data-card">
              <div class="data-card-label"><span class="h-1 w-3 bg-ochre-600"></span>Runtime</div>
              <div class="data-card-value !text-2xl">AI DM</div>
              <div class="data-card-foot">FILE-BACKED</div>
            </div>
          </div>
        </section>

        <section class="clash-card overflow-hidden">
          <div class="clash-card-header px-5 py-4">
            <div class="font-mono text-[10px] font-bold uppercase tracking-[0.18em]">Join / Rejoin</div>
            <div class="mt-1 text-sm text-white/75">输入玩家名即可入席；同浏览器会自动保留恢复令牌。</div>
          </div>

          <div class="space-y-4 p-5">
            <label class="block space-y-2">
              <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-600">Seat Name</div>
              <input
                v-model="name"
                @keydown.enter.prevent="submit"
                class="clash-input w-full px-3 py-3 font-sans text-sm"
                placeholder="例如：铁鼠 / 老高 / DM"
              />
            </label>

            <button
              @click="submit"
              :disabled="busy || !name.trim()"
              class="w-full rounded-sm border border-ochre-300 bg-ochre-500 px-4 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-paper-950 transition hover:bg-ochre-400 disabled:opacity-40"
            >
              {{ busy ? 'Joining...' : 'Enter Room' }}
            </button>

            <div v-if="error" class="rounded-sm border border-crimson-200 bg-crimson-50 px-3 py-2 text-sm text-crimson-700">
              {{ error }}
            </div>

            <div class="rounded-sm border border-paper-200 bg-paper-100 px-3 py-3 text-sm leading-6 text-paper-700">
              房间是单房间常驻结构。玩家只会看到自己的意图工作区、自己可控的角色和公共看板；DM 会拥有完整控制台。
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
