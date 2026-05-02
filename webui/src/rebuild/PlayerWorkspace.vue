<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { ForgePayload, IntentSections, RoomSnapshot, SessionCredentials, VisibleRoundState } from '@/lib/api'

const props = defineProps<{
  session: SessionCredentials
  snapshot: RoomSnapshot
  busy: boolean
  round: VisibleRoundState | null
  previewFile: {
    path: string
    size: number
    mtime: number
    frontmatter: Record<string, unknown> | null
    content: string
  } | null
}>()

const emit = defineEmits<{
  saveIntent: [sections: IntentSections, status?: 'idle' | 'ready' | 'submitted']
  respondTransfer: [characterPath: string, accept: boolean]
  runForge: [payload: ForgePayload]
  openFile: [path: string]
}>()

const intent = reactive<IntentSections>({ public: '', privateToDm: '', longTerm: '', triggers: '' })
const forge = reactive<ForgePayload>({
  name: '',
  concept: '',
  identity: '',
  motivation: '',
  strength: '标准开局',
  storyTone: '',
  signatureWish: '',
  weaknesses: '',
  boundaries: '',
  extraNotes: '',
  fileHint: '',
})
const forgeOpen = ref(false)

const statusText: Record<string, string> = {
  idle: '待行动',
  ready: '已准备',
  submitted: '已提交',
  locked: '回合处理中',
  running: '运行中',
  done: '完成',
  error: '错误',
}

watch(
  () => props.snapshot.myIntent,
  (next) => {
    intent.public = next.sections.public
    intent.privateToDm = next.sections.privateToDm
    intent.longTerm = next.sections.longTerm
    intent.triggers = next.sections.triggers
  },
  { immediate: true },
)

const controlledCharacters = computed(() =>
  props.snapshot.visibleCharacters.filter((character) =>
    props.snapshot.control.some((binding) => binding.characterPath === character.path),
  ),
)

const pendingTransfers = computed(() =>
  props.snapshot.control.filter((binding) => binding.pendingTransfer?.toSeat === props.session.seatName),
)

const seatStatus = computed(() =>
  props.snapshot.seats.find((seat) => seat.name === props.session.seatName)?.status || 'idle',
)

function save(status?: 'idle' | 'ready' | 'submitted') {
  emit('saveIntent', { ...intent }, status)
}

function submitForge() {
  emit('runForge', { ...forge })
}
</script>

