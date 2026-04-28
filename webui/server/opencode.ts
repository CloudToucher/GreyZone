/**
 * opencode round runner.
 *
 * Strategy:
 *   - Spawn `opencode run -c <prompt>` on every round (continues last session via -c)
 *   - Stream stdout/stderr as Server-Sent Events to the DM console
 *   - Keep recent rounds in memory; clients reconnect via /api/round/stream?id=<roundId>
 *
 * Round prompt is assembled from:
 *   - dm_guide/快速开始_DM提示词.md  (game master kickoff prompt)
 *   - playground.md                 (player actions for this round)
 *   - characters/active/<char>.md   (current character sheet, optional)
 *   - tools/dice_pool.md            (top N rolls if present)
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import os from 'node:os'

type Panel = 'dm' | 'player'
type RoundKind = 'action' | 'forge'

export interface ForgeRequest {
  concept?: string
  identity?: string
  motivation?: string
  strength?: string
  storyTone?: string
  signatureWish?: string
  weaknesses?: string
  boundaries?: string
  extraNotes?: string
  fileHint?: string
}

export interface RoundRequest {
  workspaceRoot: string
  panel: Panel
  kind: RoundKind
  player?: string
  /** Player-written action text. Takes priority for the prompt. */
  action: string
  /** Workspace-relative path to active character sheet (optional). */
  character?: string
  /** If provided, used verbatim as the prompt instead of building one. */
  customPrompt?: string
  /** Structured forge request used to build a player-safe prompt. */
  forge?: ForgeRequest
}

interface RoundEvent {
  type: 'start' | 'stdout' | 'stderr' | 'end' | 'error' | 'meta'
  data?: string
  code?: number | null
  ts: number
}

interface Round {
  id: string
  startedAt: number
  endedAt?: number
  proc: ChildProcessWithoutNullStreams | null
  events: RoundEvent[] // capped buffer
  listeners: Set<ServerResponse>
  done: boolean
  exitCode: number | null
}

export interface OpencodeProbeResult {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
  model: string
  title: string
}

const ROUNDS = new Map<string, Round>()
const MAX_BUFFER = 4000 // events per round
const MAX_ROUNDS = 20
const DEFAULT_MODEL = process.env.GZ_OPENCODE_MODEL || 'deepseek/deepseek-v4-pro'
const DEFAULT_XDG_DIRNAME = '.opencode-runtime'
const ENABLE_PRINT_LOGS = process.env.GZ_OPENCODE_PRINT_LOGS !== '0'
const ENABLE_THINKING = process.env.GZ_OPENCODE_THINKING !== '0'
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

function gcRounds() {
  if (ROUNDS.size <= MAX_ROUNDS) return
  // drop oldest finished
  const finished = [...ROUNDS.values()]
    .filter((r) => r.done)
    .sort((a, b) => (a.endedAt || 0) - (b.endedAt || 0))
  while (ROUNDS.size > MAX_ROUNDS && finished.length) {
    const drop = finished.shift()!
    ROUNDS.delete(drop.id)
  }
}

async function readMaybe(file: string, max = 64 * 1024): Promise<string> {
  try {
    const buf = await fs.readFile(file, 'utf8')
    return buf.length > max ? buf.slice(0, max) + '\n…(truncated)…' : buf
  } catch {
    return ''
  }
}

function buildRoundProtocol() {
  return [
    '# 灰区：撤离 — 本轮请求',
    '',
    '你是 AI DM。你的职责是裁定世界、推进场景、整理已确认事实。UI 只是辅助工具，不是游戏框架。',
    '请优先理解玩家意图与当前上下文，再决定结果。不要把玩家限制在固定动作模板中。',
    '',
    '## 本轮执行要求',
    '1. 根据世界状态与角色状态推进本轮。',
    '2. 处理玩家行动并按规则裁定，必要时消耗骰池。',
    '3. 若角色状态发生已确认变化，更新对应角色卡中的 frontmatter（hp/sp/ap）和必要正文。',
    '4. 在 logs/session/ 下追加本轮日志。',
    '5. 清理 playground.md 中已执行的部分，保留仍未执行或未决的内容。',
    '',
    '## 输出协议（严格遵守以下分段标题）',
    '请始终使用以下 Markdown 二级标题输出，顺序保持一致：',
    '## 场景推进',
    '## 裁定',
    '## 状态变化',
    '## 新信息',
    '## 后续可选方向',
    '',
    '其中：',
    '- “场景推进”写给玩家阅读，描述发生了什么。',
    '- “裁定”说明关键判定、风险、规则依据、骰点消耗。',
    '- “状态变化”只写已经确认变化的事实；若无变化，写“无已确认状态变化”。',
    '- “新信息”写本轮新增线索、态势、人物反应；若无则明确写无。',
    '- “后续可选方向”给出玩家下一步可能采取的方向，不要替玩家决定。',
  ].join('\n')
}

