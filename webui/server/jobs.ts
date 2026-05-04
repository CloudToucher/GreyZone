import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import yaml from 'js-yaml'
import { emitSnapshotRefresh } from './runtime'
import {
  ensureTableState,
  finalizeSeatsAfterRound,
  loadSeats,
  loadControl,
  loadIntentForSeat,
  markRoomIdle,
  markRoomRunning,
  readAllCharacterSummaries,
  reconcileTableFromCharacters,
  type CharacterSummary,
  type ViewerSession,
} from './core'

export type AgentJobKind = 'contract_onboarding' | 'action' | 'forge' | 'assistant'
export type AgentJobStatus = 'waiting' | 'running' | 'validating' | 'done' | 'error'
export type AgentJobPhase = 'queued' | 'preparing' | 'agent-running' | 'parsing' | 'post-processing' | 'finished'

export interface CharacterAction {
  characterPath: string
  characterName: string
  playerSeat: string | null
  publicAction: string
  privateToDm: string
  longTerm: string
  triggers: string
  aiHosted: boolean
}

export interface AgentJobManifest {
  id: string
  kind: AgentJobKind
  title: string
  status: AgentJobStatus
  phase: AgentJobPhase
  worldWrite: boolean
  createdAt: string
  updatedAt: string
  startedAt: string | null
  endedAt: string | null
  createdBy: string
  participantSeats: string[]
  participantCharacters: Array<{ name: string; path: string; controller: string | null; sceneId: string; partyId: string }>
  artifacts: Record<string, string>
  error: string | null
  model: string
  exitCode: number | null
  parserWarnings: string[]
}

export interface ParsedInfoBlock {
  id: string
  tags: string[]
  visibility: 'public' | 'scene' | 'self' | 'party' | 'dm' | 'audit'
  targets: string[]
  content: string
  warnings: string[]
}

export interface ParsedResult {
  jobId: string
  warnings: string[]
  blocks: ParsedInfoBlock[]
}

export interface AgentArtifactStat {
  name: string
  path: string
  exists: boolean
  size: number
  updatedAt: string | null
}

export interface AgentRunSummary {
  id: string
  agentName: string
  kind: AgentJobKind
  title: string
  status: AgentJobStatus | 'stale'
  rawStatus: AgentJobStatus
  phase: AgentJobPhase
  currentStep: string
  createdAt: string
  startedAt: string | null
  endedAt: string | null
  elapsedMs: number | null
  durationMs: number | null
  lastEventAt: string | null
  stale: boolean
  rawReady: boolean
  participantSeats: string[]
  participantCharacters: AgentJobManifest['participantCharacters']
  artifacts: Record<string, string>
  artifactStats: AgentArtifactStat[]
  error: string | null
  warnings: string[]
}

const JOBS_DIR = 'table/jobs'
const DEFAULT_MODEL = process.env.GZ_OPENCODE_MODEL || 'deepseek/deepseek-v4-pro'
const STALE_AFTER_MS = Number(process.env.GZ_AGENT_STALE_AFTER_MS || 120000)
const RAW_STABLE_AFTER_MS = Number(process.env.GZ_AGENT_RAW_STABLE_AFTER_MS || 8000)
const HARD_TIMEOUT_MS = Number(process.env.GZ_AGENT_HARD_TIMEOUT_MS || 600000)
const DEFAULT_XDG_DIRNAME = '.opencode-runtime'
const USE_INHERITED_STDIO = process.platform === 'win32' && process.env.GZ_OPENCODE_PIPE_STDIO !== '1'
const DEFAULT_WINDOWS_OPENCODE_EXE = path.join(
  os.homedir(),
  'AppData',
  'Roaming',
  'npm',
  'node_modules',
  'opencode-ai',
  'node_modules',
  'opencode-windows-x64',
  'bin',
  'opencode.exe',
)

let worldJobRunning = false
let pumpScheduled = false

function nowIso() {
  return new Date().toISOString()
}

function relPath(...parts: string[]) {
  return parts.join('/').replace(/\\/g, '/')
}

function abs(root: string, rel: string) {
  return path.resolve(root, rel)
}

function artifactPath(jobId: string, file: string) {
  return relPath(JOBS_DIR, jobId, file)
}

function jobDir(root: string, jobId: string) {
  return abs(root, relPath(JOBS_DIR, jobId))
}

function manifestPath(root: string, jobId: string) {
  return path.join(jobDir(root, jobId), 'manifest.yaml')
}

function buildOpencodeEnv(workspaceRoot: string) {
  return {
    ...process.env,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || path.join(workspaceRoot, DEFAULT_XDG_DIRNAME),
  }
}

async function resolveOpencodeCommand() {
  if (process.env.GZ_OPENCODE_BIN?.trim()) return { command: process.env.GZ_OPENCODE_BIN.trim(), shell: false }
  if (process.platform === 'win32') {
    try {
      await fs.access(DEFAULT_WINDOWS_OPENCODE_EXE)
      return { command: DEFAULT_WINDOWS_OPENCODE_EXE, shell: false }
    } catch {
      /* fall through */
    }
  }
  return { command: 'opencode', shell: process.platform === 'win32' }
}

function buildRunArgs(workspaceRoot: string, title: string, prompt: string) {
  const args = ['run', '-m', DEFAULT_MODEL]
  if (process.env.GZ_OPENCODE_THINKING !== '0') args.push('--thinking')
  args.push('--dir', workspaceRoot, '--title', title, prompt)
  return args
}

async function readManifest(root: string, jobId: string): Promise<AgentJobManifest | null> {
  try {
    return yaml.load(await fs.readFile(manifestPath(root, jobId), 'utf8')) as AgentJobManifest
  } catch {
    return null
  }
}

async function writeManifest(root: string, manifest: AgentJobManifest) {
  manifest.updatedAt = nowIso()
  await fs.mkdir(jobDir(root, manifest.id), { recursive: true })
  await fs.writeFile(manifestPath(root, manifest.id), yaml.dump(manifest, { lineWidth: 120, noRefs: true, sortKeys: false }), 'utf8')
  emitSnapshotRefresh(`agent-${manifest.status}`)
}

async function appendEvent(root: string, jobId: string, event: Record<string, unknown>) {
  await fs.appendFile(abs(root, artifactPath(jobId, 'events.ndjson')), `${JSON.stringify({ ts: nowIso(), ...event })}\n`, 'utf8')
  emitSnapshotRefresh('agent-event')
}

