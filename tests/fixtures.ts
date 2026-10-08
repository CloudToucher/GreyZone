import { Store } from '../server/store.js';
import { Library } from '../server/library.js';
import { GameTools } from '../server/tools.js';
import type { Campaign, GameRecord, Run } from '../shared/types.js';
import type { Director } from '../server/dsh.js';

export const record = (id: string, kind = 'character', audience = ['pc-a']): GameRecord => ({
  id,
  kind,
  name: id,
  audience,
  secret: '',
  data:
    kind === 'character'
      ? {
          stats: { body: 2, agility: 1, perception: 1, mind: 0 },
          specialties: ['维修', '观察', '攀爬'],
          resources: { cash: 100 },
          conditions: [],
          ready: true,
          delegated: false,
          location: 'fence',
        }
      : {},
});
export function fixture(die = () => 10) {
  const store = new Store(':memory:'),
    library = new Library();
  const room: Campaign = {
    format: 3,
    id: 'ABC123',
    title: '工具验证',
    revision: 0,
    worldVersion: 0,
    world: library.seed(),
    board: [],
    messages: [],
    journal: [],
    sessionId: 'test-session',
    sessionReady: false,
  };
  room.world.records['pc-a'] = record('pc-a');
  room.world.records['pc-b'] = record('pc-b', 'character', ['pc-b']);
  room.world.records.rope = { ...record('rope', 'item'), data: { owner: 'pc-a', quantity: 6 } };
  store.saveRoom(room);
  const host = store.addSeat(room.id, '房主', true),
    guest = store.addSeat(room.id, '同伴', false);
  host.seat.characters = ['pc-a'];
  guest.seat.characters = ['pc-b'];
  store.saveSeat(host.seat);
  store.saveSeat(guest.seat);
  const run = makeRun(room);
  store.saveRun(run);
  return {
    store,
    library,
    room,
    run,
    host,
    guest,
    tools: new GameTools(store, library, () => {}, die),
  };
}
export function makeRun(room: Campaign, kind: Run['kind'] = 'round'): Run {
  return {
    id: 'run-1',
    roomId: room.id,
    kind,
    status: 'running',
    baseVersion: room.worldVersion,
    draft: structuredClone(room.world),
    actions: [
      {
        id: 'action-1',
        seatId: 'seat-a',
        characterId: 'pc-a',
        text: '我尝试维修泵。',
        audience: ['pc-a'],
        createdAt: '2037-03-15',
      },
    ],
    request: '裁决',
    changes: [],
    decisions: [],
    checkpoint: 0,
    createdAt: new Date().toISOString(),
    metrics: {
      elapsedMs: 0,
      toolCalls: 0,
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      compactions: 0,
      resumptions: 0,
    },
  };
}
export const commit = (key = 'commit', finish = true) => ({
  key,
  passages: [{ text: '泵重新转动，积水开始下降。', audience: ['pc-a'] }],
  decisions: [{ actionId: 'action-1', status: 'done', reason: '完成维修' }],
  finish,
});
export class ManualDirector implements Director {
  launched: string[] = [];
  constructor(public store: Store) {}
  async launch(id: string) {
    this.launched.push(id);
  }
  stage() {
    return '';
  }
  stop() {}
  async compact() {
    return true;
  }
  close() {}
  authorized(_room: string, token: string) {
    return token === 'test-mcp-token';
  }
  toolRun(room: string) {
    return this.store.active(room)?.id;
  }
}
