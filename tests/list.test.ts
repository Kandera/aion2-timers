import assert from "node:assert/strict";
import test from "node:test";
import { DateTime } from "luxon";
import { catalog } from "../src/lib/catalog.ts";
import { dueAlerts, inQuietHours, markSeen, upcomingStarts } from "../src/lib/schedule.ts";
import { exportTimers, importTimers } from "../src/lib/share.ts";
import type { Timer } from "../src/lib/types.ts";

const zone = "Europe/Berlin";

test("Seen skips the current Shugo hour", () => {
  const now = DateTime.fromISO("2026-10-14T14:36:00", { zone });
  const shugo = catalog().find((timer) => timer.id === "shugo-festival");
  assert.ok(shugo);
  const seen = markSeen(shugo, now, zone);
  assert.ok(seen);
  const next = upcomingStarts(seen, now, zone, 1)[0];
  assert.equal(next?.setZone(zone).toFormat("HH:mm"), "16:00");
});

test("hourly timers expose the next three starts", () => {
  const now = DateTime.fromISO("2026-10-14T14:36:00", { zone });
  const shugo = catalog().find((timer) => timer.id === "shugo-festival");
  assert.ok(shugo);
  const starts = upcomingStarts(shugo, now, zone, 3).map((start) => start.setZone(zone).toFormat("HH:mm"));
  assert.deepEqual(starts, ["15:00", "16:00", "17:00"]);
});

test("a start alert fires once inside the first minute", () => {
  const timer = catalog().find((item) => item.id === "shugo-festival");
  assert.ok(timer);
  const started = DateTime.fromISO("2026-10-14T15:00:20", { zone });
  const hits = dueAlerts(timer, started, zone, new Set());
  assert.equal(hits.some((hit) => hit.started), true);
  const key = hits.find((hit) => hit.started)?.key ?? "";
  assert.equal(dueAlerts(timer, started, zone, new Set([key])).some((hit) => hit.started), false);
});

test("quiet hours wrap past midnight", () => {
  const night = DateTime.fromISO("2026-10-14T02:00:00", { zone });
  const day = DateTime.fromISO("2026-10-14T12:00:00", { zone });
  assert.equal(inQuietHours(night, 1, 8, true), true);
  assert.equal(inQuietHours(day, 1, 8, true), false);
  assert.equal(inQuietHours(night, 22, 7, true), true);
  assert.equal(inQuietHours(night, 1, 8, false), false);
});

test("import adds a custom timer and leaves catalog timers alone", () => {
  const boss: Timer = {
    ...catalog()[0],
    id: "field-gartua",
    name: "Gartua",
    category: "boss",
    schedule: { kind: "rolling" },
    seeded: false,
    customized: true,
    respawnIntervalMinutes: 480,
    nextAt: "2026-10-15T00:34:00.000Z",
  };
  const file = exportTimers([boss, catalog()[0]]);
  const result = importTimers(catalog(), file, 5);
  assert.ok(!("error" in result));
  if ("error" in result) return;
  assert.equal(result.timers.filter((timer) => timer.name === "Gartua").length, 1);
  assert.equal(result.timers.find((timer) => timer.id === "shugo-festival")?.schedule.kind, "hourly");
  assert.match(result.note, /1 new/);
});