async function appendArtifact(root: string, jobId: string, name: 'stdout.log' | 'stderr.log', text: string) {
  if (!text) return
  await fs.appendFile(abs(root, artifactPath(jobId, name)), text, 'utf8')
}

function rawLooksComplete(raw: string) {
  const trimmed = raw.trim()
  if (!/(^|\n):::gz\s+/m.test(trimmed)) return false
  return /(^|\n):::\s*$/m.test(trimmed) || trimmed.endsWith(':::')
}

function normalizeTaggedRaw(raw: string) {
  return raw.replace(/([^\s]):::\s*$/gm, '$1\n:::')
}

function summarizeJobTitle(kind: AgentJobKind, viewer: ViewerSession) {
  const label: Record<AgentJobKind, string> = {
    contract_onboarding: '进入灰区 / 合同开局',
    action: 'AI DM 行动回合',
    forge: 'AI 创建角色',
    assistant: '规则助手',
  }
  return `${label[kind]} | ${viewer.seatName} | ${new Date().toLocaleString('zh-CN', { hour12: false })}`
}

function characterLine(character: CharacterSummary) {
  return [
    `### ${character.name}`,
    `- path: ${character.path}`,
    `- controller: ${character.controller || '(none)'}`,
    `- location: ${character.location}`,
    `- sceneId: ${character.sceneId}`,
    `- partyId: ${character.partyId}`,
    `- visibilityScope: ${character.visibilityScope}`,
    `- status: ${character.semanticStatus.join('；') || '(empty)'}`,
    `- inventory: ${character.inventory.join('；') || '(empty)'}`,
    '',
    character.currentSituation || '(no current situation extracted)',
    '',
  ].join('\n')
}

function tagProtocol(resultPath: string) {
  return [
    '## 返回标签协议（必须使用）',
    `你必须把完整原始返回写入 \`${resultPath}\`。WebUI 会保存 raw，再解析标签。`,
    '每个玩家可见或 DM-only 信息块使用以下围栏格式：',
    '```text',
    ':::gz public type:dm-reply',
    '这里写所有玩家可见内容。',
    ':::',
    '',
    ':::gz scene:<sceneId> type:scene',
    '这里写同场景角色可见内容。',
    ':::',
    '',
    ':::gz self:<角色名或角色路径> type:private',
    '这里写只有该角色控制者可见内容。',
    ':::',
    '',
    ':::gz party:<partyId> type:team',
    '这里写同队/可通信队伍可见内容。',
    ':::',
    '',
    ':::gz dm-only type:notes',
    '这里写 DM 内部钩子、暗骰、隐藏真相或审计说明。',
    ':::',
    '```',
    '可以添加自定义 type 标签，但可见性标签必须至少包含 public、scene:*、self:*、party:*、dm-only、audit 之一。',
    '不要把 DM-only 信息放进 public/scene/self/party 块。',
  ].join('\n')
}

function createEnterPacket(args: {
  viewer: ViewerSession
  sharedBoard: string
  characters: CharacterSummary[]
  resultPath: string
}) {
  const characterPaths = args.characters.map((character) => character.path)
  const characterNames = args.characters.map((character) => character.name)
  return [
    '# Agent Job Packet: contract_onboarding',
    '',
    'WebUI 是外层工具层；你是唯一 AI DM 主体。WebUI 不裁决剧情，只把席位、目标角色和当前公开局面整理给你。',
    '',
    `- player_seat: ${args.viewer.seatName}`,
    `- character_paths: ${characterPaths.join(', ')}`,
    `- character_names: ${characterNames.join(', ')}`,
    `- batch_count: ${args.characters.length}`,
    `- result_raw_path: ${args.resultPath}`,
    '',
    '## 玩家/角色区分',
    '- Player/Seat 是输入者与权限主体。',
    '- Character 是世界内行动主体。',
    '- 进入灰区是角色进入，不是玩家席位进入。',
    '- 本 job 是一次批量合同开局：同时处理上方所有角色，不要把他们拆成多个独立合同 job 或多个重复欢迎场景。',
    '- 创角只生成角色档案；合同开局从本 job 才开始。',
    '',
    '## 合同开局要求',
    '- 未签约或未正式进入灰区的角色，必须从铁壁安保公司围栏镇据点签发的《回收者入职文件包》/合同场景开局；多名角色应在同一合同中心流程中同时签约。',
    '- 合同完成后，必须逐一回写每张角色卡 frontmatter：contractStatus: signed, inGame: true, lifecycle: active。',
    '- 合同条款必须包含：70/30 分成、安全箱 2 格、灰币限围栏镇、签名即正式回收者。',
    '- 如果某个角色已经签约，不要让该角色重复签合同；只把未签约角色纳入本次签约，并交代已签约角色如何接入当前局面。',
    '- 输出可以包含公共合同大厅场景，也可以给每个角色单独的下一步行动建议；需要私密信息时使用 self:<角色名或路径> 标签。',
    '',
    '## 当前共享看板',
    args.sharedBoard || '(empty)',
    '',
    '## 本次进入灰区的角色（同一批次）',
    ...args.characters.flatMap(characterLine),
    '',
    tagProtocol(args.resultPath),
  ].join('\n')
}

function createActionPacket(args: {
  viewer: ViewerSession
  sharedBoard: string
  allCharacters: CharacterSummary[]
  actions: CharacterAction[]
  resultPath: string
}) {
  const sceneIds = new Set(args.actions.map((action) => args.allCharacters.find((c) => c.path === action.characterPath)?.sceneId).filter(Boolean))
  const involved = args.allCharacters.filter((character) => sceneIds.has(character.sceneId) || args.actions.some((action) => action.characterPath === character.path))
  return [
    '# Agent Job Packet: action',
    '',
    'WebUI 只负责整理角色行动卡；你是 AI DM，负责裁决、叙事、信息分层、状态写回和标签。',
    '',
    `- triggered_by_player: ${args.viewer.seatName}`,
    `- result_raw_path: ${args.resultPath}`,
    '',
    '## 当前共享看板',
    args.sharedBoard || '(empty)',
    '',
    '## 本轮角色行动卡',
    ...args.actions.flatMap((action) => [
      `### ${action.characterName}`,
      `- characterPath: ${action.characterPath}`,
      `- playerSeat: ${action.playerSeat || '(none)'}`,
      `- aiHosted: ${action.aiHosted ? 'true' : 'false'}`,
      '',
      '#### 公开行动',
      action.publicAction || '(empty)',
      '',
      '#### 私密意图',
      action.privateToDm || '(empty)',
      '',
      '#### 长期目标',
      action.longTerm || '(empty)',
      '',
      '#### 触发条件',
      action.triggers || '(empty)',
      '',
    ]),
    '',
    '## 同步场景内相关角色（按需读取完整角色卡）',
    ...involved.map(characterLine),
    '',
    '## 必须遵守',
    '- 按 sceneId / partyId / 通信关系组织协同，不要把玩家身份直接当作角色行动主体。',
    '- 需要写回状态时，更新对应角色卡 frontmatter 和正文当前处境。',
    '- 只把公开确认事实写入 table/shared_board.md。',
    '- 私密意图、隐藏真相、暗骰和 DM 备注只能进入 dm-only/audit 标签块。',
    '',
    tagProtocol(args.resultPath),
  ].join('\n')
}

