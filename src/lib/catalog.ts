import bundledJson from "../../catalog.json" with { type: "json" };
import type { CatalogSeed, Timer, WindowSlot } from "./types.ts";

export const CATALOG_KEY = "aion2-timers.catalog.v1";
export const CATALOG_URL = "https://raw.githubusercontent.com/Kandera/aion2-timers/master/catalog.json";

const prefs = {
  overlay: true,
  alarm: true,
  leadMinutes: 5,
  seeded: true,
  customized: false,
  respawnIntervalMinutes: null,
  nextAt: null,
} as const;

export function catalog(): Timer[] {
  return activeSeeds().map(toTimer);
}

export function activeSeeds(): CatalogSeed[] {
  const stored = readStored();
  return stored ?? parseCatalog(bundledJson) ?? [];
}

export function parseCatalog(value: unknown): CatalogSeed[] | null {
  const rows = typeof value === "string" ? parseJson(value) : value;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const seeds: CatalogSeed[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const seed = seedFrom(row);
    if (!seed || seen.has(seed.id)) return null;
    seen.add(seed.id);
    seeds.push(seed);
  }
  return seeds;
}

export async function pullCatalog(): Promise<{ changed: boolean; count: number }> {
  const response = await fetch(CATALOG_URL);
  if (!response.ok) throw new Error(`Catalog fetch failed (${response.status}).`);
  const seeds = parseCatalog(await response.text());
  if (!seeds) throw new Error("Catalog file is not a timer list.");
  const next = JSON.stringify(seeds);
  const changed = next !== JSON.stringify(activeSeeds());
  localStorage.setItem(CATALOG_KEY, next);
  return { changed, count: seeds.length };
}

function readStored(): CatalogSeed[] | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(CATALOG_KEY);
  if (!raw) return null;
  return parseCatalog(raw);
}

function toTimer(seed: CatalogSeed): Timer {
  return { ...prefs, ...seed };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function seedFrom(value: unknown): CatalogSeed | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (!isId(row.id) || !isName(row.name) || !isCategory(row.category)) return null;
  if (!isMinutes(row.durationMinutes, 24 * 60) || !isMinutes(row.entryMinutes, 24 * 60)) return null;
  if (row.entryMinutes > row.durationMinutes && row.durationMinutes !== 0) return null;
  if (typeof row.note !== "string" || row.note.length > 400) return null;
  const schedule = scheduleFrom(row.schedule);
  if (!schedule) return null;
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    schedule,
    durationMinutes: row.durationMinutes,
    entryMinutes: row.entryMinutes,
    note: row.note,
  };
}

function scheduleFrom(value: unknown): CatalogSeed["schedule"] | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.kind === "hourly" && isMinute(row.minute)) return { kind: "hourly", minute: row.minute };
  if (row.kind === "every" && isHour(row.hours, 1, 24) && isHour(row.anchorHour, 0, 23) && isMinute(row.anchorMinute)) {
    return { kind: "every", hours: row.hours, anchorHour: row.anchorHour, anchorMinute: row.anchorMinute };
  }
  if (row.kind === "daily" && isHour(row.hour, 0, 23) && isMinute(row.minute)) {
    return { kind: "daily", hour: row.hour, minute: row.minute };
  }
  if (row.kind === "weekdays" && isDays(row.days) && isHour(row.hour, 0, 23) && isMinute(row.minute)) {
    return { kind: "weekdays", days: row.days, hour: row.hour, minute: row.minute };
  }
  if (row.kind === "utc" && isDays(row.days) && isHour(row.hour, 0, 23) && isMinute(row.minute)) {
    return { kind: "utc", hour: row.hour, minute: row.minute, days: row.days };
  }
  if (row.kind === "once" && typeof row.at === "string" && row.at.length > 0 && row.at.length < 40) {
    return { kind: "once", at: row.at };
  }
  if (row.kind === "rolling") return { kind: "rolling" };
  if (row.kind === "windows" && Array.isArray(row.windows) && row.windows.length > 0 && row.windows.every(isWindow)) {
    return { kind: "windows", windows: row.windows };
  }
  return null;
}

function isWindow(value: unknown): value is WindowSlot {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return isHour(row.startHour, 0, 23) && isMinute(row.startMinute) && isHour(row.endHour, 0, 23) && isMinute(row.endMinute);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 64;
}

function isName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 80;
}

function isCategory(value: unknown): value is CatalogSeed["category"] {
  return value === "event" || value === "boss" || value === "pvp" || value === "system";
}

function isDays(value: unknown): value is CatalogSeed["schedule"] extends { days: infer D } ? D : never {
  return Array.isArray(value) && value.length > 0 && value.length <= 7 && value.every((day) => isHour(day, 1, 7)) && new Set(value).size === value.length;
}

function isMinute(value: unknown): value is number {
  return isHour(value, 0, 59);
}

function isMinutes(value: unknown, max: number): value is number {
  return isHour(value, 0, max);
}

function isHour(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}
