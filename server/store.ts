import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { sessionSchema, type SessionState } from '../shared/types.js';
import { GameError } from './engine.js';
export interface Seat {
  tokenHash: string;
  characterId: string;
  host: boolean;
}
export interface SavedRoom {
  format: 2;
  state: SessionState;
  seats: Seat[];
  receipts: { id: string; actorId: string }[];
}
const roomSchema = z.object({
  format: z.literal(2),
  state: sessionSchema,
  seats: z
    .array(
      z.object({
        tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
        characterId: z.string(),
        host: z.boolean(),
      }),
    )
    .min(1)
    .max(4),
  receipts: z.array(z.object({ id: z.string().uuid(), actorId: z.string() })).max(128),
});
export function validateRoom(raw: unknown): SavedRoom {
  const room = roomSchema.parse(raw),
    s = room.state;
  if (
    new Set(s.characters.map((c) => c.id)).size !== s.characters.length ||
    room.seats.length !== s.characters.length ||
    room.seats.filter((x) => x.host).length !== 1 ||
    new Set(room.seats.map((x) => x.characterId)).size !== room.seats.length ||
    room.seats.some((x) => !s.characters.some((c) => c.id === x.characterId))
  )
    throw new Error('Invalid seats');
  const ids = s.locations.map((l) => l.id);
  if (
    new Set(s.entities.map((e) => e.id)).size !== s.entities.length ||
    s.characters.some((c) => !ids.includes(c.location)) ||
    s.entities.some((e) => !ids.includes(e.location)) ||
    s.routes.some((r) => !ids.includes(r.from) || !ids.includes(r.to))
  )
    throw new Error('Invalid world references');
  for (const c of [...s.characters, ...s.entities])
    if (
      new Set(c.inventory.map((i) => i.id)).size !== c.inventory.length ||
      c.inventory.some((i) => i.weapon && i.weapon.loaded > i.weapon.capacity)
    )
      throw new Error('Invalid inventory');
  if (s.proposal && !s.characters.some((c) => c.id === s.proposal!.actorId))
    throw new Error('Invalid proposal');
  for (const [id, workshop] of Object.entries(s.workshops)) {
    const c = s.characters.find((c) => c.id === id);
    if (!c || workshop.accepted !== c.ready)
      throw new Error('Invalid workshop owner or adoption state');
  }
  if (s.characters.some((c) => !c.ready && !s.workshops[c.id]))
    throw new Error('Unformed character without workshop');
  for (const [id, proposal] of Object.entries(s.sheetProposals))
    if (proposal.actorId !== id || !s.characters.some((c) => c.ready && c.id === id))
      throw new Error('Invalid sheet proposal owner');
  return room;
}
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('hex');

export class Store {
  private rooms = new Map<string, SavedRoom>();
  private locks = new Set<string>();
  private lockIdentity = randomUUID();
  private ownsLock = false;
  constructor(readonly directory: string) {
    this.directory = resolve(directory);
  }
  async init(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const lockFile = join(this.directory, 'server.lock');
    try {
      const lock = await open(lockFile, 'wx', 0o600);
      await lock.writeFile(JSON.stringify({ pid: process.pid, identity: this.lockIdentity }));
      await lock.close();
      this.ownsLock = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const prior = JSON.parse(await readFile(lockFile, 'utf8')) as { pid: number };
      let alive = true;
      try {
        process.kill(prior.pid, 0);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
      }
      if (alive)
        throw new Error('此存档目录已被另一个服务占用。请关闭原进程或使用另一个 DATA_DIR。');
      await rm(lockFile);
      return this.init();
    }
    try {
      for (const file of await readdir(this.directory)) {
        if (!/^[A-Z0-9]{6}\.json$/.test(file)) continue;
        try {
          const raw = JSON.parse(await readFile(join(this.directory, file), 'utf8'));
          if (raw.format === 1) {
            const archive = join(this.directory, 'legacy-v1');
            await mkdir(archive, { recursive: true });
            await rename(join(this.directory, file), join(archive, `${Date.now()}-${file}`));
            continue;
          }
          const room = validateRoom(raw);
          if (`${room.state.id}.json` !== file) throw new Error('Room id mismatch');
          this.rooms.set(room.state.id, room);
        } catch {
          throw new Error(`存档 ${file} 校验失败。原文件已保留，请从备份恢复，不会自动覆盖。`);
        }
      }
    } catch (error) {
      await this.close();
      throw error;
    }
  }
  async close(): Promise<void> {
    if (!this.ownsLock) return;
    const file = join(this.directory, 'server.lock');
    try {
      const lock = JSON.parse(await readFile(file, 'utf8'));
      if (lock.identity === this.lockIdentity) await rm(file);
    } finally {
      this.ownsLock = false;
    }
  }
  get(id: string): SavedRoom {
    const room = this.rooms.get(id);
    if (!room) throw new GameError('房间不存在，请检查六位房间码。', 404);
    return structuredClone(room);
  }
  has(id: string): boolean {
    return this.rooms.has(id);
  }
  authenticate(id: string, token: string): Seat {
    const room = this.get(id),
      hash = Buffer.from(tokenHash(token), 'hex');
    const seat = room.seats.find((s) => timingSafeEqual(Buffer.from(s.tokenHash, 'hex'), hash));
    if (!seat) throw new GameError('房间凭证无效，请从原浏览器继续或加入新角色。', 401);
    return seat;
  }
  async save(room: SavedRoom): Promise<void> {
    const checked = validateRoom(room),
      path = join(this.directory, `${checked.state.id}.json`);
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(JSON.stringify(checked));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, path);
      this.rooms.set(checked.state.id, structuredClone(checked));
    } finally {
      await rm(temporary, { force: true });
    }
  }
  async exclusive<T>(id: string, task: () => Promise<T>): Promise<T> {
    if (this.locks.has(id)) throw new GameError('房间正在处理另一个操作，请稍后重试。', 409);
    this.locks.add(id);
    try {
      return await task();
    } finally {
      this.locks.delete(id);
    }
  }
}