function createForgePacket(args: {
  viewer: ViewerSession
  forge: Record<string, unknown>
  outputPath: string
  resultPath: string
}) {
  const value = (key: string) => typeof args.forge[key] === 'string' ? String(args.forge[key]).trim() : ''
  return [
    '# Agent Job Packet: forge',
    '',
    '你是 AI DM。WebUI 只收集玩家概念；你负责生成可运行角色档案。',
    '',
    `- player_seat: ${args.viewer.seatName}`,
    `- character_output_path: ${args.outputPath}`,
    `- result_raw_path: ${args.resultPath}`,
    '',
    '## 必须写入角色卡',
    `使用 Write 工具写入 \`${args.outputPath}\`。frontmatter 必须包含 name, controller, level, xp, blood, energy, attributes, location, sceneId, partyId, visibilityScope。`,
    `controller 必须是 ${args.viewer.seatName}。控制权关系由 WebUI 维护，你只负责角色档案内容。`,
    '创角不是进入游戏。新角色 frontmatter 必须包含 contractStatus: pending, inGame: false, lifecycle: pending_contract。',
    '',
    '## 玩家输入',
    `- name: ${value('name') || '(not provided)'}`,
    `- concept: ${value('concept') || '(not provided)'}`,
    `- identity: ${value('identity') || '(not provided)'}`,
    `- motivation: ${value('motivation') || '(not provided)'}`,
    `- strength: ${value('strength') || '标准开局'}`,
    `- storyTone: ${value('storyTone') || '(not provided)'}`,
    `- signatureWish: ${value('signatureWish') || '(not provided)'}`,
    `- weaknesses: ${value('weaknesses') || '(not provided)'}`,
    `- boundaries: ${value('boundaries') || '(not provided)'}`,
    `- extraNotes: ${value('extraNotes') || '(not provided)'}`,
    '',
    '## 先读',
    '- dm_guide/启动注入_AI_DM.md',
    '- characters/templates/角色卡模板.md',
    '- characters/templates/角色生成指南.md',
    '- table/shared_board.md',
    '',
    tagProtocol(args.resultPath),
  ].join('\n')
}

function createAssistantPacket(args: {
  viewer: ViewerSession
  question: string
  charSummary?: string
  resultPath: string
}) {
  return [
    '# Agent Job Packet: assistant',
    '',
    '你是只读规则/资料助手，不是 AI DM。不得推进剧情，不得写角色卡、共享看板或 DM 状态。',
    '',
    `- player_seat: ${args.viewer.seatName}`,
    `- result_raw_path: ${args.resultPath}`,
    '',
    '## 玩家问题',
    args.question,
    '',
    args.charSummary ? `## 角色上下文\n${args.charSummary}` : '',
    '',
    '按需读取 rules/ 或公开资料，回答必须简洁，并用 public 或 self 标签返回；内部检索说明用 audit 标签。',
    '',
    tagProtocol(args.resultPath),
  ].join('\n')
}

function parseTagAttrs(raw: string) {
  return raw.split(/\s+/).map((tag) => tag.trim()).filter(Boolean)
}

function normalizeBlock(jobId: string, index: number, rawTags: string[], content: string): ParsedInfoBlock {
  const tags = rawTags.map((tag) => tag.trim()).filter(Boolean)
  const warnings: string[] = []
  const targets: string[] = []
  let visibility: ParsedInfoBlock['visibility'] | null = null

  for (const tag of tags) {
    if (tag === 'public') visibility ||= 'public'
    else if (tag === 'dm-only' || tag === 'dm') visibility = 'dm'
    else if (tag === 'audit') visibility = visibility === 'dm' ? 'dm' : 'audit'
    else if (tag.startsWith('scene:')) {
      visibility ||= 'scene'
      targets.push(tag.slice('scene:'.length))
    } else if (tag.startsWith('self:') || tag.startsWith('character:') || tag.startsWith('seat:')) {
      visibility ||= 'self'
      targets.push(tag.replace(/^(self|character|seat):/, ''))
    } else if (tag.startsWith('party:')) {
      visibility ||= 'party'
      targets.push(tag.slice('party:'.length))
    } else if (!tag.startsWith('type:')) {
      warnings.push(`未识别标签：${tag}`)
    }
  }

  if (!visibility) {
    visibility = 'dm'
    warnings.push('缺少可见性标签，已降级为 DM-only。')
  }
  if ((visibility === 'scene' || visibility === 'self' || visibility === 'party') && targets.length === 0) {
    visibility = 'dm'
    warnings.push('目标型可见性缺少目标，已降级为 DM-only。')
  }

  return {
    id: `${jobId}:${index}`,
    tags,
    visibility,
    targets,
    content: content.trim(),
    warnings,
  }
}

export function parseTaggedResult(jobId: string, raw: string): ParsedResult {
  const blocks: ParsedInfoBlock[] = []
  const warnings: string[] = []
  const normalizedRaw = normalizeTaggedRaw(raw)
  const re = /^:::gz\s+([^\n]*)\n([\s\S]*?)^:::\s*$/gm
  let match: RegExpExecArray | null
  let index = 0
  while ((match = re.exec(normalizedRaw))) {
    blocks.push(normalizeBlock(jobId, index++, parseTagAttrs(match[1]), match[2]))
  }
  if (!blocks.length && raw.trim()) {
    warnings.push('AI DM 返回没有可解析的 :::gz 标签块，完整内容仅 AI 监控台可见。')
    blocks.push(normalizeBlock(jobId, 0, ['dm-only', 'type:untagged'], raw))
  }
  for (const block of blocks) warnings.push(...block.warnings.map((warning) => `${block.id}: ${warning}`))
  return { jobId, warnings, blocks }
}

