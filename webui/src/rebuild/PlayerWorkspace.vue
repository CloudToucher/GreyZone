<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { CharacterSummary, ForgePayload, IntentSections, RoomSnapshot, SessionCredentials, VisibleRoundState } from '@/lib/api'
import RenderedMarkdown from './RenderedMarkdown.vue'

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
  ready: '草稿已保存',
  submitted: '等待 AI DM',
  locked: 'AI 处理中',
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
    props.snapshot.control.some((binding) => binding.characterPath === character.path && binding.primarySeat === props.session.seatName),
  ),
)

const pendingTransfers = computed(() =>
  props.snapshot.control.filter((binding) => binding.pendingTransfer?.toSeat === props.session.seatName),
)

const seatStatus = computed(() =>
  props.snapshot.seats.find((seat) => seat.name === props.session.seatName)?.status || 'idle',
)

const latestResult = computed(() => props.snapshot.latestResults[0] || null)
const sceneIds = computed(() => new Set(controlledCharacters.value.map((character) => character.sceneId)))
const sceneIntents = computed(() =>
  props.snapshot.publicIntents.filter((entry) => sceneIds.value.size === 0 || sceneIds.value.has(entry.sceneId) || entry.seatName === props.session.seatName),
)

const playHint = computed(() => {
  if (!controlledCharacters.value.length) return '先创建角色。角色卡生成后，这里会变成关键 HUD，并提示你提交第一步行动。'
  if (seatStatus.value === 'submitted') return '你已提交。AI DM 会按场景、分队和同场景玩家提交情况自动处理。'
  if (seatStatus.value === 'locked') return 'AI DM 正在处理当前场景。优先等待 DM 回复和角色状态写回。'
  return '写公开行动给同场景玩家协同，私密意图只给 AI DM。提交后会自动进入处理队列。'
})

function save(status?: 'idle' | 'ready' | 'submitted') {
  emit('saveIntent', { ...intent }, status)
}

function submitForge() {
  emit('runForge', { ...forge })
}

function bloodSlots(character: CharacterSummary) {
  const blood = character.stats.blood
  if (!blood) return []
  const total = Math.max(0, blood.total || 0)
  const severe = Math.max(0, blood.severe || 0)
  const light = Math.max(0, blood.light || 0)
  const healthy = Math.max(0, total - light - severe)
  return [
    ...Array.from({ length: healthy }, (_, index) => ({ key: `h-${index}`, state: 'healthy' })),
    ...Array.from({ length: light }, (_, index) => ({ key: `l-${index}`, state: 'light' })),
    ...Array.from({ length: severe }, (_, index) => ({ key: `s-${index}`, state: 'severe' })),
  ]
}

function bloodLabel(character: CharacterSummary) {
  const blood = character.stats.blood
  if (!blood) return '未记录血槽'
  return `${Math.max(0, blood.total - blood.light - blood.severe)} 红 / ${blood.light} 橙 / ${blood.severe} 黑`
}
</script>

