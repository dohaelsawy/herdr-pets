# herdr-pets: design

Date: 2026-11-14
Status: approved. Amended while planning (see Amendments).

## Summary

`herdr-pets` is a public mod for the Herdr app that puts the vscode-pets animals
in a sidebar panel. Pets are decoration: the user spawns, names and removes them.
They are not tied to agents.

It is a port, not a GitHub fork. vscode-pets is a VS Code extension host plus a
DOM webview; Herdr mods are native GPUI JavaScript with no HTML, CSS, web view,
Node APIs or `setTimeout`. What carries over is the pet behaviour tables, the
names, and the sprites (fetched at run time, never hosted here).

Upstream: https://github.com/tonybaloney/vscode-pets (MIT). Pinned reference
release: `1.37.0`.

## Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Purpose | Decorative pets with the vscode-pets characters. No agent link. |
| 2 | Audience | Public, installable by other Herdr users. |
| 3 | Art | Repo ships code only. Sprites come from the user's installed vscode-pets extension, else from the upstream GitHub repo. |
| 4 | Repo | Fresh repo in Herdr's shared-mod format, not a GitHub fork. |
| 5 | Placement | Sidebar panel by default (`place: "left"`). Sized from its block, so it works elsewhere. |
| 6 | v1 scope | Core pets (see Scope). |
| 7 | Controls | Mouse first: a + button, right-click menus, two commands, no shipped keys. |
| 8 | Behaviour port | Generated pet tables plus one engine that plans legs; native transitions move sprites. |
| 9 | Left-facing sprites | A GIF flipper inside the mod. No image tools required. |

## Scope

In v1:

- Spawn and remove pets; choose type, colour and name.
- Sizes nano, small, medium, large.
- Each pet's own state sequence: idle, walk, run, lie, stand, and wall climbing
  for the pets that have it (cat, totoro, squirrel).
- Hover reaction: swipe with a 👋 bubble.
- Themes none, forest, castle, beach, winter, autumn, library, as still images.
- Pet list, size and theme persist across restarts.

Out of v1:

- Ball throwing and the `chase` / `idle-with-ball` states. Planned as the second
  release, after a prototype shows the bounce can be done with native
  transitions.
- Pets befriending and chasing each other (`chase-friend`).
- Snow, leaves and stars effects; roll call; export and import of the pet list.
- Saved pet positions. Pets start at a random spot on launch.
- A floating-window mode.

## Constraints from Herdr

- No DOM. UI is gpui-kit builders (`div()`, `image()`, `.absolute()`, `.left()`).
- `image()` plays animated GIFs (proven by the local `pokemon-agents` mod).
- There is no mirror or flip transform, so left-facing sprites must exist as files.
- Animate natively. Motion properties are `opacity`, `width`, `height`, `left`,
  `top`. A script-driven redraw repaints the whole window, so no frame timers.
- No `setTimeout`; use `cx.timer.after` / `cx.timer.every`. Never keep a `cx`.
- Mods can read and write binary files (`fs/promises` `readFile` → `Uint8Array`,
  `writeFile`), read within home and write under `~/.config/herdr-app`.
- `herdr-app check <mod folder>` must pass before a mod is called done.
- A shared mod must disclose network use, program execution, and reads outside
  its own folder.

## Licensing

- Code: MIT. `NOTICE` keeps the vscode-pets MIT copyright notice, because the
  behaviour tables and names are derived from its source, and lists every artist
  credit from the upstream README.
- Art: not in this repo, not in its git history, not in test fixtures.
  - 23 pet types are in the upstream GitHub repo. Dog is CC BY-ND 4.0, finley is
    MIT, the rest carry no licence file.
  - cat, frog, bunny and squirrel exist only in the published extension. Cat and
    frog are paid itch.io packs that upstream keeps out of GitHub at the
    artist's request.
- Mirrored copies are made on the user's machine and stay in their cache.
  BY-ND restricts sharing adapted material, not producing it.
- `preview.png` shows only pets from the GitHub set.

## Structure

```
herdr-pets/
  mods/pets/
    main.js     panel view: render, input, commands, the leg check; a dialog when opened with props().role
    dialogs.js  the picker, the rename prompt and the right-click menus
    roster.js   pure: keeps the pets on screen in step with the saved list; what to draw
    engine.js   pure: plans legs from a pet's state, table and panel size
    pets.js     generated data: per-type table, colours, names, speed, emoji
    store.js    pure: the saved value (pets, size, theme) and its changes
    sources.js  pure: sprite file names, URLs, version compare, drawn sizes
    artcore.js  pure given its IO: locates, fetches and caches sprites; calls gif.js
    art.js      hands artcore.js Herdr's exec, fs/promises, home and appHome
    gif.js      pure: reads GIF dimensions, writes a horizontally mirrored GIF
    mod.json    { "place": "left", "size": 220 }
  scripts/gen-pets.mjs   regenerates pets.js from upstream source at a given tag
  test/                  Node tests for engine.js and gif.js
  RECIPE.md  preview.png  README.md  LICENSE  NOTICE
```