export function visibleBlocksForViewer(parsed: ParsedResult | null, viewer: ViewerSession, characters: CharacterSummary[]) {
  if (!parsed) return []
  if (viewer.role === 'dm' || viewer.dmEnabled) return parsed.blocks
  const controlled = characters.filter((character) => character.controller === viewer.seatName)
  const selfTargets = new Set([
    viewer.seatName,
    ...controlled.map((character) => character.name),
    ...controlled.map((character) => character.path),
  ])
  const scenes = new Set(controlled.map((character) => character.sceneId))
  const parties = new Set(controlled.map((character) => character.partyId))
  return parsed.blocks.filter((block) => {
    if (block.visibility === 'public') return true
    if (block.visibility === 'scene') return block.targets.some((target) => scenes.has(target))
    if (block.visibility === 'party') return block.targets.some((target) => parties.has(target))
    if (block.visibility === 'self') return block.targets.some((target) => selfTargets.has(target))
    return false
  })
}

async function readSharedBoardText(root: string) {
  return fs.readFile(abs(root, 'table/shared_board.md'), 'utf8').catch(() => '')
}

function splitMarkdownFrontmatter(text: string): { frontmatter: Record<string, unknown>; body: string } {
  if (!text.startsWith('---')) return { frontmatter: {}, body: text }
  const end = text.indexOf('\n---', 3)
  if (end === -1) return { frontmatter: {}, body: text }
  const raw = text.slice(3, end).trim()
  const body = text.slice(end + 4).replace(/^\r?\n/, '')
  const frontmatter = yaml.load(raw)
  return { frontmatter: frontmatter && typeof frontmatter === 'object' ? frontmatter as Record<string, unknown> : {}, body }
}

async function finalizeContractCharacters(root: string, characters: AgentJobManifest['participantCharacters']) {
  for (const character of characters) {
    const characterPath = abs(root, character.path)
    const raw = await fs.readFile(characterPath, 'utf8').catch(() => null)
    if (raw == null) continue
    const { frontmatter, body } = splitMarkdownFrontmatter(raw)
    const next = {
      ...frontmatter,
      contractStatus: 'signed',
      inGame: true,
      lifecycle: 'active',
    }
    await fs.writeFile(characterPath, `---\n${yaml.dump(next, { lineWidth: 120, noRefs: true, sortKeys: false })}---\n\n${body}`, 'utf8')
  }
  await reconcileTableFromCharacters(root)
}

async function createManifest(args: {
  root: string
  viewer: ViewerSession
  kind: AgentJobKind
  title?: string
  worldWrite: boolean
  participantCharacters: AgentJobManifest['participantCharacters']
  participantSeats: string[]
}) {
  const id = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const artifacts = {
    manifest: artifactPath(id, 'manifest.yaml'),
    packet: artifactPath(id, 'packet.md'),
    prompt: artifactPath(id, 'prompt.md'),
    rawResult: artifactPath(id, 'result.raw.md'),
    parsedResult: artifactPath(id, 'result.parsed.json'),
    stdout: artifactPath(id, 'stdout.log'),
    stderr: artifactPath(id, 'stderr.log'),
    events: artifactPath(id, 'events.ndjson'),
  }
  const manifest: AgentJobManifest = {
    id,
    kind: args.kind,
    title: args.title || summarizeJobTitle(args.kind, args.viewer),
    status: 'waiting',
    phase: 'queued',
    worldWrite: args.worldWrite,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    startedAt: null,
    endedAt: null,
    createdBy: args.viewer.seatName,
    participantSeats: Array.from(new Set(args.participantSeats)),
    participantCharacters: args.participantCharacters,
    artifacts,
    error: null,
    model: DEFAULT_MODEL,
    exitCode: null,
    parserWarnings: [],
  }
  await writeManifest(args.root, manifest)
  await Promise.all(['stdout.log', 'stderr.log', 'events.ndjson', 'result.raw.md', 'result.parsed.json'].map((file) => fs.writeFile(abs(args.root, artifactPath(id, file)), '', 'utf8')))
  return manifest
}

async function writePacketAndPrompt(root: string, manifest: AgentJobManifest, packet: string) {
  const resultPath = manifest.artifacts.rawResult
  const prompt = [
    packet,
    '',
    '## 文件输出硬要求',
    `你必须使用 Write 工具将完整结果写入 \`${resultPath}\`。`,
    '如果你需要修改角色卡、共享看板或 DM 备忘，请直接写对应文件；WebUI 不替你裁决或代写。',
  ].join('\n')
  await fs.writeFile(abs(root, manifest.artifacts.packet), packet, 'utf8')
  await fs.writeFile(abs(root, manifest.artifacts.prompt), prompt, 'utf8')
  return prompt
}

async function controlledCharacters(root: string, viewer: ViewerSession) {
  const control = await loadControl(root)
  const characters = await readAllCharacterSummaries(root)
  const canUseMonitor = viewer.role === 'dm' || viewer.dmEnabled
  return canUseMonitor
    ? characters
    : characters.filter((character) => control.bindings.some((binding) => binding.characterPath === character.path && binding.primarySeat === viewer.seatName))
}

function participantChars(characters: CharacterSummary[]) {
  return characters.map((character) => ({
    name: character.name,
    path: character.path,
    controller: character.controller,
    sceneId: character.sceneId,
    partyId: character.partyId,
  }))
}

function isCharacterInGame(character: CharacterSummary) {
  return character.inGame || character.lifecycle === 'active' || /^(signed|active|joined|已签约|入局)$/i.test(character.contractStatus)
}

export async function enqueueEnterJob(root: string, viewer: ViewerSession, characterPath: string) {
  const [manifest] = await enqueueEnterJobs(root, viewer, [characterPath])
  return manifest
}

