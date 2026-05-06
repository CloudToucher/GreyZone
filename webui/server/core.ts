import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { readCharacterSummary, type CharacterSummary } from './grayZone'
import type { VisibleRoundState } from './runtime'

export type { CharacterSummary } from './grayZone'

export interface ViewerSession {
  seatName: string
  role: 'dm' | 'player'
  token: string
  dmEnabled?: boolean
}

export interface SeatRecord {
  name: string
  role: 'dm' | 'player'
  occupied: boolean
  tokenHash: string | null
  tokenHashes?: string[]
  status: 'idle' | 'ready' | 'submitted' | 'locked'
  online: boolean
  lastSeenAt: string | null
  dmEnabled?: boolean
}

export interface PendingTransfer {
  toSeat: string | null
  requestedBy: string | null
  requestedAt: string | null
}

export interface ControlBinding {
  characterPath: string
  label: string
  primarySeat: string | null
  dmHosted: boolean
  visibleTo: string[]
  pendingTransfer: PendingTransfer | null
}

export interface RoomState {
  version: number
  title: string
  ruleset: string
  ownerSeat: string
  phase: 'idle' | 'composing' | 'running'
  currentRoundId: string | null
  sharedBoardPath: string
  createdAt: string
  updatedAt: string
}

export interface IntentSections {
  public: string
  privateToDm: string
  longTerm: string
  triggers: string
}

export interface IntentDocument {
  seatName: string
  updatedAt: string | null
  sections: IntentSections
  raw: string
}

export interface ArchiveEntry {
  id: string
  kind: 'action' | 'forge'
  packetPath: string
  resultPath: string | null
  updatedAt: string
}

export interface PublicIntentSummary {
  seatName: string
  status: SeatRecord['status']
  updatedAt: string | null
  publicText: string
  longTerm: string
  characterNames: string[]
  characterPaths: string[]
  sceneId: string
  location: string
}

export interface SceneThread {
  id: string
  location: string
  partyIds: string[]
  seatNames: string[]
  characters: Array<{
    name: string
    path: string
    controller: string | null
    location: string
    partyId: string
  }>
  statuses: Array<{ seatName: string; status: SeatRecord['status'] }>
}

export interface LatestResultSummary {
  id: string
  kind?: 'contract_onboarding' | 'action' | 'forge' | 'assistant'
  path: string
  rawPath?: string
  updatedAt: string
  title: string
  excerpt: string
  content: string
  visibility: 'public' | 'scene' | 'private'
}

export interface SceneReadinessResult {
  allReady: boolean
  sceneId: string
  totalSeats: number
  readySeats: Array<{ seatName: string; status: string }>
  notReadySeats: Array<{ seatName: string; status: string }>
  dmHostedSeats: Array<{ seatName: string }>
}

export interface RoomSnapshot {
  room: RoomState
  viewer: { seatName: string; role: 'dm' | 'player'; dmEnabled?: boolean }
  seats: Array<{
    name: string
    role: 'dm' | 'player'
    status: SeatRecord['status']
    occupied: boolean
    online: boolean
    lastSeenAt: string | null
    controlledCharacterCount: number
  }>
  myIntent: IntentDocument
  visibleCharacters: CharacterSummary[]
  control: ControlBinding[]
  allIntents?: IntentDocument[]
  publicIntents: PublicIntentSummary[]
  sceneThreads: SceneThread[]
  latestResults: LatestResultSummary[]
  aiQueue: AiQueueItem[]
  sharedBoard: VisibleFile | null
  latestResultContent: string | null
  archives: ArchiveEntry[]
  visibleRound: VisibleRoundState | null
  documentShortcuts: Array<{ title: string; path: string }>
}

export interface AiQueueItem {
  id: string
  kind: 'action' | 'forge'
  status: 'waiting' | 'composing' | 'running' | 'done' | 'error'
  participantSeats: string[]
  sceneIds: string[]
  packetPath?: string
  resultPath?: string | null
  updatedAt: string
  error?: string | null
}

export interface TreeNode {
  name: string
  path: string
  type: 'dir' | 'file'
  children?: TreeNode[]
}

export interface VisibleFile {
  path: string
  size: number
  mtime: number
  frontmatter: Record<string, unknown> | null
  content: string
}

export interface SeatsFile {
  version: number
  seats: SeatRecord[]
}

export interface ControlFile {
  version: number
  bindings: ControlBinding[]
}

const TABLE_DIR = 'table'
const ROOM_FILE = `${TABLE_DIR}/room.yaml`
const SEATS_FILE = `${TABLE_DIR}/seats.yaml`
const CONTROL_FILE = `${TABLE_DIR}/control.yaml`
const SHARED_BOARD_FILE = `${TABLE_DIR}/shared_board.md`
const INTENTS_DIR = `${TABLE_DIR}/intents`
const ROUNDS_DIR = `${TABLE_DIR}/rounds`

export const DM_HOSTED_MARKER = 'AI DM托管状态'

const PUBLIC_DOCS = new Set(['README.md', '开始游戏.md', '一句话开局.md', '先看这里.md', 'playground.md'])
const PUBLIC_PREFIXES = ['rules', 'assets/items', 'characters/templates']
const PLAYER_HIDDEN_PREFIXES = ['dm_guide', 'scenes', 'story', 'assets/enemies', 'assets/npcs', 'tools', 'webui', '.git', 'node_modules']
const DM_HIDDEN_PREFIXES = ['webui', '.git', 'node_modules']

function nowIso() {
  return new Date().toISOString()
}

function normalizeSeatName(name: string) {
  return name.trim().replace(/\s+/g, ' ').slice(0, 40)
}

function relPath(...parts: string[]) {
  return parts.join('/').replace(/\\/g, '/')
}

function absolute(root: string, rel: string) {
  return path.resolve(root, rel)
}

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function seatTokenHashes(seat: SeatRecord) {
  return Array.from(new Set([seat.tokenHash, ...(seat.tokenHashes || [])].filter(Boolean) as string[]))
}

function rememberSeatToken(seat: SeatRecord, hash: string) {
  const hashes = [hash, ...seatTokenHashes(seat).filter((entry) => entry !== hash)].slice(0, 8)
  seat.tokenHash = hashes[0] || null
  seat.tokenHashes = hashes
}

