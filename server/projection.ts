import type {
  Campaign,
  Seat,
  Run,
  World,
  PublicState,
  Json,
  Data,
  GameRecord,
} from '../shared/types.js';
import type { Store } from './store.js';
import { calendarLabel } from '../shared/types.js';
export const visible = (audience: string[], seat: Seat) =>
  audience.includes('table') || audience.some((id) => seat.characters.includes(id));
export function project(store: Store, room: Campaign, seat: Seat, stage = ''): PublicState {
  const run = store.active(room.id);
  const question = run?.status === 'waiting' ? run.question : undefined;
  const records = Object.values(room.world.records).filter(
    (r) => !r.data.aliasOf && (visible(r.audience, seat) || seat.characters.includes(r.id)),
  );
  const allowed = new Set(records.map((r) => r.id));
  const rolls = store
    .roomRolls(room.id)
    .filter(
      (r) =>
        visible(r.audience, seat) &&
        room.journal.some(
          (e) => e.runId === r.runId && (e.checkIds?.includes(r.id) ?? r.createdAt <= e.createdAt),
        ),
    );
  const allowedRolls = new Set(rolls.map((r) => `${r.runId}:${r.id}`));
  const redact = (value: Json): Json => {
    if (typeof value === 'string' && room.world.records[value] && !allowed.has(value)) return null;
    if (Array.isArray(value)) return value.map(redact).filter((v) => v !== null);
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v)]));
    return value;
  };
  return {
    id: room.id,
    title: room.title,
    revision: room.revision,
    minute: room.world.minute,
    me: seat,
    seats: store.seats(room.id),
    records: records.map(({ id, kind, name, data }) => ({
      id,
      kind,
      name,
      data: redact(data) as Data,
    })),
    board: room.board
      .filter((a) => a.seatId === seat.id || visible(a.audience, seat))
      .map((a) => ({ ...a, characterName: room.world.records[a.characterId]?.name })),
    boardCount: room.board.length,
    submittedSeats: [...new Set(room.board.map((a) => a.seatId))],
    messages: room.messages.filter((m) => visible(m.audience, seat)),
    journal: room.journal
      .map((e) => ({
        ...e,
        checkIds: e.checkIds?.filter((id) => allowedRolls.has(`${e.runId}:${id}`)),
        passages: e.passages.filter((p) => visible(p.audience, seat)),
        changes: e.changes
          .filter((c) => visible(c.audience, seat))
          .map((c) => ({ ...c, reason: '' })),
        decisions: e.decisions.filter((d) => {
          const source = store.run(e.runId).actions.find((a) => a.id === d.actionId);
          return source && (source.seatId === seat.id || visible(source.audience, seat));
        }),
      }))
      .filter((e) => e.passages.length || e.changes.length || e.decisions.length),
    rolls: rolls.map((r) => ({
      ...r,
      basis: '',
      ...(r.opponent
        ? {
            opponent: {
              ...r.opponent,
              actorId: allowed.has(r.opponent.actorId) ? r.opponent.actorId : 'unknown',
            },
          }
        : {}),
    })),
    run: run
      ? {
          id: run.id,
          kind: run.kind,
          status: run.status,
          checkpoint: run.checkpoint,
          stage,
          ...(run.error ? { error: run.error } : {}),
          ...(question && question.characters.some((c) => seat.characters.includes(c))
            ? {
                question: {
                  ...question,
                  characters: question.characters.filter((c) => seat.characters.includes(c)),
                  answers: Object.fromEntries(
                    Object.entries(question.answers).filter(([id]) => seat.characters.includes(id)),
                  ),
                },
              }
            : {}),
        }
      : null,
  };
}
export function due(world: World) {
  const records = Object.values(world.records);
  const deadlines: GameRecord[] = records.flatMap((r) =>
    Array.isArray(r.data.conditions)
      ? (r.data.conditions as Data[])
          .filter((c) => typeof c.deadline === 'number' && c.deadline <= world.minute)
          .map((c) => ({
            id: `${r.id}:${c.id}`,
            kind: 'deadline',
            name: `${r.name}：${c.name}`,
            audience: r.audience,
            secret: '',
            data: {
              actor: r.id,
              condition: c.id,
              due: c.deadline,
              description: c.description,
              remedy: c.remedy ?? '',
            },
          }))
      : [],
  );
  return [
    ...deadlines,
    ...records.filter(
      (r) =>
        r.kind === 'clock' &&
        r.data.status === 'pending' &&
        typeof r.data.due === 'number' &&
        r.data.due <= world.minute,
    ),
  ];
}
export function context(room: Campaign, run: Run, store: Store) {
  const ids = new Set(run.actions.map((a) => a.characterId));
  if (run.ownerCharacter) ids.add(run.ownerCharacter);
  const players = new Set(store.seats(room.id).flatMap((s) => s.characters));
  const characters = Object.values(run.draft.records).filter((r) => players.has(r.id));
  const locations = new Set(
    characters.filter((r) => ids.has(r.id) || r.data.ready).map((r) => r.data.location),
  );
  const records = Object.values(run.draft.records).filter((r) => !r.data.aliasOf);
  const outstanding = records.filter(
    (r) => r.data.open === true || (r.kind === 'clock' && r.data.status === 'pending'),
  );
  return {
    run: {
      id: run.id,
      kind: run.kind,
      checkpoint: run.checkpoint,
      request: run.request,
      ownerCharacter: run.ownerCharacter,
      responseAudience: run.responseAudience,
      question: run.question,
    },
    minute: run.draft.minute,
    calendar: `${calendarLabel(run.draft.minute)}（当地时间；不是现实时间）`,
    characters,
    scene: records.filter(
      (r) =>
        locations.has(r.id) ||
        locations.has(r.data.location) ||
        (r.kind === 'item' && ids.has(String(r.data.owner))),
    ),
    board: run.actions,
    decisions: run.decisions,
    memories: records
      .filter(
        (r) =>
          ['fact', 'ruling', 'relation'].includes(r.kind) &&
          (r.data.open === true || r.audience.some((a) => ids.has(a))),
      )
      .slice(-18),
    due: due(run.draft),
    outstanding: {
      count: outstanding.length,
      items: outstanding
        .slice(0, 60)
        .map((r) => ({
          id: r.id,
          name: r.name,
          kind: r.kind,
          due: r.data.due,
          audience: r.audience,
          excerpt: JSON.stringify(r.data).slice(0, 450),
        })),
      instruction: '未决事项索引；完整内容按ID读取，数量超出显示范围时定向检索。',
    },
    recentMovements: store.recentMovements(room.id),
    recent: room.journal.slice(-3).map((e) => ({ minute: e.minute, passages: e.passages })),
    existingChecks: store.rolls(run.id),
    pendingChanges: run.changes,
    placeIndex: records.filter((r) => r.kind === 'place').map((r) => ({ id: r.id, name: r.name })),
    entityIndex: records
      .filter((r) => ['npc', 'faction'].includes(r.kind))
      .slice(0, 80)
      .map((r) => ({ id: r.id, kind: r.kind, name: r.name })),
  };
}
