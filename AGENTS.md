# AGENTS.md

Instructions for AI coding agents and the people who use them. Read this before
changing anything. CONTRIBUTING.md has the same rules, written for people.

## What this is

Music Coach teaches beginners to make music on a Mac and to use GarageBand.
It is a small local server plus a browser app, MIT licensed.

- Server: `server.py`, Python 3.9+ standard library only. No pip packages.
- App: plain ES-module JavaScript, HTML and CSS in `web/`. No framework, no
  bundler, no build step. Edit a file and reload the page.
- Node 20+ is used only to run tests. There is no `node_modules`.
- Runs on macOS in Google Chrome (Safari has no Web MIDI).

## Run it

```sh
./music-coach            # starts the server on port 8765 and opens Chrome
./music-coach shortcut   # makes a "Music Coach" app on the Desktop that starts this copy
```

`./music-coach` stops any other Music Coach server already on its port. Do not
run it on a user's machine without asking: it can stop their running coach.

As an agent, run the server directly, on its own port, with throwaway data.
Never read or write the user's real `data/` or `sketches/`.

```sh
COACH_PORT=8799 COACH_DATA=$(mktemp -d) COACH_SKETCHES=$(mktemp -d) python3 server.py
```

To act like a bare Mac (no sample folders, no recorded guitar), add:

```sh
COACH_LOCAL_SAMPLES=/nonexistent COACH_SAMPLES=/nonexistent COACH_GUITAR_DIR=/nonexistent
```

Environment variables the server reads:

| Variable | Default | Purpose |
| --- | --- | --- |
| `COACH_PORT` | `8765` | Port on 127.0.0.1 |
| `COACH_DATA` | `data/` next to `server.py` | Progress, gear, coach settings and key |
| `COACH_SKETCHES` | `sketches/` next to `server.py` | Saved MIDI sketches |
| `COACH_SAMPLES`, `COACH_LOCAL_SAMPLES`, `COACH_GUITAR_DIR` | real sample paths | Sample folders scanned for sounds |

## Test it

```sh
npm test
```

This runs, in order: `node --check` on every `web/*.js`, then
`node --test tests/music.test.mjs`, then `python3 -m unittest discover -s tests`.
All three must pass. CI runs the same command on every pull request (Node 20,
Python 3.9), and a separate check validates the pull request title.

- Music logic, lesson content and lesson checks: `tests/music.test.mjs`.
- Server behaviour: `tests/test_server.py`. Server tests point `server.DATA`
  and `server.SKETCHES` at a temp directory; do the same in new tests.

Add or update tests for what you change.

## Layout

| Path | What lives there |
| --- | --- |
| `server.py` | Serves `web/`, stores progress and gear, scans plugins and samples, talks to the coach model. All `/api/*` routes are in `Handler.do_GET` and `Handler.do_POST`. |
| `web/lessons.js` | All lesson content, section order, style cards, recordings, gear wording, and the checker that ticks steps off. |
| `web/app.js` | The page: rendering, lesson flow, studio controls. |
| `web/audio.js` | Sound engine. |
| `web/music.js` | Chords, keys, scales, MIDI files. |
| `web/gear.js` | "Your gear" panel: plugin descriptions, grouping, search. |
| `web/looper.js`, `web/takes.js`, `web/ear.js`, `web/input.js`, `web/chords.js` | Looper, take scoring, ear drills, keyboard input, chord explorer. |
| `tests/` | `music.test.mjs` (Node) and `test_server.py` (unittest). |
| `docs/` | The project website. |
| `packaging/build.sh` | Builds `dist/Music Coach.zip` and `dist/Music-Coach-X.Y.Z.zip`. |
| `packaging/launcher.applescript` | The app's launcher: finds Python, starts the server, opens Chrome. |
| `.claude/skills/` | Step-by-step workflows: `contribute`, `merge-pr`, `release`. |

User data, never committed (`data/`, `sketches/` and `dist/` are gitignored):

- From source: `data/` (`progress.json`, `gear.json`, `gear-labels.json`,
  `coach.json`) and `sketches/`.
- Packaged app: `~/Library/Application Support/Music Coach` and
  `~/Music/Music Coach Sketches`.

## Adding a lesson or a style

All of this is in `web/lessons.js`.

1. **Lesson object** in `ALL_LESSONS`. Copy a similar lesson. Common fields:
   `id` (kebab-case), `title`, `minutes`, `why`, `steps` (array of strings),
   `setup` (sound, arp, drums, bpm, fx and so on), `chart` or `targets`
   (chord names), and `checks` (each has a `type` and a `label`). Use only
   check types that `createChecker` already handles, or add the type there
   with a test. Guided lessons (`guided: true`) use step objects with `label`,
   `text` and an optional `check`; their checks are built from the steps.
2. **Place it** in `SECTIONS`: add the `id` to one section's `ids`. Every
   lesson appears exactly once. A test asserts the total lesson count; update
   it.