let seatsSaveQueue: Promise<void> = Promise.resolve()

async function exists(abs: string) {
  try {
    await fs.access(abs)
    return true
  } catch {
    return false
  }
}

async function readYamlFile<T>(abs: string): Promise<T> {
  const raw = await fs.readFile(abs, 'utf8')
  return yaml.load(raw) as T
}

async function writeYamlFile(abs: string, value: unknown) {
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, yaml.dump(value, { lineWidth: 120, noRefs: true, sortKeys: false }), 'utf8')
}

function splitFrontmatter(text: string): {
  frontmatter: Record<string, unknown> | null
  body: string
} {
  if (!text.startsWith('---')) return { frontmatter: null, body: text }
  const end = text.indexOf('\n---', 3)
  if (end === -1) return { frontmatter: null, body: text }
  const raw = text.slice(3, end).replace(/^\r?\n/, '')
  const body = text.slice(end + 4).replace(/^\r?\n/, '')
  try {
    const data = yaml.load(raw)
    if (data && typeof data === 'object') return { frontmatter: data as Record<string, unknown>, body }
  } catch {
    /* ignore */
  }
  return { frontmatter: null, body: text }
}

async function listCharacterFiles(root: string) {
  const dir = absolute(root, 'characters/active')
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map((entry) => relPath('characters/active', entry.name))
}

export async function readAllCharacterSummaries(root: string) {
  const charPaths = await listCharacterFiles(root)
  return (
    await Promise.all(charPaths.map(async (rel) => readCharacterSummary(absolute(root, rel), rel)))
  ).filter((entry): entry is CharacterSummary => !!entry)
}

function defaultSharedBoard() {
  return [
    '# 共享看板',
    '',
    '## 公开局面',
    '- 房间已初始化。AI DM 会在每次处理后只把公开、浓缩、已确认的事实写到这里。',
    '',
    '## 当前焦点',
    '- 等待玩家创建角色或提交行动。',
    '',
    '## 最近确认变化',
    '- 暂无。',
    '',
  ].join('\n')
}

export function sanitizeFileStem(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return 'new_character'
  return trimmed.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 64)
}

function createIntentTemplate(seatName: string, updatedAt = nowIso()): string {
  return [
    '---',
    `seat: ${seatName}`,
    `updated_at: ${updatedAt}`,
    '---',
    '',
    '# Intent Workspace',
    '',
    '## Public',
    '',
    '',
    '## Private For DM',
    '',
    '',
    '## Long Term',
    '',
    '',
    '## Triggers',
    '',
    '',
  ].join('\n')
}

export function parseIntentMarkdown(seatName: string, raw: string): IntentDocument {
  let body = raw
  let updatedAt: string | null = null
  if (raw.startsWith('---')) {
    const end = raw.indexOf('\n---', 3)
    if (end !== -1) {
      const frontmatterRaw = raw.slice(3, end).replace(/^\r?\n/, '')
      try {
        const frontmatter = yaml.load(frontmatterRaw) as Record<string, unknown> | null
        if (typeof frontmatter?.updated_at === 'string') updatedAt = frontmatter.updated_at
      } catch {
        /* ignore */
      }
      body = raw.slice(end + 4).replace(/^\r?\n/, '')
    }
  }

  const section = (title: string) => {
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`##\\s*${escaped}[\\s\\S]*?(?=\\n##|$)`)
    const match = body.match(re)?.[0] || ''
    return match.split('\n').slice(1).join('\n').trim()
  }

  return {
    seatName,
    updatedAt,
    raw,
    sections: {
      public: section('Public'),
      privateToDm: section('Private For DM'),
      longTerm: section('Long Term'),
      triggers: section('Triggers'),
    },
  }
}

export function renderIntentMarkdown(seatName: string, sections: IntentSections, updatedAt = nowIso()) {
  return [
    '---',
    `seat: ${seatName}`,
    `updated_at: ${updatedAt}`,
    '---',
    '',
    '# Intent Workspace',
    '',
    '## Public',
    sections.public.trim(),
    '',
    '## Private For DM',
    sections.privateToDm.trim(),
    '',
    '## Long Term',
    sections.longTerm.trim(),
    '',
    '## Triggers',
    sections.triggers.trim(),
    '',
  ].join('\n')
}

