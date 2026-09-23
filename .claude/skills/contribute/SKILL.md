---
name: contribute
description: "Use when making a change to Music Coach and opening a pull request: starting a branch, checking a lesson on a bare Mac, writing the commit, and opening the PR. Triggers on 'open a PR', 'submit this change', 'contribute', '/contribute'."
---

# Contribute a change

For anyone changing Music Coach, maintainers included. `main` only accepts
pull requests that pass the `test` check, so every change goes through these
steps.

## 1. Start from an up-to-date main

```sh
git checkout main && git pull --ff-only
git checkout -b <type>/<short-name>      # e.g. feat/punk-lesson, fix/sampler-reverse
```

No write access? Fork on GitHub first; `gh pr create` handles forks.

## 2. Make the change, then test

```sh
npm test
```

Add or update tests for what you changed: music logic and lesson checks in
`tests/music.test.mjs`, server behaviour in `tests/test_server.py`.

## 3. Lessons and styles: run the bare-Mac check

A starter style must work on a Mac with no plugins, no sample folders and no
extra hardware. Start a server that pretends to be that Mac, on its own port
and data, so your own setup is untouched:

```sh
COACH_PORT=8799 COACH_DATA=$(mktemp -d) COACH_SKETCHES=$(mktemp -d) \
COACH_LOCAL_SAMPLES=/nonexistent COACH_SAMPLES=/nonexistent \
COACH_GUITAR_DIR=/nonexistent python3 server.py
```

Open http://localhost:8799, finish the welcome, and play the lesson. Check:
- every step can be done with the app's own sounds and GarageBand's;
- no sentence names a sound, plugin, folder or menu this Mac lacks (lesson
  text that depends on gear goes through `resolveGear` in `web/lessons.js`);
- every check ticks.

Plain words, one action per step, no jargon without a short explanation
(see CONTRIBUTING.md).

## 4. Changelog: nothing to edit

CHANGELOG.md is written by release-please from pull request titles. Don't
edit it. Make the title (step 6) read well to someone who uses the app:
`feat` goes under Added, `fix` under Fixed; `docs`, `test`, `chore`, `ci`
and the like stay out.

## 5. Commit

```
type(scope): imperative summary

Why the change is needed, wrapped at 72 characters.

Fixes #123
```

- Subject 50 characters or fewer, lowercase after the colon, no period,
  imperative ("add", not "added").
- Types: feat, fix, docs, test, refactor, chore, build, ci.
- A body only when the why isn't obvious from the diff.

## 6. Open the pull request

```sh
git push -u origin HEAD
gh pr create --base main --title "<same form as a commit subject>" --fill
```

The title becomes the commit on `main` (squash merge) and the changelog line,
so it follows the commit subject rules. The `pr-title` check enforces them:
50 characters or fewer, lowercase after the colon, no full stop. Fill in the template: why, and the two checks.

## 7. Watch the check

```sh
gh pr checks --watch
```

If `test` fails, open the log with `gh run view --log-failed`, fix, push
again. A maintainer merges once it's green (see the `merge-pr` skill).
