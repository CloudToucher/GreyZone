<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { AiCompanionPurpose, AiCompanionRequestPayload, CharacterAction, CharacterSummary, ForgePayload, IntentSections, RoomSnapshot, SessionCredentials, VisibleRoundState, SceneReadinessResult } from '@/lib/api'
import { askAssistant, fetchSceneReadiness } from '@/lib/api'
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
  submitCharacterActions: [actions: CharacterAction[]]
  respondTransfer: [characterPath: string, accept: boolean]
  runForge: [payload: ForgePayload]
  runAiCompanion: [payload: AiCompanionRequestPayload]
  openFile: [path: string]
  enterGreyZone: [characterPaths: string[]]
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
const companionOpen = ref(false)
const companionPurpose = ref<AiCompanionPurpose>('support')
const companionConcept = ref('')
const companionBoundaries = ref('')
const companionAnchorPath = ref('')

const AI_COMPANION_SEAT = '协同DM'
const companionPurposeOptions: Array<{ value: AiCompanionPurpose; label: string }> = [
  { value: 'support', label: '支援' },
  { value: 'atmosphere', label: '气氛' },
  { value: 'plot', label: '推进剧情' },
  { value: 'combat', label: '战术' },
  { value: 'scout', label: '侦察' },
  { value: 'knowledge', label: '知识' },
]

// Assistant (rules Q&A)
const assistantQuestion = ref('')
const assistantReply = ref<string | null>(null)
const assistantBusy = ref(false)
const assistantError = ref<string | null>(null)

// These need to be defined before the polling watcher
const characterOrder = ref<string[]>([])
const draggedCharacter = ref<{ path: string; group: 'mine' | 'others' } | null>(null)
const dragOverPath = ref<string | null>(null)
let restoredActorKey = ''

function characterOrderIndex(path: string) {
  const index = characterOrder.value.indexOf(path)
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER
}

function orderCharacters(characters: CharacterSummary[]) {
  return [...characters].sort((a, b) => {
    const ai = characterOrderIndex(a.path)
    const bi = characterOrderIndex(b.path)
    return ai === bi ? characters.indexOf(a) - characters.indexOf(b) : ai - bi
  })
}

const controlledCharacters = computed(() =>
  orderCharacters(
    props.snapshot.visibleCharacters.filter((character) =>
      props.snapshot.control.some((binding) => binding.characterPath === character.path && binding.primarySeat === props.session.seatName),
    ),
  ),
)
const controlledCharacterPaths = computed(() => new Set(controlledCharacters.value.map((character) => character.path)))
const otherCharacters = computed(() =>
  orderCharacters(props.snapshot.visibleCharacters.filter((character) => !controlledCharacterPaths.value.has(character.path))),
)
const activeCharacters = computed(() => controlledCharacters.value.filter((character) => character.inGame || character.lifecycle === 'active'))
const pendingCharacters = computed(() => controlledCharacters.value.filter((character) => !character.inGame && character.lifecycle !== 'active'))

const characterActions = reactive<Record<string, CharacterAction>>({})
const selectedActionPaths = ref<string[]>([])
const charExpanded = reactive<Record<string, boolean>>({})
const charStatusOpen = reactive<Record<string, boolean>>({})
const charActionOpen = reactive<Record<string, boolean>>({})

// --- localStorage persistence for character selection & AI hosting ---
function actorStorageKey() {
  return `gz.actor.${props.session.seatName}`
}

function persistActorState() {
  const aiHosted: Record<string, boolean> = {}
  for (const key of Object.keys(characterActions)) {
    aiHosted[key] = characterActions[key].aiHosted
  }
  const payload = {
    selectedPaths: selectedActionPaths.value,
    aiHosted,
    characterOrder: characterOrder.value,
  }
  try {
    localStorage.setItem(actorStorageKey(), JSON.stringify(payload))
  } catch { /* ignore quota */ }
}

function restoreActorState() {
  const key = actorStorageKey()
  const shouldRestoreListState = restoredActorKey !== key
  if (shouldRestoreListState) restoredActorKey = key
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return
    const payload = JSON.parse(raw)
    if (shouldRestoreListState && Array.isArray(payload.selectedPaths)) {
      selectedActionPaths.value = payload.selectedPaths
    }
    if (shouldRestoreListState && Array.isArray(payload.characterOrder)) {
      characterOrder.value = payload.characterOrder.filter((path: unknown): path is string => typeof path === 'string')
    }
    if (payload.aiHosted && typeof payload.aiHosted === 'object') {
      for (const key of Object.keys(payload.aiHosted)) {
        if (characterActions[key]) {
          characterActions[key].aiHosted = payload.aiHosted[key]
        }
      }
    }
  } catch { /* ignore */ }
}

function rememberVisibleCharacterOrder() {
  const visiblePaths = props.snapshot.visibleCharacters.map((character) => character.path)
  const visible = new Set(visiblePaths)
  const remembered = characterOrder.value.filter((path) => visible.has(path))
  const missing = visiblePaths.filter((path) => !remembered.includes(path))
  const next = [...remembered, ...missing]
  if (next.join('\n') !== characterOrder.value.join('\n')) {
    characterOrder.value = next
  }
}

// Watch changes and persist
watch(
  () => selectedActionPaths.value.map((p) => p),
  () => persistActorState(),
  { deep: true },
)
watch(
  () => {
    const m: Record<string, boolean> = {}
    for (const key of Object.keys(characterActions)) {
      m[key] = characterActions[key].aiHosted
    }
    return m
  },
  () => persistActorState(),
  { deep: true },
)
watch(
  () => characterOrder.value.map((p) => p),
  () => persistActorState(),
  { deep: true },
)
watch(
  () => props.session.seatName,
  () => {
    restoredActorKey = ''
    restoreActorState()
    rememberVisibleCharacterOrder()
  },
  { immediate: true },
)
watch(
  () => props.snapshot.visibleCharacters.map((character) => character.path),
  () => rememberVisibleCharacterOrder(),
  { immediate: true },
)

type PlayPhase = '休整' | '出发' | '探索' | '战斗' | '撤离'

const PHASES: PlayPhase[] = ['休整', '出发', '探索', '战斗', '撤离']

const phaseHints: Record<PlayPhase, string> = {
  休整: '整理状态、治疗、补给、询问情报，准备下一次行动。',
  出发: '选择目的地、路线和携带物，决定是稳妥准备还是快速推进。',
  探索: '侦察、搜索、交涉、绕路或深入当前区域。',
  战斗: '选择压制、突入、掩护、撤退或绕行，行动会直接影响伤势和资源。',
  撤离: '带走战利品和伤员，确认路线，决定继续深入还是返回据点。',
}

watch(
  controlledCharacters,
  (characters) => {
    const active = new Set(characters.map((character) => character.path))
    for (const key of Object.keys(characterActions)) {
      if (!active.has(key)) delete characterActions[key]
    }
    for (const character of characters) {
      if (!characterActions[character.path]) {
        characterActions[character.path] = {
          characterPath: character.path,
          characterName: character.name,
          playerSeat: props.session.seatName,
          publicAction: intent.public,
          privateToDm: intent.privateToDm,
          longTerm: intent.longTerm,
          triggers: intent.triggers,
          aiHosted: false,
        }
      } else {
        characterActions[character.path].characterName = character.name
        characterActions[character.path].playerSeat = props.session.seatName
      }
      if (charExpanded[character.path] == null) charExpanded[character.path] = false
      if (charStatusOpen[character.path] == null) charStatusOpen[character.path] = false
      if (charActionOpen[character.path] == null) charActionOpen[character.path] = true
    }
    restoreActorState()
  },
  { immediate: true },
)

