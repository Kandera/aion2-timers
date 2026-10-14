import { DateTime } from "luxon";
import { formatCountdown, formatRule, formatWhen } from "./format.ts";
import { evaluate, type Phase } from "./schedule.ts";
import type { Category, Timer } from "./types.ts";

export type RowView = {
  id: string;
  name: string;
  category: Category;
  rule: string;
  note: string;
  phase: Phase;
  countdown: string;
  when: string;
  soon: boolean;
  canKill: boolean;
  overlay: boolean;
  alarm: boolean;
};

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
    rule: formatRule(timer),
    note: timer.note,
    phase: occurrence.phase,
    countdown,
    when,
    soon,
    canKill: timer.respawnIntervalMinutes != null && timer.respawnIntervalMinutes >= 1,
    overlay: timer.overlay,
    alarm: timer.alarm,
  };
}

export function dueOnOverlay(timer: Timer, now: DateTime, zone: string, hours: number): boolean {
  const occurrence = evaluate(timer, now, zone);
  if (occurrence.phase === "unset") return false;
  if (occurrence.phase !== "upcoming") return true;
  const limit = Math.min(48, Math.max(1, hours)) * 3_600_000;
  return occurrence.remainingMs != null && occurrence.remainingMs <= limit;
}

export function ordered(
  timers: Timer[],
  now: DateTime,
  zone: string,
  category: Category | "all",
): Timer[] {
  return timers
    .filter((timer) => category === "all" || timer.category === category)
    .slice()
    .sort((left, right) => rank(left, now, zone) - rank(right, now, zone) || left.name.localeCompare(right.name));
}

function rank(timer: Timer, now: DateTime, zone: string): number {
  const occurrence = evaluate(timer, now, zone);
  if (occurrence.phase === "overdue") return -2_000_000_000_000 + (occurrence.remainingMs ?? 0);
  if (occurrence.phase === "entry" || occurrence.phase === "live") return -1_000_000_000_000 + (occurrence.remainingMs ?? 0);
  if (occurrence.phase === "unset") return 2_000_000_000_000;
  return occurrence.remainingMs ?? 1_000_000_000_000;
}
