import assert from "node:assert/strict";
import test from "node:test";
import { DateTime } from "luxon";
import { catalog } from "../src/lib/catalog.ts";
import { dueAlerts, inQuietHours, markSeen, upcomingStarts } from "../src/lib/schedule.ts";
import { exportTimers, importTimers } from "../src/lib/share.ts";
import { discordFaction } from "../src/lib/view.ts";
import { freshState, mergeStores } from "../src/lib/state.ts";
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
  assert.equal(hits.find((hit) => hit.started)?.minutes, 3);
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

test("a file store keeps settings and custom timers when the window store was wiped", () => {
  const local = freshState();
  const saved = freshState();
  saved.settings = { ...saved.settings, timeZone: "Etc/GMT-2", opacity: 0.5, hotkey: "Ctrl+Shift+T", quietEnabled: true };
  saved.timers.push({
    ...local.timers[0],
    id: "field-gartua",
    name: "Immortal Gartua",
    schedule: { kind: "rolling" },
    seeded: false,
    customized: true,
    nextAt: "2026-10-15T00:34:00.000Z",
  });
  const pinned = saved.timers.find((timer) => timer.id === "shugo-festival");
  if (pinned) pinned.overlay = false;
  const merged = mergeStores(local, saved);
  assert.equal(merged.settings.timeZone, "Etc/GMT-2");
  assert.equal(merged.settings.opacity, 0.5);
  assert.equal(merged.settings.hotkey, "Ctrl+Shift+T");
  assert.equal(merged.settings.quietEnabled, true);
  assert.equal(merged.timers.find((timer) => timer.id === "shugo-festival")?.overlay, false);
  assert.equal(merged.timers.some((timer) => timer.id === "field-gartua"), true);
});
test("Discord export names the faction server and keeps the other zone out", () => {
  const now = DateTime.fromISO("2026-10-27T23:45:00", { zone });
  const start = DateTime.fromISO("2026-10-27T23:50:00", { zone });
  const unix = Math.floor(start.toSeconds());
  const text = discordFaction(
    [
      rolling("nm-1305-1", "Eternal Gartua", "Verteron · Sky Island", start.toUTC().toISO()),
      rolling("nm-1305-2", "Neikel of the East", "Verteron · Peak · Reported up", null),
      rolling("nm-1305-3", "Melted Danar", "Altgard · Creion Campsite", start.toUTC().toISO()),
      {
        ...rolling("shugo-festival", "Shugo Festival", "", start.toUTC().toISO()),
        category: "event",
        schedule: { kind: "daily", hour: 23, minute: 50 },
      },
    ],
    "verteron",
    now,
    zone,
  );
  assert.match(text, /^\*\*ELYOS Timer Yustiel Stand 27\.10\. 23:45 Uhr\*\*/);
  assert.match(text, new RegExp(`\\*\\*Eternal Gartua\\*\\* — <t:${unix}:t> \\(<t:${unix}:R>\\) — Sky Island`));
  assert.match(text, /\*\*Neikel of the East\*\* — Up — Peak/);
  assert.equal(text.includes("Melted Danar"), false);
  assert.equal(text.includes("Shugo"), false);
  const asmo = discordFaction(
    [rolling("nm-2305-1", "Immortal Gartua", "Altgard · Remote Island", start.toUTC().toISO())],
    "altgard",
    now,
    zone,
  );
  assert.match(asmo, /^\*\*ASMODIAN Timer Marchutan Stand 27\.10\. 23:45 Uhr\*\*/);
  assert.match(asmo, /Immortal Gartua/);
});

function rolling(id: string, name: string, note: string, nextAt: string | null): Timer {
  return {
    id,
    name,
    category: "boss",
    schedule: { kind: "rolling" },
    durationMinutes: 0,
    entryMinutes: 0,
    overlay: false,
    alarm: false,
    leadMinutes: 5,
    seeded: false,
    customized: true,
    respawnIntervalMinutes: null,
    nextAt,
    alarmTone: null,
    alarmOnStart: true,
    seenUntil: null,
    note,
  };
}
