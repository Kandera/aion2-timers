import { parseCatalog } from "./catalog.ts";
import type { Timer } from "./types.ts";

export function exportTimers(timers: Timer[]): string {
  return JSON.stringify({ version: 1, timers: timers.filter((timer) => !timer.seeded) }, null, 2);
}

export function importTimers(
  current: Timer[],
  text: string,
  leadMinutes: number,
): { timers: Timer[]; note: string } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "That file is not JSON." };
  }
  const rows = shareRows(parsed);
  if (!rows) return { error: "This file is not a timer list." };
  const next = current.map((timer) => ({ ...timer }));
  let added = 0;
  let updated = 0;
  for (const row of rows) {
    const timer = timerFrom(row, leadMinutes);
    if (!timer) return { error: "A timer in that file is not valid." };
    const index = next.findIndex((item) => !item.seeded && norm(item.name) === norm(timer.name));
    if (index < 0) {
      next.push(timer);
      added += 1;
      continue;
    }
    const existing = next[index];
    if (!existing) continue;
    next[index] = {
      ...existing,
      name: timer.name,
      category: timer.category,
      schedule: timer.schedule,
      durationMinutes: timer.durationMinutes,
      entryMinutes: timer.entryMinutes,
      respawnIntervalMinutes: timer.respawnIntervalMinutes,
      nextAt: timer.nextAt,
      note: timer.note,
      customized: true,
    };
    updated += 1;
  }
  return { timers: next, note: `Imported ${added} new and updated ${updated}.` };
}

function shareRows(value: unknown): unknown[] | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  if (!("version" in value) || value.version !== 1) return null;
  if (!("timers" in value) || !Array.isArray(value.timers)) return null;
  return value.timers;
}

function timerFrom(value: unknown, leadMinutes: number): Timer | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  if (!("name" in value) || !("category" in value) || !("schedule" in value)) return null;
  if (!("durationMinutes" in value) || !("entryMinutes" in value)) return null;
  const note = "note" in value && typeof value.note === "string" ? value.note : "";
  const seed = parseCatalog([
    {
      id: "import-row",
      name: value.name,
      category: value.category,
      schedule: value.schedule,
      durationMinutes: value.durationMinutes,
      entryMinutes: value.entryMinutes,
      note,
    },
  ]);
  const parsed = seed?.[0];
  if (!parsed) return null;
  const interval = "respawnIntervalMinutes" in value ? value.respawnIntervalMinutes : null;
  const nextAt = "nextAt" in value ? value.nextAt : null;
  return {
    ...parsed,
    id: `field-${crypto.randomUUID()}`,
    overlay: true,
    alarm: true,
    leadMinutes,
    seeded: false,
    customized: true,
    respawnIntervalMinutes: typeof interval === "number" && interval >= 1 ? interval : null,
    nextAt: typeof nextAt === "string" ? nextAt : null,
    alarmTone: null,
    alarmOnStart: true,
    seenUntil: null,
  };
}

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
