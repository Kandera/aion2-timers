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

export function markSeen(timer: Timer, now: DateTime, zone: string): Timer | null {
  if (timer.schedule.kind === "rolling") return null;
  const occurrence = evaluate(timer, now, zone);
  if (!occurrence.start) return null;
  const seenUntil = occurrence.start.toUTC().toISO();
  if (!seenUntil) return null;
  return { ...timer, seenUntil };
}

export function upcomingStarts(timer: Timer, now: DateTime, zone: string, count: number): DateTime[] {
  if (count < 1) return [];
  if (timer.schedule.kind === "rolling" || timer.schedule.kind === "once") {
    const occurrence = evaluate(timer, now, zone);
    return occurrence.start && occurrence.phase === "upcoming" ? [occurrence.start] : [];
  }
  const zoned = timer.schedule.kind === "utc" ? now.toUTC() : now.setZone(zone);
  if (!zoned.isValid) return [];
  const found: DateTime[] = [];
  const origin = zoned.startOf("day").minus({ days: 1 });
  for (let day = 0; day < 21 && found.length < count; day += 1) {
    for (const start of startsOn(origin.plus({ days: day }), timer.schedule)) {
      if (dismissed(timer, start) || start <= zoned) continue;
      found.push(start);
      if (found.length === count) break;
    }
  }
  return found;
}

export function inQuietHours(now: DateTime, from: number, until: number, enabled: boolean): boolean {
  if (!enabled || from === until) return false;
  const hour = now.hour;
  if (from < until) return hour >= from && hour < until;
  return hour >= from || hour < until;
}

export type AlertHit = { key: string; minutes: number; started: boolean };

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

export function dueAlerts(
  timer: Timer,
  now: DateTime,
  zone: string,
  already: ReadonlySet<string>,
): AlertHit[] {
  return alertsFrom(timer, evaluate(timer, now, zone), now, zone, already);
}

export function alertsFrom(
  timer: Timer,
  occurrence: Occurrence,
  now: DateTime,
  zone: string,
  already: ReadonlySet<string>,
): AlertHit[] {
  const hits: AlertHit[] = [];
  if (
    timer.alarm &&
    timer.leadMinutes >= 1 &&
    occurrence.phase === "upcoming" &&
    occurrence.start &&
    occurrence.remainingMs != null &&
    occurrence.remainingMs > 0 &&
    occurrence.remainingMs <= timer.leadMinutes * 60_000
  ) {
    const key = alertKey(timer.id, occurrence.start);
    if (!already.has(key)) hits.push({ key, minutes: Math.max(1, Math.ceil(occurrence.remainingMs / 60_000)), started: false });
  }
  if (!timer.alarm || timer.alarmOnStart === false) return hits;
  const start = occurrence.phase === "live" || occurrence.phase === "entry" ? recentStart(occurrence, now) : justStarted(timer, now, zone);
  if (!start) return hits;
  const key = `${alertKey(timer.id, start)}#start`;
  if (!already.has(key)) hits.push({ key, minutes: entryLeft(timer, start, now), started: true });
  return hits;
}

function recentStart(occurrence: Occurrence, now: DateTime): DateTime | null {
  if (!occurrence.start) return null;
  const age = now.toMillis() - occurrence.start.toMillis();
  return age >= 0 && age <= 90_000 ? occurrence.start : null;
}

function entryLeft(timer: Timer, start: DateTime, now: DateTime): number {
  if (timer.entryMinutes < 1) return 0;
  const left = start.plus({ minutes: timer.entryMinutes }).toMillis() - now.toMillis();
  if (left <= 0) return 0;
  return Math.max(1, Math.ceil(left / 60_000));
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
  if (!start.isValid || dismissed(timer, start)) return empty();
  const end = start.plus({ minutes: Math.max(0, timer.durationMinutes) });
  if (now < start) return pointing("upcoming", start, start, now);
  if (timer.durationMinutes > 0 && now < end) return openPhase(timer, start, end, now);
  return pointing("overdue", start, start, now);
}

function evaluateClock(timer: Timer, now: DateTime): Occurrence {
  if (timer.schedule.kind === "windows") return scanClock(timer, now);
  const previous = previousFixed(now, timer.schedule);
  if (previous && !dismissed(timer, previous)) {
    const end = endFor(previous, timer.schedule, timer.durationMinutes);
    if (end > previous && now < end) return openPhase(timer, previous, end, now);
  }
  let next = nextFixed(now, timer.schedule);
  for (let hop = 0; next && hop < 8 && dismissed(timer, next); hop += 1) next = nextFixed(next, timer.schedule);
  if (next) return pointing("upcoming", next, next, now);
  return empty();
}

