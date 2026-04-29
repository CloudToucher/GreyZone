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
}

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
        title: probeTitle,
      })
    })
  })
}

export async function runForgeRound(args: {
  workspaceRoot: string
  viewer: ViewerSession
  roundId: string
  forge: {
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
  const outputFile = sanitizeFileStem(args.forge.fileHint || args.viewer.seatName)
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

  const proc = spawn(launch.command, runArgs, {
    cwd: args.workspaceRoot,
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
    appendRoundLog('stdout', chunk)
  })
  proc.stderr.on('data', (chunk: string) => {
    stderr += chunk
    appendRoundLog('stderr', chunk)
  })
  proc.on('error', async (error) => {
    appendRoundLog('meta', `Process error: ${error.message}`)
    await fs.writeFile(path.join(args.workspaceRoot, args.resultPath), stderr || error.message, 'utf8')
    await args.afterFinish()
    await markRoomIdle(args.workspaceRoot)
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
    await fs.writeFile(path.join(args.workspaceRoot, args.resultPath), stdout || stderr || '(no output)', 'utf8')
    await args.afterFinish()
    await markRoomIdle(args.workspaceRoot)
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
