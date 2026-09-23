---
name: release
description: "Use when a maintainer publishes a new Music Coach version: choosing the version, updating the changelog, tagging, building the Mac app zip, and creating the GitHub release. Triggers on 'release', 'cut a release', 'ship a version', 'publish the app', '/release'."
---

# Release a version (maintainers)

A release is a tag `vX.Y.Z` on `main`, a GitHub release, and the packaged
`Music Coach.zip` attached to it. The site deploys on every merge to `main`;
a release is what people download.

Release tags are protected: once pushed, a `v*` tag can't be moved or
deleted. Check everything before step 5.

## 1. Start clean

```sh
git checkout main && git pull --ff-only
git status --short          # must be empty
npm test
```

## 2. Choose the version

Read `## [Unreleased]` in CHANGELOG.md and the commits since the last tag:

```sh
git describe --tags --abbrev=0 2>/dev/null       # last release, if any
git log $(git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD)..HEAD --oneline
```

- Any `feat` → bump the minor (0.1.0 → 0.2.0).
- Only `fix`, `docs` and the like → bump the patch (0.2.0 → 0.2.1).
- Before 1.0.0, breaking changes bump the minor too.
- The first release is `v0.1.0`.

## 3. Update the changelog through a pull request

On a branch `chore/release-X.Y.Z`:
- Rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` (today) and add a
  new empty `## [Unreleased]` above it.
- Make sure each line reads as plain words for a user, not code.

Open it with the title `chore: release X.Y.Z` and merge it with the
`merge-pr` skill.

## 4. Build and test the app

```sh
git checkout main && git pull --ff-only
packaging/build.sh
```

Unzip `dist/Music Coach.zip` somewhere temporary, right-click the app → Open,
and check it starts, shows the welcome, and plays a note. The zip must hold
only the app: no `data/`, `sketches/` or keys (`build.sh` copies only
`server.py` and `web/`).

## 5. Tag

```sh
git tag -a vX.Y.Z -m "Music Coach X.Y.Z"
git push origin vX.Y.Z
```

## 6. Create the GitHub release

Use the changelog section as the notes:

```sh
awk '/^## \[X.Y.Z\]/{f=1;next} /^## \[/{f=0} f' CHANGELOG.md > /tmp/notes.md
gh release create vX.Y.Z "dist/Music Coach.zip" --title "Music Coach X.Y.Z" --notes-file /tmp/notes.md
```

## 7. Confirm

```sh
gh release view vX.Y.Z --json assets --jq '.assets[].name'   # Music Coach.zip
```

Download the zip from the release page once and open it, as a new user would.
The README says the app is built by hand until the first release exists;
after `v0.1.0`, update its Start section to point at the latest release.
