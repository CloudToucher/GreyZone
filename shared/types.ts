import { z } from 'zod';

export const attributes = {
  body: '体魄',
  agility: '身手',
  perception: '察觉',
  mind: '心智',
} as const;
export type Attribute = keyof typeof attributes;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Data = { [key: string]: Json };
export const json: z.ZodType<Json> = z.lazy(() =>
  z.union([z.null(), z.boolean(), z.number().finite(), z.string(), z.array(json), z.record(json)]),
);
export const identifier = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[\p{L}\p{N}_:.\/-]+$/u);
export const audience = z.array(identifier).max(50); // [] = GM only; ['table'] = every seat; otherwise character IDs.
export const recordSchema = z
  .object({
    id: identifier,
    kind: z.string().min(1).max(40),
    name: z.string().min(1).max(150),
    audience,
    data: z.record(json).default({}),
    secret: z.string().max(12000).default(''),
  })
  .strict();
export type GameRecord = z.infer<typeof recordSchema>;
export interface World {
  minute: number;
  records: Record<string, GameRecord>;
}
export interface Seat {
  id: string;
  name: string;
  host: boolean;
  characters: string[];
}
export interface Intent {
  id: string;
  seatId: string;
  characterId: string;
  text: string;
  audience: string[];
  createdAt: string;
  characterName?: string;
}
export interface Message {
  id: string;
  seatId: string;
  name: string;
  text: string;
  audience: string[];
  createdAt: string;
}
export interface Passage {
  text: string;
  audience: string[];
}
export interface Published {
  id: string;
  runId: string;
  minute: number;
  passages: Passage[];
  changes: Change[];
  decisions: Decision[];
  createdAt: string;
  checkIds?: string[];
}
export interface Change {
  recordId: string;
  name: string;
  summary: string;
  audience: string[];
  reason: string;
}
export interface Decision {
  actionId: string;
  status: 'done' | 'partial' | 'deferred' | 'interrupted' | 'rejected';
  reason: string;
}
export interface Campaign {
  format: 3;
  id: string;
  title: string;
  revision: number;
  worldVersion: number;
  world: World;
  board: Intent[];
  messages: Message[];
  journal: Published[];
  sessionId: string;
  sessionReady: boolean;
}
export interface Question {
  prompt: string;
  characters: string[];
  answers: Record<string, string>;
}
export type RunKind = 'round' | 'workshop' | 'discussion';
export interface Run {
  id: string;
  roomId: string;
  kind: RunKind;
  status: 'running' | 'waiting' | 'failed' | 'completed';
  baseVersion: number;
  draft: World;
  actions: Intent[];
  request: string;
  ownerCharacter?: string;
  responseAudience?: string[];
  changes: Change[];
  decisions: Decision[];
  question?: Question;
  checkpoint: number;
  createdAt: string;
  error?: string;
  metrics: {
    elapsedMs: number;
    toolCalls: number;
    modelCalls: number;
    inputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    outputTokens: number;
    compactions: number;
    resumptions: number;
  };
}
export interface Roll {
  id: string;
  runId: string;
  purpose: string;
  actorId: string;
  dice: number[];
  selected: number;
  modifier: number;
  total: number;
  difficulty?: number;
  success?: boolean;
  opponent?: { actorId: string; dice: number[]; total: number };
  outcome?: 'win' | 'tie' | 'loss';
  audience: string[];
  basis: string;
  createdAt: string;
}
export interface PublicRecord {
  id: string;
  kind: string;
  name: string;
  data: Data;
}
export interface PublicState {
  id: string;
  title: string;
  revision: number;
  minute: number;
  me: Seat;
  seats: Seat[];
  records: PublicRecord[];
  board: Intent[];
  boardCount: number;
  submittedSeats: string[];
  messages: Message[];
  journal: Published[];
  rolls: Roll[];
  run: null | {
    id: string;
    kind: RunKind;
    status: Run['status'];
    stage: string;
    checkpoint: number;
    question?: Question;
    error?: string;
  };
}
export const dateLabel = (minute: number) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'UTC',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(Date.UTC(2037, 2, 15, 8) + minute * 60000));
export const calendarLabel = (minute: number) =>
  new Date(Date.UTC(2037, 2, 15, 8) + minute * 60000).toISOString().slice(0, 16).replace('T', ' ');
