import assert from "node:assert/strict";
import test from "node:test";
import { DateTime } from "luxon";
import { catalog } from "../src/lib/catalog.ts";
import { dueAlert, evaluate, markKilled } from "../src/lib/schedule.ts";
import type { Timer } from "../src/lib/types.ts";

const zone = "Europe/Berlin";

function timer(id: string): Timer {
  const found = catalog().find((item) => item.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

function at(value: string): DateTime {
  return DateTime.fromISO(value, { zone });
}

test("catalog timers resolve on a Wednesday afternoon", () => {
  const now = at("2026-10-14T14:36:00");
  assert.equal(now.weekday, 3);
  const expected: Record<string, string> = {
    "shugo-festival": "2026-10-14T15:00:00",
    "dimensional-invasion": "2026-10-14T14:30:00",
    "spacetime-rift": "2026-10-14T17:00:00",
    "arena-of-tactics": "2026-10-14T19:00:00",
    "artifact-siege": "2026-10-15T21:00:00",
    "watcher-kaira": "2026-10-14T16:00:00",
    "executor-tamasa": "2026-10-15T21:30:00",
    "executor-argo": "2026-10-15T21:30:00",
    "executor-kaira": "2026-10-15T21:30:00",
    "guardian-lord-nahma": "2026-10-16T21:00:00",
    "daily-reset": "2026-10-15T09:00:00",
    "weekly-reset": "2026-10-21T09:00:00",
  };
  for (const item of catalog()) {
    const occurrence = evaluate(item, now, zone);
    assert.notEqual(occurrence.phase, "unset", item.id);
    assert.equal(occurrence.start?.toUTC().toISO(), at(expected[item.id]).toUTC().toISO(), item.id);
  }
  assert.equal(evaluate(timer("dimensional-invasion"), now, zone).phase, "live");
});

test("invasion entry then live window", () => {
  const entry = evaluate(timer("dimensional-invasion"), at("2026-10-14T14:31:00"), zone);
  assert.equal(entry.phase, "entry");
  assert.ok(Math.abs((entry.remainingMs ?? 0) - 2 * 60_000) < 1000);

  const live = evaluate(timer("dimensional-invasion"), at("2026-10-14T14:34:00"), zone);
  assert.equal(live.phase, "live");
  assert.ok(Math.abs((live.remainingMs ?? 0) - 9 * 60_000) < 1000);
});

test("arena windows and the overnight gap", () => {
  const live = evaluate(timer("arena-of-tactics"), at("2026-10-14T12:00:00"), zone);
  assert.equal(live.phase, "live");
  assert.equal(live.target?.toISO(), at("2026-10-14T14:00:00").toISO());

  const next = evaluate(timer("arena-of-tactics"), at("2026-10-14T15:00:00"), zone);
  assert.equal(next.start?.toISO(), at("2026-10-14T19:00:00").toISO());

  const overnight = evaluate(timer("arena-of-tactics"), at("2026-10-14T21:30:00"), zone);
  assert.equal(overnight.start?.toISO(), at("2026-10-15T11:00:00").toISO());
});

test("rift after the last slot rolls to 02:00", () => {
  const occurrence = evaluate(timer("spacetime-rift"), at("2026-10-14T23:30:00"), zone);
  assert.equal(occurrence.phase, "upcoming");
  assert.equal(occurrence.start?.toISO(), at("2026-10-15T02:00:00").toISO());
});

test("a Berlin wall-clock event follows the fallback", () => {
  const daily: Timer = { ...timer("daily-reset"), schedule: { kind: "daily", hour: 16, minute: 0 } };
  const summer = evaluate(daily, at("2026-10-24T15:00:00"), zone);
  assert.equal(summer.start?.toUTC().toISO(), "2026-10-24T14:00:00.000Z");

  const afterFallback = evaluate(daily, at("2026-10-24T17:00:00"), zone);
  assert.equal(afterFallback.start?.toUTC().toISO(), "2026-10-25T15:00:00.000Z");
});

test("a Berlin wall-clock event follows the spring forward", () => {
  const daily: Timer = { ...timer("daily-reset"), schedule: { kind: "daily", hour: 16, minute: 0 } };
  const occurrence = evaluate(daily, at("2027-03-28T01:30:00"), zone);
  assert.equal(occurrence.start?.toUTC().toISO(), "2027-03-28T14:00:00.000Z");
});

test("daily and weekly reset stay on 07:00 UTC", () => {
  const daily = timer("daily-reset");
  const afternoon = evaluate(daily, at("2026-10-14T14:36:00"), zone);
  assert.equal(afternoon.start?.toUTC().toISO(), "2026-10-15T07:00:00.000Z");
  assert.equal(afternoon.start?.setZone(zone).toFormat("HH:mm"), "09:00");

  const stillMorning = evaluate(daily, at("2026-10-14T08:30:00"), zone);
  assert.equal(stillMorning.start?.toUTC().toISO(), "2026-10-14T07:00:00.000Z");

  const afterFallback = evaluate(daily, at("2026-10-24T17:00:00"), zone);
  assert.equal(afterFallback.start?.toUTC().toISO(), "2026-10-25T07:00:00.000Z");
  assert.equal(afterFallback.start?.setZone(zone).toFormat("HH:mm"), "08:00");

  const weekly = evaluate(timer("weekly-reset"), at("2026-10-14T14:36:00"), zone);
  assert.equal(weekly.start?.toUTC().toISO(), "2026-10-21T07:00:00.000Z");
});

test("killed sets the next spawn from now plus the interval", () => {
  const boss: Timer = {
    ...timer("watcher-kaira"),
    id: "custom-field",
    seeded: false,
    schedule: { kind: "rolling" },
    respawnIntervalMinutes: 90,
    nextAt: null,
  };
  const now = at("2026-10-14T18:00:00");
  const killed = markKilled(boss, now);
  assert.equal(killed?.nextAt, now.plus({ minutes: 90 }).toUTC().toISO());
  const upcoming = evaluate(killed!, now.plus({ minutes: 1 }), zone);
  assert.equal(upcoming.phase, "upcoming");
  const overdue = evaluate(killed!, now.plus({ minutes: 91 }), zone);
  assert.equal(overdue.phase, "overdue");
  assert.equal(markKilled({ ...boss, respawnIntervalMinutes: null }, now), null);
});

test("alarm fires once inside the lead window", () => {
  const shugo = timer("shugo-festival");
  const tooEarly = dueAlert(shugo, at("2026-10-14T15:50:00"), zone, new Set());
  assert.equal(tooEarly, null);
  const due = dueAlert(shugo, at("2026-10-14T15:56:00"), zone, new Set());
  assert.equal(due?.minutes, 4);
  const again = dueAlert(shugo, at("2026-10-14T15:56:00"), zone, new Set([due!.key]));
  assert.equal(again, null);
});