const seatStatus = computed(() =>
  props.snapshot.seats.find((seat) => seat.name === props.session.seatName)?.status || 'idle',
)

const latestAssistantResult = computed(() =>
  (props.snapshot.latestResults || []).find((result) => result.kind === 'assistant') || null,
)
const latestNarrativeResult = computed(() =>
  (props.snapshot.latestResults || []).find((result) => result.kind !== 'assistant') || null,
)
const latestPlayerResultContent = computed(() =>
  props.round?.resultContent || props.snapshot.latestResultContent || latestNarrativeResult.value?.content || '',
)
const sceneIds = computed(() => new Set(activeCharacters.value.map((character) => character.sceneId)))
const sceneIntents = computed(() =>
  props.snapshot.publicIntents.filter((entry) => sceneIds.value.size === 0 || sceneIds.value.has(entry.sceneId) || entry.seatName === props.session.seatName),
)

function normalizeText(text: string) {
  return text.replace(/<!--[\s\S]*?-->/g, '').trim()
}

function sectionBody(content: string, titles: string[]) {
  for (const title of titles) {
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(^|\\n)##\\s*${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`)
    const match = content.match(re)
    if (match?.[2]?.trim()) return normalizeText(match[2])
  }
  return ''
}

const narrativeBody = computed(() => {
  const content = latestPlayerResultContent.value
  return sectionBody(content, ['DM 回复', '场景推进', '当前局面'])
    || normalizeText(content).split(/\n##\s+/)[0]?.trim()
    || ''
})

const confirmedChanges = computed(() => {
  const content = latestPlayerResultContent.value
  const body = sectionBody(content, ['已确认变化', '状态变化', '裁定'])
  if (body) return body
  const fallbackLines = normalizeText(content)
    .split(/\r?\n/)
    .filter((line) => /受伤|血|弹|能量|位置|战利品|获得|消耗|失去|移动|安全箱|背包|灰币|线索/.test(line))
    .slice(0, 8)
  return fallbackLines.join('\n')
})

const nextActionOptions = computed(() => {
  const body = sectionBody(latestPlayerResultContent.value, ['下一步方向', '可以做些什么', '下一步'])
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, '').replace(/^\d+[.)]\s*/, '').trim())
    .filter(Boolean)
    .map((line) => {
      const quoted = line.match(/`([^`]+)`/)?.[1]
      const afterWrite = line.match(/(?:写|输入|行动)[：:]\s*([^。；;]+)/)?.[1]
      const text = quoted || afterWrite || line.replace(/\*\*/g, '')
      return text.trim().slice(0, 120)
    })
    .filter((line) => line.length >= 2 && !/^<!--/.test(line))
  return Array.from(new Set(lines)).slice(0, 3)
})

const selectedResultIndex = ref(0)
const recentNarrativeResults = computed(() =>
  (props.snapshot.latestResults || []).filter((result) => result.kind !== 'assistant').slice(0, 5),
)
type NarrativeEntry = {
  id: string
  path: string
  title: string
  updatedAt: string
  content: string
  excerpt: string
  isCurrent: boolean
}

const narrativeEntries = computed<NarrativeEntry[]>(() => {
  const current = {
    id: 'current',
    path: props.round?.resultPath || props.snapshot.latestResults?.[0]?.path || '',
    title: latestNarrativeResult.value?.title || '最新',
    updatedAt: latestNarrativeResult.value?.updatedAt || props.snapshot.room.updatedAt,
    content: props.round?.resultContent || props.snapshot.latestResultContent || latestNarrativeResult.value?.content || '',
    excerpt: latestNarrativeResult.value?.excerpt || '当前最新结果',
    isCurrent: true,
  }
  const history = recentNarrativeResults.value.map((result) => ({
    id: result.id,
    path: result.path,
    title: result.title,
    updatedAt: result.updatedAt,
    content: result.content,
    excerpt: result.excerpt,
    isCurrent: false,
  }))
  return [current, ...history]
})

const selectedHistoryContent = computed(() => {
  if (selectedResultIndex.value < 0 || selectedResultIndex.value >= narrativeEntries.value.length) return null
  return narrativeEntries.value[selectedResultIndex.value]
})

watch(
  narrativeEntries,
  (entries) => {
    if (!entries.length) return
    if (selectedResultIndex.value < 0 || selectedResultIndex.value >= entries.length) {
      selectedResultIndex.value = 0
    }
  },
  { immediate: true },
)

function inferPhaseFromText(text: string): PlayPhase {
  if (/撤离|撤退|撤出|返回据点|归队|战利品结算|脱离/.test(text)) return '撤离'
  if (/战斗|交火|开火|伏击|敌人|压制|突入|硬冲|受伤|弹匣|掩护/.test(text)) return '战斗'
  if (/探索|搜索|侦察|深入|房间|道路|废墟|工厂|码头|实验室|线索/.test(text)) return '探索'
  if (/出发|前往|路线|任务地点|接任务|补给|整备|车辆|集合/.test(text)) return '出发'
  return '休整'
}

const currentPhase = computed<PlayPhase>(() => {
  if (!activeCharacters.value.length) return '休整'
  const haystack = [
    latestPlayerResultContent.value,
    props.snapshot.sharedBoard?.content || '',
    activeCharacters.value.map((character) => `${character.location} ${character.currentSituation}`).join('\n'),
  ].join('\n')
  return inferPhaseFromText(haystack)
})

const phaseTitle = computed(() => {
  if (!controlledCharacters.value.length) return '先创建角色'
  if (!activeCharacters.value.length) return '选择角色进入灰区'
  if (seatStatus.value === 'locked') return `${currentPhase.value}处理中`
  return `${currentPhase.value}阶段：选择角色行动`
})

function latestMentionedCharacterPaths(characters: CharacterSummary[]) {
  const content = latestPlayerResultContent.value
  return characters.filter((character) => content.includes(character.name)).map((character) => character.path)
}

watch(
  activeCharacters,
  (characters) => {
    const activePaths = new Set(characters.map((character) => character.path))
    selectedActionPaths.value = selectedActionPaths.value.filter((path) => activePaths.has(path))
    if (!characters.length || selectedActionPaths.value.length) return
    const mentioned = latestMentionedCharacterPaths(characters)
    selectedActionPaths.value = mentioned.length ? [mentioned[0]] : [characters[0].path]
  },
  { immediate: true },
)

const selectedActionCharacters = computed(() =>
  activeCharacters.value.filter((character) => selectedActionPaths.value.includes(character.path)),
)

const standbyCharacters = computed(() =>
  activeCharacters.value.filter((character) => !selectedActionPaths.value.includes(character.path)),
)

function isAiCompanion(character: CharacterSummary) {
  return character.controller === AI_COMPANION_SEAT || character.aiHosted || character.requestedBy === props.session.seatName
}

function companionRoleLabel(role?: string) {
  if (!role) return ''
  return companionPurposeOptions.find((option) => option.value === role)?.label || role
}

const automaticCompanions = computed(() => {
  const relevantScenes = new Set((selectedActionCharacters.value.length ? selectedActionCharacters.value : activeCharacters.value).map((character) => character.sceneId))
  return props.snapshot.visibleCharacters.filter((character) =>
    isAiCompanion(character)
    && (character.inGame || character.lifecycle === 'active')
    && (!relevantScenes.size || relevantScenes.has(character.sceneId)),
  )
})

const companionAnchorCandidates = computed(() => activeCharacters.value)
const companionAnchor = computed(() =>
  companionAnchorCandidates.value.find((character) => character.path === companionAnchorPath.value)
  || companionAnchorCandidates.value[0]
  || null,
)

const hasSelectedActions = computed(() => selectedActionCharacters.value.length > 0)

watch(
  [companionAnchorCandidates, selectedActionPaths],
  () => {
    const candidates = companionAnchorCandidates.value
    if (!candidates.length) {
      companionAnchorPath.value = ''
      return
    }
    if (candidates.some((character) => character.path === companionAnchorPath.value)) return
    const selected = candidates.find((character) => selectedActionPaths.value.includes(character.path))
    companionAnchorPath.value = selected?.path || candidates[0].path
  },
  { immediate: true },
)

// Scene readiness
const readiness = ref<SceneReadinessResult | null>(null)
const readinessMessage = ref<string | null>(null)
let readinessTimer: ReturnType<typeof setInterval> | null = null
const nowTick = ref(Date.now())
let monitorTimer: ReturnType<typeof setInterval> | null = null

function startReadinessPolling() {
  stopReadinessPolling()
  if (!activeCharacters.value.length) return
  const poll = async () => {
    try {
      const result = await fetchSceneReadiness(props.session)
      readiness.value = result
    } catch { /* ignore */ }
  }
  poll()
  readinessTimer = setInterval(poll, 5000)
}

function stopReadinessPolling() {
  if (readinessTimer) {
    clearInterval(readinessTimer)
    readinessTimer = null
  }
}

watch(activeCharacters, (chars) => {
  if (chars.length) startReadinessPolling()
  else stopReadinessPolling()
}, { immediate: true })

onMounted(() => {
  monitorTimer = setInterval(() => {
    nowTick.value = Date.now()
  }, 2000)
})

onBeforeUnmount(() => {
  stopReadinessPolling()
  if (monitorTimer) clearInterval(monitorTimer)
})

const statusText: Record<string, string> = {
  idle: '编辑中',
  ready: '已公开',
  submitted: '已就绪',
  locked: '处理中',
  dm_hosted: 'AI 托管',
  running: '运行中',
  done: '完成',
  error: '错误',
}

const statusColor: Record<string, string> = {
  idle: 'text-paper-600',
  ready: 'text-forest-700',
  submitted: 'text-navy-700 font-bold',
  locked: 'text-ochre-600',
  dm_hosted: 'text-paper-500 italic',
}

const agentStatusRuns = computed(() => {
  const active = props.snapshot.activeAgentRuns || []
  if (active.length) return active
  return (props.snapshot.agentRuns || []).slice(0, 3)
})

function agentKindLabel(kind: string) {
  if (kind === 'contract_onboarding') return '进入灰区'
  if (kind === 'forge') return '创建角色'
  if (kind === 'ai_companion') return '协同角色'
  if (kind === 'action') return '行动回合'
  if (kind === 'assistant') return '规则助手'
  return kind
}

function formatMs(ms: number | null | undefined) {
  if (ms == null) return '未开始'
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return minutes ? `${minutes}分${rest.toString().padStart(2, '0')}秒` : `${rest}秒`
}

function elapsedFor(run: { startedAt: string | null; createdAt: string; endedAt: string | null; elapsedMs: number | null; durationMs: number | null }) {
  if (run.endedAt) return formatMs(run.durationMs ?? run.elapsedMs)
  const start = new Date(run.startedAt || run.createdAt).getTime()
  if (Number.isNaN(start)) return formatMs(run.elapsedMs)
  return formatMs(nowTick.value - start)
}

function agentTone(status: string, stale: boolean) {
  if (stale || status === 'stale') return 'border-ochre-400 bg-ochre-50 text-ochre-800'
  if (status === 'error') return 'border-crimson-300 bg-crimson-50 text-crimson-800'
  if (status === 'done') return 'border-forest-300 bg-forest-50 text-forest-800'
  if (status === 'running' || status === 'validating') return 'border-navy-300 bg-navy-50 text-navy-800'
  return 'border-paper-300 bg-paper-100 text-paper-800'
}

// Track if intent was modified after being submitted
const intentModified = ref(false)

watch(
  () => props.snapshot.myIntent,
  (next) => {
    // Only update from snapshot if we haven't modified locally
    if (!intentModified.value) {
      intent.public = next.sections.public
      intent.privateToDm = next.sections.privateToDm
      intent.longTerm = next.sections.longTerm
      intent.triggers = next.sections.triggers
    }
  },
  { immediate: true },
)

// Watch for local edits to mark modified
watch(
  () => ({ p: intent.public, d: intent.privateToDm, l: intent.longTerm, t: intent.triggers }),
  () => {
    if (seatStatus.value === 'submitted') {
      intentModified.value = true
    }
  },
  { deep: true },
)

const pendingTransfers = computed(() =>
  props.snapshot.control.filter((binding) => binding.pendingTransfer?.toSeat === props.session.seatName),
)

// Detect assistant replies when round completes
watch(
  () => props.round?.resultMarker,
  (marker) => {
    if (marker && marker.type === 'ASSISTANT_DONE' && props.round?.resultContent) {
      assistantReply.value = props.round.resultContent
      assistantBusy.value = false
    }
  },
)

const enteringCharacterPaths = computed(() => new Set(
  (props.snapshot.activeAgentRuns || [])
    .filter((run) => run.kind === 'contract_onboarding')
    .flatMap((run) => run.participantCharacters.map((character) => character.path)),
))

const enterablePendingCharacters = computed(() =>
  pendingCharacters.value.filter((character) => !enteringCharacterPaths.value.has(character.path)),
)
const selectedEnterPaths = ref<string[]>([])
const selectedEnterablePaths = computed(() => {
  const enterable = new Set(enterablePendingCharacters.value.map((character) => character.path))
  return selectedEnterPaths.value.filter((path) => enterable.has(path))
})

watch(
  [pendingCharacters, enteringCharacterPaths],
  () => {
    const pending = new Set(pendingCharacters.value.map((character) => character.path))
    selectedEnterPaths.value = selectedEnterPaths.value.filter((path) => pending.has(path) && !enteringCharacterPaths.value.has(path))
  },
  { deep: true },
)

const playHint = computed(() => {
  if (!controlledCharacters.value.length) return '先创建角色。角色卡生成后，它只是候选角色；需要让某个角色进入灰区并完成合同，才会加入同步游戏。'
  if (!activeCharacters.value.length) return '选择一个角色进入灰区，AI DM 会以该角色为主体处理合同开局。签约后才可以提交同步行动。'
  if (seatStatus.value === 'locked') return 'AI DM 正在处理当前场景。等待 DM 回复和角色状态写回。'
  if (seatStatus.value === 'submitted') {
    if (readiness.value && !readiness.value.allReady) {
      return `已就绪。等待同场景其他玩家就绪：${readiness.value.notReadySeats.map(s => s.seatName).join('、')}`
    }
    return '已就绪。等待 AI DM 处理...'
  }
  if (intentModified.value) return '意图已修改，请重新点击"就绪"提交。'
  return `当前是${currentPhase.value}。勾选本轮参与角色，给每个角色写一句核心意图；没勾选的人会待命。`
})

function draftFromCharacterActions() {
  const source = selectedActionCharacters.value.length ? selectedActionCharacters.value : activeCharacters.value
  const actions = source.map((character) => characterActions[character.path]).filter(Boolean)
  if (!actions.length) return { ...intent }
  const format = (key: 'publicAction' | 'privateToDm' | 'longTerm' | 'triggers') => actions
    .map((action) => {
      const text = action[key]?.trim()
      return text ? `【${action.characterName}】\n${text}` : ''
    })
    .filter(Boolean)
    .join('\n\n')
  return {
    public: format('publicAction') || intent.public,
    privateToDm: format('privateToDm') || intent.privateToDm,
    longTerm: format('longTerm') || intent.longTerm,
    triggers: format('triggers') || intent.triggers,
  }
}

function save(status?: 'idle' | 'ready' | 'submitted') {
  intentModified.value = false
  if (status === 'submitted') {
    readinessMessage.value = null
  }
  emit('saveIntent', draftFromCharacterActions(), status)
}

function submitActions() {
  const actions = selectedActionCharacters.value.map((character) => characterActions[character.path]).filter(Boolean)
  if (!actions.length) return
  intentModified.value = false
  emit('submitCharacterActions', actions.map((action) => ({ ...action })))
}

function applyQuickAction(text: string) {
  const targets = selectedActionCharacters.value.length ? selectedActionCharacters.value : activeCharacters.value
  for (const character of targets) {
    const action = characterActions[character.path]
    if (!action) continue
    action.publicAction = action.publicAction?.trim()
      ? `${action.publicAction.trim()}\n${text}`
      : text
  }
}

function enterCharacters(characterPaths: string[]) {
  const paths = characterPaths.filter((path) => !enteringCharacterPaths.value.has(path))
  if (!paths.length) return
  selectedEnterPaths.value = selectedEnterPaths.value.filter((path) => !paths.includes(path))
  emit('enterGreyZone', paths)
}

function enterCharacter(characterPath: string) {
  enterCharacters([characterPath])
}

function enterSelectedCharacters() {
  enterCharacters(selectedEnterablePaths.value)
}

function charactersForSortGroup(group: 'mine' | 'others') {
  return group === 'mine' ? controlledCharacters.value : otherCharacters.value
}

function isCharacterEnabled(character: CharacterSummary, group: 'mine' | 'others') {
  if (group === 'mine') return selectedActionPaths.value.includes(character.path)
  return character.inGame || character.lifecycle === 'active'
}

function dragHandleTone(character: CharacterSummary, group: 'mine' | 'others') {
  if (group === 'mine') {
    return isCharacterEnabled(character, group)
      ? 'bg-crimson-700'
      : 'bg-paper-400'
  }
  if (character.inGame || character.lifecycle === 'active') {
    return enteringCharacterPaths.value.has(character.path) ? 'bg-ochre-500' : 'bg-forest-600'
  }
  return enteringCharacterPaths.value.has(character.path) ? 'bg-ochre-500' : 'bg-paper-500'
}

function dragHandleTitle(character: CharacterSummary, group: 'mine' | 'others') {
  if (group === 'mine') {
    return isCharacterEnabled(character, group)
      ? '已启用，按住可拖动排序'
      : '未启用，按住可拖动排序'
  }
  if (enteringCharacterPaths.value.has(character.path)) return '该角色正在进入灰区，按住可拖动排序'
  return character.inGame || character.lifecycle === 'active'
    ? '已入局，按住可拖动排序'
    : '待入局，按住可拖动排序'
}

function moveCharacter(group: 'mine' | 'others', fromPath: string, toPath: string) {
  if (fromPath === toPath) return
  const groupPaths = charactersForSortGroup(group).map((character) => character.path)
  const fromIndex = groupPaths.indexOf(fromPath)
  const toIndex = groupPaths.indexOf(toPath)
  if (fromIndex < 0 || toIndex < 0) return
  const nextGroupPaths = [...groupPaths]
  const [moved] = nextGroupPaths.splice(fromIndex, 1)
  nextGroupPaths.splice(toIndex, 0, moved)
  const groupSet = new Set(groupPaths)
  const outsideGroup = characterOrder.value.filter((path) => !groupSet.has(path))
  characterOrder.value = [...outsideGroup, ...nextGroupPaths]
}

function startCharacterDrag(group: 'mine' | 'others', path: string) {
  draggedCharacter.value = { group, path }
  dragOverPath.value = path
}

function finishCharacterDrag() {
  draggedCharacter.value = null
  dragOverPath.value = null
}

function dropCharacter(group: 'mine' | 'others', targetPath: string) {
  const dragged = draggedCharacter.value
  if (!dragged || dragged.group !== group) {
    finishCharacterDrag()
    return
  }
  moveCharacter(group, dragged.path, targetPath)
  finishCharacterDrag()
}

function submitForge() {
  emit('runForge', { ...forge })
}

function submitCompanion() {
  const anchor = companionAnchor.value
  const concept = companionConcept.value.trim()
  if (!anchor || !concept) return
  emit('runAiCompanion', {
    anchorCharacterPath: anchor.path,
    purpose: companionPurpose.value,
    concept,
    boundaries: companionBoundaries.value.trim() || undefined,
  })
  companionConcept.value = ''
  companionBoundaries.value = ''
  companionOpen.value = false
}

async function submitAssistant() {
  const q = assistantQuestion.value.trim()
  if (!q) return
  assistantBusy.value = true
  assistantError.value = null
  try {
    const charSummary = controlledCharacters.value
      .map((c) => `${c.name} (${c.location}, Lv.${c.stats.level || '?'}, 血${c.stats.blood?.total || '?'})`)
      .join('\n') || undefined
    await askAssistant(props.session, q, charSummary)
    assistantQuestion.value = ''
    assistantReply.value = null
  } catch (err: any) {
    assistantError.value = err?.message || String(err)
  } finally {
    assistantBusy.value = false
  }
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
              {{ phaseTitle }}
            </div>
            <div class="mt-2 max-w-3xl text-sm leading-7 text-paper-800">{{ playHint }}</div>
            <div v-if="activeCharacters.length" class="mt-4 flex flex-wrap gap-2">
              <span
                v-for="phase in PHASES"
                :key="phase"
                class="rounded-sm border px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.12em]"
                :class="phase === currentPhase ? 'border-crimson-700 bg-crimson-600 text-white' : 'border-paper-300 bg-white text-paper-700'"
              >
                {{ phase }}
              </span>
            </div>
            <div v-if="activeCharacters.length" class="mt-2 text-xs leading-6 text-paper-700">
              {{ phaseHints[currentPhase] }} 已选 {{ selectedActionCharacters.length }} 人；
              <span v-if="standbyCharacters.length">待命：{{ standbyCharacters.map((character) => character.name).join('、') }}</span>
              <span v-else>没有待命角色。</span>
              <span v-if="automaticCompanions.length"> 自动协同：{{ automaticCompanions.map((character) => character.name).join('、') }}。</span>
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              @click="companionOpen = !companionOpen"
              :disabled="!activeCharacters.length"
              class="rounded-sm border border-navy-800 bg-navy-800 px-5 py-3 text-center font-mono text-[13px] font-bold tracking-[0.12em] text-white hover:bg-navy-900 disabled:opacity-40"
            >
              {{ companionOpen ? '收起协同DM' : '申请协同DM角色' }}
            </button>
            <button
              @click="forgeOpen = !forgeOpen"
              class="rounded-sm border border-crimson-700 bg-crimson-600 px-5 py-3 text-center font-mono text-[13px] font-bold tracking-[0.12em] text-white hover:bg-crimson-700"
            >
              {{ forgeOpen ? '收起创建角色' : '创建角色' }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="round?.resultContent || snapshot.latestResultContent || latestNarrativeResult" class="clash-card overflow-hidden">
        <div class="clash-card-header px-4 py-3">
          <div class="font-mono text-[10px] font-bold tracking-[0.18em]">DM 文学化回复</div>
          <div class="mt-1 text-sm text-white/80">
            {{ round?.kind === 'forge' ? '欢迎场景' : '行动处理结果' }}
            <span v-if="round?.resultMarker" class="ml-2 font-mono text-[10px] opacity-60">{{ round.resultMarker.type || 'done' }}</span>
            <span v-else class="ml-2">共 {{ narrativeEntries.length }} 条结果</span>
          </div>
        </div>
        <div class="grid gap-4 p-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <div v-if="narrativeEntries.length > 1" class="space-y-2">
            <button
              v-for="(entry, idx) in narrativeEntries"
              :key="`${entry.id}-${idx}`"
              @click="selectedResultIndex = idx"
              class="group w-full rounded-sm border p-3 text-left transition"
              :class="selectedResultIndex === idx ? 'border-navy-700 bg-navy-50 shadow-[0_8px_18px_rgba(15,23,42,0.08)]' : 'border-paper-300 bg-white hover:border-paper-500 hover:bg-paper-50'"
              :title="entry.title"
            >
              <div class="flex items-start gap-3">
                <div
                  class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[2px] border font-mono text-[10px] font-bold tracking-[0.12em]"
                  :class="selectedResultIndex === idx ? 'border-navy-700 bg-navy-700 text-white' : 'border-paper-300 bg-paper-100 text-paper-600'"
                >
                  {{ String(idx + 1).padStart(2, '0') }}
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center justify-between gap-2">
                    <div class="truncate font-serif text-sm font-bold text-paper-950">
                      {{ entry.title }}
                    </div>
                    <span class="shrink-0 rounded-sm border border-paper-300 bg-paper-100 px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-[0.12em] text-paper-600">
                      #{{ idx + 1 }}
                    </span>
                  </div>
                  <div class="mt-1 truncate text-[11px] leading-5 text-paper-600">
                    {{ new Date(entry.updatedAt).toLocaleString('zh-CN', { hour12: false }) }}
                  </div>
                  <div class="mt-1 truncate text-xs leading-5 text-paper-700">
                    {{ entry.excerpt || '暂无摘要' }}
                  </div>
                </div>
              </div>
            </button>
          </div>
          <div class="min-w-0 rounded-sm border border-paper-300 bg-white p-4 shadow-[0_8px_18px_rgba(12,10,9,0.04)]">
            <template v-if="selectedHistoryContent">
              <div class="mb-3 flex flex-wrap items-center gap-2 border-b border-paper-200 pb-3">
                <span
                  class="rounded-sm border px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.12em]"
                  :class="selectedResultIndex === 0 ? 'border-crimson-700 bg-crimson-600 text-white' : 'border-paper-300 bg-paper-100 text-paper-600'"
                >
                  {{ selectedResultIndex === 0 ? '当前' : `#${selectedResultIndex + 1}` }}
                </span>
                <span class="min-w-0 truncate font-serif text-base font-bold text-paper-950">
                  {{ selectedHistoryContent.title }}
                </span>
                <span class="font-mono text-[10px] text-paper-500">
                  {{ new Date(selectedHistoryContent.updatedAt).toLocaleString('zh-CN', { hour12: false }) }}
                </span>
                <button
                  v-if="selectedHistoryContent.path"
                  @click="emit('openFile', selectedHistoryContent.path)"
                  class="ml-auto rounded-sm border border-paper-300 bg-white px-2 py-0.5 font-mono text-[10px] text-paper-800 hover:border-navy-700 hover:text-navy-800"
                >
                  打开文件
                </button>
              </div>
              <RenderedMarkdown :content="selectedHistoryContent.content" compact max-height="38rem" />
            </template>
          </div>
        </div>
        <div v-if="nextActionOptions.length || confirmedChanges" class="border-t border-paper-300 grid gap-3 p-4 lg:grid-cols-2">
          <div v-if="confirmedChanges && selectedResultIndex === 0" class="rounded-sm border border-paper-300 bg-paper-100 p-3">
            <div class="font-mono text-[10px] font-bold tracking-[0.16em] text-paper-600">已确认变化</div>
            <div class="mt-2 max-h-44 overflow-auto text-sm leading-6 text-paper-850">
              <RenderedMarkdown :content="confirmedChanges" compact />
            </div>
          </div>
          <div v-if="nextActionOptions.length" class="rounded-sm border border-paper-300 bg-white p-3" :class="!confirmedChanges || selectedResultIndex !== 0 ? 'lg:col-span-2' : ''">
            <div class="font-mono text-[10px] font-bold tracking-[0.16em] text-paper-600">下一步建议</div>
            <div class="mt-2 space-y-2">
              <button
                v-for="option in nextActionOptions"
                :key="option"
                @click="applyQuickAction(option)"
                class="w-full rounded-sm border border-navy-700 bg-navy-50 px-3 py-2 text-left text-sm leading-6 text-navy-900 hover:bg-navy-100"
              >
                {{ option }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <details class="clash-card overflow-hidden">
        <summary class="cursor-pointer px-4 py-3 font-mono text-[10px] font-bold tracking-[0.18em] text-paper-800">
          后台处理状态（调试）
        </summary>
        <div class="space-y-2 border-t border-paper-300 p-4">
          <article
            v-for="run in agentStatusRuns"
            :key="run.id"
            class="rounded-sm border p-3"
            :class="agentTone(run.status, run.stale)"
          >
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="font-serif text-base font-bold text-paper-950">{{ run.title }}</div>
                <div class="mt-1 font-mono text-[10px] tracking-[0.14em] text-paper-700">
                  {{ run.agentName }} · {{ agentKindLabel(run.kind) }} · {{ run.currentStep }}
                </div>
              </div>
              <div class="shrink-0 text-right font-mono text-[10px] leading-5">
                <div>{{ run.stale ? '可能卡住' : run.status }}</div>
                <div>{{ elapsedFor(run) }}</div>
              </div>
            </div>
            <div class="mt-2 text-xs leading-5 text-paper-700">
              参与角色：{{ run.participantCharacters.map((character) => character.name).join('、') || '未绑定角色' }}
              <span class="mx-1">·</span>
              最后事件：{{ run.lastEventAt ? new Date(run.lastEventAt).toLocaleTimeString('zh-CN', { hour12: false }) : '暂无' }}
            </div>
            <div v-if="run.error" class="mt-2 rounded-sm border border-crimson-200 bg-crimson-50 px-2 py-1 text-xs text-crimson-700">{{ run.error }}</div>
          </article>
          <div v-if="!agentStatusRuns.length" class="text-sm leading-7 text-paper-800">
            当前没有与你相关的 Agent 任务。
          </div>
        </div>
      </details>

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
          <div class="font-mono text-[10px] font-bold tracking-[0.18em]">场景状态 · 行动同步</div>
          <div class="mt-1 text-sm text-white/80" v-if="readiness">
            场景 {{ readiness.sceneId }} · {{ readiness.readySeats.length }}/{{ readiness.totalSeats }} 就绪
            <span v-if="readiness.allReady" class="ml-1 font-bold text-green-200">✓ 可触发</span>
            <span v-else class="ml-1 text-ochre-200">等待中</span>
          </div>
        </div>
        <div class="space-y-2 p-4">
          <article v-for="entry in sceneIntents" :key="entry.seatName" class="rounded-sm border p-3"
            :class="entry.status === 'submitted' ? 'border-navy-400 bg-navy-50' : entry.status === 'ready' ? 'border-forest-300 bg-forest-50' : 'border-paper-300 bg-paper-100'">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="font-serif text-base font-bold text-paper-950">{{ entry.seatName }}</div>
              <span class="stamp" :class="statusColor[entry.status] || 'text-paper-700'">
                {{ statusText[entry.status] || entry.status }}
              </span>
            </div>
            <div class="mt-1 font-mono text-[10px] tracking-[0.14em] text-paper-700">
              {{ entry.characterNames.join('、') || '未绑定角色' }} · {{ entry.location }}
            </div>
            <div class="mt-2 whitespace-pre-wrap text-sm leading-6 text-paper-800">
              {{ entry.publicText || '尚未写公开行动。' }}
            </div>
          </article>
          <div v-if="!sceneIntents.length && activeCharacters.length" class="text-sm text-paper-600 px-1">
            等待其他玩家加入此场景...
          </div>
        </div>
      </div>

      <div class="clash-card overflow-hidden">
        <div class="clash-card-header px-4 py-3">
          <div class="font-mono text-[10px] font-bold tracking-[0.18em]">行动控制</div>
          <div class="mt-1 text-sm text-white/80">已选 {{ selectedActionCharacters.length }} 人参与本轮 · {{ standbyCharacters.length }} 人待命</div>
        </div>
        <div class="space-y-3 p-4">
          <div v-if="!activeCharacters.length" class="rounded-sm border border-dashed border-paper-400 bg-paper-100 p-4 text-sm leading-7 text-paper-800">
            还没有已入局角色。先创建角色，然后让该角色进入灰区完成合同；签约后 WebUI 才会开放同步行动卡。
          </div>
          <div v-if="intentModified && seatStatus === 'submitted'" class="rounded-sm border border-ochre-300 bg-ochre-50 px-3 py-2 text-sm text-ochre-800">
            意图已修改。请先保存草稿，然后重新点击"就绪"。
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button @click="save()" :disabled="busy" class="rounded-sm border border-paper-300 bg-white px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800 disabled:opacity-40">保存草稿</button>
            <button @click="save('ready')" :disabled="busy" class="rounded-sm border border-forest-600 bg-forest-600 px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.12em] text-white disabled:opacity-40">公开草稿</button>
            <button @click="submitActions" :disabled="busy || !hasSelectedActions" class="rounded-sm border border-navy-800 bg-navy-800 px-4 py-2 font-mono text-[11px] font-bold tracking-[0.12em] text-white disabled:opacity-40">
              提交选中角色行动（{{ selectedActionCharacters.length }}）
            </button>
            <span class="font-mono text-[10px] tracking-[0.18em]" :class="statusColor[seatStatus] || 'text-paper-800'">
              {{ statusText[seatStatus] || seatStatus }}
            </span>
          </div>
          <div v-if="activeCharacters.length" class="rounded-sm border border-paper-300 bg-paper-100 px-3 py-2 text-xs leading-6 text-paper-800">
            <span class="font-mono font-bold tracking-[0.12em] text-paper-600">本轮：</span>
            真人角色 {{ selectedActionCharacters.map((character) => character.name).join('、') || '未选择' }}；
            待命 {{ standbyCharacters.map((character) => character.name).join('、') || '无' }}；
            自动协同 {{ automaticCompanions.map((character) => character.name).join('、') || '无' }}
          </div>

          <div class="border-t border-paper-300 pt-3">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div class="font-mono text-[10px] font-bold tracking-[0.18em] text-paper-700">我的角色</div>
                <div class="mt-1 text-xs leading-5 text-paper-600">拖动排序后会自动记住，下次打开保持一致。</div>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <button
                  v-if="pendingCharacters.length > 1"
                  @click="enterSelectedCharacters"
                  :disabled="busy || !selectedEnterablePaths.length"
                  class="rounded-sm border border-navy-800 bg-navy-800 px-3 py-2 text-center font-mono text-[11px] font-bold tracking-[0.12em] text-white hover:bg-navy-900 disabled:opacity-40"
                >
                  批量进入灰区（{{ selectedEnterablePaths.length }}）
                </button>
                <span class="stamp text-paper-800">{{ controlledCharacters.length }} 个可控角色</span>
              </div>
            </div>

            <div v-if="controlledCharacters.length" class="mt-3 space-y-3">
              <article
                v-for="character in controlledCharacters"
                :key="character.path"
                class="rounded-sm border border-paper-300 bg-paper-100 p-3 transition"
                :class="dragOverPath === character.path ? 'border-crimson-600 bg-crimson-50' : ''"
                @dragover.prevent="dragOverPath = character.path"
                @dragleave="dragOverPath = null"
                @drop.prevent="dropCharacter('mine', character.path)"
              >
                <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                  <div class="flex min-w-0 items-start gap-2">
                    <button
                      type="button"
                      draggable="true"
                      class="h-12 w-3 shrink-0 cursor-grab rounded-[1px] active:cursor-grabbing"
                      :class="dragHandleTone(character, 'mine')"
                      :title="dragHandleTitle(character, 'mine')"
                      :aria-label="dragHandleTitle(character, 'mine')"
                      @dragstart="startCharacterDrag('mine', character.path)"
                      @dragend="finishCharacterDrag"
                    >
                      <span class="sr-only">拖动排序</span>
                    </button>
                    <div class="min-w-0">
                      <div class="font-serif text-base font-bold text-paper-950">{{ character.name }}</div>
                      <div class="mt-1 font-mono text-[10px] tracking-[0.12em] text-paper-700">
                        {{ character.location }} · {{ character.sceneId }} · {{ character.partyId }}
                      </div>
                      <div v-if="isAiCompanion(character)" class="mt-2 flex flex-wrap gap-1.5">
                        <span class="stamp text-navy-800">协同DM</span>
                        <span v-if="character.aiHosted" class="stamp text-navy-800">AI托管</span>
                        <span v-if="character.temporary" class="stamp text-ochre-700">临时角色</span>
                        <span v-if="companionRoleLabel(character.aiRole)" class="stamp text-paper-800">{{ companionRoleLabel(character.aiRole) }}</span>
                      </div>
                    </div>
                  </div>
                  <div class="flex flex-wrap items-center gap-2 lg:justify-end">
                    <template v-if="character.inGame || character.lifecycle === 'active'">
                      <label class="inline-flex items-center gap-2 rounded-sm border border-paper-300 bg-white px-3 py-2 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800">
                        <input v-model="selectedActionPaths" :value="character.path" type="checkbox" class="accent-crimson-600" />
                        {{ selectedActionPaths.includes(character.path) ? '本轮参与' : '本轮待命' }}
                      </label>
                      <label v-if="characterActions[character.path]" class="inline-flex items-center gap-2 rounded-sm border border-paper-300 bg-white px-3 py-2 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800">
                        <input v-model="characterActions[character.path].aiHosted" type="checkbox" class="accent-navy-800" />
                        AI 托管
                      </label>
                      <span class="stamp text-forest-700">已入局</span>
                    </template>
                    <template v-else>
                      <label
                        class="inline-flex items-center gap-2 rounded-sm border border-paper-300 bg-white px-3 py-2 font-mono text-[11px] font-bold tracking-[0.12em] text-paper-800"
                        :class="enteringCharacterPaths.has(character.path) ? 'opacity-40' : ''"
                      >
                        <input
                          v-model="selectedEnterPaths"
                          :value="character.path"
                          :disabled="busy || enteringCharacterPaths.has(character.path)"
                          type="checkbox"
                          class="accent-navy-800"
                        />
                        加入批量
                      </label>
                      <button
                        @click="enterCharacter(character.path)"
                        :disabled="busy || enteringCharacterPaths.has(character.path)"
                        class="rounded-sm border border-navy-800 bg-navy-800 px-3 py-2 text-center font-mono text-[11px] font-bold tracking-[0.12em] text-white hover:bg-navy-900 disabled:opacity-40"
                      >
                        {{ enteringCharacterPaths.has(character.path) ? '合同处理中...' : '该角色进入灰区' }}
                      </button>
                    </template>
                    <button
                      @click="emit('openFile', character.path)"
                      class="rounded-sm border border-paper-300 bg-white px-3 py-2 text-center font-mono text-[11px] font-bold tracking-[0.12em] text-paper-900 hover:border-crimson-600 hover:text-crimson-700"
                    >
                      打开档案
                    </button>
                    <button
                      @click="charExpanded[character.path] = !charExpanded[character.path]"
                      class="rounded-sm border border-paper-300 bg-white px-3 py-2 text-center font-mono text-[11px] font-bold tracking-[0.12em] text-paper-900 hover:border-crimson-600 hover:text-crimson-700"
                    >
                      {{ charExpanded[character.path] ? '收起' : '展开详情' }}
                    </button>
                  </div>
                </div>

                <div v-if="charExpanded[character.path]" class="mt-4 space-y-4">
                  <section class="rounded-sm border border-paper-300 bg-white p-3">
                    <div class="flex items-center justify-between gap-3">
                      <div class="font-mono text-[10px] font-bold tracking-[0.18em] text-paper-600">状态信息</div>
                      <button
                        type="button"
                        @click="charStatusOpen[character.path] = !charStatusOpen[character.path]"
                        class="rounded-sm border border-paper-300 bg-paper-100 px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800 hover:border-navy-700 hover:text-navy-800"
                      >
                        {{ charStatusOpen[character.path] ? '收起' : '展开' }}
                      </button>
                    </div>
                    <div v-if="charStatusOpen[character.path]" class="mt-3 space-y-4">
                      <div v-if="character.currentSituation" class="rounded-sm border border-paper-300 bg-paper-50 p-3 text-sm leading-6 text-paper-800">
                        {{ character.currentSituation }}
                      </div>

                      <div>
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

                      <div class="grid gap-3 lg:grid-cols-3">
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
                    </div>
                  </section>

                  <section v-if="characterActions[character.path] && (character.inGame || character.lifecycle === 'active')" class="rounded-sm border border-paper-300 bg-white p-3">
                    <div class="flex items-center justify-between gap-3">
                      <div class="font-mono text-[10px] font-bold tracking-[0.18em] text-paper-600">行动输入</div>
                      <button
                        type="button"
                        @click="charActionOpen[character.path] = !charActionOpen[character.path]"
                        class="rounded-sm border border-paper-300 bg-paper-100 px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800 hover:border-navy-700 hover:text-navy-800"
                      >
                        {{ charActionOpen[character.path] ? '收起' : '展开' }}
                      </button>
                    </div>
                    <div v-if="charActionOpen[character.path]" class="mt-3 space-y-3">
                      <label class="space-y-1">
                        <div class="font-mono text-[10px] tracking-[0.18em] text-paper-500">核心意图（一句话即可，同场景可见）</div>
                        <textarea
                          v-model="characterActions[character.path].publicAction"
                          rows="3"
                          class="clash-textarea w-full resize-y px-3 py-2 text-sm leading-6"
                          :disabled="!selectedActionPaths.includes(character.path)"
                          placeholder="例：侦察前方道路 / 掩护队友撤离 / 搜索房间。也可以写复杂行动。"
                        />
                      </label>
                      <div class="grid gap-3">
                        <label class="space-y-1">
                          <div class="font-mono text-[10px] tracking-[0.18em] text-paper-500">私密意图给 AI DM</div>
                          <textarea v-model="characterActions[character.path].privateToDm" rows="3" class="clash-textarea w-full resize-y px-3 py-2 text-sm leading-6" :disabled="!selectedActionPaths.includes(character.path)" placeholder="只给 AI DM 的真实目的、试探、隐瞒或底线。" />
                        </label>
                        <div class="grid gap-3 md:grid-cols-2">
                          <textarea v-model="characterActions[character.path].longTerm" rows="2" class="clash-textarea w-full resize-y px-3 py-2 text-sm leading-6" :disabled="!selectedActionPaths.includes(character.path)" placeholder="长期目标，例如：找到妹妹的线索。" />
                          <textarea v-model="characterActions[character.path].triggers" rows="2" class="clash-textarea w-full resize-y px-3 py-2 text-sm leading-6" :disabled="!selectedActionPaths.includes(character.path)" placeholder="触发条件，例如：如果职员回避安全箱问题就追问。" />
                        </div>
                      </div>
                    </div>
                  </section>
                </div>
              </article>
            </div>

            <div v-else class="mt-3 rounded-sm border border-dashed border-paper-400 bg-paper-100 p-4 text-sm leading-7 text-paper-800">
              创建角色后，这里会显示你的角色详情和行动输入。
            </div>
          </div>

          <div class="border-t border-paper-300 pt-3">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div class="font-mono text-[10px] font-bold tracking-[0.18em] text-paper-700">其它角色</div>
                <div class="mt-1 text-xs leading-5 text-paper-600">只显示当前席位可见的角色信息，排序同样会保留。</div>
              </div>
              <span class="stamp text-paper-800">{{ otherCharacters.length }} 个可见角色</span>
            </div>

            <div v-if="otherCharacters.length" class="mt-3 space-y-3">
              <article
                v-for="character in otherCharacters"
                :key="character.path"
                class="rounded-sm border border-paper-300 bg-white p-3 transition"
                :class="dragOverPath === character.path ? 'border-crimson-600 bg-crimson-50' : ''"
                @dragover.prevent="dragOverPath = character.path"
                @dragleave="dragOverPath = null"
                @drop.prevent="dropCharacter('others', character.path)"
              >
                <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                  <div class="flex min-w-0 items-start gap-2">
                    <button
                      type="button"
                      draggable="true"
                      class="h-12 w-3 shrink-0 cursor-grab rounded-[1px] active:cursor-grabbing"
                      :class="dragHandleTone(character, 'others')"
                      :title="dragHandleTitle(character, 'others')"
                      :aria-label="dragHandleTitle(character, 'others')"
                      @dragstart="startCharacterDrag('others', character.path)"
                      @dragend="finishCharacterDrag"
                    >
                      <span class="sr-only">拖动排序</span>
                    </button>
                    <div class="min-w-0">
                      <div class="font-serif text-base font-bold text-paper-950">{{ character.name }}</div>
                      <div class="mt-1 font-mono text-[10px] tracking-[0.12em] text-paper-700">
                        {{ character.controller || '未绑定席位' }} · {{ character.location }} · {{ character.sceneId }}
                      </div>
                      <div v-if="isAiCompanion(character)" class="mt-2 flex flex-wrap gap-1.5">
                        <span class="stamp text-navy-800">协同DM</span>
                        <span v-if="character.aiHosted" class="stamp text-navy-800">AI托管</span>
                        <span v-if="character.temporary" class="stamp text-ochre-700">临时角色</span>
                        <span v-if="companionRoleLabel(character.aiRole)" class="stamp text-paper-800">{{ companionRoleLabel(character.aiRole) }}</span>
                      </div>
                    </div>
                  </div>
                  <div class="flex flex-wrap items-center gap-2 lg:justify-end">
                    <span class="stamp" :class="character.inGame || character.lifecycle === 'active' ? 'text-forest-700' : 'text-paper-700'">
                      {{ character.inGame || character.lifecycle === 'active' ? '已入局' : '待入局' }}
                    </span>
                    <button
                      @click="emit('openFile', character.path)"
                      class="rounded-sm border border-paper-300 bg-white px-3 py-2 text-center font-mono text-[11px] font-bold tracking-[0.12em] text-paper-900 hover:border-crimson-600 hover:text-crimson-700"
                    >
                      打开档案
                    </button>
                    <button
                      @click="charExpanded[character.path] = !charExpanded[character.path]"
                      class="rounded-sm border border-paper-300 bg-white px-3 py-2 text-center font-mono text-[11px] font-bold tracking-[0.12em] text-paper-900 hover:border-crimson-600 hover:text-crimson-700"
                    >
                      {{ charExpanded[character.path] ? '收起' : '展开详情' }}
                    </button>
                  </div>
                </div>

                <div v-if="charExpanded[character.path]" class="mt-4 grid gap-3">
                  <section class="rounded-sm border border-paper-300 bg-paper-100 p-3">
                    <div class="flex items-center justify-between gap-3">
                      <div class="font-mono text-[10px] font-bold tracking-[0.18em] text-paper-600">状态信息</div>
                      <button
                        type="button"
                        @click="charStatusOpen[character.path] = !charStatusOpen[character.path]"
                        class="rounded-sm border border-paper-300 bg-white px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800 hover:border-navy-700 hover:text-navy-800"
                      >
                        {{ charStatusOpen[character.path] ? '收起' : '展开' }}
                      </button>
                    </div>
                    <div v-if="charStatusOpen[character.path]" class="mt-3 grid gap-3 md:grid-cols-2">
                      <div v-if="character.currentSituation || character.concept" class="rounded-sm border border-paper-300 bg-white p-3 text-sm leading-6 text-paper-800">
                        {{ character.currentSituation || character.concept }}
                      </div>
                      <div class="rounded-sm border border-paper-300 bg-white p-3">
                        <div class="font-mono text-[10px] tracking-[0.16em] text-paper-600">状态</div>
                        <div class="mt-2 text-sm leading-6 text-paper-800">{{ bloodLabel(character) }}</div>
                        <div v-if="character.semanticStatus.length" class="mt-2 space-y-1 text-sm leading-6 text-paper-800">
                          <div v-for="entry in character.semanticStatus" :key="entry" class="truncate">- {{ entry }}</div>
                        </div>
                      </div>
                      <div class="rounded-sm border border-paper-300 bg-white p-3 md:col-span-2">
                        <div class="font-mono text-[10px] tracking-[0.16em] text-paper-600">公开物品</div>
                        <div v-if="character.inventory.length" class="mt-2 flex flex-wrap gap-2">
                          <span v-for="item in character.inventory" :key="item" class="stamp text-paper-800">{{ item }}</span>
                        </div>
                        <div v-else class="mt-2 text-sm text-paper-700">暂无可见物品。</div>
                      </div>
                    </div>
                  </section>
                </div>
              </article>
            </div>

            <div v-else class="mt-3 rounded-sm border border-dashed border-paper-400 bg-paper-100 p-4 text-sm leading-7 text-paper-800">
              当前没有其它可见角色。
            </div>
          </div>
        </div>
      </div>

      <div v-if="round" class="hud-frame">
        <span class="corner-bl"></span><span class="corner-br"></span>
        <div class="brief-heading !mb-3 !text-sm">AI 处理状态</div>
        <div class="space-y-2 text-sm leading-6 text-paper-800">
          <div>类型：{{ round.kind === 'forge' ? '欢迎场景' : '行动处理' }}</div>
          <div>状态：{{ statusText[round.status] || round.status }}</div>
          <div>席位：{{ round.participantSeats.join(', ') || '无' }}</div>
        </div>
      </div>

      <div v-if="companionOpen" class="clash-card overflow-hidden">
        <div class="clash-card-header px-4 py-3" style="background: #1f4f64;">
          <div class="font-mono text-[10px] font-bold tracking-[0.18em]">申请协同DM角色</div>
          <div class="mt-1 text-sm text-white/80">生成后由协同DM席位自动托管，加入当前场景。</div>
        </div>
        <div class="space-y-3 p-4">
          <label class="block space-y-1">
            <div class="font-mono text-[10px] tracking-[0.18em] text-paper-600">锚定角色</div>
            <select v-model="companionAnchorPath" class="clash-input w-full px-3 py-2 text-sm" :disabled="!companionAnchorCandidates.length">
              <option v-for="character in companionAnchorCandidates" :key="character.path" :value="character.path">
                {{ character.name }} · {{ character.location }}
              </option>
            </select>
          </label>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="option in companionPurposeOptions"
              :key="option.value"
              type="button"
              @click="companionPurpose = option.value"
              class="rounded-sm border px-3 py-2 font-mono text-[10px] font-bold tracking-[0.12em]"
              :class="companionPurpose === option.value ? 'border-navy-800 bg-navy-800 text-white' : 'border-paper-300 bg-white text-paper-800 hover:border-navy-700'"
            >
              {{ option.label }}
            </button>
          </div>
          <textarea
            v-model="companionConcept"
            rows="3"
            class="clash-textarea w-full resize-y px-3 py-2 text-sm leading-6"
            placeholder="一句话写你需要的临时伙伴，例如：一个懂黑市规矩、会帮忙圆场的向导。"
          />
          <textarea
            v-model="companionBoundaries"
            rows="2"
            class="clash-textarea w-full resize-y px-3 py-2 text-sm leading-6"
            placeholder="可选边界：不要替玩家做主线决定 / 不参与火力压制 / 只提供线索。"
          />
          <button
            @click="submitCompanion"
            :disabled="busy || !companionAnchor || !companionConcept.trim()"
            class="w-full rounded-sm border border-navy-800 bg-navy-800 px-4 py-3 font-mono text-[11px] font-bold tracking-[0.16em] text-white disabled:opacity-40"
          >
            提交协同DM申请
          </button>
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

      <div class="clash-card overflow-hidden">
        <div class="clash-card-header px-4 py-3" style="background: #2d5a27;">
          <div class="font-mono text-[10px] font-bold tracking-[0.18em]">规则助手</div>
          <div class="mt-1 text-sm text-white/80">可以在这里问灰区规则、机制或世界设定问题。这不会影响游戏叙事。</div>
        </div>
        <div class="space-y-3 p-4">
          <textarea
            v-model="assistantQuestion"
            rows="2"
            class="clash-textarea w-full resize-y px-3 py-2 text-sm leading-6"
            placeholder="例如：灰区血槽规则是什么？行动经济怎么算？"
            :disabled="assistantBusy"
            @keydown.ctrl.enter="submitAssistant"
          />
          <div class="flex items-center gap-2">
            <button
              @click="submitAssistant"
              :disabled="assistantBusy || !assistantQuestion.trim()"
              class="rounded-sm border border-navy-800 bg-navy-800 px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.12em] text-white disabled:opacity-40"
            >
              {{ assistantBusy ? '询问中...' : '提交问题' }}
            </button>
            <span class="font-mono text-[10px] text-paper-500">Ctrl+Enter 快速提交</span>
          </div>
          <div v-if="assistantError" class="rounded-sm border border-crimson-200 bg-crimson-50 px-3 py-2 text-sm text-crimson-700">
            {{ assistantError }}
          </div>
          <div v-if="assistantReply" class="rounded-sm border border-paper-300 bg-paper-100 p-3">
            <RenderedMarkdown :content="assistantReply" compact max-height="28rem" />
          </div>
          <div v-else-if="latestAssistantResult" class="rounded-sm border border-paper-300 bg-paper-100 p-3">
            <div class="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-paper-300 pb-2">
              <div class="font-mono text-[10px] font-bold tracking-[0.14em] text-paper-700">
                最新规则助手回复 · {{ new Date(latestAssistantResult.updatedAt).toLocaleString('zh-CN', { hour12: false }) }}
              </div>
              <button
                @click="emit('openFile', latestAssistantResult.path)"
                class="rounded-sm border border-paper-300 bg-white px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800"
              >
                解析结果
              </button>
            </div>
            <RenderedMarkdown :content="latestAssistantResult.content" compact max-height="28rem" />
          </div>
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
