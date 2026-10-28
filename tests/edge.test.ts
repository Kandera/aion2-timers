import assert from "node:assert/strict";
import test from "node:test";
import { DateTime } from "luxon";
import { edgeSnapshot } from "../src/lib/edge.ts";
import { defaultSettings } from "../src/lib/state.ts";
import type { AppState, Timer } from "../src/lib/types.ts";

const now = DateTime.fromISO("2026-10-15T17:50:00.000Z");

test("edge snapshot follows overlay pins, window, and list mode", () => {
  const state = app([
    timer("soon", "Gartua", { nextAt: "2026-10-15T18:00:00.000Z", respawnIntervalMinutes: 180 }),
    timer("far", "Bakarma", { nextAt: "2026-10-16T16:00:00.000Z" }),
    timer("off", "Hidden", { nextAt: "2026-10-15T18:05:00.000Z", overlay: false }),
    timer("unset", "Unset", { nextAt: null }),
    clock("shugo", "Shugo Festival", { kind: "daily", hour: 23, minute: 0 }),
  ]);

  const all = edgeSnapshot(state, now);
  assert.deepEqual(all.rows.map((row) => row.id), ["soon", "shugo"]);
  assert.equal(all.rows[0]?.countdown, "00:10:00");
  assert.equal(all.rows[0]?.detail, "Thu 20:00");
  assert.equal(all.rows[0]?.kind, "field");
  assert.equal(all.rows[0]?.canKill, true);
  assert.equal(all.rows[0]?.canSee, false);
  assert.equal(all.rows[0]?.soon, true);
  assert.equal(all.rows[1]?.canSee, true);
  assert.equal(all.rows[1]?.canKill, false);
  assert.equal(all.later, 2);
  assert.equal(all.listLabel, "All");
  assert.match(all.note, /2 later, outside 8 h/);

  state.settings.overlayList = "next3";
  const next = edgeSnapshot(state, now);
  assert.equal(next.rows.length, 2);
  assert.equal(next.compactHidden, 0);

  state.settings.overlayList = "soon";
  const soon = edgeSnapshot(state, now);
  assert.deepEqual(soon.rows.map((row) => row.id), ["soon"]);
  assert.equal(soon.listLabel, "Soon");
});

test("live and overdue stay on the edge list outside the hour window", () => {
  const state = app([
    timer("late", "Overdue", { nextAt: "2026-10-15T10:00:00.000Z" }),
    clock("window", "Abyss", { kind: "once", at: "2026-10-15T17:40:00.000Z" }, 30, 5),
  ]);
  const snapshot = edgeSnapshot(state, now);
  assert.equal(snapshot.rows.find((row) => row.id === "late")?.phase, "overdue");
  assert.equal(snapshot.rows.find((row) => row.id === "window")?.phase, "live");
  assert.equal(snapshot.empty, "");
});

test("empty copy matches the overlay", () => {
  const state = app([timer("far", "Bakarma", { nextAt: "2026-10-16T16:00:00.000Z" })]);
  assert.equal(edgeSnapshot(state, now).empty, "Nothing due in the next 8 h.");
  state.timers = [];
  assert.equal(edgeSnapshot(state, now).empty, "No timers on the overlay.");
});
test("rift view shows Elyos field bosses and keeps pinned events", () => {
  const state = app([
    timer("nm-2305-1", "Immortal Gartua", { nextAt: "2026-10-15T18:00:00.000Z", note: "Altgard · Remote Island" }),
    clock("shugo", "Shugo Festival", { kind: "daily", hour: 23, minute: 0 }),
  ]);
  const nezekan = timer("nm-1302-9", "Eternal Gartua", {
    overlay: false,
    nextAt: "2026-10-15T18:05:00.000Z",
    note: "Verteron · Sky Island",
  });
  const up = timer("nm-1302-2", "Neikel of the East", {
    overlay: false,
    nextAt: null,
    note: "Verteron · Peak · Reported up",
  });
  const off = edgeSnapshot(state, now, false, { on: false, timers: [nezekan, up] });
  assert.equal(off.rift, false);
  assert.equal(off.rows.some((row) => row.id.startsWith("nm-1302")), false);
  assert.equal(off.rows.some((row) => row.id === "nm-2305-1"), true);

  const on = edgeSnapshot(state, now, false, { on: true, timers: [nezekan, up] });
  assert.equal(on.rift, true);
  assert.deepEqual(
    on.rows.map((row) => row.id),
    ["nm-1302-2", "nm-1302-9", "shugo"],
  );
  assert.equal(on.rows[0]?.countdown, "Up");
  assert.equal(on.rows[0]?.detail, "Up");
  assert.match(on.note, /Nezekan/);
  assert.match(on.note, /Vaizel/);
});

test("rift view says when the Elyos report is missing", () => {
  const snapshot = edgeSnapshot(app([]), now, false, { on: true, timers: [] });
  assert.equal(snapshot.empty, "Elyos report is not loaded.");
  assert.equal(snapshot.rows.length, 0);
});

function app(timers: Timer[]): AppState {
  return { settings: defaultSettings(), timers, alerted: [] };
}

function timer(id: string, name: string, extra: Partial<Timer>): Timer {
  return {
    id,
    name,
    category: "boss",
    schedule: { kind: "rolling" },
    durationMinutes: 0,
    entryMinutes: 0,
    overlay: true,
    alarm: false,
    leadMinutes: 5,
    seeded: false,
    customized: false,
    respawnIntervalMinutes: null,
    nextAt: null,
    alarmTone: null,
    alarmOnStart: false,
    seenUntil: null,
    note: "",
    ...extra,
  };
}

function clock(
  id: string,
  name: string,
  schedule: Timer["schedule"] = { kind: "hourly", minute: 0 },
  durationMinutes = 0,
  entryMinutes = 0,
): Timer {
  return timer(id, name, {
    category: "event",
    schedule,
    durationMinutes,
    entryMinutes,
    nextAt: null,
  });
}