export async function loadRoom(root: string) {
  const abs = absolute(root, ROOM_FILE)
  const data = await readYamlFile<RoomState | null>(abs).catch(() => null)
  if (data && typeof data === 'object' && typeof data.ownerSeat === 'string') return data
  const fallback: RoomState = {
    version: 1,
    title: 'Gray Zone Table',
    ruleset: 'gray-zone',
    ownerSeat: 'AI Monitor',
    phase: 'idle',
    currentRoundId: null,
    sharedBoardPath: SHARED_BOARD_FILE,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  await writeYamlFile(abs, fallback)
  return fallback
}

export async function saveRoom(root: string, room: RoomState) {
  room.updatedAt = nowIso()
  await writeYamlFile(absolute(root, ROOM_FILE), room)
}

export async function loadSeatsFile(root: string) {
  const abs = absolute(root, SEATS_FILE)
  const data = await readYamlFile<SeatsFile | null>(abs).catch(() => null)
  if (data && typeof data === 'object' && Array.isArray(data.seats)) return data
  const fallback: SeatsFile = {
    version: 1,
    seats: [{
      name: 'AI Monitor',
      role: 'dm',
      occupied: false,
      tokenHash: null,
      status: 'idle',
      online: false,
      lastSeenAt: null,
      dmEnabled: true,
    }],
  }
  await writeYamlFile(abs, fallback)
  return fallback
}

export async function loadSeats(root: string) {
  return loadSeatsFile(root)
}

export async function saveSeats(root: string, seats: SeatsFile, options: { allowTokenClear?: boolean; preserveStatus?: boolean } = {}) {
  const run = async () => {
    const abs = absolute(root, SEATS_FILE)
    const current = await readYamlFile<SeatsFile | null>(abs).catch(() => null)
    if (current?.seats?.length) {
      const currentByName = new Map(current.seats.map((seat) => [seat.name, seat]))
      seats.seats = seats.seats.map((seat) => {
        const existing = currentByName.get(seat.name)
        if (!options.allowTokenClear && existing) {
          const hashes = Array.from(new Set([
            seat.tokenHash,
            ...(seat.tokenHashes || []),
            existing.tokenHash,
            ...(existing.tokenHashes || []),
          ].filter(Boolean) as string[])).slice(0, 8)
          if (hashes.length || existing.tokenHash) {
            const merged = {
              ...seat,
              tokenHash: hashes[0] || existing.tokenHash,
              tokenHashes: hashes,
            }
            if (existing.tokenHash && !seat.tokenHash) {
              merged.occupied = existing.occupied
              merged.online = existing.online
              merged.lastSeenAt = existing.lastSeenAt
              merged.dmEnabled = existing.dmEnabled
            }
            return options.preserveStatus ? { ...merged, status: existing.status } : merged
          }
        }
        return options.preserveStatus && existing ? { ...seat, status: existing.status } : seat
      })
      const nextNames = new Set(seats.seats.map((seat) => seat.name))
      for (const seat of current.seats) {
        if (!nextNames.has(seat.name) && (seat.occupied || seat.tokenHash)) {
          seats.seats.push(seat)
          nextNames.add(seat.name)
        }
      }
    }
    await writeYamlFile(abs, seats)
  }
  const next = seatsSaveQueue.then(run, run)
  seatsSaveQueue = next.catch(() => {})
  await next
}

export async function loadControl(root: string) {
  const abs = absolute(root, CONTROL_FILE)
  const data = await readYamlFile<ControlFile | null>(abs).catch(() => null)
  if (data && typeof data === 'object' && Array.isArray(data.bindings)) return data
  const fallback: ControlFile = { version: 1, bindings: [] }
  await writeYamlFile(abs, fallback)
  return fallback
}

export async function saveControl(root: string, control: ControlFile) {
  await writeYamlFile(absolute(root, CONTROL_FILE), control)
}

export async function ensureTableState(root: string) {
  await fs.mkdir(absolute(root, INTENTS_DIR), { recursive: true })
  await fs.mkdir(absolute(root, ROUNDS_DIR), { recursive: true })

  const roomExists = await exists(absolute(root, ROOM_FILE))
  const seatsExists = await exists(absolute(root, SEATS_FILE))
  const controlExists = await exists(absolute(root, CONTROL_FILE))
  const sharedExists = await exists(absolute(root, SHARED_BOARD_FILE))
  const createdAt = nowIso()

  if (!roomExists) {
    await writeYamlFile(absolute(root, ROOM_FILE), {
      version: 1,
      title: 'Gray Zone Table',
      ruleset: 'gray-zone',
      ownerSeat: 'AI Monitor',
      phase: 'idle',
      currentRoundId: null,
      sharedBoardPath: SHARED_BOARD_FILE,
      createdAt,
      updatedAt: createdAt,
    } satisfies RoomState)
  }

  const charSummaries = await readAllCharacterSummaries(root)

  if (!seatsExists) {
    const seatNames = new Set(['AI Monitor', ...charSummaries.map((entry) => entry.controller).filter(Boolean) as string[]])
    const seats: SeatRecord[] = [...seatNames].map((name) => ({
      name,
      role: name === 'AI Monitor' ? 'dm' : 'player',
      occupied: false,
      tokenHash: null,
      status: 'idle',
      online: false,
      lastSeenAt: null,
      dmEnabled: name === 'AI Monitor',
    }))
    await writeYamlFile(absolute(root, SEATS_FILE), { version: 1, seats })
  }

  if (!controlExists) {
    const bindings: ControlBinding[] = charSummaries.map((entry) => ({
      characterPath: entry.path,
      label: entry.name,
      primarySeat: entry.controller,
      dmHosted: !entry.controller,
      visibleTo: entry.controller ? [entry.controller] : [],
      pendingTransfer: null,
    }))
    await writeYamlFile(absolute(root, CONTROL_FILE), { version: 1, bindings })
  }

  if (!sharedExists) await fs.writeFile(absolute(root, SHARED_BOARD_FILE), defaultSharedBoard(), 'utf8')
  await reconcileTableFromCharacters(root)
}

export async function reconcileTableFromCharacters(root: string) {
  const room = await loadRoom(root)
  const seatsFile = await loadSeats(root)
  const controlFile = await loadControl(root)
  const charSummaries = await readAllCharacterSummaries(root)
  const latestSeatsFile = await loadSeats(root).catch(() => seatsFile)
  const latestSeatsByName = new Map(latestSeatsFile.seats.map((seat) => [seat.name, seat]))
  const originalSeatsByName = new Map(seatsFile.seats.map((seat) => [seat.name, seat]))
  const seatNames = new Set([...originalSeatsByName.keys(), ...latestSeatsByName.keys()])

  seatNames.add(room.ownerSeat)
  for (const summary of charSummaries) {
    if (summary.controller) seatNames.add(summary.controller)
  }

  const preSaveSeatsFile = await loadSeats(root).catch(() => latestSeatsFile)
  for (const seat of preSaveSeatsFile.seats) {
    latestSeatsByName.set(seat.name, seat)
    seatNames.add(seat.name)
  }

  seatsFile.seats = [...seatNames].map((name) => {
    const current = latestSeatsByName.get(name) || originalSeatsByName.get(name)
    return current || {
      name,
      role: name === room.ownerSeat ? 'dm' : 'player',
      occupied: false,
      tokenHash: null,
      status: 'idle' as const,
      online: false,
      lastSeenAt: null,
      dmEnabled: name === room.ownerSeat,
    }
  })
  await saveSeats(root, seatsFile)

  controlFile.bindings = charSummaries.map((summary) => {
    const current = controlFile.bindings.find((binding) => binding.characterPath === summary.path)
    const primarySeat = current?.pendingTransfer ? current.primarySeat : summary.controller
    return {
      characterPath: summary.path,
      label: summary.name,
      primarySeat: current?.pendingTransfer ? current.primarySeat : primarySeat,
      dmHosted: current?.pendingTransfer ? current.dmHosted : !primarySeat,
      visibleTo: Array.from(new Set([...(current?.visibleTo || []), ...(primarySeat ? [primarySeat] : [])])),
      pendingTransfer: current?.pendingTransfer || null,
    } satisfies ControlBinding
  })
  await saveControl(root, controlFile)

  for (const seat of seatsFile.seats) {
    const intentPath = absolute(root, relPath(INTENTS_DIR, `${sanitizeFileStem(seat.name)}.md`))
    if (!(await exists(intentPath))) await fs.writeFile(intentPath, createIntentTemplate(seat.name), 'utf8')
  }
}

export async function authenticateViewer(root: string, seatName: string, token: string) {
  await ensureTableState(root)
  const seatsFile = await loadSeats(root)
  const seat = seatsFile.seats.find((entry) => entry.name === seatName)
  if (!seat || !seatTokenHashes(seat).includes(tokenHash(token))) return null
  seat.online = true
  seat.lastSeenAt = nowIso()
  await saveSeats(root, seatsFile, { preserveStatus: true })
  return { seatName: seat.name, role: seat.role, token, dmEnabled: Boolean(seat.dmEnabled) } satisfies ViewerSession
}

export async function joinSeat(root: string, rawName: string, providedToken?: string) {
  await ensureTableState(root)
  const seatName = normalizeSeatName(rawName)
  if (!seatName) throw new Error('Seat name is required')

  const room = await loadRoom(root)
  const seatsFile = await loadSeats(root)
  let seat = seatsFile.seats.find((entry) => entry.name === seatName)
  const nextToken = providedToken?.trim() || randomUUID()
  const nextHash = tokenHash(nextToken)
  if (!seat) {
    seat = {
      name: seatName,
      role: seatName === room.ownerSeat ? 'dm' : 'player',
      occupied: true,
      tokenHash: nextHash,
      tokenHashes: [nextHash],
      status: 'idle',
      online: true,
      lastSeenAt: nowIso(),
      dmEnabled: seatName === room.ownerSeat,
    }
    seatsFile.seats.push(seat)
  } else {
    seat.occupied = true
    rememberSeatToken(seat, nextHash)
    seat.online = true
    seat.lastSeenAt = nowIso()
    if (typeof seat.dmEnabled !== 'boolean') seat.dmEnabled = seat.name === room.ownerSeat
  }
  await saveSeats(root, seatsFile)

  const intentPath = absolute(root, relPath(INTENTS_DIR, `${sanitizeFileStem(seat.name)}.md`))
  if (!(await exists(intentPath))) await fs.writeFile(intentPath, createIntentTemplate(seat.name), 'utf8')
  return { seatName: seat.name, role: seat.role, token: nextToken, dmEnabled: Boolean(seat.dmEnabled) } satisfies ViewerSession
}

export async function enableDmConsole(root: string, viewer: ViewerSession, roomCode: string) {
  const expected = process.env.GZ_DM_CODE?.trim()
  if (!expected) throw new Error('AI 监控台口令未配置')
  if (roomCode.trim() !== expected) throw new Error('AI 监控台口令不正确')
  const seatsFile = await loadSeats(root)
  const seat = seatsFile.seats.find((entry) => entry.name === viewer.seatName)
  if (!seat) throw new Error('Seat not found')
  seat.dmEnabled = true
  seat.lastSeenAt = nowIso()
  await saveSeats(root, seatsFile)
  return { seatName: seat.name, role: seat.role, token: viewer.token, dmEnabled: true } satisfies ViewerSession
}

export async function releaseSeat(root: string, viewer: ViewerSession, seatName: string) {
  if (!viewer.dmEnabled && viewer.role !== 'dm') throw new Error('Only AI monitor can release seats')
  const seatsFile = await loadSeats(root)
  const seat = seatsFile.seats.find((entry) => entry.name === seatName)
  if (!seat) throw new Error('Seat not found')
  seat.occupied = false
  seat.tokenHash = null
  seat.tokenHashes = []
  seat.online = false
  seat.status = 'idle'
  seat.lastSeenAt = nowIso()
  await saveSeats(root, seatsFile, { allowTokenClear: true })
}

export async function updateSeatStatus(root: string, seatName: string, status: SeatRecord['status']) {
  const seatsFile = await loadSeats(root)
  const seat = seatsFile.seats.find((entry) => entry.name === seatName)
  if (!seat) throw new Error('Seat not found')
  seat.status = status
  seat.lastSeenAt = nowIso()
  await saveSeats(root, seatsFile)
}

export async function getIntentPathForSeat(root: string, seatName: string) {
  await ensureTableState(root)
  return absolute(root, relPath(INTENTS_DIR, `${sanitizeFileStem(seatName)}.md`))
}

export async function loadIntentForSeat(root: string, seatName: string) {
  const abs = await getIntentPathForSeat(root, seatName)
  const raw = await fs.readFile(abs, 'utf8')
  return parseIntentMarkdown(seatName, raw)
}

export async function saveIntentForSeat(root: string, seatName: string, sections: IntentSections) {
  const raw = renderIntentMarkdown(seatName, sections)
  const abs = await getIntentPathForSeat(root, seatName)
  await fs.writeFile(abs, raw, 'utf8')
  return parseIntentMarkdown(seatName, raw)
}

export async function assignControl(root: string, viewer: ViewerSession, args: {
  characterPath: string
  primarySeat: string | null
  dmHosted: boolean
  requireAccept?: boolean
}) {
  if (!viewer.dmEnabled && viewer.role !== 'dm') throw new Error('Only AI monitor can assign control')
  const controlFile = await loadControl(root)
  const binding = controlFile.bindings.find((entry) => entry.characterPath === args.characterPath)
  if (!binding) throw new Error('Character binding not found')
  if (args.requireAccept && args.primarySeat && binding.primarySeat !== args.primarySeat) {
    binding.pendingTransfer = { toSeat: args.primarySeat, requestedBy: viewer.seatName, requestedAt: nowIso() }
  } else {
    binding.primarySeat = args.dmHosted ? null : args.primarySeat
    binding.dmHosted = args.dmHosted
    binding.pendingTransfer = null
    binding.visibleTo = Array.from(new Set([...(binding.visibleTo || []), ...(args.primarySeat ? [args.primarySeat] : [])]))
    await syncCharacterController(root, binding.characterPath, binding.primarySeat)
  }
  await saveControl(root, controlFile)
}

export async function respondToTransfer(root: string, viewer: ViewerSession, characterPath: string, accept: boolean) {
  const controlFile = await loadControl(root)
  const binding = controlFile.bindings.find((entry) => entry.characterPath === characterPath)
  if (!binding?.pendingTransfer?.toSeat) throw new Error('Pending transfer not found')
  if (binding.pendingTransfer.toSeat !== viewer.seatName) throw new Error('Transfer not assigned to this seat')
  if (accept) {
    binding.primarySeat = viewer.seatName
    binding.dmHosted = false
    binding.visibleTo = Array.from(new Set([...(binding.visibleTo || []), viewer.seatName]))
    await syncCharacterController(root, binding.characterPath, viewer.seatName)
  }
  binding.pendingTransfer = null
  await saveControl(root, controlFile)
}

async function syncCharacterController(root: string, characterPath: string, controller: string | null) {
  const abs = absolute(root, characterPath)
  const raw = await fs.readFile(abs, 'utf8')
  const { frontmatter, body } = splitFrontmatter(raw)
  const rendered = `---\n${yaml.dump({ ...(frontmatter || {}), controller: controller || '' }, { lineWidth: 120, noRefs: true, sortKeys: false })}---\n\n${body}`
  await fs.writeFile(abs, rendered, 'utf8')
}

async function readSharedBoard(root: string) {
  return readVisibleFile(root, { seatName: 'AI DM', role: 'dm', token: '', dmEnabled: true }, SHARED_BOARD_FILE)
}

function isPublicPath(rel: string) {
  return PUBLIC_DOCS.has(rel) || PUBLIC_PREFIXES.some((prefix) => rel === prefix || rel.startsWith(prefix + '/'))
}

async function canSeeCharacter(root: string, viewer: ViewerSession, rel: string) {
  const controlFile = await loadControl(root)
  const binding = controlFile.bindings.find((entry) => entry.characterPath === rel)
  if (!binding) return false
  if (viewer.role === 'dm' || viewer.dmEnabled) return true
  if (binding.primarySeat === viewer.seatName) return true
  return binding.visibleTo.includes(viewer.seatName)
}

function hiddenByRole(role: 'dm' | 'player', rel: string) {
  const prefixes = role === 'dm' ? DM_HIDDEN_PREFIXES : PLAYER_HIDDEN_PREFIXES
  return prefixes.some((prefix) => rel === prefix || rel.startsWith(prefix + '/'))
}

export async function canReadPath(root: string, viewer: ViewerSession, rel: string) {
  const normalized = rel.replace(/^\/+/, '').replace(/\\/g, '/')
  const effectiveRole = viewer.role === 'dm' || viewer.dmEnabled ? 'dm' : viewer.role
  if (!normalized || hiddenByRole(effectiveRole, normalized)) return false
  if (effectiveRole === 'dm') return true
  if (isPublicPath(normalized)) return true
  if (normalized === SHARED_BOARD_FILE) return true
  if (normalized.startsWith(`${ROUNDS_DIR}/`) && normalized.endsWith('/result.md')) return true
  if (normalized === relPath(INTENTS_DIR, `${sanitizeFileStem(viewer.seatName)}.md`)) return true
  if (normalized.startsWith('characters/active/') && normalized.endsWith('.md')) return canSeeCharacter(root, viewer, normalized)
  return false
}

export async function canWritePath(root: string, viewer: ViewerSession, rel: string) {
  const normalized = rel.replace(/^\/+/, '').replace(/\\/g, '/')
  if (!(await canReadPath(root, viewer, normalized)) && viewer.role !== 'dm' && !viewer.dmEnabled) return false
  if (viewer.role === 'dm' || viewer.dmEnabled) return true
  return normalized === relPath(INTENTS_DIR, `${sanitizeFileStem(viewer.seatName)}.md`)
}

export async function readVisibleFile(root: string, viewer: ViewerSession, rel: string): Promise<VisibleFile | null> {
  const normalized = rel.replace(/^\/+/, '').replace(/\\/g, '/')
  if (!(await canReadPath(root, viewer, normalized))) return null
  const abs = absolute(root, normalized)
  const stat = await fs.stat(abs).catch(() => null)
  if (!stat?.isFile()) return null
  const raw = await fs.readFile(abs, 'utf8')
  const { frontmatter, body } = splitFrontmatter(raw)
  return { path: normalized, size: stat.size, mtime: stat.mtimeMs, frontmatter, content: body }
}

export async function writeVisibleFile(root: string, viewer: ViewerSession, rel: string, content: string) {
  const normalized = rel.replace(/^\/+/, '').replace(/\\/g, '/')
  if (!(await canWritePath(root, viewer, normalized))) throw new Error('Write forbidden')
  const abs = absolute(root, normalized)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, content, 'utf8')
}

