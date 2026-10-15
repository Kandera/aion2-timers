import names from "../field-bosses.json" with { type: "json" };
import { catalog as worldCatalog } from "./catalog.ts";
import type { Timer } from "./types.ts";

export const FIELD_BOSS_URL =
  "https://raw.githubusercontent.com/Not4You-Dev/NotMeter-Cache/main/presence/notmeter-field-boss-public-ww-eu-expanded.json";

const MARCHUTAN = 2305;

type BossName = { code: number; name: string; zone: string; location: string };

export type FieldReport = {
  code: number;
  name: string;
  zone: string;
  location: string;
  nextAt: string | null;
  up: boolean;
};

const catalog = new Map<number, BossName>();
for (const row of names) {
  if (isBossName(row)) catalog.set(row.code, row);
}

export function reportsFromFeed(value: unknown, nowMs = Date.now()): FieldReport[] {
  const server = findServer(value, MARCHUTAN);
  if (!server) return [];
  const reports: FieldReport[] = [];
  for (const map of server.maps) {
    for (const entry of map.entries) {
      const known = catalog.get(entry.bossCode);
      if (!known || isFixedWorldBoss(known.name)) continue;
      const up = entry.spawned === true;
      const nextAt = !up && entry.targetAt > 0 ? new Date(entry.targetAt).toISOString() : null;
      if (!up && entry.targetAt > 0 && entry.targetAt < nowMs - 6 * 60 * 60_000) continue;
      reports.push({ ...known, nextAt, up });
    }
  }
  return reports;
}

export function applyFieldReports(timers: Timer[], reports: FieldReport[], leadMinutes: number): Timer[] {
  const next = timers.map((timer) => ({ ...timer }));
  const byId = new Map(next.map((timer) => [timer.id, timer]));
  for (const report of reports) {
    if (isFixedWorldBoss(report.name)) continue;
    const id = `nm-${MARCHUTAN}-${report.code}`;
    const existing = byId.get(id);
    const name = fieldBossName(report, reports);
    const note = [report.zone, report.location, report.up ? "Reported up" : ""].filter(Boolean).join(" · ");
    if (!existing) {
      const created = fieldTimer(id, report, name, note, leadMinutes);
      next.push(created);
      byId.set(id, created);
      continue;
    }
    const index = next.findIndex((timer) => timer.id === id);
    if (index < 0) continue;
    next[index] = {
      ...existing,
      name,
      note,
      nextAt: report.nextAt ?? existing.nextAt,
    };
  }
  return next.filter((timer) => !isDuplicateWorldBoss(timer));
}

export async function pullFieldReports(): Promise<FieldReport[]> {
  const response = await fetch(FIELD_BOSS_URL);
  if (!response.ok) throw new Error(`Field boss report failed (${response.status}).`);
  return reportsFromFeed(await response.json());
}

function fieldTimer(id: string, report: FieldReport, name: string, note: string, leadMinutes: number): Timer {
  return {
    id,
    name,
    category: "boss",
    schedule: { kind: "rolling" },
    durationMinutes: 0,
    entryMinutes: 0,
    overlay: false,
    alarm: false,
    tracked: false,
    leadMinutes,
    seeded: false,
    customized: true,
    respawnIntervalMinutes: null,
    nextAt: report.nextAt,
    alarmTone: null,
    alarmOnStart: true,
    seenUntil: null,
    note,
  };
}

const worldBossNames = new Set(
  worldCatalog()
    .filter((timer) => timer.category === "boss")
    .map((timer) => normName(timer.name)),
);

export function isDuplicateWorldBoss(timer: { id: string; name: string; note: string }): boolean {
  if (!timer.id.startsWith("nm-")) return false;
  return isFixedWorldBoss(timer.name.split(" · ")[0] ?? timer.name);
}

function isFixedWorldBoss(name: string): boolean {
  return worldBossNames.has(normName(name));
}

function normName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function fieldBossName(report: FieldReport, reports: FieldReport[]): string {
  const shared = reports.some((other) => other.code !== report.code && other.name === report.name);
  return shared ? `${report.name} · ${report.zone}` : report.name;
}

function findServer(value: unknown, serverId: number): { maps: FeedMap[] } | null {
  if (!isRecord(value) || !Array.isArray(value.servers)) return null;
  for (const server of value.servers) {
    if (!isRecord(server) || server.serverId !== serverId || !Array.isArray(server.maps)) continue;
    const maps: FeedMap[] = [];
    for (const map of server.maps) {
      if (!isRecord(map) || !Array.isArray(map.entries)) continue;
      const entries: FeedEntry[] = [];
      for (const entry of map.entries) {
        if (!isRecord(entry) || typeof entry.bossCode !== "number" || typeof entry.targetAt !== "number") continue;
        entries.push({
          bossCode: entry.bossCode,
          targetAt: entry.targetAt,
          spawned: entry.spawned === true,
        });
      }
      maps.push({ entries });
    }
    return { maps };
  }
  return null;
}

function isBossName(value: unknown): value is BossName {
  if (!isRecord(value)) return false;
  return (
    typeof value.code === "number" &&
    typeof value.name === "string" &&
    typeof value.zone === "string" &&
    typeof value.location === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

type FeedEntry = { bossCode: number; targetAt: number; spawned: boolean };
type FeedMap = { entries: FeedEntry[] };