function scanClock(timer: Timer, now: DateTime): Occurrence {
  const origin = now.startOf("day").minus({ days: 1 });
  let open: { start: DateTime; end: DateTime } | null = null;
  let next: DateTime | null = null;

  for (let day = 0; day < 10; day += 1) {
    const date = origin.plus({ days: day });
    for (const start of startsOn(date, timer.schedule)) {
      if (dismissed(timer, start)) continue;
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

function dismissed(timer: Timer, start: DateTime): boolean {
  if (!timer.seenUntil) return false;
  const seen = DateTime.fromISO(timer.seenUntil);
  return seen.isValid && start.toMillis() <= seen.toMillis();
}

function justStarted(timer: Timer, now: DateTime, zone: string): DateTime | null {
  const windowMs = 90_000;
  if (timer.schedule.kind === "rolling") {
    if (!timer.nextAt) return null;
    const start = DateTime.fromISO(timer.nextAt);
    if (!start.isValid) return null;
    const age = now.toMillis() - start.toMillis();
    return age >= 0 && age <= windowMs ? start : null;
  }
  if (timer.schedule.kind === "once") {
    const start = DateTime.fromISO(timer.schedule.at);
    if (!start.isValid || dismissed(timer, start)) return null;
    const age = now.toMillis() - start.toMillis();
    return age >= 0 && age <= windowMs ? start : null;
  }
  const zoned = timer.schedule.kind === "utc" ? now.toUTC() : now.setZone(zone);
  if (!zoned.isValid) return null;
  const previous = previousFixed(zoned, timer.schedule);
  if (!previous || dismissed(timer, previous)) return null;
  const age = zoned.toMillis() - previous.toMillis();
  return age >= 0 && age <= windowMs ? previous : null;
}

function nextFixed(now: DateTime, schedule: Schedule): DateTime | null {
  switch (schedule.kind) {
    case "hourly":
      return stepAfter(now, now.set({ minute: schedule.minute, second: 0, millisecond: 0 }), 60);
    case "every":
      return schedule.hours < 1
        ? null
        : stepAfter(
            now,
            now.startOf("day").set({ hour: schedule.anchorHour, minute: schedule.anchorMinute, second: 0, millisecond: 0 }),
            schedule.hours * 60,
          );
    case "daily":
      return nextOnDays(now, [1, 2, 3, 4, 5, 6, 7], schedule.hour, schedule.minute);
    case "weekdays":
      return nextOnDays(now, schedule.days, schedule.hour, schedule.minute);
    case "utc":
      return nextOnDays(now, schedule.days.length > 0 ? schedule.days : [1, 2, 3, 4, 5, 6, 7], schedule.hour, schedule.minute);
    default:
      return null;
  }
}

function previousFixed(now: DateTime, schedule: Schedule): DateTime | null {
  switch (schedule.kind) {
    case "hourly":
      return stepAfter(now, now.set({ minute: schedule.minute, second: 0, millisecond: 0 }), 60).minus({ hours: 1 });
    case "every":
      return schedule.hours < 1 ? null : nextFixed(now, schedule)?.minus({ hours: schedule.hours }) ?? null;
    case "daily":
      return previousOnDays(now, [1, 2, 3, 4, 5, 6, 7], schedule.hour, schedule.minute);
    case "weekdays":
      return previousOnDays(now, schedule.days, schedule.hour, schedule.minute);
    case "utc":
      return previousOnDays(now, schedule.days.length > 0 ? schedule.days : [1, 2, 3, 4, 5, 6, 7], schedule.hour, schedule.minute);
    default:
      return null;
  }
}

function stepAfter(now: DateTime, anchor: DateTime, stepMinutes: number): DateTime {
  const step = stepMinutes * 60_000;
  const jumps = Math.floor((now.toMillis() - anchor.toMillis()) / step) + 1;
  return anchor.plus({ milliseconds: jumps * step });
}

function nextOnDays(now: DateTime, days: Weekday[], hour: number, minute: number): DateTime | null {
  if (days.length === 0) return null;
  for (let offset = 0; offset < 8; offset += 1) {
    const start = now.startOf("day").plus({ days: offset }).set({ hour, minute, second: 0, millisecond: 0 });
    if (days.includes(start.weekday as Weekday) && start > now) return start;
  }
  return null;
}

function previousOnDays(now: DateTime, days: Weekday[], hour: number, minute: number): DateTime | null {
  if (days.length === 0) return null;
  for (let offset = 0; offset < 8; offset += 1) {
    const start = now.startOf("day").minus({ days: offset }).set({ hour, minute, second: 0, millisecond: 0 });
    if (days.includes(start.weekday as Weekday) && start <= now) return start;
  }
  return null;
}