Boundaries:

- `engine.js`, `gif.js`, `store.js`, `sources.js`, `roster.js` and `artcore.js`
  import nothing from `herdr` or `gpui-kit`. They take values and return values
  (`artcore.js` is handed its file and program access), and run under `node --test`.
- `pets.js` is data only and is never edited by hand.
- `art.js` is the only module that imports Herdr's file and program access; what
  is done with it (reading editors' extension folders, running `curl`) is in
  `artcore.js`.
- `main.js` and `dialogs.js` own every drawing and state call to Herdr.

Sprite cache: `~/.config/herdr-app/data/pets/`.

## Art pipeline (`art.js`, `gif.js`)

Sprites are fetched per pet, on first spawn.

1. **Source.** Look for `tonybaloney.vscode-pets-*` under `~/.vscode/extensions`,
   `~/.vscode-insiders/extensions`, `~/.cursor/extensions` and
   `~/.vscode-oss/extensions`; take the highest version. If none is found, the
   source is `https://raw.githubusercontent.com/tonybaloney/vscode-pets/<tag>/media/`
   with `<tag>` a constant (`1.37.0`).
2. **Copy.** Files are named `<colour>_<spriteLabel>_8fps.gif` under
   `media/<type>/`. Copy the labels that type's table uses, plus `swipe`, into
   `data/pets/<type>/`. If the extension lacks a file, try GitHub for that file.
   - From an extension: `fs/promises` `readFile` and `writeFile` (binary).
   - From GitHub: `exec("curl", ["-sfL", "--retry", "2", "-o", file, url, …])`.
     A mod's `fetch` response exposes only `text()` and `json()`, so it cannot
     save binary files. `curl` ships with macOS, Windows 10+ and most Linux
     distributions; it is the mod's only external program, and is needed only
     when no extension is installed.
3. **Mirror.** For each file write `<colour>_<spriteLabel>_8fps.left.gif` and
   record width and height in a per-colour `<colour>.json`. It carries a recipe
   version so a changed recipe rebuilds the cache. `curl -f` exits 22 on HTTP 404,
   which marks an animation that pet does not have; any other failure is an error.
4. **Themes.** Fetch `backgrounds/<theme>/background-<dark|light>-<size>.png` and
   the matching `foreground-…` on first use of that theme, size and appearance.

`gif.js`:

- `readSize(bytes) → { width, height }` from the logical screen descriptor.
- `flop(bytes) → bytes`: for every frame, LZW-decode, reverse each pixel row,
  LZW-encode, and set the frame's left offset to
  `screenWidth − left − frameWidth`. Colour tables, delays, disposal methods,
  transparency and loop count pass through unchanged. Interlaced frames are
  de-interlaced on decode and written non-interlaced.

Availability: with an extension installed, all 27 types are offered. Without
one, cat, frog, bunny and squirrel are greyed out in the picker with the line
"Needs the vscode-pets extension installed in an editor."

## Behaviour (`engine.js`, `pets.js`)

Upstream ticks every 100 ms and moves each pet `speed` pixels per tick. The
engine replaces ticks with legs.

`pets.js`, per type: `label`, `emoji`, `colors[]`, `names[]`, `speed` (0–5),
`startingState`, and `sequence: { [state]: nextStates[] }`. The generator drops
`chase`, `idle-with-ball` and `chase-friend`, both as rows and as next states.

A **leg** is `{ state, sprite, facing, fromX, toX, fromY, toY, duration }`.

| State | Sprite | Leg |
|---|---|---|
| `sit-idle`, `lie` | `idle` / `lie` | hold 5 s (upstream `holdTime` 50 ticks) |
| `stand-right`, `stand-left` | `stand` | hold 6 s (60 ticks) |
| `walk-right`, `walk-left` | `walk` | glide to that edge; duration = distance ÷ speed |
| `run-right`, `run-left` | `walk_fast` | as walk, at 1.6 × speed |
| `climb-wall-left`, `wall-hang-left`, `wall-dig-left`, `wall-nap`, `jump-down-left`, `land` | `wallclimb`, `wallgrab`, `walldig`, `wallnap`, `fall_from_grab`, `land` | vertical glide or hold at the left wall, upstream speeds and hold times |
| `swipe` | `swipe` | hold 1.5 s (15 ticks), 👋 bubble |

Rules:

- Speed in px/s = upstream speed × 10, multiplied by a per-pet factor drawn once
  at spawn from 0.7–1.3. Exact per-state hold times and multipliers are taken
  from upstream `states.ts` at the pinned tag.
- Right edge = panel width × 0.95 − sprite width, as upstream. Left edge = 0.
- A pet with speed 0 (rocky) holds in place for the walk state's hold time.
- `main.js` checks every 200 ms whether a pet's leg has ended. The check is
  arithmetic only; the panel is redrawn only when a pet starts a new leg. The
  engine picks at random among the current state's next states (upstream repeats
  a state in the list to weight it) and plans the next leg.
