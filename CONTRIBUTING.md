# Contributing

Thanks for helping. Music Coach is for people who don't play an instrument, so
every change is judged by one question: does it help a beginner get a real
result, in plain words, on their own Mac?

## Before you start

- **Bugs:** open an issue with the bug template. Say what you pressed, what you
  expected, and what happened.
- **New styles or lessons:** open an issue with the style template first.
  Styles are planned in [#1](https://github.com/stylusnexus/music-coach/issues/1)
  and the issues it links to.
- **Anything bigger than a small fix:** open an issue before writing code, so
  we can agree on the approach.

## Run it

You need a Mac, Chrome, Python 3.9 or newer, and Node 20 or newer (for tests).

```sh
./music-coach   # starts the server and opens Chrome at http://localhost:8765
npm test        # JavaScript and Python tests
```

There are no dependencies to install and no build step.

## Rules the code follows

- **No new dependencies.** The server uses the Python standard library only;
  the app is plain browser JavaScript with no build step.
- **Everything stays on the user's Mac.** No analytics and no accounts. Nothing
  goes to the internet except to the coach model service the user picked, and
  never their API key anywhere else.
- **Test what you change.** Music logic and lesson checks go in
  `tests/music.test.mjs`; server behaviour in `tests/test_server.py`.

## Rules lessons follow

- **Plain words.** No jargon without a one-line explanation. Short steps, one
  action each.
- **The bare-Mac test.** A starter style must give an honest first win on a Mac
  with nothing extra: this app's own sounds, GarageBand's stock sounds and
  Apple Loops, and the laptop microphone. No plugins, no sample folders.
- **Never claim gear the Mac lacks.** If a sentence names a sound, plugin or
  folder, it resolves through `resolveGear` in `web/lessons.js`, with a
  truthful stand-in wording for Macs without it.
- **Real screenshots only,** taken from the app they describe.

## Commits and pull requests

Commit messages use [Conventional Commits](https://www.conventionalcommits.org):

```
type(scope): imperative summary

Why the change is needed, wrapped at 72 characters.
```

- Subject: 50 characters or fewer, lowercase after the colon, no period,
  imperative mood ("fix the race", not "fixed").
- Types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `build`, `ci`.
- A body only when the why isn't obvious from the diff.
- Reference issues as `Fixes #123` on its own line.

Pull requests go to `main`, need the tests to pass, and are squash-merged, so
the pull request title follows the same rules as a commit subject.

## Using Claude Code

If you use [Claude Code](https://claude.com/claude-code), the repo ships three
skills in `.claude/skills/` that walk through the steps on this page.

### `contribute`: for anyone opening a pull request

Type `/contribute` (or ask Claude to "open a PR for this change"). It takes
you through:

1. A branch from an up-to-date `main`, named `type/short-name`.
2. `npm test`, and tests for what you changed.
3. For lessons and styles, the **bare-Mac check**: a second server that
   pretends to be a Mac with no plugins, no sample folders and no extra
   hardware, on its own port and data so your own setup is untouched:

   ```sh
   COACH_PORT=8799 COACH_DATA=$(mktemp -d) COACH_SKETCHES=$(mktemp -d) \
   COACH_LOCAL_SAMPLES=/nonexistent COACH_SAMPLES=/nonexistent \
   COACH_GUITAR_DIR=/nonexistent python3 server.py
   ```

   Open http://localhost:8799 and play the lesson: every step must work with
   the app's own sounds and GarageBand's, and every check must tick.
4. A line under `## [Unreleased]` in CHANGELOG.md for anything a user would
   notice.
5. A commit in the format below, then `gh pr create` and `gh pr checks --watch`.

You can do all of this by hand; the skill just keeps the steps in order.

### `merge-pr` and `release`: for maintainers

- `merge-pr` checks a pull request against the rules here, fixes the title if
  needed, squash-merges it, and confirms the site rebuilt.
- `release` picks the version, updates the changelog, builds and test-opens
  `Music Coach.zip`, tags `vX.Y.Z`, and publishes the GitHub release.

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