3. **For a style**, also add:
   - `STYLE_INFO[id]`: `name`, `artists`, `sound` (one short line),
     `texture` (`drone`, `chord`, `groove`, `sample`, `synth` or `mix`),
     and optional `betterWith` and `matches`.
   - `LISTEN[id]`: one or two real records, each from the artist's or
     label's official Bandcamp page: `artist`, `title`, `url`,
     `kind` (`album` or `track`) and the numeric Bandcamp `id` (from the
     page's `bc-page-properties`). Check each page by hand.
   - The `id` in `PICKER_ORDER`. It must list every style exactly once.
4. **Optional `goFurther`**: `{ text, links: [{ name, url }] }` pointing to
   free plugins that get closer to the record. Links go only to the maker's
   own official page, over https. No lesson check may depend on the plugin.
5. **Gear in text.** Never name a plugin, recorded sound, sample folder or
   menu the Mac might not have. Write a token instead, resolved by
   `resolveGear`: `GEAR` keys (`{amp}`, `{chorus}`, `{echo}`, `{reverb}`,
   `{fuzz}`, `{tape}`, ...) become the installed plugin or GarageBand's
   built-in, and `PHRASES` keys (`{Organ}`, `{samplerStart}`, ...) swap whole
   sentences. To add a phrase, keep the original wording as the first branch
   and give an honest stand-in for Macs without the gear.

Tests that guard lessons, in `tests/music.test.mjs`:

- "on a bare Mac, lessons claim no sound, folder or plugin it lacks": no
  gear-specific words and no unresolved `{token}` on a bare Mac.
- "with all of Eve's gear, lessons read as they always did": with the
  maintainer's full gear list, existing sentences stay word for word.
- Style tests: every style has a card, one or two official Bandcamp
  recordings, and a single place in `PICKER_ORDER`.

Then do the bare-Mac check by hand: start the bare-Mac server above, open it
in Chrome, and play the lesson. Every step must work with the app's own
sounds and GarageBand's, and every check must tick.

## Rules that must not break

- Every lesson works on a bare Mac with GarageBand only: the app's sounds,
  GarageBand's stock sounds and Apple Loops, and the built-in microphone.
- No new dependencies. Standard library Python, plain browser JavaScript, no
  build step.
- The server listens on `127.0.0.1` only. `from_elsewhere` refuses any
  request whose Host is not `localhost:<port>` or `127.0.0.1:<port>`, or
  whose Origin is another site. Keep both checks on every route.
- The coach API key is written with `write_json(..., private=True)` (mode
  0600) and is sent only to the provider the user chose (LM Studio, OpenAI,
  Anthropic, or their own OpenAI-compatible address). Never log it, return
  it to the page, or send it anywhere else.
- No analytics, no accounts. Nothing uploads the user's folders, samples,
  sketches or recordings. The only network calls are to the chosen coach
  model and Bandcamp's player when the user presses Hear it.
- User data lives outside the app bundle, so replacing the app keeps it.
  `packaging/build.sh` copies only `server.py` and `web/`.
- Never commit `data/`, `sketches/`, `dist/`, API keys or other secrets.
- Don't edit `CHANGELOG.md`. release-please writes it.
- Screenshots in lessons are real, taken from the app they describe.

## Workflow

- Work on a branch named `type/short-name` from an up-to-date `main`, and open
  a pull request to `main`. Never push to `main` directly.
- `main` is protected: the `test` check must pass, history stays linear, and
  pull requests are squash-merged.
- Pull request titles use Conventional Commits and are checked in CI:
  `type(scope): imperative summary`, 50 characters or fewer, lowercase after
  the colon, no full stop. Types: `feat`, `fix`, `docs`, `test`, `refactor`,
  `perf`, `revert`, `chore`, `build`, `ci`.
- The squashed title becomes the changelog line: `feat` goes under Added,
  `fix` under Fixed, `perf` and `revert` under Changed, `docs` under
  Documentation; the rest are hidden. Write it for someone who uses the app:
  `feat(styles): add gothic rock`, not `feat: update lessons.js`.
- Before 1.0.0, a `feat` bumps the minor version and a `fix` bumps the patch.
- Releases: release-please keeps a release pull request open. Merging it tags
  the version and creates a draft GitHub release. A macOS job runs
  `packaging/build.sh`, attaches both zips, and only then publishes the
  release. Release tags cannot be moved or deleted.

The full steps are in `.claude/skills/contribute/SKILL.md` (opening a pull
request), `.claude/skills/merge-pr/SKILL.md` (maintainers merging) and
`.claude/skills/release/SKILL.md` (maintainers releasing). They are plain
Markdown with shell commands; any agent can follow them.

## Writing for users

Lessons and UI text are for people who have never played an instrument.

- Plain words. Explain any music or studio term in one short clause the first
  time: "a power chord: just two notes".
- Short sentences. One action per step: "Tap D major (D F# A)."
- Spell out what to press, where, and what they should hear or see.
- Name GarageBand menus and keys exactly: "File → Save", "the Library
  (press Y)".
- Name other lessons by title, never by number.
- No hype and no claims the app can't back up. The take coach "can't hear
  you; it only scores the numbers."