- If the panel is shorter than climb height plus sprite height, wall states are
  removed from the candidates for that pick. If nothing remains, use the
  starting state.
- Hover: allowed only for states on the ground. The engine computes the current
  position as `from + (to − from) × elapsed ÷ duration`, plans a `swipe` leg
  there, then replans the interrupted state from that position.
- Resize: any leg whose target is outside the new bounds is replanned from the
  pet's current position.
- Sprite box by size: nano 30, small 40, medium 55, large 110. A sprite is drawn
  inside the box at its own aspect ratio and is never enlarged, as upstream.
- Ground line: the theme's floor height for the size (upstream `themes.ts`);
  0 with no theme.

`engine.js` takes the clock and the random source as arguments, so tests are
deterministic.

## Panel and controls (`main.js`)

- Root element reports its size with `on_size_change`; all layout derives from it.
- Layers back to front: theme background, pets, theme foreground, the + button.
  With no theme the panel uses `theme()` colours.
- Each pet is an absolutely positioned element holding an `image()`, placed at
  its leg's end with `.transition("left" | "top", { duration, easing: "linear" })`,
  where `duration` is the time left in the leg.
- A theme's background and foreground pictures repeat along the bottom edge, as
  upstream.
- Empty state: "No pets yet. Click + to add one."
- **+** (top right, muted): opens the picker as a dialog overlay of this mod
  (`openOverlay({ mod: "pets", props: { picker: true }, kind: "dialog" })`).
- **Picker:** search field; type list (emoji, name); the chosen type's colours;
  a name field pre-filled with a random name from that type's list; Add.
- **Right-click a pet:** header "<name> the <type>"; Rename; Remove.
- **Right-click the ground:** Add pet; Theme; Size; Remove all.
- **Commands** (via `nextCommand()`): `pets.spawn` opens the picker;
  `pets.remove-all` clears the list. No `keys.json` is shipped.
- **Saved state:** `setShared("pets", { pets: [{ id, type, color, name }], size, theme })`.
  Every docked copy renders the same list and animates it independently.
- **Limit:** 20 pets, a named constant. The picker says so at the limit.
- Defaults: size nano, theme none.

## Failure handling

| Failure | Behaviour |
|---|---|
| Sprites cannot be fetched on spawn | Pet is not added; `notify()` states the reason. Cached pets are unaffected. |
| Saved pet's cache is missing at start | Refetch. On failure, show the pet as its emoji, standing still. |
| `flop` cannot parse a GIF | Use the unflipped file for that state; log it. |
| Extension lacks an expected file | Fetch that file from GitHub. |
| No extension and `curl` is not on the PATH | Pet is not added; `notify()` says sprites need either vscode-pets installed in an editor or `curl`. |
| Saved state malformed, or a type no longer exists | Drop bad entries, keep the rest. |
| Type unavailable without the extension | Greyed in the picker with the reason; cannot be added. |

## Testing

`node --test`, no Herdr required:

- **Tables:** for all 27 types, every state has a planner, every next state
  exists as a row, the starting state exists, no dropped state remains.
- **Engine:** leg distance and duration; right-edge rule; speed-0 hold; hover
  position mid-leg and resume; short panel excludes wall states; resize replans;
  fixed seed gives a fixed sequence.
- **Flipper:** `flop(flop(x))` decodes to the same pixels as `x`; a frame
  covering part of the screen lands mirrored; multi-frame delays and
  transparency survive; `readSize` is correct. Fixtures are GIFs built in code.
- **Optional:** when an installed extension is found, run `flop` over its real
  sprites and assert every file round-trips; skipped otherwise.

In Herdr:

- `herdr-app check mods/pets` passes.
- Manual run: spawn, rename, remove, resize, each theme, each size, restart.
- `herdr-app shot` for `preview.png`.

## Release

- Develop at `~/herdr-pets`, with `mods/pets` linked into
  `~/.config/herdr-app/mods/pets` for live reload.
