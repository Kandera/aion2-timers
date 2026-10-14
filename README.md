# Aion 2 Timers

Desktop timers for Aion 2 events, bosses, and your own field bosses. The overlay follows what you pin in the editor.

It does not read the game client, packets, or memory. V:0.1 by Kandera.

## Install

Download the Windows setup from the [latest release](https://github.com/Kandera/aion2-timers/releases/latest). It installs for the current user, no admin prompt.

Settings → Updates checks GitHub for a newer signed setup, then installs it and restarts.

Field boss times are not pulled from aion2timers.com. That site blocks automated fetches. Add those timers yourself.

The signing private key is not in this repo. `node_modules` and `src-tauri/target` are not either.

## Develop

```
npm install
npm test
npm run tauri dev
```

Close the editor window to keep the overlay and alarms in the tray. Quit from the tray icon.
