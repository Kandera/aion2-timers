import { DateTime } from "luxon";
import { formatWhen } from "./format.ts";
import type { Timer } from "./types.ts";

export type SpawnHit = {
  name: string;
  nextAt: string;
};

const CLOCK = /\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i;
const RELATIVE_HOUR = /\bin\s+(\d+)\s*h(?:ours?)?(?:\s+(\d+)\s*m(?:in(?:utes?)?)?)?/i;
const RELATIVE_MINUTE = /\bin\s+(\d+)\s*m(?:in(?:utes?)?)?/i;

export function parseSpawns(text: string, now: DateTime, zone: string): SpawnHit[] {
  const hits: SpawnHit[] = [];
  for (const line of text.split(/\r?\n/)) {
    const hit = parseLine(line, now, zone);
    if (hit) hits.push(hit);
  }
  return hits;
}

export function applySpawns(timers: Timer[], hits: SpawnHit[], leadMinutes: number, zone: string): { timers: Timer[]; notes: string[] } {
  const next = timers.map((timer) => ({ ...timer }));
  const notes: string[] = [];
  for (const hit of hits) {
    const index = pick(next, hit.name);
    const when = formatWhen(DateTime.fromISO(hit.nextAt).setZone(zone));
    if (index == null) {
      next.push(fieldTimer(hit, leadMinutes, new Set(next.map((timer) => timer.id))));
      notes.push(`Added ${hit.name}. Next spawn ${when}. Set an interval if it should roll after a kill.`);
      continue;
    }
    const timer = next[index];
    if (!timer || timer.schedule.kind !== "rolling") {
      notes.push(`${timer?.name ?? hit.name} keeps its clock. Paste sets field bosses.`);
      continue;
    }
    next[index] = { ...timer, nextAt: hit.nextAt, customized: true };
    notes.push(`Set ${timer.name} to ${when}.`);
  }
  return { timers: next, notes };
}

function parseLine(line: string, now: DateTime, zone: string): SpawnHit | null {
  const clock = line.match(CLOCK);
  const relative = line.match(RELATIVE_HOUR) ?? line.match(RELATIVE_MINUTE);
  if (!clock && !relative) return null;
  const name = cleanup(line);
  if (!name) return null;
  const nextAt = clock ? nextClock(now, zone, clock) : nextRelative(now, relative);
  if (!nextAt) return null;
  return { name, nextAt };
}

function nextClock(now: DateTime, zone: string, match: RegExpMatchArray): string | null {
  const minute = Number(match[2]);
  const hour = hour24(Number(match[1]), match[3]);
  if (hour == null || minute > 59) return null;
  const zoned = now.setZone(zone);
  let start = zoned.set({ hour, minute, second: 0, millisecond: 0 });
  if (start <= zoned) start = start.plus({ days: 1 });
  return start.toUTC().toISO();
}

function nextRelative(now: DateTime, match: RegExpMatchArray | null): string | null {
  if (!match) return null;
  const hours = match[2] == null && /m/i.test(match[0]) && !/h/i.test(match[0]) ? 0 : Number(match[1]);
  const minutes = match[2] != null ? Number(match[2]) : /m/i.test(match[0]) && !/h/i.test(match[0]) ? Number(match[1]) : 0;
  if (hours > 48 || minutes > 59) return null;
  return now.plus({ hours, minutes }).toUTC().toISO();
}

function hour24(hour: number, suffix: string | undefined): number | null {
  if (!suffix) return hour <= 23 ? hour : null;
  if (hour < 1 || hour > 12) return null;
  if (hour === 12) return suffix.toLowerCase() === "pm" ? 12 : 0;
  return suffix.toLowerCase() === "pm" ? hour + 12 : hour;
}

function cleanup(line: string): string {
  return line
    .replace(RELATIVE_HOUR, " ")
    .replace(RELATIVE_MINUTE, " ")
    .replace(/\bspawns?\s+at\b/gi, " ")
    .replace(CLOCK, " ")
    .replace(/[,.|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pick(timers: Timer[], name: string): number | null {
  const query = norm(name);
  const hits = timers
    .map((timer, index) => ({ timer, index }))
    .filter((item) => {
      const value = norm(item.timer.name);
      return value === query || value.includes(query) || query.includes(value);
    });
  const rolling = hits.filter((item) => item.timer.schedule.kind === "rolling");
  const pool = rolling.length > 0 ? rolling : hits;
  pool.sort((left, right) => {
    const exact = Number(norm(left.timer.name) !== query) - Number(norm(right.timer.name) !== query);
    return exact || norm(left.timer.name).length - norm(right.timer.name).length;
  });
  return pool[0]?.index ?? null;
}

function fieldTimer(hit: SpawnHit, leadMinutes: number, taken: Set<string>): Timer {
  return {
    id: fieldId(hit.name, taken),
    name: hit.name,
    category: "boss",
    schedule: { kind: "rolling" },
    durationMinutes: 0,
    entryMinutes: 0,
    overlay: true,
    alarm: true,
    leadMinutes,
    seeded: false,
    customized: true,
    respawnIntervalMinutes: null,
    nextAt: hit.nextAt,
    note: "Pasted spawn. Set an interval to roll after a kill.",
  };
}

function fieldId(name: string, taken: Set<string>): string {
  const slug = norm(name).replace(/ /g, "-").slice(0, 40) || "boss";
  const base = `field-${slug}`;
  if (!taken.has(base)) return base;
  let count = 2;
  while (taken.has(`${base}-${count}`)) count += 1;
  return `${base}-${count}`;
}

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
