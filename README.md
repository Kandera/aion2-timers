# Aion 2 Timers

Desktop timers for Aion 2 events, bosses, and your own field bosses. The overlay follows what you pin in the editor.

It does not read the game client, packets, or memory. V:0.1 by Kandera. Licensed under MIT.

## Install

Download the Windows setup from the [latest release](https://github.com/Kandera/aion2-timers/releases/latest). It installs for the current user, no admin prompt.

Settings → Updates checks GitHub for a newer signed setup, then installs it and restarts.

Field boss times are not pulled from aion2timers.com. That site blocks automated fetches.

## Added since 0.1.0

Not in the 0.1.0 installer yet.

- Paste spawn reads `Gartua 00:34` or `Immortal Gartua Spawns at 6:43 PM`. The clock is the server zone. A field boss keeps its interval.
- Export and Import share custom timers as JSON. Catalog timers stay put.
- The overlay cycles All, Next 3, and Soon. It fades when nothing is soon. Click-through stays visible.
- Pick the overlay monitor in Settings. The app does not read the game window.
- Each timer can have its own tone, and a second alert when it starts. Quiet hours mute the sound. The row stays.
- Seen skips one clock time. Killed still rolls an interval.
- Each row shows the next three times. Maintenance opens a one-time end timer.
- Settings, Catalog pulls `catalog.json` from this repo without a new setup.


The signing private key is not in this repo. `node_modules` and `src-tauri/target` are not either.

## Develop

```
npm install
npm test
npm run tauri dev
```

Close the editor window to keep the overlay and alarms in the tray. Quit from the tray icon.