export async function enqueueEnterJobs(root: string, viewer: ViewerSession, characterPaths: string[]) {
  await ensureTableState(root)
  const characters = await controlledCharacters(root, viewer)
  const uniquePaths = Array.from(new Set(characterPaths.map((entry) => entry.trim()).filter(Boolean)))
  if (!uniquePaths.length) throw new Error('At least one characterPath is required')
  const selected = uniquePaths.map((characterPath) => {
    const character = characters.find((entry) => entry.path === characterPath)
    if (!character) throw new Error(`Character is not controlled by this player: ${characterPath}`)
    return character
  })
  const sharedBoard = await readSharedBoardText(root)
  const participantSeats = Array.from(new Set(selected.map((character) => character.controller || viewer.seatName).filter(Boolean)))
  const manifest = await createManifest({
    root,
    viewer,
    kind: 'contract_onboarding',
    title: selected.length > 1
      ? `${selected.length} 人批量进入灰区 / 合同开局 | ${viewer.seatName} | ${new Date().toLocaleString('zh-CN', { hour12: false })}`
      : undefined,
    worldWrite: true,
    participantSeats,
    participantCharacters: participantChars(selected),
  })
  const packet = createEnterPacket({
    viewer,
    sharedBoard,
    characters: selected,
    resultPath: manifest.artifacts.rawResult,
  })
  await writePacketAndPrompt(root, manifest, packet)
  schedulePump(root)
  return [manifest]
}

export async function enqueueForgeJob(root: string, viewer: ViewerSession, forge: Record<string, unknown>) {
  await ensureTableState(root)
  const rawName = typeof forge.name === 'string' && forge.name.trim() ? forge.name.trim() : viewer.seatName
  const fileStem = rawName.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 64) || 'new_character'
  const outputPath = `characters/active/${fileStem}.md`
  const manifest = await createManifest({
    root,
    viewer,
    kind: 'forge',
    worldWrite: true,
    participantSeats: [viewer.seatName],
    participantCharacters: [],
  })
  const packet = createForgePacket({ viewer, forge, outputPath, resultPath: manifest.artifacts.rawResult })
  await writePacketAndPrompt(root, manifest, packet)
  schedulePump(root)
  return manifest
}

export async function enqueueAssistantJob(root: string, viewer: ViewerSession, question: string, charSummary?: string) {
  await ensureTableState(root)
  const manifest = await createManifest({
    root,
    viewer,
    kind: 'assistant',
    worldWrite: false,
    participantSeats: [viewer.seatName],
    participantCharacters: [],
  })
  const packet = createAssistantPacket({ viewer, question, charSummary, resultPath: manifest.artifacts.rawResult })
  await writePacketAndPrompt(root, manifest, packet)
  schedulePump(root)
  return manifest
}

export async function enqueueActionJob(root: string, viewer: ViewerSession, actions?: CharacterAction[]) {
  await ensureTableState(root)
  const characters = await readAllCharacterSummaries(root)
  const control = await loadControl(root)
  const seats = await loadSeats(root)
  const owned = await controlledCharacters(root, viewer)
  const activeOwned = owned.filter(isCharacterInGame)
  const fallbackIntent = await loadIntentForSeat(root, viewer.seatName).catch(() => null)
  const requestedActions = actions?.length ? actions : activeOwned.map((character) => ({
    characterPath: character.path,
    characterName: character.name,
    playerSeat: viewer.seatName,
    publicAction: fallbackIntent?.sections.public || '',
    privateToDm: fallbackIntent?.sections.privateToDm || '',
    longTerm: fallbackIntent?.sections.longTerm || '',
    triggers: fallbackIntent?.sections.triggers || '',
    aiHosted: false,
  }))
  const activeOwnedPaths = new Set(activeOwned.map((character) => character.path))
  const ownedActions = requestedActions.filter((action) => activeOwnedPaths.has(action.characterPath))
  if (!ownedActions.length) throw new Error('No signed/in-game character actions to process. Use Enter Grey Zone on a character first.')
  const actionSceneIds = new Set(
    ownedActions
      .map((action) => characters.find((character) => character.path === action.characterPath)?.sceneId)
      .filter((sceneId): sceneId is string => Boolean(sceneId)),
  )
  const sceneMateActions: CharacterAction[] = []
  const seenActionPaths = new Set(ownedActions.map((action) => action.characterPath))
  const activeSceneMates = characters.filter((character) =>
    isCharacterInGame(character) && actionSceneIds.has(character.sceneId) && !seenActionPaths.has(character.path),
  )
  for (const character of activeSceneMates) {
    const binding = control.bindings.find((entry) => entry.characterPath === character.path)
    const seatName = binding?.primarySeat || character.controller
    if (!seatName || seatName === viewer.seatName) continue
    const seat = seats.seats.find((entry) => entry.name === seatName)
    const intent = await loadIntentForSeat(root, seatName).catch(() => null)
    if (!intent) continue
    const hasDraft = [intent.sections.public, intent.sections.privateToDm, intent.sections.longTerm, intent.sections.triggers]
      .some((section) => section.trim().length > 0)
    if (!(seat?.status === 'ready' || seat?.status === 'submitted' || hasDraft)) continue
    sceneMateActions.push({
      characterPath: character.path,
      characterName: character.name,
      playerSeat: seatName,
      publicAction: intent.sections.public,
      privateToDm: intent.sections.privateToDm,
      longTerm: intent.sections.longTerm,
      triggers: intent.sections.triggers,
      aiHosted: false,
    })
    seenActionPaths.add(character.path)
  }
  const finalActions = [...ownedActions, ...sceneMateActions]
  const participant = finalActions
    .map((action) => characters.find((character) => character.path === action.characterPath))
    .filter((character): character is CharacterSummary => Boolean(character))
  const manifest = await createManifest({
    root,
    viewer,
    kind: 'action',
    worldWrite: true,
    participantSeats: Array.from(new Set(finalActions.map((action) => action.playerSeat || viewer.seatName))),
    participantCharacters: participantChars(participant),
  })
  const packet = createActionPacket({
    viewer,
    sharedBoard: await readSharedBoardText(root),
    allCharacters: characters,
    actions: finalActions,
    resultPath: manifest.artifacts.rawResult,
  })
  await writePacketAndPrompt(root, manifest, packet)
  schedulePump(root)
  return manifest
}

async function waitingJobs(root: string) {
  const dir = abs(root, JOBS_DIR)
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  const jobs = (await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => readManifest(root, entry.name))))
    .filter((job): job is AgentJobManifest => Boolean(job))
  return jobs.filter((job) => job.status === 'waiting').sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