export async function buildTree(root: string, viewer: ViewerSession): Promise<TreeNode> {
  const effectiveRole = viewer.role === 'dm' || viewer.dmEnabled ? 'dm' : viewer.role
  async function walk(absDir: string, relDir: string): Promise<TreeNode | null> {
    const entries = await fs.readdir(absDir, { withFileTypes: true }).catch(() => [])
    const children: TreeNode[] = []
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.well-known') continue
      const childRel = relDir ? relPath(relDir, entry.name) : entry.name
      if (hiddenByRole(effectiveRole, childRel)) continue
      const childAbs = path.join(absDir, entry.name)
      if (entry.isDirectory()) {
        const node = await walk(childAbs, childRel)
        if (node?.children?.length) children.push(node)
        continue
      }
      if (entry.isFile() && /\.(md|ya?ml|json)$/i.test(entry.name) && await canReadPath(root, viewer, childRel)) {
        children.push({ name: entry.name, path: childRel, type: 'file' })
      }
    }
    children.sort((a, b) => a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name, 'zh-Hans-CN'))
    return { name: relDir ? path.basename(absDir) : 'workspace', path: relDir, type: 'dir', children }
  }
  return (await walk(root, '')) || { name: 'workspace', path: '', type: 'dir', children: [] }
}

function isMonitor(viewer: ViewerSession) {
  return viewer.role === 'dm' || viewer.dmEnabled
}

