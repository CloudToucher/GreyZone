import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import {
  type Plan,
  type SessionState,
  type CreationReply,
  type Conversation,
  type Amendment,
} from '../../shared/types.js';
import { GameError } from '../engine.js';
import { adjudicate } from './adjudicator.js';
import { persona, protocol, sheetProtocol } from './policy.js';
import { createWithModel } from './creation.js';
export interface Command {
  executable: string;
  args: string[];
}
export interface Director {
  create?(
    state: SessionState,
    actorId: string,
    message: string,
    signal: AbortSignal,
  ): Promise<CreationReply>;
  respond?(
    state: SessionState,
    actorId: string,
    intent: string,
    signal: AbortSignal,
    onProgress?: (stage: string) => void,
  ): Promise<Plan | Conversation | Amendment>;
  plan(
    state: SessionState,
    actorId: string,
    intent: string,
    signal: AbortSignal,
    onProgress?: (stage: string) => void,
  ): Promise<Plan>;
}
// No shell, files, networking tools, subagents, or runtime code are exposed to the game DM.
export const disabledPlugins = [
  'tool-bash',
  'tool-pwsh',
  'tool-jobs',
  'tool-fs',
  'tool-fs-search',
  'tool-skill',
  'tool-subagent-control',
  'tool-subagent-list-agents',
  'tool-subagent',
  'tool-subagent-fork',
  'tool-subagent-report',
  'tool-workflow',
  'tool-todo',
  'tool-goal',
  'tool-ralph',
  'tool-str-replace-editor',
  'tool-web',
  'agent-instructions',
  'skill-filesystem',
  'plan-mode',
  'goal-round-driver',
  'code-runtime',
  'session-title-llm',
];

export async function locateDsh(): Promise<Command> {
  const custom = process.env.DSH_BIN;
  if (custom) {
    if (!isAbsolute(custom))
      throw new GameError('DSH_BIN 必须是 dsh 可执行文件或 bin.js 的绝对路径。', 503);
    await access(custom, constants.R_OK).catch(() => {
      throw new GameError('DSH_BIN 指向的文件不存在。', 503);
    });
    if (/\.[cm]?js$/i.test(custom)) return { executable: process.execPath, args: [custom] };
    if (/\.(ps1|cmd|bat)$/i.test(custom))
      throw new GameError(
        'Windows 请将 DSH_BIN 指向 @deepseek-ai/dsh/lib/bin.js，不能使用 shell 包装文件。',
        503,
      );
    return { executable: custom, args: [] };
  }
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  if (process.env.APPDATA) dirs.unshift(join(process.env.APPDATA, 'npm'));
  dirs.unshift(dirname(process.execPath));
  for (const dir of [...new Set(dirs)]) {
    const candidates = [
      join(dir, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
      resolve(dir, '../lib/node_modules/@deepseek-ai/dsh/lib/bin.js'),
    ];
    for (const candidate of candidates) {
      try {
        await access(candidate);
        return { executable: process.execPath, args: [candidate] };
      } catch {
        /* next installation */
      }
    }
    if (process.platform !== 'win32') {
      try {
        const candidate = join(dir, 'dsh');
        await access(candidate, constants.X_OK);
        return { executable: candidate, args: [] };
      } catch {
        /* next PATH entry */
      }
    }
  }
  throw new GameError('未找到 dsh。请安装 @deepseek-ai/dsh 并完成模型配置，或设置 DSH_BIN。', 503);
}

export function runProcess(
  command: Command,
  args: string[],
  options: { cwd?: string; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<string> {
  return new Promise((resolveResult, reject) => {
    if (options.signal?.aborted) {
      reject(new GameError('行动已取消。', 409));
      return;
    }
    const child = spawn(command.executable, [...command.args, ...args], {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DSH_TELEMETRY_DISABLED: '1' },
    });
    let stdout = '',
      stderr = '',
      failure: Error | undefined,
      settled = false;
    const kill = (error: Error) => {
      if (failure || settled) return;
      failure = error;
      if (child.pid) {
        if (process.platform === 'win32') {
          const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
            shell: false,
          });
          killer.on('error', () => child.kill());
        } else {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
        }
      }
    };
    const timer = setTimeout(
      () => kill(new GameError('dsh 响应超时，本次行动未扣除资源。可以重试。', 504)),
      options.timeoutMs ?? 120_000,
    );
    const onAbort = () => kill(new GameError('行动已取消，游戏状态未改变。', 409));
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const cleanup = () => {
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > 1_048_576)
        kill(new GameError('dsh 输出超过限制，本次行动未结算。', 502));
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-16384);
    });
    child.on('error', () => {
      cleanup();
      reject(new GameError('无法启动 dsh，请运行 npm run doctor 检查安装。', 503));
    });
    child.on('close', (code) => {
      if (settled) return;
      cleanup();
      if (failure) reject(failure);
      else if (code !== 0) {
        // Never relay raw provider errors: they may contain URLs or credential fragments.
        const hint = /credential|api.?key|unauthorized|401|认证/i.test(stderr)
          ? '请在 dsh 中配置有效的模型凭据。'
          : '请检查 dsh 的模型配置与网络连接。';
        reject(
          new GameError(
            `dsh 未完成响应（退出码 ${code ?? 'unknown'}）。${hint}游戏状态未改变。`,
            502,
          ),
        );
      } else resolveResult(stdout.trim());
    });
  });
}

