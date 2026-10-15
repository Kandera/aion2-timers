import assert from "node:assert/strict";
import test from "node:test";
import { DateTime } from "luxon";
import { applyFieldReports, reportsFromFeed } from "../src/lib/field-bosses.ts";
import { parseState } from "../src/lib/state.ts";
import type { Timer } from "../src/lib/types.ts";
import { ordered, shownTimers } from "../src/lib/view.ts";

const now = Date.parse("2026-10-15T10:00:00.000Z");

test("a Marchutan report becomes a named timer and keeps an interval", () => {
  const reports = reportsFromFeed(
    {
      servers: [
        {
          serverId: 2305,
          maps: [
            {
              entries: [
                { bossCode: 2400800, targetAt: Date.parse("2026-10-15T10:35:00.000Z") },
                { bossCode: 2100003, spawned: true, targetAt: now },
              ],
            },
          ],
        },
      ],
    },
    now,
  );
  const gartua = reports.find((report) => report.name === "Immortal Gartua");
  assert.equal(gartua?.zone, "Altgard");
  assert.equal(gartua?.location, "Remote Island");
  assert.equal(gartua?.up, false);
  const existing: Timer = {
    id: "nm-2305-2400800",
    name: "Old",
    category: "boss",
    schedule: { kind: "rolling" },
    durationMinutes: 0,
    entryMinutes: 0,
    overlay: false,
    alarm: false,
    leadMinutes: 9,
    seeded: false,
    customized: true,
    respawnIntervalMinutes: 180,
    nextAt: null,
    alarmTone: null,
    alarmOnStart: true,
    seenUntil: null,
    note: "",
  };
  const timers = applyFieldReports([existing], reports, 5);
  const updated = timers.find((timer) => timer.id === existing.id);
  assert.equal(updated?.name, "Immortal Gartua");
  assert.equal(updated?.respawnIntervalMinutes, 180);
  assert.equal(updated?.overlay, false);
  const added = timers.find((timer) => timer.name === "Neikel of the East");
  assert.equal(added?.overlay, false);
  assert.equal(added?.alarm, false);
  assert.equal(added?.tracked, false);
});

test("an unchosen field boss stays off, and a chosen pin stays on", () => {
  const state = parseState(
    JSON.stringify({
      settings: { fieldBossesCleared: true },
      timers: [
        boss("nm-2305-1", "Left on by the old default", true, true),
        { ...boss("nm-2305-2", "Chosen", true, false), tracked: true },
        boss("watcher-kaira", "Watcher Kaira", true, true, { kind: "every", hours: 3, anchorHour: 1, anchorMinute: 0 }),
      ],
    }),
  );
  assert.ok(state);
  const left = state.timers.find((timer) => timer.id === "nm-2305-1");
  const chosen = state.timers.find((timer) => timer.id === "nm-2305-2");
  assert.equal(left?.overlay, false);
  assert.equal(left?.alarm, false);
  assert.equal(chosen?.overlay, true);
  assert.equal(chosen?.alarm, false);
  const now = DateTime.fromISO("2026-10-15T10:00:00", { zone: "Europe/Berlin" });
  const world = ordered(state.timers, now, "Europe/Berlin", "world").map((timer) => timer.id);
  const field = ordered(state.timers, now, "Europe/Berlin", "field").map((timer) => timer.id);
  assert.equal(world.includes("watcher-kaira"), true);
  assert.equal(world.includes("nm-2305-2"), false);
  assert.equal(field.includes("nm-2305-1"), true);
  assert.equal(field.includes("nm-2305-2"), true);
  assert.equal(field.includes("watcher-kaira"), false);
});

test("the first load drops pasted tests and old pulled field bosses", () => {
  const state = parseState(
    JSON.stringify({
      timers: [
        boss("field-immortal-gartua", "Immortal Gartua", true, true),
        boss("nm-2305-2400800", "Immortal Gartua", true, true),
        boss("watcher-kaira", "Watcher Kaira", true, true, { kind: "every", hours: 3, anchorHour: 1, anchorMinute: 0 }),
      ],
    }),
  );
  assert.ok(state);
  assert.equal(state.settings.fieldBossesCleared, true);
  assert.equal(state.timers.some((timer) => timer.id === "field-immortal-gartua"), false);
  assert.equal(state.timers.some((timer) => timer.id.startsWith("nm-")), false);
  assert.equal(state.timers.some((timer) => timer.id === "watcher-kaira"), true);
  const mixed = [
    boss("nm-2305-1", "Altgard boss", false, false),
    boss("nm-2305-2", "Verteron boss", false, false),
    boss("nm-2305-3", "Reshanta boss", false, false),
  ];
  mixed[0].note = "Altgard · Remote Island";
  mixed[1].note = "Verteron · Laborer's Rest Stop";
  mixed[2].note = "Chaotic Lower Reshanta";
  const visible = shownTimers(mixed, "altgard").map((timer) => timer.id);
  assert.deepEqual(visible, ["nm-2305-1"]);
});

function boss(
  id: string,
  name: string,
  overlay: boolean,
  alarm: boolean,
  schedule: Timer["schedule"] = { kind: "rolling" },
): Timer {
  return {
    id,
    name,
    category: "boss",
    schedule,
    durationMinutes: 0,
    entryMinutes: 0,
    overlay,
    alarm,
    leadMinutes: 5,
    seeded: false,
    customized: true,
    respawnIntervalMinutes: null,
    nextAt: null,
    alarmTone: null,
    alarmOnStart: true,
    seenUntil: null,
    note: "",
  };
}