<template>
  <div class="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
    <section class="space-y-4">
      <div class="hud-frame">
        <span class="corner-bl"></span><span class="corner-br"></span>
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-crimson-700">我的角色</div>
            <div class="mt-1 font-serif text-2xl font-bold text-paper-950">
              {{ controlledCharacters.length ? `${controlledCharacters.length} 份可控档案` : '尚未绑定角色' }}
            </div>
          </div>
          <button
            @click="forgeOpen = !forgeOpen"
            class="rounded-sm border border-paper-300 bg-white px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800 hover:border-crimson-600 hover:text-crimson-700"
          >
            {{ forgeOpen ? '收起创建角色' : '创建角色' }}
          </button>
        </div>

        <div v-if="controlledCharacters.length" class="mt-4 grid gap-3 md:grid-cols-2">
          <article v-for="character in controlledCharacters" :key="character.path" class="clash-card p-4">
            <div class="flex items-start gap-3">
              <div class="op-portrait !h-14 !w-14 !text-2xl">{{ character.name.slice(0, 1) }}</div>
              <div class="min-w-0">
                <div class="font-serif text-lg font-bold text-paper-950">{{ character.name }}</div>
                <button @click="emit('openFile', character.path)" class="mt-1 block max-w-full truncate font-mono text-[10px] tracking-[0.12em] text-paper-700 hover:text-crimson-700">
                  {{ character.path }}
                </button>
              </div>
            </div>
            <div class="mt-3 whitespace-pre-wrap text-sm leading-6 text-paper-800">{{ character.concept || '暂无角色概念摘要。' }}</div>
            <div v-if="character.currentSituation" class="mt-3 rounded-sm border border-paper-200 bg-paper-100 px-3 py-2 text-xs leading-6 text-paper-800">
              {{ character.currentSituation }}
            </div>
            <div class="mt-3 flex flex-wrap gap-2">
              <span v-if="character.stats.blood" class="stamp text-crimson-700">血槽 {{ character.stats.blood.total }}</span>
              <span v-if="character.stats.energy" class="stamp text-forest-700">能量 {{ character.stats.energy.current }}/{{ character.stats.energy.max }}</span>
              <span v-if="character.stats.level != null" class="stamp text-navy-800">等级 {{ character.stats.level }}</span>
              <span v-if="character.stats.xp != null" class="stamp text-paper-800">XP {{ character.stats.xp }}</span>
            </div>
          </article>
        </div>
        <div v-else class="mt-4 rounded-sm border border-dashed border-paper-400 bg-paper-100 p-4 text-sm leading-7 text-paper-800">
          还没有角色时，展开“创建角色”，写一个名字和角色概念。系统会为这个角色开启独立创角会话，生成角色卡后再进入正式行动。
        </div>
      </div>

      <div v-if="pendingTransfers.length" class="hud-frame hatch-warn">
        <span class="corner-bl"></span><span class="corner-br"></span>
        <div class="brief-heading !mb-3 !text-sm">待确认角色移交</div>
        <div class="space-y-3">
          <div v-for="binding in pendingTransfers" :key="binding.characterPath" class="clash-card p-3">
            <div class="font-serif text-base font-bold text-paper-950">{{ binding.label }}</div>
            <div class="mt-1 text-sm text-paper-800">DM 想把这个角色交给你的席位控制。</div>
            <div class="mt-3 flex gap-2">
              <button @click="emit('respondTransfer', binding.characterPath, true)" class="rounded-sm bg-forest-600 px-3 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-white">接受</button>
              <button @click="emit('respondTransfer', binding.characterPath, false)" class="rounded-sm border border-paper-300 bg-white px-3 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800">拒绝</button>
            </div>
          </div>
        </div>
      </div>

      <div class="clash-card overflow-hidden">
        <div class="clash-card-header px-4 py-3">
          <div class="font-mono text-[10px] font-bold tracking-[0.18em]">本轮行动意图</div>
          <div class="mt-1 text-sm text-white/80">玩家只写想做什么；AI DM 按当前局势裁定并写回状态。</div>
        </div>
        <div class="space-y-4 p-4">
          <div class="grid gap-4 lg:grid-cols-2">
            <label class="space-y-1">
              <div class="font-mono text-[10px] tracking-[0.18em] text-paper-500">公开行动</div>
              <textarea v-model="intent.public" rows="6" class="clash-textarea w-full resize-y px-3 py-2 text-sm leading-6" placeholder="我走到门口，先听里面有没有动静..." />
            </label>
            <label class="space-y-1">
              <div class="font-mono text-[10px] tracking-[0.18em] text-paper-500">私密意图给 DM</div>
              <textarea v-model="intent.privateToDm" rows="6" class="clash-textarea w-full resize-y px-3 py-2 text-sm leading-6" placeholder="不想公开给其他玩家的试探、隐瞒、心理活动..." />
            </label>
            <label class="space-y-1">
              <div class="font-mono text-[10px] tracking-[0.18em] text-paper-500">长期目标</div>
              <textarea v-model="intent.longTerm" rows="4" class="clash-textarea w-full resize-y px-3 py-2 text-sm leading-6" placeholder="我希望接下来几轮逐渐达成的目标。" />
            </label>
            <label class="space-y-1">
              <div class="font-mono text-[10px] tracking-[0.18em] text-paper-500">触发条件</div>
              <textarea v-model="intent.triggers" rows="4" class="clash-textarea w-full resize-y px-3 py-2 text-sm leading-6" placeholder="如果有人靠近 / 如果枪响 / 如果谈崩，我就..." />
            </label>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button @click="save()" :disabled="busy" class="rounded-sm border border-paper-300 bg-white px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800 disabled:opacity-40">保存草稿</button>
            <button @click="save('ready')" :disabled="busy" class="rounded-sm border border-navy-800 bg-navy-800 px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.12em] text-white disabled:opacity-40">标记准备</button>
            <button @click="save('submitted')" :disabled="busy" class="rounded-sm border border-ochre-300 bg-ochre-500 px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-950 disabled:opacity-40">提交给 DM</button>
            <span class="font-mono text-[10px] tracking-[0.18em] text-paper-800">当前状态：{{ statusText[seatStatus] || seatStatus }}</span>
          </div>
        </div>
      </div>

      <div class="hud-frame">
        <span class="corner-bl"></span><span class="corner-br"></span>
        <div class="brief-heading !mb-3 !text-sm">共享入口</div>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button v-for="shortcut in snapshot.documentShortcuts" :key="shortcut.path" @click="emit('openFile', shortcut.path)" class="rounded-sm border border-paper-300 bg-white p-3 text-left transition hover:border-crimson-600 hover:bg-crimson-50">
            <div class="font-serif text-[12px] font-bold text-paper-950">{{ shortcut.title }}</div>
            <div class="mt-1 truncate font-mono text-[10px] text-paper-700">{{ shortcut.path }}</div>
          </button>
        </div>
      </div>
    </section>

    <section class="space-y-4">
      <div v-if="round" class="hud-frame">
        <span class="corner-bl"></span><span class="corner-br"></span>
        <div class="brief-heading !mb-3 !text-sm">回合状态</div>
        <div class="space-y-2 text-sm leading-6 text-paper-800">
          <div><span class="font-mono text-[10px] tracking-[0.16em] text-paper-700">类型</span> {{ round.kind === 'forge' ? '创建角色' : '行动回合' }}</div>
          <div><span class="font-mono text-[10px] tracking-[0.16em] text-paper-700">状态</span> {{ statusText[round.status] || round.status }}</div>
          <div><span class="font-mono text-[10px] tracking-[0.16em] text-paper-700">席位</span> {{ round.participantSeats.join(', ') || '无' }}</div>
        </div>
      </div>

      <div v-if="forgeOpen" class="clash-card overflow-hidden">
        <div class="clash-card-header px-4 py-3">
          <div class="font-mono text-[10px] font-bold tracking-[0.18em]">AI 创建角色</div>
          <div class="mt-1 text-sm text-white/80">创建角色会启动新会话，并把角色写入 characters/active/。</div>
        </div>
        <div class="space-y-3 p-4">
          <label class="space-y-1">
            <div class="font-mono text-[10px] tracking-[0.18em] text-paper-500">角色名字</div>
            <input v-model="forge.name" class="clash-input w-full px-3 py-2 text-sm" placeholder="例如：习风、铁鼠、老高" />
          </label>
          <label class="space-y-1">
            <div class="font-mono text-[10px] tracking-[0.18em] text-paper-500">角色概念</div>
            <textarea v-model="forge.concept" rows="5" class="clash-textarea w-full resize-y px-3 py-2 text-sm leading-6" placeholder="一句话写出你想扮演的人。" />
          </label>
          <div class="grid gap-3 md:grid-cols-2">
            <input v-model="forge.identity" class="clash-input px-3 py-2 text-sm" placeholder="身份 / 背景" />
            <input v-model="forge.motivation" class="clash-input px-3 py-2 text-sm" placeholder="动机" />
            <input v-model="forge.strength" class="clash-input px-3 py-2 text-sm" placeholder="期望强度" />
            <input v-model="forge.storyTone" class="clash-input px-3 py-2 text-sm" placeholder="故事调性" />
            <input v-model="forge.signatureWish" class="clash-input px-3 py-2 text-sm" placeholder="标志性愿望" />
            <input v-model="forge.fileHint" class="clash-input px-3 py-2 text-sm" placeholder="文件名提示（可选）" />
          </div>
          <textarea v-model="forge.weaknesses" rows="2" class="clash-textarea w-full resize-y px-3 py-2 text-sm leading-6" placeholder="可接受的缺陷 / 代价" />
          <textarea v-model="forge.boundaries" rows="2" class="clash-textarea w-full resize-y px-3 py-2 text-sm leading-6" placeholder="内容边界" />
          <textarea v-model="forge.extraNotes" rows="2" class="clash-textarea w-full resize-y px-3 py-2 text-sm leading-6" placeholder="补充说明" />
          <button @click="submitForge" :disabled="busy" class="w-full rounded-sm border border-ochre-300 bg-ochre-500 px-4 py-3 font-mono text-[11px] font-bold tracking-[0.16em] text-paper-950 disabled:opacity-40">
            生成角色卡
          </button>
        </div>
      </div>
    </section>
  </div>
</template>