- `RECIPE.md` in Herdr's six-part form, written from the finished files. It
  states that the mod reads editor extension folders in the home directory,
  and, when no extension is found, runs `curl` to download from
  `raw.githubusercontent.com`. It runs no other program.
- `README.md`: what it is, install, where the art comes from and why four pets
  need the extension, credits.
- Publish as a public GitHub repo with the topic `herdr-mod`. Publishing happens
  only on the owner's explicit go-ahead.

## Amendments

Made on 2026-11-14 while writing the implementation plan, after drafting and
testing the modules:

- Upstream 1.37.0 has 27 pet types, not 26 (raccoon). 23 are on GitHub.
- Three modules were added to keep files small and testable: `store.js`,
  `sources.js`, `dialogs.js`.
- Leg ends are detected by a 200 ms check, not a one-shot timer per leg. It is the
  pattern the local `pokemon-agents` mod uses, it also covers resize, added and
  removed pets and late-arriving sprites, and it redraws only on a change.
- A pet with no sprites yet stands still as its emoji; it starts moving when they
  arrive.
- Per-pet behaviour that upstream keeps in code is carried as data in the
  generated tables: swipe bubbles (finley, horse, skeleton, squirrel) and the
  squirrel's speed, climb and fall.

Made on 2026-11-14 after the per-task and whole-branch reviews:

- The art loader is split: `artcore.js` holds the logic with its file and program
  access passed in, so its failure paths are tested; `art.js` is a thin wrapper.
- No load waits on another's promise. Every copy of the mod shares its modules, and
  Herdr stops a closed dialog's work part-way, leaving its promise pending for ever.
  Each load downloads into a side file of its own and puts only whole files in place.
- curl runs without `-f` and with `-w %{http_code}`: 200 is kept, 404 marks an
  animation the pet does not have, anything else is an error. It also has
  `--proto =https`, `--max-time` and `--max-filesize`.
- The newest extension is taken across all four editor folders. "No extension" is
  looked up again after 30 seconds, so installing it is noticed without a restart.
- Downloaded bytes are treated as untrusted: a GIF with an undefined code, short
  data or an oversized frame is rejected, and so is a PNG claiming width or height 0.
- A pet's element is one size-box high with its picture standing on the bottom, so
  its feet do not move when it changes to an animation of another height. Only the
  axis a leg moves on gets the leg's remaining time as its transition.
- `refit` brings a pet on the wall down when the panel no longer contains it, and a
  climb never heads below a floor higher than the climb height.
- `roster.js` (pure) holds the panel's bookkeeping, so the flow from saved list to
  drawn pet is tested.
- Pets stand on a theme's ground only once its picture has loaded. A pet without
  sprites does not react to the pointer.
- A saved pet whose type is not one of the tables' own string keys is dropped.
- Tests need Node 22 or newer (the test script uses a glob).

Made on 2026-11-14 during the owner's trial in the running app:

- **Placement.** `"place": "left"` made Herdr dock a full-height column at the far
  left, which the owner rejected. A mod cannot ask to be placed inside the sidebar,
  so `mod.json` is now `{ "place": "none", "title": "Pets" }` and the recipe tells
  the installer to add a 110 px block in the sidebar column above its footer.
- **Default size is medium** (55 px), not upstream's nano: nano is too small to see
  in a sidebar.
- **Herdr stops a script after about half a second without a break**, and the stop
  cannot be caught (measured: 400 ms passes, 800 ms is stopped). Totoro's sprites
  took longer than that to mirror, so its load died silently. `gif.js` now works in
  steps of 16384 pixels (about 5 ms each in Herdr's engine) and the loader awaits a
  real host call between them at least every 25 ms. A load silent for two minutes is
  started again.
- **Commands** `pets.size-<name>` and `pets.theme-<name>` were added beside
  `pets.spawn` and `pets.remove-all`.
- **Herdr does not hot-reload a symlinked mod folder.** Development copies the mod
  in with `scripts/sync-to-herdr.sh`.

Made on 2026-11-14 after publishing:

- **Renamed to `herdr-vscode-pets`.** Herdr's gallery already listed an unrelated
  mod called `herdr-pets`. The repo is `herdr-vscode-pets`, the mod folder
  `mods/vscode-pets`, the gallery title "VS Code Pets", the commands
  `vscode-pets.*`, the cache `data/vscode-pets/` and the saved-state key
  `vscode-pets`. The old key `pets` is still read while nothing is saved under the
  new one, so the rename loses nobody's pets. Earlier sections of this document
  and its file name keep the first name.
- **A size may be given in pixels** (`vscode-pets.size-45`, 20 to 160) as well as
  by one of upstream's four names; a theme then uses the nearest named size.

