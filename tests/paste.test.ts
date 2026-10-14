import assert from "node:assert/strict";
import test from "node:test";
import { DateTime } from "luxon";
import { readFileSync } from "node:fs";
import { catalog, parseCatalog } from "../src/lib/catalog.ts";
import { applySpawns, parseSpawns } from "../src/lib/paste.ts";
import { dueOnOverlay } from "../src/lib/view.ts";
import type { Timer } from "../src/lib/types.ts";

const zone = "Europe/Berlin";
const now = DateTime.fromISO("2026-10-14T14:36:00", { zone });

function rolling(name: string, interval: number | null): Timer {
  return {
    id: name.toLowerCase().replace(/ /g, "-"),
    name,
    category: "boss",
    schedule: { kind: "rolling" },
    durationMinutes: 0,
    entryMinutes: 0,
    overlay: true,
    alarm: true,
    leadMinutes: 5,
    seeded: false,
    customized: true,
    respawnIntervalMinutes: interval,
    nextAt: null,
    note: "",
  };
}

test("a clock time past now lands tomorrow in the server zone", () => {
  const [hit] = parseSpawns("Gartua 00:34", now, zone);
  assert.equal(hit?.name, "Gartua");
  assert.equal(DateTime.fromISO(hit?.nextAt ?? "").setZone(zone).toFormat("yyyy-MM-dd HH:mm"), "2026-10-15 00:34");
});

test("a later clock time stays today and keeps the interval", () => {
  const [hit] = parseSpawns("Immortal Gartua Spawns at 6:43 PM", now, zone);
  assert.equal(DateTime.fromISO(hit?.nextAt ?? "").setZone(zone).toFormat("HH:mm"), "18:43");
  const timer = rolling("Immortal Gartua", 480);
  const result = applySpawns([timer], hit ? [hit] : [], 5, zone);
  assert.equal(result.timers[0]?.respawnIntervalMinutes, 480);
  assert.equal(result.timers[0]?.nextAt, hit?.nextAt);
  assert.match(result.notes[0] ?? "", /Set Immortal Gartua/);
});

test("an unknown name becomes a field boss and a clock timer is left alone", () => {
  const hits = parseSpawns("Lagta 00:38\nShugo Festival 15:00", now, zone);
  const shugo = catalog().find((timer) => timer.id === "shugo-festival");
  assert.ok(shugo);
  const result = applySpawns([shugo], hits, 5, zone);
  assert.equal(result.timers[0]?.schedule.kind, "hourly");
  assert.equal(result.timers[1]?.name, "Lagta");
  assert.equal(result.timers[1]?.schedule.kind, "rolling");
  assert.equal(result.timers[1]?.respawnIntervalMinutes, null);
  assert.match(result.notes.join(" "), /keeps its clock/);
});

test("weekly reset stays off an 8 hour overlay and a live event stays on", () => {
  const weekly = catalog().find((timer) => timer.id === "weekly-reset");
  const invasion = catalog().find((timer) => timer.id === "dimensional-invasion");
  assert.ok(weekly && invasion);
  assert.equal(dueOnOverlay(weekly, now, zone, 8), false);
  assert.equal(dueOnOverlay(invasion, now, zone, 8), true);
});

test("the published catalog parses", () => {
  const parsed = parseCatalog(readFileSync(new URL("../catalog.json", import.meta.url), "utf8"));
  assert.ok(parsed);
  assert.equal(parsed?.length, catalog().length);
  assert.equal(parseCatalog("{"), null);
});
