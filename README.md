# Aion 2 Timers

Desktop timers for Aion 2 events, bosses, and your own field bosses. The overlay follows what you pin in the editor.

It does not read the game client, packets, or memory. V:0.1 by Kandera. Licensed under MIT.

## Install

Download the Windows setup from the [latest release](https://github.com/Kandera/aion2-timers/releases/latest). It installs for the current user, no admin prompt.

Settings → Updates checks GitHub for a newer signed setup, then installs it and restarts.

Field boss times are not pulled from aion2timers.com. That site blocks automated fetches. Paste a line like `Gartua 00:34` onto a field boss. The interval stays. The clock is the server zone.

The overlay shows pinned timers due within the next hours. Live and overdue stay. Change the window under Settings, Overlay.

Settings, Catalog pulls `catalog.json` from this repo. A schedule fix lands without a new setup. Pins, alarms, notes, and your own timers stay.

The overlay button cycles All, Next 3, and Soon. It fades when nothing is due soon, and comes back when the pointer is over it. Click-through keeps it visible, because a hover cannot reach it.

Export and Import share custom timers as JSON. Maintenance opens a one-time end timer. Seen skips the current clock time without rolling an interval.

The signing private key is not in this repo. `node_modules` and `src-tauri/target` are not either.

## Develop

```
npm install
npm test
npm run tauri dev
```

Close the editor window to keep the overlay and alarms in the tray. Quit from the tray icon.