function schedulePump(root: string) {
  if (pumpScheduled) return
  pumpScheduled = true
  setTimeout(() => {
    pumpScheduled = false
    void pumpJobs(root)
  }, 10)
}

async function pumpJobs(root: string) {
  const jobs = await waitingJobs(root)
  for (const job of jobs) {
    if (job.worldWrite) {
      if (worldJobRunning) continue
      worldJobRunning = true
      void runJob(root, job).finally(() => {
        worldJobRunning = false
        schedulePump(root)
      })
      continue
    }
    void runJob(root, job).finally(() => schedulePump(root))
  }
}

async function runJob(root: string, manifest: AgentJobManifest) {
  const prompt = await fs.readFile(abs(root, manifest.artifacts.prompt), 'utf8')
  manifest.status = 'running'
  manifest.phase = 'agent-running'
  manifest.startedAt = nowIso()
  await writeManifest(root, manifest)
  await appendEvent(root, manifest.id, { type: 'start', status: manifest.status, phase: manifest.phase })
  if (manifest.worldWrite) await markRoomRunning(root, manifest.id)

  const launch = await resolveOpencodeCommand()
  const runArgs = buildRunArgs(root, manifest.title, prompt)
  const env = buildOpencodeEnv(root)

  await appendArtifact(root, manifest.id, 'stdout.log', USE_INHERITED_STDIO ? 'stdout/stderr inherited by opencode process on Windows; authoritative result is result.raw.md.\n' : '')

  await new Promise<void>((resolve) => {
    let settled = false
    let lastRawSize = -1
    let lastRawChangeAt = Date.now()
    let rawWatchTimer: ReturnType<typeof setInterval> | null = null
    let hardTimer: ReturnType<typeof setTimeout> | null = null
    const settleFromRaw = async (code: number | null, forcedError?: string) => {
      if (settled) return
      const raw = await fs.readFile(abs(root, manifest.artifacts.rawResult), 'utf8').catch(() => '')
      if (!forcedError && !rawLooksComplete(raw)) return
      settled = true
      if (rawWatchTimer) clearInterval(rawWatchTimer)
      if (hardTimer) clearTimeout(hardTimer)
      try { proc.kill('SIGTERM') } catch { /* ignore */ }
      await finishJobFromRaw(root, manifest, code, forcedError)
      resolve()
    }
    const proc = spawn(launch.command, runArgs, {
      cwd: root,
      windowsHide: true,
      env,
      shell: launch.shell,
      stdio: USE_INHERITED_STDIO ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    if (proc.stdout) {
      proc.stdout.setEncoding('utf8')
      proc.stdout.on('data', (chunk: string) => {
        stdout += chunk
        void appendArtifact(root, manifest.id, 'stdout.log', chunk)
        void appendEvent(root, manifest.id, { type: 'stdout', bytes: Buffer.byteLength(chunk) })
      })
    }
    if (proc.stderr) {
      proc.stderr.setEncoding('utf8')
      proc.stderr.on('data', (chunk: string) => {
        stderr += chunk
        void appendArtifact(root, manifest.id, 'stderr.log', chunk)
        void appendEvent(root, manifest.id, { type: 'stderr', bytes: Buffer.byteLength(chunk) })
      })
    }
    proc.on('error', async (error) => {
      if (settled) return
      settled = true
      if (rawWatchTimer) clearInterval(rawWatchTimer)
      if (hardTimer) clearTimeout(hardTimer)
      manifest.status = 'error'
      manifest.phase = 'finished'
      manifest.error = error.message
      manifest.endedAt = nowIso()
      await appendArtifact(root, manifest.id, 'stderr.log', `${error.message}\n`)
      await appendEvent(root, manifest.id, { type: 'error', error: error.message })
      resolve()
    })
    proc.on('close', async (code) => {
      if (settled) return
      settled = true
      if (rawWatchTimer) clearInterval(rawWatchTimer)
      if (hardTimer) clearTimeout(hardTimer)
      let raw = await fs.readFile(abs(root, manifest.artifacts.rawResult), 'utf8').catch(() => '')
      let noOutputError: string | undefined
      if (!raw.trim()) {
        noOutputError = 'Agent finished without writing result.raw.md. Check prompt.md, stdout.log and stderr.log.'
        const fallback = [
          ':::gz dm-only type:no-output',
          noOutputError,
          stdout ? `\nStdout:\n${stdout}` : '',
          stderr ? `\nStderr:\n${stderr}` : '',
          ':::',
        ].join('\n')
        await fs.writeFile(abs(root, manifest.artifacts.rawResult), fallback, 'utf8')
        raw = fallback
      }
      const outputComplete = rawLooksComplete(raw)
      await finishJobFromRaw(
        root,
        manifest,
        noOutputError ? (code ?? 1) : (outputComplete ? 0 : code),
        noOutputError || (outputComplete || code === 0 ? undefined : (stderr || `opencode exited with code ${code}`)),
      )
      resolve()
    })
    rawWatchTimer = setInterval(async () => {
      const stat = await fs.stat(abs(root, manifest.artifacts.rawResult)).catch(() => null)
      if (!stat || stat.size <= 0) return
      if (stat.size !== lastRawSize) {
        lastRawSize = stat.size
        lastRawChangeAt = Date.now()
        await appendEvent(root, manifest.id, { type: 'raw-write', bytes: stat.size })
        return
      }
      if (Date.now() - lastRawChangeAt >= RAW_STABLE_AFTER_MS) {
        await settleFromRaw(0)
      }
    }, 2000)
    hardTimer = setTimeout(async () => {
      await appendEvent(root, manifest.id, { type: 'timeout', timeoutMs: HARD_TIMEOUT_MS })
      await settleFromRaw(null, `Agent timed out after ${Math.round(HARD_TIMEOUT_MS / 1000)}s`)
    }, HARD_TIMEOUT_MS)
  })
}

async function finishJobFromRaw(root: string, manifest: AgentJobManifest, code: number | null, error?: string) {
  manifest.exitCode = code
  let raw = await fs.readFile(abs(root, manifest.artifacts.rawResult), 'utf8').catch(() => '')
  if (!raw.trim()) {
    raw = [
      ':::gz dm-only type:no-output',
      error || 'Agent ended without writing result.raw.md.',
      ':::',
    ].join('\n')
    await fs.writeFile(abs(root, manifest.artifacts.rawResult), raw, 'utf8')
  }
  manifest.phase = 'parsing'
  manifest.status = 'validating'
  await writeManifest(root, manifest)
  const parsed = parseTaggedResult(manifest.id, raw)
  manifest.parserWarnings = parsed.warnings
  await fs.writeFile(abs(root, manifest.artifacts.parsedResult), JSON.stringify(parsed, null, 2), 'utf8')
  manifest.status = error ? 'error' : 'done'
  manifest.error = error || null
  manifest.phase = 'post-processing'
  await writeManifest(root, manifest)
  if (!error && manifest.kind === 'forge') await reconcileTableFromCharacters(root)
  if (!error && manifest.kind === 'contract_onboarding') await finalizeContractCharacters(root, manifest.participantCharacters)
  if (!error && manifest.kind === 'action') await finalizeSeatsAfterRound(root, manifest.participantSeats)
  if (manifest.worldWrite) await markRoomIdle(root)
  manifest.phase = 'finished'
  manifest.endedAt = nowIso()
  await writeManifest(root, manifest)
  await appendEvent(root, manifest.id, { type: 'end', code, status: manifest.status, repaired: false })
}

export async function listJobs(root: string, limit = 50) {
  await reconcileStuckJobs(root)
  await fs.mkdir(abs(root, JOBS_DIR), { recursive: true })
  const entries = await fs.readdir(abs(root, JOBS_DIR), { withFileTypes: true }).catch(() => [])
  const jobs = (await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => readManifest(root, entry.name))))
    .filter((job): job is AgentJobManifest => Boolean(job))
  return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
}

