import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Campaign, Run, Seat, Roll } from '../shared/types.js';

export class Fault extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const uid = (prefix = 'id') => `${prefix}-${randomUUID().slice(0, 12)}`;
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const stableJson = (value: unknown): string =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
export class Store {
  db: DatabaseSync;
  private lock?: string;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    if (path !== ':memory:') {
      this.lock = path + '.lock';
      for (let attempt = 0; ; attempt++) {
        try {
          writeFileSync(this.lock, String(process.pid), { flag: 'wx' });
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt > 1) throw error;
          const pid = Number(readFileSync(this.lock, 'utf8'));
          let alive = true;
          try {
            if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid lock');
            process.kill(pid, 0);
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
            else throw new Fault('存档锁无法核实，请检查对应服务进程。', 409);
          }
          if (alive)
            throw new Fault('这个存档目录已有服务运行。请使用已有服务或另一个 DATA_DIR。', 409);
          unlinkSync(this.lock);
        }
      }
    }
    try {
      this.db = new DatabaseSync(path);
      this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS campaigns(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS seats(id TEXT PRIMARY KEY, room TEXT NOT NULL REFERENCES campaigns(id), token TEXT UNIQUE NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, room TEXT NOT NULL REFERENCES campaigns(id), status TEXT NOT NULL, data TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS one_open_run ON runs(room) WHERE status!='completed';
      CREATE TABLE IF NOT EXISTS receipts(scope TEXT NOT NULL, key TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(scope,key));
      CREATE TABLE IF NOT EXISTS rolls(run TEXT NOT NULL REFERENCES runs(id), id TEXT NOT NULL, fingerprint TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(run,id));
      CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY, room TEXT NOT NULL, run TEXT, checkpoint INTEGER, data TEXT NOT NULL, created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS metrics(seq INTEGER PRIMARY KEY, run TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS record_index(room TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, fingerprint TEXT NOT NULL, updated TEXT NOT NULL, refs TEXT NOT NULL, PRIMARY KEY(room,id));
      CREATE INDEX IF NOT EXISTS record_kind ON record_index(room,kind);
      PRAGMA user_version=3;`);
      for (const row of this.db.prepare("SELECT data FROM runs WHERE status='running'").all()) {
        const run = JSON.parse(String(row.data)) as Run;
        run.status = 'failed';
        run.error = '主持进程已中断，可以继续本轮。';
        this.saveRun(run);
      }
      for (const row of this.db.prepare('SELECT data FROM campaigns').all())
        this.indexRecords(JSON.parse(String(row.data)));
    } catch (error) {
      if (this.lock) unlinkSync(this.lock);
      throw error;
    }
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  room(id: string): Campaign {
    const row = this.db.prepare('SELECT data FROM campaigns WHERE id=?').get(id);
    if (!row) throw new Fault('这个团桌不存在。', 404);
    return JSON.parse(String(row.data));
  }
  saveRoom(room: Campaign) {
    this.db
      .prepare('INSERT INTO campaigns VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')
      .run(room.id, JSON.stringify(room));
    this.indexRecords(room);
  }
  private indexRecords(room: Campaign) {
    const prior = new Map(
      this.db
        .prepare('SELECT id,fingerprint FROM record_index WHERE room=?')
        .all(room.id)
        .map((r) => [String(r.id), String(r.fingerprint)]),
    );
    for (const record of Object.values(room.world.records)) {
      const fingerprint = hash(JSON.stringify(record));
      if (prior.get(record.id) === fingerprint) continue;
      const refs = new Set<string>();
      const scan = (value: unknown) => {
        if (typeof value === 'string' && room.world.records[value] && value !== record.id)
          refs.add(value);
        else if (value && typeof value === 'object') Object.values(value).forEach(scan);
      };
      scan(record.data);
      this.db
        .prepare(
          'INSERT INTO record_index VALUES(?,?,?,?,?,?,?) ON CONFLICT(room,id) DO UPDATE SET kind=excluded.kind,name=excluded.name,fingerprint=excluded.fingerprint,updated=excluded.updated,refs=excluded.refs',
        )
        .run(
          room.id,
          record.id,
          record.kind,
          record.name,
          fingerprint,
          new Date().toISOString(),
          JSON.stringify([...refs]),
        );
    }
    for (const id of prior.keys())
      if (!room.world.records[id])
        this.db.prepare('DELETE FROM record_index WHERE room=? AND id=?').run(room.id, id);
  }
  recordInfo(room: string, id: string) {
    const row = this.db
      .prepare('SELECT updated,refs FROM record_index WHERE room=? AND id=?')
      .get(room, id);
    return row
      ? { id, updatedAt: String(row.updated), references: JSON.parse(String(row.refs)) as string[] }
      : { id, staged: true };
  }
  seats(room: string): Seat[] {
    return this.db
      .prepare('SELECT data FROM seats WHERE room=?')
      .all(room)
      .map((r) => JSON.parse(String(r.data)));
  }
  addSeat(room: string, name: string, host: boolean): { seat: Seat; token: string } {
    const token = randomBytes(32).toString('hex');
    const seat: Seat = { id: uid('seat'), name, host, characters: [] };
    this.db
      .prepare('INSERT INTO seats VALUES(?,?,?,?)')
      .run(seat.id, room, hash(token), JSON.stringify(seat));
    return { seat, token };
  }
  saveSeat(seat: Seat) {
    this.db.prepare('UPDATE seats SET data=? WHERE id=?').run(JSON.stringify(seat), seat.id);
  }
  authenticate(room: string, token: string): Seat {
    const row = this.db
      .prepare('SELECT data FROM seats WHERE room=? AND token=?')
      .get(room, hash(token));
    if (!row) throw new Fault('请从你的团桌入口重新加入。', 401);
    return JSON.parse(String(row.data));
  }
  run(id: string): Run {
    const row = this.db.prepare('SELECT data FROM runs WHERE id=?').get(id);
    if (!row) throw new Fault('裁决记录不存在。', 404);
    return JSON.parse(String(row.data));
  }
  active(room: string): Run | null {
    const row = this.db
      .prepare("SELECT data FROM runs WHERE room=? AND status!='completed'")
      .get(room);
    return row ? JSON.parse(String(row.data)) : null;
  }
  saveRun(run: Run) {
    this.db
      .prepare(
        'INSERT INTO runs VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,data=excluded.data',
      )
      .run(run.id, run.roomId, run.status, JSON.stringify(run));
  }
  once<T>(scope: string, key: string, args: unknown, fn: () => T, atomic = true): T {
    const fingerprint = hash(stableJson(args));
    const row = this.db
      .prepare('SELECT fingerprint,result FROM receipts WHERE scope=? AND key=?')
      .get(scope, key);
    if (row) {
      if (row.fingerprint !== fingerprint && row.fingerprint !== hash(JSON.stringify(args)))
        throw new Fault(
          '这个 key 已完成另一项操作。同一工具的新操作需要新的 key；重试则保留原 key 和原内容。',
          409,
        );
      return JSON.parse(String(row.result));
    }
    const execute = () => {
      const result = fn();
      this.db
        .prepare('INSERT INTO receipts VALUES(?,?,?,?)')
        .run(scope, key, fingerprint, JSON.stringify(result));
      return result;
    };
    return atomic ? this.transaction(execute) : execute();
  }
  recordRoll(runId: string, id: string, args: unknown, roll: () => Roll): Roll {
    const fingerprint = hash(stableJson(args));
    const row = this.db
      .prepare('SELECT fingerprint,data FROM rolls WHERE run=? AND id=?')
      .get(runId, id);
    if (row) {
      if (row.fingerprint !== fingerprint && row.fingerprint !== hash(JSON.stringify(args)))
        throw new Fault('检定依据已锁定，不能在看到骰子后更换。', 409);
      return JSON.parse(String(row.data));
    }
    const result = roll();
    this.db
      .prepare('INSERT INTO rolls VALUES(?,?,?,?)')
      .run(runId, id, fingerprint, JSON.stringify(result));
    return result;
  }
  rolls(runId: string): Roll[] {
    return this.db
      .prepare('SELECT data FROM rolls WHERE run=? ORDER BY rowid')
      .all(runId)
      .map((r) => JSON.parse(String(r.data)));
  }
  roomRolls(room: string): Roll[] {
    return this.db
      .prepare(
        'SELECT rolls.data FROM rolls JOIN runs ON runs.id=rolls.run WHERE runs.room=? ORDER BY rolls.rowid',
      )
      .all(room)
      .map((r) => JSON.parse(String(r.data)));
  }
  audit(run: Run, data: unknown) {
    this.db
      .prepare('INSERT INTO audit(room,run,checkpoint,data,created) VALUES(?,?,?,?,?)')
      .run(run.roomId, run.id, run.checkpoint, JSON.stringify(data), new Date().toISOString());
  }
  recentMovements(room: string) {
    return this.db
      .prepare('SELECT data FROM audit WHERE room=? ORDER BY seq DESC LIMIT 12')
      .all(room)
      .flatMap((r) => JSON.parse(String(r.data)).movements ?? [])
      .slice(0, 12);
  }
  close() {
    this.db.close();
    if (this.lock) {
      unlinkSync(this.lock);
      this.lock = undefined;
    }
  }
}
