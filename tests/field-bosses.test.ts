import assert from "node:assert/strict";
import test from "node:test";
import { applyFieldReports, reportsFromFeed } from "../src/lib/field-bosses.ts";
import type { Timer } from "../src/lib/types.ts";

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
  assert.equal(timers.some((timer) => timer.name === "Neikel of the East"), true);
});
