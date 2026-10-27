import { DateTime } from "luxon";
import { formatCountdown, formatRule, formatWhen } from "./format.ts";
import { evaluate, upcomingStarts, type Occurrence, type Phase } from "./schedule.ts";
import type { Category, Timer } from "./types.ts";
import { isDuplicateWorldBoss } from "./field-bosses.ts";

export type RowView = {
  id: string;
  name: string;
  category: Category;
  kind: "field" | Category;
  rule: string;
  note: string;
  phase: Phase;
  countdown: string;
  when: string;
  soon: boolean;
  canKill: boolean;
  canSee: boolean;
  later: string;
  overlay: boolean;
  alarm: boolean;
  tracked: boolean;
};

export type ListFilter = Category | "all" | "world" | "field";

export function present(timer: Timer, now: DateTime, zone: string): RowView {
  const occurrence = evaluate(timer, now, zone);
  const when = occurrence.start ? formatWhen(occurrence.start.setZone(zone)) : "No time set";
  const countdown =
    occurrence.remainingMs == null ? "—" : formatCountdown(occurrence.remainingMs);
  const soon =
    occurrence.phase === "upcoming" &&
    occurrence.remainingMs != null &&
    occurrence.remainingMs <= 15 * 60_000;
  return {
    id: timer.id,
    name: timer.name,
    category: timer.category,
    kind: isFieldBoss(timer) ? "field" : timer.category,
    rule: formatRule(timer),
    note: timer.note,
    phase: occurrence.phase,
    countdown,
    when,
    soon,
    canKill: timer.respawnIntervalMinutes != null && timer.respawnIntervalMinutes >= 1,
    canSee: timer.schedule.kind !== "rolling" && occurrence.start != null,
    later: upcomingStarts(timer, now, zone, 3).map((start) => formatWhen(start.setZone(zone))).join(" · "),
    overlay: timer.overlay,
    alarm: timer.alarm,
    tracked: timer.tracked === true,
  };
}

export function pulse(timer: Timer, now: DateTime, zone: string): { countdown: string; phase: Phase; when: string; soon: boolean } {
  const occurrence = evaluate(timer, now, zone);
  const soon =
    occurrence.phase === "upcoming" &&
    occurrence.remainingMs != null &&
    occurrence.remainingMs <= 15 * 60_000;
  return {
    countdown: occurrence.remainingMs == null ? "—" : formatCountdown(occurrence.remainingMs),
    phase: occurrence.phase,
    when: occurrence.start ? formatWhen(occurrence.start.setZone(zone)) : "No time set",
    soon,
  };
}

export function dueOnOverlay(timer: Timer, now: DateTime, zone: string, hours: number): boolean {
  const occurrence = evaluate(timer, now, zone);
  if (occurrence.phase === "unset") return false;
  if (occurrence.phase !== "upcoming") return true;
  const limit = Math.min(48, Math.max(1, hours)) * 3_600_000;
  return occurrence.remainingMs != null && occurrence.remainingMs <= limit;
}

export function ordered(timers: Timer[], now: DateTime, zone: string, filter: ListFilter): Timer[] {
  return timers
    .filter((timer) => matchesFilter(timer, filter))
    .slice()
    .sort((left, right) => rank(left, now, zone) - rank(right, now, zone) || left.name.localeCompare(right.name));
}

export function isFieldBoss(timer: Timer): boolean {
  return timer.id.startsWith("nm-") || (timer.category === "boss" && timer.schedule.kind === "rolling");
}

export function shownTimers(timers: Timer[], fieldZone: "verteron" | "altgard"): Timer[] {
  return timers.filter((timer) => {
    if (isDuplicateWorldBoss(timer)) return false;
    const zone = fieldBossZone(timer);
    return zone == null || zone === fieldZone;
  });
}

function fieldBossZone(timer: Timer): "verteron" | "altgard" | null {
  if (!isFieldBoss(timer)) return null;
  const head = `${timer.note} ${timer.name}`;
  if (/\bVerteron\b/.test(head) && !/\bAltgard\b/.test(head)) return "verteron";
  if (/\bAltgard\b/.test(head) && !/\bVerteron\b/.test(head)) return "altgard";
  return null;
}
export function discordFaction(
  timers: Timer[],
  fieldZone: "verteron" | "altgard",
  now: DateTime,
  timeZone: string,
): string {
  const elyos = fieldZone === "verteron";
  const title = elyos ? "ELYOS Timer Yustiel" : "ASMODIAN Timer Marchutan";
  const stamp = now.setZone(timeZone);
  const stand = stamp.isValid ? stamp.toFormat("dd.MM. HH:mm") : "--.--. --:--";
  const header = `**${title} Stand ${stand} Uhr**`;
  const bosses = timers.filter((timer) => isFieldBoss(timer) && !isDuplicateWorldBoss(timer) && factionBoss(timer, fieldZone));
  if (elyos && bosses.length === 0) return `${header}\nYustiel report is not loaded.`;
  const lines = bosses
    .flatMap((timer) => discordLine(timer, now, timeZone))
    .sort((left, right) => left.rank - right.rank || left.name.localeCompare(right.name));
  if (lines.length === 0) return `${header}\nNo bosses with a time.`;
  return [header, ...lines.map((line) => line.text)].join("\n");
}

function factionBoss(timer: Timer, fieldZone: "verteron" | "altgard"): boolean {
  const zone = fieldBossZone(timer);
  return zone == null || zone === fieldZone;
}

function discordLine(timer: Timer, now: DateTime, timeZone: string): { name: string; text: string; rank: number }[] {
  const place = timer.note
    .split(" · ")
    .map((part) => part.trim())
    .filter((part) => part && part !== "Altgard" && part !== "Verteron" && part !== "Reported up" && part !== "Report is too old")
    .join(" · ");
  const tail = place ? ` — ${place}` : "";
  if (timer.nextAt == null && timer.note.includes("Reported up")) {
    return [{ name: timer.name, text: `**${timer.name}** — Up${tail}`, rank: -1 }];
  }
  const start = evaluate(timer, now, timeZone).start;
  if (!start) return [];
  const unix = Math.floor(start.toSeconds());
  return [{ name: timer.name, text: `**${timer.name}** — <t:${unix}:t> (<t:${unix}:R>)${tail}`, rank: start.toMillis() }];
}

function matchesFilter(timer: Timer, filter: ListFilter): boolean {
  if (isDuplicateWorldBoss(timer)) return false;
  if (filter === "all") return true;
  if (filter === "world") return timer.category === "boss" && !isFieldBoss(timer);
  if (filter === "field") return isFieldBoss(timer);
  return timer.category === filter;
}

export function passesFilter(timer: Timer, filter: ListFilter): boolean {
  return matchesFilter(timer, filter);
}

export function rankValue(occurrence: Occurrence): number {
  if (occurrence.phase === "overdue") return -2_000_000_000_000 + (occurrence.remainingMs ?? 0);
  if (occurrence.phase === "entry" || occurrence.phase === "live") return -1_000_000_000_000 + (occurrence.remainingMs ?? 0);
  if (occurrence.phase === "unset") return 2_000_000_000_000;
  return occurrence.remainingMs ?? 1_000_000_000_000;
}

function rank(timer: Timer, now: DateTime, zone: string): number {
  return rankValue(evaluate(timer, now, zone));
}
