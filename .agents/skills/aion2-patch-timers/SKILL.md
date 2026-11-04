---
name: aion2-patch-timers
description: neue Woche, neuer Patch, neue Timer. Apply the latest Aion 2 maintenance schedule to the aion2-timers catalog.
---

# Patch timers

Apply the latest completed Aion 2 weekly maintenance to this repo's clocks. The catalog is the clock. This file is the procedure.

## Steps

1. Get the official patch notes for the latest completed weekly maintenance, not the maintenance notice and not a preview. The update board is `https://aion2.plaync.com/en-us/board/update/list`. `https://endgametools.com/en/aion-2/notices` lists the article id when the board is script-only. Open the article in a browser; the reader often returns only the title. Done when the note's date and every clock sentence under Content & Systems are in hand.

2. Diff those sentences against `catalog.json`. A clock sentence names a weekday set, a posted hour, a respawn interval, or a new fixed spawn. A playtime cap, an item level, and a raid entry rule are not timers. Done when every clock sentence is applied or written down as unchanged.

3. Keep the last map-countdown minute unless a new map reading, or the patch, says the clock moved. Posted 21:00 and 21:30 are not the EU map. If the patch says the clock is unchanged, keep the catalog minute. If it publishes a new hour and the catalog minute was a map offset on the old posted hour, shift by that same delta and say so. With no map reading, store the posted time and label the note `Posted time`. Done when each changed minute names its source.

4. A boss that gains a posted schedule becomes a catalog boss. Its `name` must equal the `field-bosses.json` name, so a field report no longer duplicates it. A respawn change for a feed-owned field boss is a changelog fact. Do not seed `respawnIntervalMinutes` unless this repo already stores that interval. Done when the new fixed name matches the field-boss catalog and the field-report tests no longer expect that boss from the feed.

5. Update `catalog.json`, the schedule tests, `README.md`, and the in-app changelog in `index.html`. Weekday numbers are Monday `1` through Sunday `7`. A twice-daily pair is `every` with `hours: 12` from the first clock. Times beside the 21:00 siege in the English global notes are Berlin wall-clock, not UTC. A customized row keeps its old schedule until reset; say that when days change. Bump the displayed version in `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `edge-widget/manifest.json`, the README rail, and `index.html` so the rail and the new changelog heading match. Do not commit, tag, or push unless asked. Done when `npm test` passes and a dropped weekday no longer resolves.

## Sources

- Patch notes: plaync update board. Maintenance notices are a different board and do not carry the clock.
- Map offset: the last catalog note that says `Map countdown`, or a reading the user gives this run. Do not invent one.
- Field predictions: `FIELD_BOSS_URL` in `src/lib/field-bosses.ts`. The meter owns `targetAt`.
- Fixed-name cut: `isFixedWorldBoss` compares the normalized catalog boss name to the field-boss name.