function summarizeText(text: string, max = 260) {
  return text.replace(/[#>*`_\[\]()]/g, '').replace(/\s+/g, ' ').trim().slice(0, max)
}

async function buildPublicIntents(root: string, seatsFile: SeatsFile, controlFile: ControlFile, characters: CharacterSummary[]) {
  return Promise.all(seatsFile.seats.filter((seat) => seat.role === 'player').map(async (seat) => {
    const intent = await loadIntentForSeat(root, seat.name)
    const controlled = controlFile.bindings
      .filter((binding) => binding.primarySeat === seat.name)
      .map((binding) => characters.find((character) => character.path === binding.characterPath))
      .filter((entry): entry is CharacterSummary => !!entry && (entry.inGame || entry.lifecycle === 'active'))
    const primary = controlled[0]
    return {
      seatName: seat.name,
      status: seat.status,
      updatedAt: intent.updatedAt,
      publicText: intent.sections.public,
      longTerm: intent.sections.longTerm,
      characterNames: controlled.map((character) => character.name),
      characterPaths: controlled.map((character) => character.path),
      sceneId: primary?.sceneId || 'scene:default',
      location: primary?.location || '未定位',
    } satisfies PublicIntentSummary
  }))
}

function buildSceneThreads(seatsFile: SeatsFile, controlFile: ControlFile, characters: CharacterSummary[]) {
  const map = new Map<string, SceneThread>()
  for (const character of characters.filter((entry) => entry.inGame || entry.lifecycle === 'active')) {
    const binding = controlFile.bindings.find((entry) => entry.characterPath === character.path)
    const sceneId = character.sceneId || 'scene:default'
    const current = map.get(sceneId) || {
      id: sceneId,
      location: character.location || '未定位',
      partyIds: [],
      seatNames: [],
      characters: [],
      statuses: [],
    }
    current.characters.push({
      name: character.name,
      path: character.path,
      controller: binding?.primarySeat || character.controller,
      location: character.location,
      partyId: character.partyId,
    })
    if (character.partyId && !current.partyIds.includes(character.partyId)) current.partyIds.push(character.partyId)
    if (binding?.primarySeat && !current.seatNames.includes(binding.primarySeat)) current.seatNames.push(binding.primarySeat)
    map.set(sceneId, current)
  }
  for (const thread of map.values()) {
    thread.statuses = thread.seatNames.map((seatName) => ({
      seatName,
      status: seatsFile.seats.find((seat) => seat.name === seatName)?.status || 'idle',
    }))
  }
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id, 'zh-Hans-CN'))
}