export async function reconcileStuckJobs(root: string) {
  await fs.mkdir(abs(root, JOBS_DIR), { recursive: true })
  const entries = await fs.readdir(abs(root, JOBS_DIR), { withFileTypes: true }).catch(() => [])
  const jobs = (await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => readManifest(root, entry.name))))
    .filter((job): job is AgentJobManifest => Boolean(job))
  let releasedWorldLock = false
  for (const job of jobs) {
    if (!(job.status === 'running' || job.status === 'validating' || job.status === 'waiting' || job.status === 'error')) continue
    const raw = await fs.readFile(abs(root, job.artifacts.rawResult), 'utf8').catch(() => '')
    if (!raw.trim() || !rawLooksComplete(raw)) continue
    const parsed = parseTaggedResult(job.id, raw)
    await fs.writeFile(abs(root, job.artifacts.parsedResult), JSON.stringify(parsed, null, 2), 'utf8')
    job.parserWarnings = parsed.warnings
    job.status = 'done'
    job.phase = 'finished'
    job.error = null
    job.exitCode = 0
    job.startedAt = job.startedAt || job.createdAt
    job.endedAt = job.endedAt || nowIso()
    await writeManifest(root, job)
    await appendEvent(root, job.id, { type: 'reconcile', status: 'done', reason: 'raw-result-present' })
    if (job.kind === 'forge') await reconcileTableFromCharacters(root)
    if (job.kind === 'contract_onboarding') await finalizeContractCharacters(root, job.participantCharacters)
    if (job.kind === 'action') await finalizeSeatsAfterRound(root, job.participantSeats)
    if (job.worldWrite) releasedWorldLock = true
  }
  if (releasedWorldLock) {
    await markRoomIdle(root)
    schedulePump(root)
  }
}

export async function getJob(root: string, jobId: string) {
  return readManifest(root, jobId)
}

export async function readJobArtifact(root: string, viewer: ViewerSession, jobId: string, name: string) {
  const manifest = await readManifest(root, jobId)
  if (!manifest) return null
  const isMonitor = viewer.role === 'dm' || viewer.dmEnabled
  const allowedPlayerArtifacts = new Set(['result.parsed.json'])
  if (!isMonitor && !allowedPlayerArtifacts.has(name)) return null
  const normalized = name.replace(/[\\/]+/g, '')
  const file = abs(root, artifactPath(jobId, normalized))
  if (!file.startsWith(jobDir(root, jobId))) return null
  const content = await fs.readFile(file, 'utf8').catch(() => null)
  if (content == null) return null
  return {
    path: artifactPath(jobId, normalized),
    size: Buffer.byteLength(content),
    mtime: Date.now(),
    frontmatter: null,
    content,
  }
}

export async function latestVisibleJobResult(root: string, viewer: ViewerSession) {
  return (await latestVisibleJobResults(root, viewer, 1))[0] || null
}

