import { DateTime, IANAZone } from "luxon";
import type { Schedule, Timer, Weekday } from "./types.ts";

export type Phase = "upcoming" | "entry" | "live" | "overdue" | "unset";

export type Occurrence = {
  phase: Phase;
  start: DateTime | null;
  target: DateTime | null;
  remainingMs: number | null;
};

export function zoneOk(zone: string): boolean {
  return IANAZone.isValidZone(zone);
}

export function evaluate(timer: Timer, now: DateTime, zone: string): Occurrence {
  const zoned = now.setZone(zone);
  if (!zoned.isValid) return empty();
  if (timer.schedule.kind === "rolling") return evaluateRolling(timer, zoned);
  if (timer.schedule.kind === "once") return evaluateOnce(timer, zoned);
  if (timer.schedule.kind === "utc") return evaluateClock(timer, now.toUTC());
  return evaluateClock(timer, zoned);
}

export function markKilled(timer: Timer, now: DateTime): Timer | null {
  if (timer.respawnIntervalMinutes == null || timer.respawnIntervalMinutes < 1) return null;
  const next = now.plus({ minutes: timer.respawnIntervalMinutes }).toUTC();
  const nextAt = next.toISO();
  if (!nextAt) return null;
  return { ...timer, nextAt, schedule: { kind: "rolling" } };
}

export function alertKey(id: string, start: DateTime): string {
  return `${id}@${start.toUTC().toISO()}`;
}

export function dueAlert(
  timer: Timer,
  now: DateTime,
  zone: string,
  already: ReadonlySet<string>,
): { key: string; minutes: number } | null {
  if (!timer.alarm || timer.leadMinutes < 1) return null;
  const occurrence = evaluate(timer, now, zone);
  if (occurrence.phase !== "upcoming" || !occurrence.start) return null;
  const until = occurrence.start.toMillis() - now.toMillis();
  const leadMs = timer.leadMinutes * 60_000;
  if (until <= 0 || until > leadMs) return null;
  const key = alertKey(timer.id, occurrence.start);
  if (already.has(key)) return null;
  return { key, minutes: Math.max(1, Math.ceil(until / 60_000)) };
}

function evaluateRolling(timer: Timer, now: DateTime): Occurrence {
  if (!timer.nextAt) return empty();
  const start = DateTime.fromISO(timer.nextAt);
  if (!start.isValid) return empty();
  if (start.toMillis() > now.toMillis()) return pointing("upcoming", start, start, now);
  return pointing("overdue", start, start, now);
}

function evaluateOnce(timer: Timer, now: DateTime): Occurrence {
  if (timer.schedule.kind !== "once") return empty();
  const start = DateTime.fromISO(timer.schedule.at);
  if (!start.isValid) return empty();
  const end = start.plus({ minutes: Math.max(0, timer.durationMinutes) });
  if (now < start) return pointing("upcoming", start, start, now);
  if (timer.durationMinutes > 0 && now < end) return openPhase(timer, start, end, now);
  return pointing("overdue", start, start, now);
}

function evaluateClock(timer: Timer, now: DateTime): Occurrence {
  const origin = now.startOf("day").minus({ days: 1 });
  let open: { start: DateTime; end: DateTime } | null = null;
  let next: DateTime | null = null;

  for (let day = 0; day < 10; day += 1) {
    const date = origin.plus({ days: day });
    for (const start of startsOn(date, timer.schedule)) {
      const end = endFor(start, timer.schedule, timer.durationMinutes);
      if (!end.isValid || end <= start) {
        if (start > now && (next === null || start < next)) next = start;
        continue;
      }
      if (now >= start && now < end) open = { start, end };
      else if (start > now && (next === null || start < next)) next = start;
    }
  }

  if (open) return openPhase(timer, open.start, open.end, now);
  if (next) return pointing("upcoming", next, next, now);
  return empty();
}

function openPhase(timer: Timer, start: DateTime, end: DateTime, now: DateTime): Occurrence {
  if (timer.entryMinutes > 0) {
    const entryEnd = start.plus({ minutes: timer.entryMinutes });
    if (entryEnd.isValid && now < entryEnd && entryEnd <= end) {
      return pointing("entry", start, entryEnd, now);
    }
  }
  return pointing("live", start, end, now);
}

function startsOn(day: DateTime, schedule: Schedule): DateTime[] {
  switch (schedule.kind) {
    case "hourly": {
      const starts: DateTime[] = [];
      for (let hour = 0; hour < 24; hour += 1) {
        const start = at(day, hour, schedule.minute);
        if (start.isValid) starts.push(start);
      }
      return starts;
    }
    case "every": {
      if (schedule.hours < 1) return [];
      const starts: DateTime[] = [];
      let minutes = schedule.anchorHour * 60 + schedule.anchorMinute;
      const step = schedule.hours * 60;
      while (minutes < 24 * 60) {
        const start = at(day, Math.floor(minutes / 60), minutes % 60);
        if (start.isValid) starts.push(start);
        minutes += step;
      }
      return starts;
    }
    case "daily": {
      const start = at(day, schedule.hour, schedule.minute);
      return start.isValid ? [start] : [];
    }
    case "weekdays": {
      if (!schedule.days.includes(day.weekday as Weekday)) return [];
      const start = at(day, schedule.hour, schedule.minute);
      return start.isValid ? [start] : [];
    }
    case "utc": {
      if (schedule.days.length > 0 && !schedule.days.includes(day.weekday as Weekday)) return [];
      const start = at(day, schedule.hour, schedule.minute);
      return start.isValid ? [start] : [];
    }
    case "windows":
      return schedule.windows
        .map((slot) => at(day, slot.startHour, slot.startMinute))
        .filter((start) => start.isValid);
    default:
      return [];
  }
}

function endFor(start: DateTime, schedule: Schedule, durationMinutes: number): DateTime {
  if (schedule.kind === "windows") {
    const slot = schedule.windows.find(
      (item) => item.startHour === start.hour && item.startMinute === start.minute,
    );
    if (!slot) return start;
    let end = at(start.startOf("day"), slot.endHour, slot.endMinute);
    if (end <= start) end = end.plus({ days: 1 });
    return end;
  }
  if (durationMinutes <= 0) return start;
  return start.plus({ minutes: durationMinutes });
}

function at(day: DateTime, hour: number, minute: number): DateTime {
  return day.set({ hour, minute, second: 0, millisecond: 0 });
}

function pointing(phase: Phase, start: DateTime, target: DateTime, now: DateTime): Occurrence {
  return {
    phase,
    start,
    target,
    remainingMs: target.toMillis() - now.toMillis(),
  };
}

function empty(): Occurrence {
  return { phase: "unset", start: null, target: null, remainingMs: null };
}