export async function listArchives(root: string) {
  const roundsAbs = absolute(root, ROUNDS_DIR)
  const entries = await fs.readdir(roundsAbs, { withFileTypes: true }).catch(() => [])
  const archives: ArchiveEntry[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const packetPath = relPath(ROUNDS_DIR, entry.name, 'packet.md')
    const resultPath = relPath(ROUNDS_DIR, entry.name, 'result.md')
    const packetStat = await fs.stat(absolute(root, packetPath)).catch(() => null)
    const resultStat = await fs.stat(absolute(root, resultPath)).catch(() => null)
    const packetHead = await fs.readFile(absolute(root, packetPath), 'utf8').catch(() => '')
    const kind = /创建角色|forge/i.test(packetHead.slice(0, 500)) ? 'forge' : 'action'
    archives.push({
      id: entry.name,
      kind,
      packetPath,
      resultPath: resultStat ? resultPath : null,
      updatedAt: new Date(Math.max(packetStat?.mtimeMs || 0, resultStat?.mtimeMs || 0)).toISOString(),
    })
  }
  return archives.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 20)
}

async function buildLatestResults(root: string, archives: ArchiveEntry[]) {
  const results: LatestResultSummary[] = []
  for (const archive of archives.filter((entry) => entry.resultPath).slice(0, 5)) {
    const resultPath = archive.resultPath as string
    const raw = await fs.readFile(absolute(root, resultPath), 'utf8').catch(() => '')
    const firstHeading = raw.match(/^#\s+(.+)$/m)?.[1] || raw.match(/^##\s+(.+)$/m)?.[1] || `回合 ${archive.id}`
    results.push({
      id: archive.id,
      path: resultPath,
      updatedAt: archive.updatedAt,
      title: firstHeading.trim(),
      excerpt: summarizeText(raw, 320),
      content: raw,
      visibility: 'public',
    })
  }
  return results
}

function buildAiQueue(room: RoomState, seatsFile: SeatsFile, sceneThreads: SceneThread[], archives: ArchiveEntry[], visibleRound: VisibleRoundState | null) {
  const queue: AiQueueItem[] = []
  const activeRoundId = visibleRound?.id || room.currentRoundId
  const busy = Boolean(visibleRound && (visibleRound.status === 'running' || visibleRound.status === 'idle')) || room.phase !== 'idle'
  if (visibleRound) {
    queue.push({
      id: visibleRound.id,
      kind: visibleRound.kind,
      status: visibleRound.status === 'idle' ? 'waiting' : visibleRound.status,
      participantSeats: visibleRound.participantSeats,
      sceneIds: sceneThreads.filter((thread) => thread.seatNames.some((seat) => visibleRound.participantSeats.includes(seat))).map((thread) => thread.id),
      packetPath: visibleRound.packetPath,
      resultPath: visibleRound.resultPath,
      updatedAt: visibleRound.endedAt || visibleRound.startedAt,
      error: visibleRound.error,
    })
  } else if (room.phase !== 'idle' && room.currentRoundId) {
    queue.push({
      id: room.currentRoundId,
      kind: 'action',
      status: room.phase,
      participantSeats: seatsFile.seats.filter((seat) => seat.status === 'locked').map((seat) => seat.name),
      sceneIds: [],
      packetPath: relPath(ROUNDS_DIR, room.currentRoundId, 'packet.md'),
      resultPath: relPath(ROUNDS_DIR, room.currentRoundId, 'result.md'),
      updatedAt: room.updatedAt,
    })
  }
  const submitted = seatsFile.seats.filter((seat) => seat.role === 'player' && seat.status === 'submitted').map((seat) => seat.name)
  if (!busy && submitted.length) {
    queue.push({
      id: 'submitted-intents',
      kind: 'action',
      status: 'waiting',
      participantSeats: submitted,
      sceneIds: sceneThreads.filter((thread) => thread.seatNames.some((seat) => submitted.includes(seat))).map((thread) => thread.id),
      updatedAt: nowIso(),
    })
  }
  for (const archive of archives.filter((entry) => entry.id !== activeRoundId).slice(0, 6)) {
    queue.push({
      id: archive.id,
      kind: archive.kind,
      status: archive.resultPath ? 'done' : 'error',
      participantSeats: [],
      sceneIds: [],
      packetPath: archive.packetPath,
      resultPath: archive.resultPath,
      updatedAt: archive.updatedAt,
      error: archive.resultPath ? null : 'result.md missing',
    })
  }
  return queue
}

export async function createRoundPacket(root: string, viewer: ViewerSession, args: {
  seatNames?: string[]
  note?: string
}) {
  if (!isMonitor(viewer)) throw new Error('Only AI monitor can compose rounds')
  return createAiRoundPacket(root, args)
}

export async function checkSceneReadiness(root: string, submittedSeatName: string): Promise<SceneReadinessResult> {
  const seatsFile = await loadSeats(root)
  const controlFile = await loadControl(root)
  const characters = (await readAllCharacterSummaries(root)).filter((entry) => entry.inGame || entry.lifecycle === 'active')

  // Find the scene for the submitting seat
  const binding = controlFile.bindings.find((b) => b.primarySeat === submittedSeatName)
  const character = binding ? characters.find((c) => c.path === binding.characterPath) : null
  const sceneId = character?.sceneId || 'scene:default'

  // Get all seats in this scene
  const sceneBindings = controlFile.bindings.filter((b) => {
    const ch = characters.find((c) => c.path === b.characterPath)
    return ch?.sceneId === sceneId
  })

  const seatNames = [...new Set(sceneBindings.map((b) => b.primarySeat).filter(Boolean) as string[])]

  const readySeats: Array<{ seatName: string; status: string }> = []
  const notReadySeats: Array<{ seatName: string; status: string }> = []
  const dmHostedSeats: Array<{ seatName: string }> = []

  for (const seatName of seatNames) {
    const seat = seatsFile.seats.find((s) => s.name === seatName)
    if (!seat) continue

    const binding = sceneBindings.find((b) => b.primarySeat === seatName)
    
    // Check if DM-hosted (character without primary seat, or intent says DM托管)
    if (!binding || binding.dmHosted) {
      dmHostedSeats.push({ seatName })
      readySeats.push({ seatName, status: 'dm_hosted' })
      continue
    }

    // Check if intent contains DM托管 marker
    if (seat.status === 'submitted') {
      const intent = await loadIntentForSeat(root, seatName)
      if (intent.sections.public.includes(DM_HOSTED_MARKER) || intent.sections.privateToDm.includes(DM_HOSTED_MARKER)) {
        dmHostedSeats.push({ seatName })
        readySeats.push({ seatName, status: 'dm_hosted' })
        continue
      }
    }

    if (seat.status === 'submitted') {
      readySeats.push({ seatName, status: 'submitted' })
    } else {
      notReadySeats.push({ seatName, status: seat.status })
    }
  }

  return {
    allReady: notReadySeats.length === 0,
    sceneId,
    totalSeats: seatNames.length,
    readySeats,
    notReadySeats,
    dmHostedSeats,
  }
}

export async function createAiRoundPacket(root: string, args: {
  seatNames?: string[]
  note?: string
  reason?: string
} = {}) {
  await ensureTableState(root)
  const room = await loadRoom(root)
  if (room.phase !== 'idle') throw new Error('AI DM is already processing a round')

  const seatsFile = await loadSeats(root)
  const controlFile = await loadControl(root)
  const characters = await readAllCharacterSummaries(root)
  const sceneThreads = buildSceneThreads(seatsFile, controlFile, characters)
  const publicIntents = await buildPublicIntents(root, seatsFile, controlFile, characters)

  const seatNames = args.seatNames?.length
    ? args.seatNames
    : seatsFile.seats.filter((seat) => seat.role === 'player' && seat.status === 'submitted').map((seat) => seat.name)

  if (!seatNames.length) throw new Error('No submitted player intents to process')

  // ─── Readiness check: all same-scene seats must be submitted or DM-hosted ───
  for (const seatName of seatNames) {
    const readiness = await checkSceneReadiness(root, seatName)
    if (!readiness.allReady) {
      const notReadyNames = readiness.notReadySeats.map((s) => s.seatName).join(', ')
      throw new Error(`场景 ${readiness.sceneId} 尚未全部就绪。等待：${notReadyNames}`)
    }
  }

  const roundId = randomUUID()
  const intents = await Promise.all(seatNames.map(async (seatName) => loadIntentForSeat(root, seatName)))
  const involvedSceneIds = new Set(publicIntents.filter((intent) => seatNames.includes(intent.seatName)).map((intent) => intent.sceneId))
  const involvedSeatNames = new Set(seatNames)
  for (const thread of sceneThreads.filter((thread) => involvedSceneIds.has(thread.id))) {
    for (const seatName of thread.seatNames) involvedSeatNames.add(seatName)
  }
  const activeSeatNames = [...involvedSeatNames]
  const bindings = controlFile.bindings.filter((binding) => binding.primarySeat && activeSeatNames.includes(binding.primarySeat))
  const characterBlocks = bindings.map((binding) => {
    const summary = characters.find((character) => character.path === binding.characterPath)
    return [
      `### ${binding.label} (${binding.characterPath})`,
      `- controller: ${binding.primarySeat || '(none)'}`,
      `- location: ${summary?.location || '未定位'}`,
      `- sceneId: ${summary?.sceneId || 'scene:default'}`,
      `- partyId: ${summary?.partyId || '(none)'}`,
      `- visibilityScope: ${summary?.visibilityScope || 'private'}`,
      `- semanticStatus: ${summary?.semanticStatus.join('；') || '(empty)'}`,
      `- inventory: ${summary?.inventory.join('；') || '(empty)'}`,
      `- safeBox: ${summary?.safeBox.map((slot) => `${slot.label}=${slot.empty ? '空' : slot.item}`).join('；') || '(empty)'}`,
      '',
      summary?.currentSituation || '(no current situation extracted)',
      '',
    ].join('\n')
  })
  const packetPath = relPath(ROUNDS_DIR, roundId, 'packet.md')
  const resultPath = relPath(ROUNDS_DIR, roundId, 'result.md')
  
  // Build intent blocks (keep intent text inline - it's the core of what changed)
  const intentBlocks = intents.flatMap((intent) => [
    `### ${intent.seatName}`,
    '',
    '#### 公开行动',
    intent.sections.public || '(empty)',
    '',
    '#### 私密意图（只给 AI DM）',
    intent.sections.privateToDm || '(empty)',
    '',
    '#### 长期目标',
    intent.sections.longTerm || '(empty)',
    '',
    '#### 触发条件',
    intent.sections.triggers || '(empty)',
    '',
  ])
  
  // Build file references instead of inline character blocks
  const characterRefs = bindings.map((binding) => {
    const summary = characters.find((character) => character.path === binding.characterPath)
    return `- **${binding.label}**: \`${binding.characterPath}\` | 位置: ${summary?.location || '未定位'} | 场景: ${summary?.sceneId || 'default'} | 分队: ${summary?.partyId || 'none'}`
  })
  
  const packet = [
    '# AI DM 回合包（精简版）',
    '',
    `- round_id: ${roundId}`,
    `- generated_at: ${nowIso()}`,
    `- trigger_reason: ${args.reason || 'player-submitted'}`,
    `- submitted_seats: ${seatNames.join(', ')}`,
    '',
    '## 本次玩家意图',
    ...intentBlocks,
    '',
    '## 涉及角色（按需读取角色卡获取完整状态）',
    ...characterRefs,
    '',
    '## 必须读取的文件',
    '- dm_guide/启动注入_AI_DM.md',
    '- dm_guide/DM速记_备忘.md（局面卡）',
    '- rules/公式速查卡.md',
    '- table/shared_board.md（当前公开局面）',
    ...bindings.map((b) => `- ${b.characterPath}（角色状态：blood/energy/inventory/location）`),
    '',
    '## 输出要求',
    `- 将完整 DM 回复写入 \`${resultPath}\`（使用 Write 工具）`,
    '- 更新 table/shared_board.md（只写公开浓缩事实）',
    '- 更新涉及角色卡的前置元数据（blood, energy, inventory, location, sceneId, partyId）',
    '- 在结果文件末尾追加：`<!-- ROUND_DONE {"round_id":"' + roundId + '","status":"ok"} -->`',
    '',
  ].join('\n')

  await fs.mkdir(absolute(root, relPath(ROUNDS_DIR, roundId)), { recursive: true })
  await fs.writeFile(absolute(root, packetPath), packet, 'utf8')
  for (const seatName of activeSeatNames) {
    const seat = seatsFile.seats.find((entry) => entry.name === seatName)
    if (seat && (seat.status === 'submitted' || seat.status === 'ready')) seat.status = 'locked'
  }
  await saveSeats(root, seatsFile)
  room.phase = 'composing'
  room.currentRoundId = roundId
  await saveRoom(root, room)
  return { roundId, packetPath, resultPath, seatNames: activeSeatNames }
}

export async function markRoomRunning(root: string, roundId: string) {
  const room = await loadRoom(root)
  room.phase = 'running'
  room.currentRoundId = roundId
  await saveRoom(root, room)
}

export async function markRoomIdle(root: string) {
  const room = await loadRoom(root)
  room.phase = 'idle'
  room.currentRoundId = null
  await saveRoom(root, room)
}

export async function finalizeSeatsAfterRound(root: string, seatNames: string[]) {
  const seatsFile = await loadSeats(root)
  for (const seatName of seatNames) {
    const seat = seatsFile.seats.find((entry) => entry.name === seatName)
    if (seat && (seat.status === 'locked' || seat.status === 'submitted')) seat.status = 'idle'
  }
  await saveSeats(root, seatsFile)
}

export async function buildSnapshot(root: string, viewer: ViewerSession, visibleRound: VisibleRoundState | null): Promise<RoomSnapshot> {
  await ensureTableState(root)
  const room = await loadRoom(root)
  const seatsFile = await loadSeats(root)
  const controlFile = await loadControl(root)
  const myIntent = await loadIntentForSeat(root, viewer.seatName)
  const canUseMonitor = isMonitor(viewer)
  const allCharacters = await readAllCharacterSummaries(root)
  const charPaths = controlFile.bindings
    .filter((binding) => canUseMonitor || binding.primarySeat === viewer.seatName || binding.visibleTo.includes(viewer.seatName))
    .map((binding) => binding.characterPath)
  const visibleCharacters = allCharacters.filter((character) => charPaths.includes(character.path))
  const seats = seatsFile.seats.map((seat) => ({
    name: seat.name,
    role: seat.role,
    status: seat.status,
    occupied: seat.occupied,
    online: seat.online,
    lastSeenAt: seat.lastSeenAt,
    controlledCharacterCount: controlFile.bindings.filter((binding) => binding.primarySeat === seat.name).length,
  }))
  const publicIntents = await buildPublicIntents(root, seatsFile, controlFile, allCharacters)
  const sceneThreads = buildSceneThreads(seatsFile, controlFile, allCharacters)
  const sharedBoard = await readSharedBoard(root)
  const archives = await listArchives(root)
  const latestResults = await buildLatestResults(root, archives)
  const aiQueue = buildAiQueue(room, seatsFile, sceneThreads, archives, visibleRound)
  const documentShortcuts = [
    { title: '先看这里', path: '先看这里.md' },
    { title: '一句话开局', path: '一句话开局.md' },
    { title: '共享看板', path: SHARED_BOARD_FILE },
    { title: '行动语义板', path: 'playground.md' },
    { title: '创建角色指南', path: 'characters/templates/角色生成指南.md' },
  ]
  if (canUseMonitor) documentShortcuts.push({ title: '游戏对话索引', path: 'table/conversations.md' })

  const snapshot: RoomSnapshot = {
    room,
    viewer: { seatName: viewer.seatName, role: viewer.role, dmEnabled: viewer.dmEnabled },
    seats,
    myIntent,
    visibleCharacters,
    control: canUseMonitor
      ? controlFile.bindings
      : controlFile.bindings.filter((binding) => binding.primarySeat === viewer.seatName || binding.visibleTo.includes(viewer.seatName)),
    publicIntents,
    sceneThreads,
    latestResults,
    latestResultContent: latestResults.length > 0 ? latestResults[0].content : null,
    aiQueue,
    sharedBoard,
    archives,
    visibleRound,
    documentShortcuts,
  }
  if (canUseMonitor) {
    snapshot.allIntents = await Promise.all(seatsFile.seats.map(async (seat) => loadIntentForSeat(root, seat.name)))
  }
  return snapshot
}
