import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createForgePrompt, createRoundPrompt } from './grayZone'
import {
  finalizeSeatsAfterRound,
  markRoomIdle,
  markRoomRunning,
  reconcileTableFromCharacters,
  sanitizeFileStem,
  type ViewerSession,
} from './core'
import { appendRoundLog, beginRound, finishRound } from './runtime'

export interface OpencodeProbeResult {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
  model: string
  title: string
  command: string
  xdgConfigHome: string
  timedOut: boolean
  durationMs: number
  error?: string
  diagnosis?: string
}

const DEFAULT_MODEL = process.env.GZ_OPENCODE_MODEL || 'deepseek/deepseek-v4-pro'
const DEFAULT_XDG_DIRNAME = '.opencode-runtime'
const ENABLE_PRINT_LOGS = process.env.GZ_OPENCODE_PRINT_LOGS !== '0'
const ENABLE_THINKING = process.env.GZ_OPENCODE_THINKING !== '0'
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

function buildOpencodeEnv(workspaceRoot: string) {
  return {
    ...process.env,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || path.join(workspaceRoot, DEFAULT_XDG_DIRNAME),
  }
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

function buildRunArgs(workspaceRoot: string, title: string, prompt: string) {
  const args = ['run', '-m', DEFAULT_MODEL]
  if (ENABLE_PRINT_LOGS) args.push('--print-logs')
  if (ENABLE_THINKING) args.push('--thinking')
  args.push('--dir', workspaceRoot, '--title', title, prompt)
  return args
}

function diagnoseOpencodeFailure(stderr: string, stdout: string, error?: string) {
  const text = `${error || ''}\n${stderr}\n${stdout}`
  if (/uv_spawn 'git'|uv_spawn "git"|operation not permitted.*git|EPERM.*git/is.test(text)) {
    return [
      'opencode 已找到，但启动时调用 git 被系统或沙箱拦截。',
      '这通常发生在受限沙箱中；在正常启动的 Vite/浏览器进程外运行时一般不会复现。',
      '如果本机 UI 自检仍失败，请确认 git.exe 在 PATH 中，且安全软件没有拦截子进程。',
    ].join('\n')
  }
  if (/EEXIST: file already exists, mkdir .*\.config\\opencode/is.test(text)) {
    return [
      'opencode 默认配置目录存在异常。',
      '本项目会把 XDG_CONFIG_HOME 固定到工作区 .opencode-runtime；请通过 webui 启动，不要直接裸跑 opencode。',
    ].join('\n')
  }
  if (/not recognized|ENOENT|no such file|cannot find/i.test(text)) {
    return '没有找到 opencode 可执行文件。可在 webui/.env 中设置 GZ_OPENCODE_BIN 指向 opencode.exe。'
  }
  if (/unauthorized|api key|token|auth/i.test(text)) {
    return 'opencode 已启动，但模型认证失败。请检查 opencode 的 provider/API key 配置。'
  }
  return undefined
}

async function writeResultFallback(workspaceRoot: string, resultPath: string, content: string) {
  const abs = path.join(workspaceRoot, resultPath)
  const existing = await fs.stat(abs).catch(() => null)
  if (existing?.isFile() && existing.size > 0 && !content.trim()) return
  await fs.writeFile(abs, content || '(opencode completed; no captured stdout because stdio is inherited on Windows)', 'utf8')
}

function title(kind: string, viewer: ViewerSession) {
  const stamp = new Date().toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  return `Gray Zone Web | ${kind} | ${viewer.seatName} | ${stamp}`
}

export async function runOpencodeProbe(workspaceRoot: string): Promise<OpencodeProbeResult> {
  const env = buildOpencodeEnv(workspaceRoot)
  const launch = await resolveOpencodeCommand()
  const probeTitle = title('probe', { seatName: 'DM', role: 'dm', token: '' })
  const args = ['run', '-m', DEFAULT_MODEL, '--dir', workspaceRoot, '--title', probeTitle, '--pure', 'Reply exactly OK.']
  if (process.env.GZ_OPENCODE_PROBE_PRINT_LOGS === '1') args.splice(3, 0, '--print-logs')
  const startedAt = Date.now()
  const timeoutMs = Number(process.env.GZ_OPENCODE_PROBE_TIMEOUT_MS || 90000)

  return new Promise((resolve) => {
    const proc = spawn(launch.command, args, {
      cwd: workspaceRoot,
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
      })
    }
    if (proc.stderr) {
      proc.stderr.setEncoding('utf8')
      proc.stderr.on('data', (chunk: string) => {
        stderr += chunk
      })
    }
    let settled = false
    let timedOut = false
    const finish = (code: number | null, error?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const ok = !timedOut && !error && code === 0 && (USE_INHERITED_STDIO || /\bOK\b/.test(stdout))
      resolve({
        ok,
        code,
        stdout,
        stderr,
        model: DEFAULT_MODEL,
        title: probeTitle,
        command: launch.command,
        xdgConfigHome: String(env.XDG_CONFIG_HOME || ''),
        timedOut,
        durationMs: Date.now() - startedAt,
        error,
        diagnosis: ok ? undefined : diagnoseOpencodeFailure(stderr, stdout, error),
      })
    }
    const timer = setTimeout(() => {
      timedOut = true
      try {
        proc.kill()
      } catch {
        /* ignore */
      }
      finish(null, `opencode probe timed out after ${timeoutMs}ms`)
    }, timeoutMs)
    proc.on('error', (error) => {
      finish(null, error.message)
    })
    proc.on('close', (code) => {
      finish(code)
    })
  })
}