export function parseJson<T>(text: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T {
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1')
    .trim();
  try {
    return schema.parse(JSON.parse(clean));
  } catch {
    throw new GameError('dsh 返回的数据未通过协议校验，本次行动未结算。请重试。', 502);
  }
}

export class DshDirector implements Director {
  constructor(private timeoutMs = Number(process.env.DSH_TIMEOUT_MS ?? 240_000)) {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600_000)
      throw new Error('DSH_TIMEOUT_MS must be between 1000 and 600000');
  }
  async request<T>(
    task: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    signal: AbortSignal,
  ): Promise<T> {
    const command = await locateDsh();
    const scratch = await mkdtemp(join(tmpdir(), 'greyzone-dsh-'));
    try {
      const patch = [
        ...disabledPlugins.map((id) => ({ id, disabled: true })),
        { id: 'tools', config: { mode: 'native' } },
        { id: 'system-prompt', config: { persona, includeRuntimeContext: false } },
        { id: 'headless-runner', config: { task } },
      ];
      const patchPath = join(scratch, 'game.patch.yml');
      // JSON is valid YAML. The full prompt goes through a file, avoiding Windows argv limits.
      await writeFile(patchPath, JSON.stringify(patch), { mode: 0o600 });
      const answer = await runProcess(
        command,
        ['--profile', 'headless', '--patch', patchPath, 'Adjudicate the supplied game request.'],
        { cwd: scratch, timeoutMs: this.timeoutMs, signal },
      );
      try {
        return parseJson(answer, schema);
      } catch (error) {
        if (process.env.DSH_DEBUG === '1') {
          const { mkdir } = await import('node:fs/promises');
          await mkdir(resolve('.data/verification'), { recursive: true });
          await writeFile(resolve('.data/verification/invalid-model-output.txt'), answer);
        }
        throw error;
      }
    } finally {
      if (
        dirname(resolve(scratch)) !== resolve(tmpdir()) ||
        !basename(scratch).startsWith('greyzone-dsh-')
      )
        throw new Error('Unexpected dsh temporary directory');
      await rm(scratch, { recursive: true, force: true });
    }
  }
  async plan(
    state: SessionState,
    actorId: string,
    intent: string,
    signal: AbortSignal,
    onProgress?: (stage: string) => void,
  ): Promise<Plan> {
    return adjudicate(
      (prompt, abort) => this.request(prompt, z.unknown(), abort),
      state,
      actorId,
      intent,
      signal,
      protocol,
      onProgress,
    );
  }
  async create(state: SessionState, actorId: string, message: string, signal: AbortSignal) {
    return createWithModel(
      (prompt, abort) => this.request(prompt, z.unknown(), abort),
      state,
      actorId,
      message,
      signal,
    );
  }
  async respond(
    state: SessionState,
    actorId: string,
    intent: string,
    signal: AbortSignal,
    onProgress?: (stage: string) => void,
  ) {
    return adjudicate(
      (prompt, abort) => this.request(prompt, z.unknown(), abort),
      state,
      actorId,
      intent,
      signal,
      protocol + sheetProtocol,
      onProgress,
      true,
    );
  }
}
export async function dshVersion(): Promise<string> {
  return runProcess(await locateDsh(), ['--version'], { timeoutMs: 15_000 });
}
export class LocalDirector implements Director {
  async plan(): Promise<Plan> {
    throw new GameError('规则演练不调用主持模型，只提供基础操作。自由行动请使用 dsh 房间。');
  }
}
export async function loadEnv(): Promise<void> {
  // Node's built-in .env parser; existing environment values keep precedence.
  try {
    await readFile('.env');
    process.loadEnvFile('.env');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
