---
name: merge-pr
description: "Use when a maintainer merges a Music Coach pull request: checking it, squash-merging with a correct title, and syncing main. Triggers on 'merge PR', 'merge #N', 'land this', '/merge-pr'."
---

# Merge a pull request (maintainers)

`main` is protected: pull requests only, the `test` check must pass, review
threads must be resolved, squash merge only. These steps keep `main` clean
and the site current.

## 1. Look before merging

```sh
gh pr view <N> --json title,author,files,body
gh pr diff <N>
gh pr checks <N>
```

Stop and comment instead of merging if any of these fail:
- `test` isn't green.
- Lesson or style text names a sound, plugin or folder without going through
  `resolveGear`, or wasn't checked on a bare Mac (see the `contribute` skill).
- A new dependency, analytics, or any network call other than the coach model
  the user picked.
- A pull request that edits CHANGELOG.md by hand (release-please writes it).

For a large change, get an independent review first (a code-review agent, or
a second person). A review of your own work by you isn't a review.

## 2. Fix the title if needed

The title becomes the commit on `main` and the line in the next changelog, so
it should read well to someone who uses the app:

- `type(scope): imperative summary`, 50 characters or fewer, lowercase after
  the colon, no period.

```sh
gh pr edit <N> --title "fix(sampler): keep reverse on after a new loop"
```

## 3. Squash-merge

```sh
gh pr merge <N> --squash --delete-branch
```

The commit body comes from the pull request body; trim it to the why.

## 4. Sync and confirm

```sh
git checkout main && git pull --ff-only
gh run list --branch main --limit 1          # test passes on main too
```

If the pull request changed `docs/`, the site redeploys on its own. Confirm:

```sh
gh api repos/stylusnexus/music-coach/pages/builds/latest --jq .status   # "built"
```

Then open https://stylusnexus.github.io/music-coach/ and check the change is
there.

## 5. Close the loop

- Issues named with `Fixes #N` close themselves; tick any checklist items in
  larger issues by hand.
- Nothing is released until the release pull request is merged (the `release`
  skill): merging to `main` only updates the source, the site, and the release
  pull request that release-please keeps open.