export async function runForgeRound(args: {
  workspaceRoot: string
  viewer: ViewerSession
  roundId: string
  forge: {
    name?: string
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
}) {
  const outputFile = sanitizeFileStem(args.forge.name || args.forge.fileHint || args.viewer.seatName)
  const outputPath = `characters/active/${outputFile}.md`
  const packetPath = `table/rounds/${args.roundId}/packet.md`
  const resultPath = `table/rounds/${args.roundId}/result.md`
  const prompt = createForgePrompt({
    seatName: args.viewer.seatName,
    outputPath,
    ...args.forge,
  })

  await fs.mkdir(path.join(args.workspaceRoot, `table/rounds/${args.roundId}`), { recursive: true })
  await fs.writeFile(path.join(args.workspaceRoot, packetPath), prompt, 'utf8')

  return startProcess({
    workspaceRoot: args.workspaceRoot,
    viewer: args.viewer,
    roundId: args.roundId,
    kind: 'forge',
    participantSeats: [args.viewer.seatName],
    packetPath,
    resultPath,
    prompt,
    afterFinish: async () => {
      await reconcileTableFromCharacters(args.workspaceRoot)
    },
  })
}

export async function runActionRound(args: {
  workspaceRoot: string
  viewer: ViewerSession
  roundId: string
  seatNames: string[]
  packetPath: string
  resultPath: string
}) {
  const prompt = createRoundPrompt({
    packetPath: args.packetPath,
    resultPath: args.resultPath,
    sharedBoardPath: 'table/shared_board.md',
  })

  return startProcess({
    workspaceRoot: args.workspaceRoot,
    viewer: args.viewer,
    roundId: args.roundId,
    kind: 'action',
    participantSeats: args.seatNames,
    packetPath: args.packetPath,
    resultPath: args.resultPath,
    prompt,
    afterFinish: async () => {
      await reconcileTableFromCharacters(args.workspaceRoot)
      await finalizeSeatsAfterRound(args.workspaceRoot, args.seatNames)
    },
  })
}

async function startProcess(args: {
  workspaceRoot: string
  viewer: ViewerSession
  roundId: string
  kind: 'action' | 'forge'
  participantSeats: string[]
  packetPath: string
  resultPath: string
  prompt: string
  afterFinish: () => Promise<void>
}) {
  const env = buildOpencodeEnv(args.workspaceRoot)
  const launch = await resolveOpencodeCommand()
  const runTitle = title(args.kind, args.viewer)
  const runArgs = buildRunArgs(args.workspaceRoot, runTitle, args.prompt)

  beginRound({
    id: args.roundId,
    kind: args.kind,
    status: 'running',
    startedAt: new Date().toISOString(),
    participantSeats: args.participantSeats,
    packetPath: args.packetPath,
    resultPath: args.resultPath,
    affectedFiles: [args.packetPath, args.resultPath],
  })
  await markRoomRunning(args.workspaceRoot, args.roundId)
  appendRoundLog('meta', `Launching opencode for ${args.kind} round ${args.roundId}`)
  await appendConversationIndex(args.workspaceRoot, {
    roundId: args.roundId,
    kind: args.kind,
    status: 'running',
    title: runTitle,
    participantSeats: args.participantSeats,
    packetPath: args.packetPath,
    resultPath: args.resultPath,
  })

  const proc = spawn(launch.command, runArgs, {
    cwd: args.workspaceRoot,
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
      appendRoundLog('stdout', chunk)
    })
  } else {
    appendRoundLog('meta', 'Using inherited stdio for opencode on Windows to avoid pipe-mode hang')
  }
  if (proc.stderr) {
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (chunk: string) => {
      stderr += chunk
      appendRoundLog('stderr', chunk)
    })
  }
  proc.on('error', async (error) => {
    appendRoundLog('meta', `Process error: ${error.message}`)
    const diagnosis = diagnoseOpencodeFailure(stderr, stdout, error.message)
    await writeResultFallback(args.workspaceRoot, args.resultPath, [stderr || error.message, diagnosis ? `\n\n## 鍚姩璇婃柇\n${diagnosis}` : ''].join(''))
    await args.afterFinish()
    await markRoomIdle(args.workspaceRoot)
    await appendConversationIndex(args.workspaceRoot, {
      roundId: args.roundId,
      kind: args.kind,
      status: 'error',
      title: runTitle,
      participantSeats: args.participantSeats,
      packetPath: args.packetPath,
      resultPath: args.resultPath,
      error: diagnosis || error.message,
    })
    finishRound({
      status: 'error',
      endedAt: new Date().toISOString(),
      exitCode: null,
      error: error.message,
      resultPath: args.resultPath,
      affectedFiles: [args.packetPath, args.resultPath],
    })
  })

  proc.on('close', async (code) => {
    const endedAt = new Date().toISOString()
    const diagnosis = code === 0 ? undefined : diagnoseOpencodeFailure(stderr, stdout)
    await writeResultFallback(args.workspaceRoot, args.resultPath, [
      stdout || stderr || '(no output)',
      diagnosis ? `\n\n## 鍚姩璇婃柇\n${diagnosis}` : '',
    ].join(''))
    await args.afterFinish()
    await markRoomIdle(args.workspaceRoot)
    await appendConversationIndex(args.workspaceRoot, {
      roundId: args.roundId,
      kind: args.kind,
      status: code === 0 ? 'done' : 'error',
      title: runTitle,
      participantSeats: args.participantSeats,
      packetPath: args.packetPath,
      resultPath: args.resultPath,
      error: code === 0 ? undefined : diagnosis || stderr || `opencode exited with code ${code}`,
    })
    finishRound({
      status: code === 0 ? 'done' : 'error',
      endedAt,
      exitCode: code,
      error: code === 0 ? null : stderr || `opencode exited with code ${code}`,
      resultPath: args.resultPath,
      affectedFiles: [args.packetPath, args.resultPath],
    })
  })
}

