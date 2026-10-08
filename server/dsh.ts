import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, delimiter } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { Store, Fault, uid } from './store.js';
import { Library } from './library.js';
import { context } from './projection.js';
import type { Run } from '../shared/types.js';

export function locateDsh() {
  const candidates = [
    process.env.DSH_BIN,
    process.env.APPDATA
      ? join(process.env.APPDATA, 'npm/node_modules/@deepseek-ai/dsh/lib/bin.js')
      : undefined,
    ...(process.env.PATH ?? '')
      .split(delimiter)
      .map((p) => join(p, 'node_modules/@deepseek-ai/dsh/lib/bin.js')),
  ].filter(Boolean) as string[];
  const bin = candidates.find((p) => existsSync(p));
  if (!bin)
    throw new Fault('未找到 dsh。安装 @deepseek-ai/dsh 并在 dsh 中配置模型，或设置 DSH_BIN。', 503);
  const root = dirname(dirname(bin));
  return {
    bin: resolve(bin),
    vendor: join(root, 'node_modules/@deepseek-ai'),
    version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
  };
}
interface RpcResult {
  ok: boolean;
  error?: string;
  reason?: string;
  compacted?: boolean;
  metrics?: Partial<Run['metrics']>;
}
class Worker {
  child: ChildProcessWithoutNullStreams;
  token = randomBytes(32).toString('hex');
  pending = new Map<
    string,
    { resolve: (v: RpcResult) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  ready: Promise<void>;
  stderr = '';
  constructor(
    public roomId: string,
    directory: string,
    url: string,
    sessionId: string,
    persona: string,
    booted: () => void,
  ) {
    const dsh = locateDsh(),
      dir = resolve(directory, 'runtime', roomId);
    mkdirSync(dir, { recursive: true });
    const personaPath = join(dir, 'persona.md');
    writeFileSync(personaPath, persona);
    const disabled = [
      'headless-runner',
      'headless-startup',
      'hmr',
      'code-runtime',
      'session-title-llm',
      'session-telemetry-otel',
      'tool-bash',
      'tool-pwsh',
      'tool-jobs',
      'tool-fs',
      'tool-fs-search',
      'agent-instructions',
      'skill-filesystem',
      'tool-skill',
      'goal',
      'goal-round-driver',
      'command-goal',
      'plan-mode',
      'command-compact',
      'subagent',
      'subagent-spawn-in-process',
      'subagent-fork-in-process',
      'tool-subagent-control',
      'tool-subagent-list-agents',
      'tool-subagent',
      'tool-subagent-fork',
      'tool-subagent-report',
      'workflow-worker-thread',
      'tool-workflow',
      'tool-todo',
      'tool-goal',
      'tool-ralph',
      'tool-str-replace-editor',
      'repeat-tool-reminder',
      'tool-web',
      'web-search-deepseek',
    ];
    const patch = [
      ...disabled.map((id) => ({ id, disabled: true })),
      { id: 'tools', config: { mode: 'native' } },
      {
        id: 'system-prompt',
        config: { persona, includeHarnessIdentity: false, includeRuntimeContext: false },
      },
      { id: 'session-persistence-jsonl', config: { root: resolve(directory, 'dsh-sessions') } },
      {
        id: 'compaction-basic',
        name: pathToFileURL(resolve('runtime/compaction.mjs')).href,
        config: { thresholdRatio: 0.7, retainTokens: 3500, maxTokens: 4096 },
      },
      {
        insert: [
          {
            id: 'greyzone-mcp',
            name: '@deepseek-ai/dsh-mcp-client',
            config: {
              serverName: 'table',
              transport: 'streamable-http',
              url: `${url}/internal/mcp/${roomId}`,
              headers: { Authorization: `Bearer ${this.token}` },
              failOnStartupError: true,
            },
          },
          { id: 'greyzone-runner', name: pathToFileURL(resolve('runtime/runner.mjs')).href },
        ],
      },
    ];
    const patchPath = join(dir, 'gm.patch.json');
    writeFileSync(patchPath, JSON.stringify(patch, null, 2));
    this.child = spawn(process.execPath, [dsh.bin, '--profile', 'headless', '--patch', patchPath], {
      cwd: resolve('.'),
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GZ_DSH_PACKAGES: dsh.vendor,
        GZ_SESSION: sessionId,
        GZ_PERSONA_FILE: personaPath,
      },
    });
    this.child.stdin.on('error', () => {});
    let buffer = '';
    this.ready = new Promise((ready, reject) => {
      const timer = setTimeout(() => reject(new Error('dsh 启动超时。')), 45000);
      this.child.stdout.setEncoding('utf8');
      this.child.stderr.setEncoding('utf8');
      this.child.stderr.on('data', (chunk: string) => {
        this.stderr = (this.stderr + chunk).slice(-12000);
      });
      this.child.stdout.on('data', (chunk: string) => {
        buffer += chunk;
        while (buffer.includes('\n')) {
          const at = buffer.indexOf('\n'),
            line = buffer.slice(0, at);
          buffer = buffer.slice(at + 1);
          if (!line.startsWith('GZ_RPC ')) continue;
          try {
            const value = JSON.parse(line.slice(7));
            if (value.ready) {
              clearTimeout(timer);
              ready();
            } else if (value.booted) {
              booted();
            } else if (value.startupError) {
              clearTimeout(timer);
              reject(new Error(value.startupError));
            } else {
              const call = this.pending.get(value.id);
              if (call) {
                clearTimeout(call.timer);
                this.pending.delete(value.id);
                call.resolve(value);
              }
            }
          } catch {
            /* Non-protocol output is private. */
          }
        }
      });
      const fail = () => {
        clearTimeout(timer);
        const e = new Error('dsh 进程已退出。');
        reject(e);
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(e);
        }
        this.pending.clear();
      };
      this.child.on('exit', fail);
      this.child.on('error', fail);
    });
    // Manager awaits readiness after registering MCP authentication.
    this.ready.catch(() => {});
  }
  async request(
    method: string,
    data: Record<string, unknown> = {},
    timeout = 300000,
  ): Promise<RpcResult> {
    await this.ready;
    const id = uid('rpc');
    return new Promise((resolveCall, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.child.kill();
        reject(new Error('主持超时；已保存的阶段和骰子可继续使用。'));
      }, timeout);
      this.pending.set(id, { resolve: resolveCall, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, ...data }) + '\n');
    });
  }
  stop() {
    if (this.child.killed || this.child.exitCode !== null) return;
    this.child.stdin.write(JSON.stringify({ id: uid('cancel'), method: 'cancel' }) + '\n');
    const timer = setTimeout(() => this.child.kill(), 1500);
    timer.unref();
  }
}
export interface Director {
  launch(runId: string): Promise<void>;
  stop(roomId: string): void;
  compact(roomId: string): Promise<boolean>;
  close(): void;
  stage(roomId: string): string;
  authorized(room: string, token: string): boolean;
  toolRun(room: string): string | undefined;
  progress?(room: string, stage: string): void;
}
export class DshDirector implements Director {
  workers = new Map<string, Worker>();
  running = new Map<string, Promise<void>>();
  scheduled = new Map<string, Promise<void>>();
  executing = new Map<string, string>();
  executingGeneration = new Map<string, number>();
  stages = new Map<string, string>();
  baseUrl = '';
  private closed = false;
  constructor(
    public store: Store,
    public library: Library,
    public directory: string,
    private changed: (id: string) => void = () => {},
  ) {}
  stage(room: string) {
    return this.stages.get(room) ?? '';
  }
  authorized(room: string, token: string) {
    return this.workers.get(room)?.token === token;
  }
  toolRun(room: string) {
    const id = this.executing.get(room);
    return id && this.store.run(id).metrics.resumptions === this.executingGeneration.get(room)
      ? id
      : undefined;
  }
  progress(room: string, stage: string) {
    this.stages.set(room, stage);
    this.changed(room);
  }
  private worker(roomId: string) {
    let worker = this.workers.get(roomId);
    if (worker && worker.child.exitCode === null && !worker.child.killed) return worker;
    const room = this.store.room(roomId);
    const persona =
      this.library.get('gm/charter.md').text +
      '\n\n' +
      this.library.get('rules/quick.md').text +
      '\n\n工具名均带 mcp__table__ 前缀；使用原生工具。回复玩家必须经 turn_commit / turn_ask 发布。不要只在最终文本里宣布结果。普通数值更新可和叙述一起 turn_commit。长期资料可检索；新NPC资料若需检定，先补 stats/specialties。';
    worker = new Worker(roomId, this.directory, this.baseUrl, room.sessionId, persona, () => {
      const fresh = this.store.room(roomId);
      fresh.sessionReady = true;
      this.store.saveRoom(fresh);
    });
    this.workers.set(roomId, worker);
    return worker;
  }
  async launch(runId: string) {
    if (this.closed) throw new Fault('主持服务正在关闭。', 503);
    const run = this.store.run(runId);
    const generation = run.metrics.resumptions;
    const ticket = `${runId}:${generation}`;
    const existing = this.scheduled.get(ticket);
    if (existing) return existing;
    const previous = this.running.get(run.roomId) ?? Promise.resolve();
    const task = previous
      .catch(() => {})
      .then(async () => {
        const fresh = this.store.run(runId);
        if (!this.closed && fresh.status === 'running' && fresh.metrics.resumptions === generation)
          await this.execute(runId);
      });
    this.scheduled.set(ticket, task);
    this.running.set(run.roomId, task);
    try {
      await task;
    } finally {
      this.scheduled.delete(ticket);
      if (this.running.get(run.roomId) === task) this.running.delete(run.roomId);
    }
  }
  private async execute(runId: string) {
    let run = this.store.run(runId);
    const generation = run.metrics.resumptions;
    const started = Date.now();
    this.executing.set(run.roomId, runId);
    this.executingGeneration.set(run.roomId, generation);
    this.stages.set(run.roomId, run.kind === 'workshop' ? '主持人正在整理角色' : '主持人正在裁决');
    this.changed(run.roomId);
    try {
      const room = this.store.room(run.roomId),
        worker = this.worker(run.roomId);
      const prompt = JSON.stringify({
        instruction:
          run.kind === 'workshop'
            ? '与玩家讨论并更新本角色完整可采用的草案及初始物品。使用 turn_commit 发布；本轮只维护此角色。'
            : run.kind === 'discussion'
              ? '回答玩家的场外问题，不改变世界，使用 turn_commit 发布自然回复。'
              : '处理本批冻结行动，按情境决定顺序、检定和实际后果。读到骰子后继续主持。已提交的部分不要重复。通过 turn_commit 发布，或在真正的新选择处 turn_ask。',
        context: context(room, run, this.store),
        documents: this.library.documents.map((d) => ({ id: d.id, title: d.title })),
      });
      const result = await worker.request(
        'run',
        { prompt, resume: room.sessionReady },
        Number(process.env.DSH_TIMEOUT_MS ?? 600000),
      );
      const fresh = this.store.room(run.roomId);
      fresh.sessionReady = true;
      this.store.saveRoom(fresh);
      run = this.store.run(runId);
      if (result.metrics)
        for (const [key, value] of Object.entries(result.metrics))
          if (typeof value === 'number')
            run.metrics[key as keyof Run['metrics']] =
              (run.metrics[key as keyof Run['metrics']] ?? 0) + value;
      if (run.status === 'running' && run.metrics.resumptions === generation) {
        run.status = 'failed';
        run.error = '主持人尚未发布本轮结果。已保留检定和草稿，可继续裁决。';
      }
      this.store.saveRun(run);
      if (!result.ok && result.error)
        writeFileSync(
          resolve(this.directory, 'runtime', run.roomId, 'last-error.txt'),
          result.error,
        );
    } catch (error) {
      run = this.store.run(runId);
      run.metrics.elapsedMs += Date.now() - started;
      if (run.status === 'running' && run.metrics.resumptions === generation) {
        run.status = 'failed';
        run.error = '主持连接中断。已保留进度，可以继续本轮。';
      }
      this.store.saveRun(run);
      const worker = this.workers.get(run.roomId);
      if (worker) {
        const diagnostic = worker.stderr || String(error);
        writeFileSync(resolve(this.directory, 'runtime', run.roomId, 'last-error.txt'), diagnostic);
        worker.stop();
        this.workers.delete(run.roomId);
      }
    } finally {
      this.executing.delete(run.roomId);
      this.executingGeneration.delete(run.roomId);
      this.stages.delete(run.roomId);
      this.changed(run.roomId);
    }
  }
  stop(roomId: string) {
    this.workers.get(roomId)?.stop();
    this.workers.delete(roomId);
  }
  async compact(roomId: string) {
    if (this.running.has(roomId) || this.store.active(roomId))
      throw new Fault('本轮完成后才能整理长期记忆。', 409);
    let compacted = false;
    this.stages.set(roomId, '主持人正在整理长期记忆');
    const task = (async () => {
      const room = this.store.room(roomId);
      const result = await this.worker(roomId).request('compact', { resume: room.sessionReady });
      if (!result.ok) throw new Fault('记忆整理未完成，原记录仍保留。', 502);
      compacted = result.compacted ?? false;
      this.store.db
        .prepare('INSERT INTO metrics(run,data) VALUES(?,?)')
        .run(room.sessionId, JSON.stringify({ kind: 'compaction', ...result }));
    })();
    this.running.set(roomId, task);
    try {
      await task;
      return compacted;
    } finally {
      if (this.running.get(roomId) === task) this.running.delete(roomId);
      this.stages.delete(roomId);
      this.changed(roomId);
    }
  }
  async close() {
    this.closed = true;
    for (const worker of this.workers.values()) worker.stop();
    this.workers.clear();
    await Promise.allSettled(this.running.values());
  }
}
