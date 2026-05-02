<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  busy: boolean
  error: string | null
  lastSeatName: string
  lastRoomCode: string
}>()

const emit = defineEmits<{
  join: [payload: { name: string; roomCode: string }]
}>()

const name = ref(props.lastSeatName || '')
const roomCode = ref(props.lastRoomCode || '')

function submit() {
  emit('join', { name: name.value, roomCode: roomCode.value })
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
            <span class="font-mono text-[10px] uppercase tracking-[0.22em] text-crimson-700">灰区跑团房间</span>
          </div>
          <h1 class="font-serif text-4xl font-black leading-tight text-paper-950">输入席位名，进入你的桌面。</h1>
          <p class="mt-4 max-w-3xl text-sm leading-7 text-paper-800">
            这里是《灰区：撤离》的文件落盘跑团界面。玩家只需要提交意图、阅读 DM 回复、查看共享看板和自己的角色卡；AI DM 与主持人负责读取必要文件、推进局势并写回状态。
          </p>

          <div class="mt-8 grid gap-3 sm:grid-cols-3">
            <div class="data-card">
              <div class="data-card-label"><span class="h-1 w-3 bg-crimson-600"></span>身份</div>
              <div class="data-card-value !text-2xl">席位入房</div>
              <div class="data-card-foot">可恢复会话</div>
            </div>
            <div class="data-card">
              <div class="data-card-label"><span class="h-1 w-3 bg-navy-800"></span>控制</div>
              <div class="data-card-value !text-2xl">角色绑定</div>
              <div class="data-card-foot">支持移交</div>
            </div>
            <div class="data-card">
              <div class="data-card-label"><span class="h-1 w-3 bg-ochre-600"></span>运行</div>
              <div class="data-card-value !text-2xl">AI DM</div>
              <div class="data-card-foot">文件落盘</div>
            </div>
          </div>
        </section>

        <section class="clash-card overflow-hidden">
          <div class="clash-card-header px-5 py-4">
            <div class="font-mono text-[10px] font-bold tracking-[0.18em]">进入 / 重新进入</div>
            <div class="mt-1 text-sm text-white/80">玩家用自己的名字入席；主持人输入 DM。</div>
          </div>

          <div class="space-y-4 p-5">
            <label class="block space-y-2">
              <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-800">席位名</div>
              <input
                v-model="name"
                @keydown.enter.prevent="submit"
                class="clash-input w-full px-3 py-3 font-sans text-sm"
                placeholder="例如：习风 / 铁鼠 / DM"
              />
            </label>

            <label class="block space-y-2">
              <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-800">房间口令</div>
              <input
                v-model="roomCode"
                @keydown.enter.prevent="submit"
                class="clash-input w-full px-3 py-3 font-sans text-sm"
                type="password"
                autocomplete="current-password"
                placeholder="由房主提供"
              />
            </label>

            <button
              @click="submit"
              :disabled="busy || !name.trim()"
              class="w-full rounded-sm border border-ochre-300 bg-ochre-500 px-4 py-3 font-mono text-[11px] font-bold tracking-[0.16em] text-paper-950 transition hover:bg-ochre-400 disabled:opacity-40"
            >
              {{ busy ? '进入中...' : '进入房间' }}
            </button>

            <div v-if="error" class="rounded-sm border border-crimson-200 bg-crimson-50 px-3 py-2 text-sm text-crimson-700">
              {{ error }}
            </div>

            <div class="rounded-sm border border-paper-300 bg-paper-100 px-3 py-3 text-sm leading-6 text-paper-800">
              进入后，玩家优先看“DM 回复 / 共享看板 / 我的角色”。回合包和对话索引主要给 DM 调试与追踪，玩家不需要盯着它们玩。
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