<template>
  <div class="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
    <section class="space-y-4">
      <div class="hud-frame">
        <span class="corner-bl"></span><span class="corner-br"></span>
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-crimson-700">下一步</div>
            <div class="mt-1 font-serif text-2xl font-bold text-paper-950">
              {{ controlledCharacters.length ? '提交行动，等待 AI DM 调度' : '先创建角色' }}
            </div>
            <div class="mt-2 max-w-3xl text-sm leading-7 text-paper-800">{{ playHint }}</div>
          </div>
          <button
            @click="forgeOpen = !forgeOpen"
            class="rounded-sm border border-crimson-700 bg-crimson-600 px-5 py-3 text-center font-mono text-[13px] font-bold tracking-[0.12em] text-white hover:bg-crimson-700"
          >
            {{ forgeOpen ? '收起创建角色' : '创建角色' }}
          </button>
        </div>
      </div>

      <div v-if="latestResult" class="clash-card overflow-hidden">
        <div class="clash-card-header px-4 py-3">
          <div class="font-mono text-[10px] font-bold tracking-[0.18em]">DM 回复</div>
          <button @click="emit('openFile', latestResult.path)" class="mt-1 text-left text-sm text-white/85 hover:text-white">
            {{ latestResult.title }} · {{ new Date(latestResult.updatedAt).toLocaleString('zh-CN', { hour12: false }) }}
          </button>
        </div>
        <div class="p-4 text-sm leading-7 text-paper-850">
          {{ latestResult.excerpt || '打开结果文件查看完整回复。' }}
        </div>
      </div>

      <div class="hud-frame">
        <span class="corner-bl"></span><span class="corner-br"></span>
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-crimson-700">我的角色</div>
            <div class="mt-1 font-serif text-xl font-bold text-paper-950">
              {{ controlledCharacters.length ? `${controlledCharacters.length} 个可控角色` : '尚未绑定角色' }}
            </div>
          </div>
          <span class="stamp text-paper-800">席位：{{ statusText[seatStatus] || seatStatus }}</span>
        </div>

        <div v-if="controlledCharacters.length" class="mt-4 grid gap-3">
          <article v-for="character in controlledCharacters" :key="character.path" class="clash-card p-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="font-serif text-lg font-bold text-paper-950">{{ character.name }}</div>
                <div class="mt-1 font-mono text-[10px] tracking-[0.12em] text-paper-700">
                  {{ character.location }} · {{ character.sceneId }} · {{ character.partyId }}
                </div>
              </div>
              <button
                @click="emit('openFile', character.path)"
                class="rounded-sm border border-paper-300 bg-white px-3 py-2 text-center font-mono text-[11px] font-bold tracking-[0.12em] text-paper-900 hover:border-crimson-600 hover:text-crimson-700"
              >
                角色详情
              </button>
            </div>

            <div class="mt-4">
              <div class="font-mono text-[10px] tracking-[0.18em] text-paper-600">血槽</div>
              <div class="mt-2 flex flex-wrap gap-1.5" :aria-label="bloodLabel(character)">
                <span
                  v-for="slot in bloodSlots(character)"
                  :key="slot.key"
                  class="h-5 w-5 rounded-[2px] border border-paper-950"
                  :class="slot.state === 'healthy' ? 'bg-crimson-600' : slot.state === 'light' ? 'bg-ochre-500' : 'bg-paper-950'"
                  :title="slot.state === 'healthy' ? '红：可用血槽' : slot.state === 'light' ? '橙：受损血槽' : '黑：重创血槽'"
                ></span>
                <span v-if="!bloodSlots(character).length" class="text-sm text-paper-700">未记录血槽</span>
              </div>
              <div class="mt-2 flex flex-wrap gap-2 text-[11px] leading-5 text-paper-700">
                <span class="inline-flex items-center gap-1"><span class="h-3 w-3 bg-crimson-600"></span>红</span>
                <span class="inline-flex items-center gap-1"><span class="h-3 w-3 bg-ochre-500"></span>橙</span>
                <span class="inline-flex items-center gap-1"><span class="h-3 w-3 bg-paper-950"></span>黑</span>
                <span>{{ bloodLabel(character) }}</span>
              </div>
            </div>

            <div class="mt-4 grid gap-3 lg:grid-cols-3">
              <div class="rounded-sm border border-paper-300 bg-white p-3">
                <div class="font-mono text-[10px] tracking-[0.16em] text-paper-600">背包 / 随身物品</div>
                <div v-if="character.inventory.length" class="mt-2 flex flex-wrap gap-2">
                  <span v-for="item in character.inventory" :key="item" class="stamp text-paper-800">{{ item }}</span>
                </div>
                <div v-else class="mt-2 text-sm text-paper-700">未提取到物品。</div>
              </div>
              <div class="rounded-sm border border-paper-300 bg-white p-3">
                <div class="font-mono text-[10px] tracking-[0.16em] text-paper-600">安全箱</div>
                <div v-if="character.safeBox.length" class="mt-2 grid grid-cols-2 gap-2">
                  <div
                    v-for="slot in character.safeBox"
                    :key="slot.label"
                    class="rounded-sm border px-2 py-2 text-xs leading-5"
                    :class="slot.empty ? 'border-paper-300 bg-paper-100 text-paper-600' : 'border-ochre-400 bg-ochre-50 text-paper-900'"
                  >
                    <div class="font-mono text-[10px] tracking-[0.12em]">{{ slot.label }}</div>
                    <div class="mt-1 truncate">{{ slot.empty ? '空' : slot.item }}</div>
                  </div>
                </div>
                <div v-else class="mt-2 text-sm text-paper-700">未记录安全箱。</div>
              </div>
              <div class="rounded-sm border border-paper-300 bg-white p-3">
                <div class="font-mono text-[10px] tracking-[0.16em] text-paper-600">语义状态栏</div>
                <div v-if="character.semanticStatus.length" class="mt-2 space-y-1 text-sm leading-6 text-paper-800">
                  <div v-for="entry in character.semanticStatus" :key="entry" class="truncate">- {{ entry }}</div>
                </div>
                <div v-else class="mt-2 text-sm text-paper-700">暂无语义状态。</div>
              </div>
            </div>
          </article>
        </div>

        <div v-else class="mt-4 rounded-sm border border-dashed border-paper-400 bg-paper-100 p-4 text-sm leading-7 text-paper-800">
          创建角色后这里只显示关键 HUD；完整角色卡从“角色详情”进入。
        </div>
      </div>

      <div v-if="pendingTransfers.length" class="hud-frame hatch-warn">
        <span class="corner-bl"></span><span class="corner-br"></span>
        <div class="brief-heading !mb-3 !text-sm">待确认角色移交</div>
        <div class="space-y-3">
          <div v-for="binding in pendingTransfers" :key="binding.characterPath" class="clash-card p-3">
            <div class="font-serif text-base font-bold text-paper-950">{{ binding.label }}</div>
            <div class="mt-3 flex gap-2">
              <button @click="emit('respondTransfer', binding.characterPath, true)" class="rounded-sm bg-forest-600 px-3 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-white">接受</button>
              <button @click="emit('respondTransfer', binding.characterPath, false)" class="rounded-sm border border-paper-300 bg-white px-3 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800">拒绝</button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="space-y-4">
      <div class="clash-card overflow-hidden">
        <div class="clash-card-header px-4 py-3">
          <div class="font-mono text-[10px] font-bold tracking-[0.18em]">行动同步</div>
          <div class="mt-1 text-sm text-white/80">同场景公开草稿实时可见；私密意图只进入 AI DM 上下文。</div>
        </div>
        <div class="space-y-2 p-4">
          <article v-for="entry in sceneIntents" :key="entry.seatName" class="rounded-sm border border-paper-300 bg-paper-100 p-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="font-serif text-base font-bold text-paper-950">{{ entry.seatName }}</div>
              <span class="stamp text-paper-800">{{ statusText[entry.status] || entry.status }}</span>
            </div>
            <div class="mt-1 font-mono text-[10px] tracking-[0.14em] text-paper-700">
              {{ entry.characterNames.join('、') || '未绑定角色' }} · {{ entry.location }}
            </div>
            <div class="mt-2 whitespace-pre-wrap text-sm leading-6 text-paper-800">{{ entry.publicText || '尚未写公开行动。' }}</div>
          </article>
        </div>
      </div>

      <div class="clash-card overflow-hidden">
        <div class="clash-card-header px-4 py-3">
          <div class="font-mono text-[10px] font-bold tracking-[0.18em]">提交行动</div>
          <div class="mt-1 text-sm text-white/80">提交后自动进入 AI DM 队列，不需要人类 DM 选择玩家。</div>
        </div>
        <div class="space-y-4 p-4">
          <label class="space-y-1">
            <div class="font-mono text-[10px] tracking-[0.18em] text-paper-500">公开行动</div>
            <textarea v-model="intent.public" rows="5" class="clash-textarea w-full resize-y px-3 py-2 text-sm leading-6" placeholder="写给同场景玩家也能看到的行动草稿。" />
          </label>
          <label class="space-y-1">
            <div class="font-mono text-[10px] tracking-[0.18em] text-paper-500">私密意图给 AI DM</div>
            <textarea v-model="intent.privateToDm" rows="4" class="clash-textarea w-full resize-y px-3 py-2 text-sm leading-6" placeholder="只给 AI DM 的真实意图、隐瞒、试探或条件。" />
          </label>
          <div class="grid gap-3 md:grid-cols-2">
            <textarea v-model="intent.longTerm" rows="3" class="clash-textarea w-full resize-y px-3 py-2 text-sm leading-6" placeholder="长期目标" />
            <textarea v-model="intent.triggers" rows="3" class="clash-textarea w-full resize-y px-3 py-2 text-sm leading-6" placeholder="触发条件" />
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button @click="save()" :disabled="busy" class="rounded-sm border border-paper-300 bg-white px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800 disabled:opacity-40">保存草稿</button>
            <button @click="save('ready')" :disabled="busy" class="rounded-sm border border-navy-800 bg-navy-800 px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.12em] text-white disabled:opacity-40">公开草稿</button>
            <button @click="save('submitted')" :disabled="busy || !controlledCharacters.length" class="rounded-sm border border-ochre-300 bg-ochre-500 px-4 py-2 font-mono text-[11px] font-bold tracking-[0.12em] text-paper-950 disabled:opacity-40">提交给 AI DM</button>
            <span class="font-mono text-[10px] tracking-[0.18em] text-paper-800">当前：{{ statusText[seatStatus] || seatStatus }}</span>
          </div>
        </div>
      </div>

      <div v-if="round" class="hud-frame">
        <span class="corner-bl"></span><span class="corner-br"></span>
        <div class="brief-heading !mb-3 !text-sm">AI 处理状态</div>
        <div class="space-y-2 text-sm leading-6 text-paper-800">
          <div>类型：{{ round.kind === 'forge' ? '创建角色' : '行动处理' }}</div>
          <div>状态：{{ statusText[round.status] || round.status }}</div>
          <div>席位：{{ round.participantSeats.join(', ') || '无' }}</div>
        </div>
      </div>

      <div v-if="forgeOpen" class="clash-card overflow-hidden">
        <div class="clash-card-header px-4 py-3">
          <div class="font-mono text-[10px] font-bold tracking-[0.18em]">AI 创建角色</div>
          <div class="mt-1 text-sm text-white/80">生成角色卡后，你就可以提交开局行动。</div>
        </div>
        <div class="space-y-3 p-4">
          <input v-model="forge.name" class="clash-input w-full px-3 py-2 text-sm" placeholder="角色名字" />
          <textarea v-model="forge.concept" rows="5" class="clash-textarea w-full resize-y px-3 py-2 text-sm leading-6" placeholder="一句话写出你想扮演的人。" />
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

      <div v-if="previewFile" class="clash-card overflow-hidden">
        <div class="clash-card-header px-4 py-3">
          <div class="font-mono text-[10px] font-bold tracking-[0.18em]">{{ previewFile.path }}</div>
        </div>
        <div class="p-4">
          <RenderedMarkdown :content="previewFile.content" compact max-height="28rem" />
        </div>
      </div>
    </section>
  </div>
</template>