async function appendConversationIndex(workspaceRoot: string, entry: {
  roundId: string
  kind: 'action' | 'forge'
  status: 'running' | 'done' | 'error'
  title: string
  participantSeats: string[]
  packetPath: string
  resultPath: string
  error?: string
}) {
  const indexPath = path.join(workspaceRoot, 'table', 'conversations.md')
  const exists = await fs.stat(indexPath).catch(() => null)
  if (!exists) {
    await fs.mkdir(path.dirname(indexPath), { recursive: true })
    await fs.writeFile(indexPath, [
      '# 游戏对话索引',
      '',
      '这里记录 WebUI 发起的 opencode 会话。每次创建角色和行动处理都会留下回合包、结果文件和参与席位，方便回看 AI DM 调用链。',
      '',
    ].join('\n'), 'utf8')
  }

  const lines = [
    `## ${new Date().toLocaleString('zh-CN', { hour12: false })} - ${entry.kind === 'forge' ? '创建角色' : 'AI DM 行动处理'} - ${entry.status}`,
    '',
    `- round_id: ${entry.roundId}`,
    `- title: ${entry.title}`,
    `- seats: ${entry.participantSeats.join(', ') || '(none)'}`,
    `- packet: ${entry.packetPath}`,
    `- result: ${entry.resultPath}`,
    entry.error ? `- error: ${entry.error.replace(/\s+/g, ' ').slice(0, 240)}` : '',
    '',
  ].filter(Boolean)

  await fs.appendFile(indexPath, `${lines.join('\n')}\n`, 'utf8')
}
