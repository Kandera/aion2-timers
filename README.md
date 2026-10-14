# Aion 2 Timers

Desktop timers for Aion 2 events, bosses, and your own field bosses. The overlay follows what you pin in the editor.

It does not read the game client, packets, or memory. V:0.1.1 by Kandera. Licensed under MIT.

## Install

Download the Windows setup from the [latest release](https://github.com/Kandera/aion2-timers/releases/latest). It installs for the current user, no admin prompt.

Settings → Updates checks GitHub for a newer signed setup, then installs it and restarts.

## Use

Paste spawn reads `Gartua 00:34`, `Immortal Gartua Spawns at 6:43 PM`, or a copied timer row. Loot text and a Korean name on the same line are ignored. The clock after `Spawns in` is used, in the server zone. A matching field boss keeps its interval.

Export and Import share custom timers as JSON. Catalog timers stay put.

The overlay button cycles All, Next 3, and Soon. It fades when nothing is soon, and comes back under the pointer. Click-through stays visible. Pick the monitor under Settings → Overlay.

Each timer can have its own tone, and a second alert when it starts. Quiet hours mute the sound. The row stays. Seen skips one clock time. Killed still rolls an interval.

Each row shows the next three times. Maintenance opens a one-time end timer.

Settings → Catalog pulls `catalog.json` from this repo, so a schedule fix lands without a new setup. Pins, alarms, notes, and your own timers stay.

Close the editor window to keep the overlay and alarms in the tray. Quit from the tray icon.

## Develop

```
npm install
npm test
npm run tauri dev
```