export async function latestVisibleJobResults(root: string, viewer: ViewerSession, limit = 8) {
  const jobs = await listJobs(root, 20)
  const characters = await readAllCharacterSummaries(root)
  const results: Array<{
    id: string
    kind: AgentJobKind
    path: string
    rawPath: string
    updatedAt: string
    title: string
    excerpt: string
    content: string
    visibility: 'public'
  }> = []
  for (const job of jobs) {
    const rawParsed = await fs.readFile(abs(root, job.artifacts.parsedResult), 'utf8').catch(() => '')
    if (!rawParsed.trim()) continue
    const parsed = JSON.parse(rawParsed) as ParsedResult
    const blocks = visibleBlocksForViewer(parsed, viewer, characters)
    const content = blocks.map((block) => block.content).filter(Boolean).join('\n\n')
    if (content.trim()) {
      results.push({
        id: job.id,
        kind: job.kind,
        path: job.artifacts.parsedResult,
        rawPath: job.artifacts.rawResult,
        updatedAt: job.endedAt || job.updatedAt,
        title: job.title,
        excerpt: content.replace(/[#>*`_\[\]()]/g, '').replace(/\s+/g, ' ').trim().slice(0, 320),
        content,
        visibility: 'public' as const,
      })
      if (results.length >= limit) break
    }
  }
  return results
}

export async function buildJobQueueItems(root: string) {
  const jobs = await listJobs(root, 20)
  const runs = await buildAgentRunSummaries(root, { seatName: 'AI Monitor', role: 'dm', token: '', dmEnabled: true }, 20)
  return jobs.map((job) => {
    const run = runs.find((entry) => entry.id === job.id)
    return {
    id: job.id,
    kind: job.kind === 'forge' ? 'forge' as const : 'action' as const,
    status: run?.status === 'stale'
      ? 'error' as const
      : job.status === 'waiting' ? 'waiting' as const : job.status === 'validating' ? 'running' as const : job.status,
    participantSeats: job.participantSeats,
    sceneIds: Array.from(new Set(job.participantCharacters.map((character) => character.sceneId))),
    packetPath: job.artifacts.packet,
    resultPath: job.artifacts.rawResult,
    updatedAt: job.endedAt || job.updatedAt,
    error: job.error,
    title: job.title,
    phase: job.phase,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    elapsedMs: run?.elapsedMs ?? null,
    durationMs: run?.durationMs ?? null,
    lastEventAt: run?.lastEventAt ?? null,
    stale: run?.stale ?? false,
    agentName: run?.agentName || agentName(job.kind),
    currentStep: run?.currentStep || phaseLabel(job.phase),
  }
  })
}

export async function buildJobArchives(root: string) {
  const jobs = await listJobs(root, 30)
  return jobs.map((job) => ({
    id: job.id,
    kind: job.kind === 'forge' ? 'forge' as const : 'action' as const,
    packetPath: job.artifacts.packet,
    resultPath: job.artifacts.rawResult,
    updatedAt: job.endedAt || job.updatedAt,
  }))
}

export async function hashPromptForDebug(root: string, jobId: string) {
  const prompt = await fs.readFile(abs(root, artifactPath(jobId, 'prompt.md')), 'utf8').catch(() => '')
  return createHash('sha256').update(prompt).digest('hex')
}

function agentName(kind: AgentJobKind) {
  if (kind === 'contract_onboarding') return 'AI DM / 合同开局'
  if (kind === 'action') return 'AI DM / 行动裁决'
  if (kind === 'forge') return 'Forge Agent / 创建角色'
  return 'Assistant Agent / 规则助手'
}

function phaseLabel(phase: AgentJobPhase) {
  const labels: Record<AgentJobPhase, string> = {
    queued: '等待调度',
    preparing: '准备上下文',
    'agent-running': 'Agent 正在运行',
    parsing: '解析标签返回',
    'post-processing': '写回与收尾',
    finished: '已结束',
  }
  return labels[phase] || phase
}

async function artifactStats(root: string, job: AgentJobManifest): Promise<AgentArtifactStat[]> {
  return Promise.all(Object.entries(job.artifacts).map(async ([name, rel]) => {
    const stat = await fs.stat(abs(root, rel)).catch(() => null)
    return {
      name,
      path: rel,
      exists: Boolean(stat),
      size: stat?.size || 0,
      updatedAt: stat ? new Date(stat.mtimeMs).toISOString() : null,
    }
  }))
}

async function lastEventAt(root: string, job: AgentJobManifest, stats: AgentArtifactStat[]) {
  const eventsRel = job.artifacts.events
  const raw = await fs.readFile(abs(root, eventsRel), 'utf8').catch(() => '')
  const lastLine = raw.trim().split(/\r?\n/).filter(Boolean).pop()
  if (lastLine) {
    try {
      const parsed = JSON.parse(lastLine) as { ts?: string }
      if (parsed.ts) return parsed.ts
    } catch {
      /* fall back to stat */
    }
  }
  return stats.find((entry) => entry.name === 'events')?.updatedAt || job.updatedAt
}

function msBetween(start: string | null, end: string | null, now = Date.now()) {
  if (!start) return null
  const startMs = new Date(start).getTime()
  if (Number.isNaN(startMs)) return null
  const endMs = end ? new Date(end).getTime() : now
  if (Number.isNaN(endMs)) return null
  return Math.max(0, endMs - startMs)
}

function isRelevantToViewer(job: AgentJobManifest, viewer: ViewerSession, controlledPaths: Set<string>) {
  if (viewer.role === 'dm' || viewer.dmEnabled) return true
  if (job.createdBy === viewer.seatName) return true
  if (job.participantSeats.includes(viewer.seatName)) return true
  return job.participantCharacters.some((character) => controlledPaths.has(character.path) || character.controller === viewer.seatName)
}

export async function buildAgentRunSummaries(root: string, viewer: ViewerSession, limit = 50): Promise<AgentRunSummary[]> {
  const jobs = await listJobs(root, limit)
  const characters = await readAllCharacterSummaries(root)
  const controlledPaths = new Set(characters.filter((character) => character.controller === viewer.seatName).map((character) => character.path))
  const now = Date.now()
  const summaries = await Promise.all(jobs
    .filter((job) => isRelevantToViewer(job, viewer, controlledPaths))
    .map(async (job) => {
      const stats = await artifactStats(root, job)
      const last = await lastEventAt(root, job, stats)
      const lastMs = last ? new Date(last).getTime() : NaN
      const rawUpdated = stats.find((entry) => entry.name === 'rawResult')?.updatedAt
      const rawSize = stats.find((entry) => entry.name === 'rawResult')?.size || 0
      const rawReady = rawSize > 0 && rawLooksComplete(await fs.readFile(abs(root, job.artifacts.rawResult), 'utf8').catch(() => ''))
      const rawMs = rawUpdated ? new Date(rawUpdated).getTime() : NaN
      const latestActivity = Math.max(Number.isNaN(lastMs) ? 0 : lastMs, Number.isNaN(rawMs) ? 0 : rawMs)
      const active = job.status === 'running' || job.status === 'validating'
      const stale = active && !rawReady && latestActivity > 0 && now - latestActivity > STALE_AFTER_MS
      const durationMs = job.endedAt ? msBetween(job.startedAt, job.endedAt, now) : null
      const elapsedMs = job.endedAt ? durationMs : msBetween(job.startedAt || job.createdAt, null, now)
      return {
        id: job.id,
        agentName: agentName(job.kind),
        kind: job.kind,
        title: job.title,
        status: stale ? 'stale' : job.status,
        rawStatus: job.status,
        phase: job.phase,
        currentStep: rawReady && active ? '原始返回已写入，正在自动解析收尾' : stale ? '可能卡住，等待 Agent 写入或退出' : phaseLabel(job.phase),
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        endedAt: job.endedAt,
        elapsedMs,
        durationMs,
        lastEventAt: last,
        stale,
        rawReady,
        participantSeats: job.participantSeats,
        participantCharacters: job.participantCharacters,
        artifacts: job.artifacts,
        artifactStats: stats,
        error: job.error,
        warnings: job.parserWarnings || [],
      } satisfies AgentRunSummary
    }))
  return summaries
}
