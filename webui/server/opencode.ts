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

export interface RoundRequest {
  workspaceRoot: string
  /** Player-written action text. Takes priority for the prompt. */
  action: string
  /** Workspace-relative path to active character sheet (optional). */
  character?: string
  /** If provided, used verbatim as the prompt instead of building one. */
  customPrompt?: string
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

const ROUNDS = new Map<string, Round>()
const MAX_BUFFER = 4000 // events per round
const MAX_ROUNDS = 20

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

async function buildPrompt(req: RoundRequest): Promise<string> {
  if (req.customPrompt) return req.customPrompt

  const root = req.workspaceRoot
  const dmKickoff = await readMaybe(path.join(root, 'dm_guide/快速开始_DM提示词.md'))
  const playground = await readMaybe(path.join(root, 'playground.md'))
  const dice = await readMaybe(path.join(root, 'tools/dice_pool.md'), 4 * 1024)
  const charBlock = req.character
    ? await readMaybe(path.join(root, req.character), 16 * 1024)
    : ''

  const parts: string[] = []
  parts.push(
    '# 灰区：撤离 — 本轮请求\n\n' +
      '你是 AI DM。请按照《DM 核心手册》和下方资料推进游戏一个回合。\n' +
      '请在回应中：\n' +
      '1) 简述场景与状态变化\n' +
      '2) 处理玩家行动并按规则裁决（必要时用骰）\n' +
      '3) 更新玩家角色卡的 frontmatter（hp/sp/ap）若发生变化\n' +
      '4) 在 logs/session/ 下追加本轮日志\n' +
      '5) 清理 playground.md 已执行的部分\n',
  )

  if (dmKickoff) {
    parts.push('---\n## DM 启动提示词（必读）\n\n' + dmKickoff)
  }
  if (charBlock) {
    parts.push(`---\n## 当前角色卡 (${req.character})\n\n` + charBlock)
  }
  if (playground) {
    parts.push('---\n## playground.md（当前行动）\n\n' + playground)
  }
  parts.push('---\n## 本轮玩家行动（来自网页提交）\n\n' + (req.action || '(空)'))
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
      const prompt = await buildPrompt(req)
      pushEvent(round, {
        type: 'meta',
        data: JSON.stringify({
          promptBytes: Buffer.byteLength(prompt, 'utf8'),
          character: req.character || null,
        }),
        ts: Date.now(),
      })
      pushEvent(round, { type: 'start', data: 'opencode run -c …', ts: Date.now() })

      // Use opencode CLI; -c continues last session for cross-turn memory.
      // --print-logs -> goes to stderr, fine for our purposes.
      const proc = spawn('opencode', ['run', '-c', prompt], {
        cwd: req.workspaceRoot,
        windowsHide: true,
        env: process.env,
        // shell:true is needed on Windows to resolve .cmd / .ps1 shims for npm-installed CLIs
        shell: process.platform === 'win32',
      })
      round.proc = proc

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