function buildPlayerIntentBlock(player: string | undefined, action: string, playground: string) {
  const submitted = action?.trim() || '(空)'
  const board = playground?.trim() || '(空)'
  return [
    '## 玩家意图与行动上下文',
    '',
    '### 当前玩家身份',
    player?.trim() || '（未提供）',
    '',
    '### 来自网页提交的本轮意图',
    submitted,
    '',
    '### 当前 playground.md',
    board,
  ].join('\n')
}

function safeFileStem(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return '新角色'
  return trimmed.replace(/[\\/:*?"<>|]+/g, '_')
}

function buildForgePrompt(req: RoundRequest) {
  const forge = req.forge || {}
  const outputFile = safeFileStem(forge.fileHint || req.player || '新角色')
  const player = req.player?.trim() || '未绑定玩家'

  return [
    '# 灰区：撤离 — 创角请求',
    '',
    '你是 AI DM。你的任务不是让玩家去套职业模板，而是根据玩家想扮演的人设、强度要求、风格要求和世界约束，生成一个可直接投入游戏的初始角色。',
    '',
    '## 创角原则',
    '1. 玩家输入优先，允许模糊、留白和不完整。',
    '2. 你负责给出合理的开局强度、初始资源、标志性装备、代价与隐患。',
    '3. 不要机械套用旧职业模板；可以参考世界风格，但不要把玩家锁进固定职业。',
    '4. 所有内容保持纯文本、可叙事、可让后续 DM 继续接管。',
    `5. 生成结果写入 characters/active/${outputFile}.md。`,
    '6. 结果必须同时适合玩家阅读、适合 UI 提取 frontmatter、适合后续回合继续更新。',
    '',
    '## 输出与落档要求',
    '1. 创建或覆盖目标角色卡文件。',
    '2. 文件顶部必须包含 YAML frontmatter，至少提供：name, level, hp, sp, ap, attributes。',
    `3. frontmatter 额外写入 controller: ${player}，用于绑定玩家身份。`,
    '4. 正文使用完整角色档案形式，至少包含：角色概念、起始资源与装备、状态与异常、当前处境、角色笔记。',
    '5. 初始装备、资源、负债、关系、隐患由你根据玩家设定裁定。',
    '6. 可以给出不完美但强叙事性的开局，不要求数值绝对平衡，但要与玩家要求强度匹配。',
    '',
    '## 面向玩家的回应协议（严格遵守以下标题）',
    '## 角色概念',
    '## 初始状态',
    '## 起始装备',
    '## 优势',
    '## 代价与隐患',
    '## 当前处境',
    '## 已写入文件',
    '',
    '## 绑定玩家',
    player,
    '',
    '## 玩家自由设想',
    forge.concept?.trim() || '（未填写）',
    '',
    '## 身份 / 背景倾向',
    forge.identity?.trim() || '（未指定）',
    '',
    '## 动机 / 想玩的方向',
    forge.motivation?.trim() || '（未指定）',
    '',
    '## 希望的开局强度',
    forge.strength?.trim() || '（未指定，按概念合理裁定）',
    '',
    '## 希望的故事风格',
    forge.storyTone?.trim() || '（未指定）',
    '',
    '## 想要的标志性装备 / 资源感',
    forge.signatureWish?.trim() || '（未指定）',
    '',
    '## 可以接受的缺陷 / 代价',
    forge.weaknesses?.trim() || '（未指定，由你酌情加入）',
    '',
    '## 边界 / 不想出现的内容',
    forge.boundaries?.trim() || '（无特别说明）',
    '',
    '## 补充备注',
    forge.extraNotes?.trim() || '（无）',
  ].join('\n')
}

async function buildPrompt(req: RoundRequest): Promise<string> {
  if (req.customPrompt) return req.customPrompt
  if (req.kind === 'forge') return buildForgePrompt(req)

  const root = req.workspaceRoot
  const dmKickoff = await readMaybe(path.join(root, 'dm_guide/快速开始_DM提示词.md'))
  const playground = await readMaybe(path.join(root, 'playground.md'))
  const dice = await readMaybe(path.join(root, 'tools/dice_pool.md'), 4 * 1024)
  const charBlock = req.character
    ? await readMaybe(path.join(root, req.character), 16 * 1024)
    : ''

  const parts: string[] = []
  parts.push(buildRoundProtocol())

  if (dmKickoff) {
    parts.push('---\n## DM 启动提示词（必读）\n\n' + dmKickoff)
  }
  if (charBlock) {
    parts.push(`---\n## 当前角色卡 (${req.character})\n\n` + charBlock)
  }
  parts.push('---\n' + buildPlayerIntentBlock(req.player, req.action, playground))
  if (dice) {
    parts.push(
      '---\n## 骰池剩余（顶部即下一组待消耗）\n\n```\n' + dice.split('\n').slice(0, 60).join('\n') + '\n```',
    )
  }
  return parts.join('\n\n')
}

function pushEvent(round: Round, ev: RoundEvent) {
  round.events.push(ev)
  if (round.events.length > MAX_BUFFER) {
    round.events.splice(0, round.events.length - MAX_BUFFER)
  }
  const line = `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`
  for (const r of round.listeners) {
    try {
      r.write(line)
    } catch {
      /* listener gone */
    }
  }
}

function buildOpencodeEnv(workspaceRoot: string) {
  return {
    ...process.env,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || path.join(workspaceRoot, DEFAULT_XDG_DIRNAME),
  }
}

function buildSessionTitle(req: RoundRequest) {
  const player = req.player?.trim() || req.panel.toUpperCase()
  const kind = req.kind === 'forge' ? '创角' : '回合'
  const stamp = new Date().toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  return `Gray Zone Web · ${kind} · ${player} · ${stamp}`
}

function buildProbeTitle() {
  const stamp = new Date().toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  return `Gray Zone Web · Probe · ${stamp}`
}

function buildOpencodeArgs(req: RoundRequest, prompt: string) {
  const args = ['run', '-m', DEFAULT_MODEL]
  if (ENABLE_PRINT_LOGS) args.push('--print-logs')
  if (ENABLE_THINKING) args.push('--thinking')
  args.push('--dir', req.workspaceRoot)
  args.push('--title', buildSessionTitle(req))
  args.push(prompt)
  return args
}

async function resolveOpencodeCommand() {
  if (process.env.GZ_OPENCODE_BIN?.trim()) {
    return {
      command: process.env.GZ_OPENCODE_BIN.trim(),
      shell: false,
    }
  }

  if (process.platform === 'win32') {
    try {
      await fs.access(DEFAULT_WINDOWS_OPENCODE_EXE)
      return {
        command: DEFAULT_WINDOWS_OPENCODE_EXE,
        shell: false,
      }
    } catch {
      /* fall through */
    }
  }

  return {
    command: 'opencode',
    shell: process.platform === 'win32',
  }
}

export async function runOpencodeProbe(workspaceRoot: string): Promise<OpencodeProbeResult> {
  const env = buildOpencodeEnv(workspaceRoot)
  const launch = await resolveOpencodeCommand()
  const title = buildProbeTitle()
  const args = ['run', '-m', DEFAULT_MODEL, '--dir', workspaceRoot, '--title', title, '--pure', 'Reply exactly OK.']

  if (ENABLE_PRINT_LOGS) args.splice(3, 0, '--print-logs')
  if (ENABLE_THINKING) args.splice(ENABLE_PRINT_LOGS ? 4 : 3, 0, '--thinking')

  return new Promise((resolve, reject) => {
    const proc = spawn(launch.command, args, {
      cwd: workspaceRoot,
      windowsHide: true,
      env,
      shell: launch.shell,
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.setEncoding('utf8')
    proc.stderr.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    proc.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      resolve({
        ok: code === 0 && /\bOK\b/.test(stdout),
        code,
        stdout,
        stderr,
        model: DEFAULT_MODEL,
        title,
      })
    })
  })
}

export function startRound(req: RoundRequest): { roundId: string } {
  const id = randomUUID()
  const round: Round = {
    id,
    startedAt: Date.now(),
    proc: null,
    events: [],
    listeners: new Set(),
    done: false,
    exitCode: null,
  }
  ROUNDS.set(id, round)
  gcRounds()

  // Async kickoff so we can return roundId immediately
  ;(async () => {
    try {
      pushEvent(round, {
        type: 'meta',
        data: JSON.stringify({
          phase: 'building_prompt',
          kind: req.kind,
          panel: req.panel,
          player: req.player || null,
        }),
        ts: Date.now(),
      })
      const prompt = await buildPrompt(req)
      const env = buildOpencodeEnv(req.workspaceRoot)
      const launch = await resolveOpencodeCommand()
      pushEvent(round, {
        type: 'meta',
        data: JSON.stringify({
          phase: 'prompt_ready',
          promptBytes: Buffer.byteLength(prompt, 'utf8'),
          panel: req.panel,
          kind: req.kind,
          player: req.player || null,
          character: req.character || null,
          model: DEFAULT_MODEL,
          xdgConfigHome: env.XDG_CONFIG_HOME || null,
        }),
        ts: Date.now(),
      })
      pushEvent(round, {
        type: 'meta',
        data: JSON.stringify({
          phase: 'spawning',
          command: 'opencode run',
          model: DEFAULT_MODEL,
          printLogs: ENABLE_PRINT_LOGS,
          thinking: ENABLE_THINKING,
          resolvedCommand: launch.command,
        }),
        ts: Date.now(),
      })
      const args = buildOpencodeArgs(req, prompt)
      pushEvent(round, { type: 'start', data: `opencode ${args.join(' ').replace(prompt, '…')}`, ts: Date.now() })

      // Use opencode CLI; -c continues last session for cross-turn memory.
      const proc = spawn(launch.command, args, {
        cwd: req.workspaceRoot,
        windowsHide: true,
        env,
        shell: launch.shell,
      })
      round.proc = proc
      pushEvent(round, {
        type: 'meta',
        data: JSON.stringify({
          phase: 'spawned',
          pid: proc.pid ?? null,
          model: DEFAULT_MODEL,
        }),
        ts: Date.now(),
      })

      proc.stdout.setEncoding('utf8')
      proc.stderr.setEncoding('utf8')

      proc.stdout.on('data', (chunk: string) => {
        pushEvent(round, { type: 'stdout', data: chunk, ts: Date.now() })
      })
      proc.stderr.on('data', (chunk: string) => {
        pushEvent(round, { type: 'stderr', data: chunk, ts: Date.now() })
      })
      proc.on('error', (err) => {
        pushEvent(round, { type: 'error', data: String(err?.message || err), ts: Date.now() })
      })
      proc.on('close', (code) => {
        round.done = true
        round.exitCode = code
        round.endedAt = Date.now()
        pushEvent(round, { type: 'end', code, ts: Date.now() })
        for (const r of round.listeners) {
          try {
            r.end()
          } catch {
            /* ignore */
          }
        }
        round.listeners.clear()
      })
    } catch (e: any) {
      pushEvent(round, { type: 'error', data: e?.message || String(e), ts: Date.now() })
      round.done = true
      round.endedAt = Date.now()
    }
  })()

  return { roundId: id }
}

/** Attach an SSE response to an existing round; returns false if not found. */
export function attachStream(roundId: string, res: ServerResponse): boolean {
  const round = ROUNDS.get(roundId)
  if (!round) return false
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.write('retry: 2000\n\n')

  // Replay buffered events
  for (const ev of round.events) {
    res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`)
  }

  if (round.done) {
    try {
      res.end()
    } catch {
      /* ignore */
    }
    return true
  }

  round.listeners.add(res)
  res.on('close', () => {
    round.listeners.delete(res)
  })
  return true
}
