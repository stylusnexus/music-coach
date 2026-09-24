---
name: release
description: "Use when a maintainer publishes a new Music Coach version: checking and merging the release pull request that release-please keeps open, then confirming the GitHub release and the Mac app zip. Triggers on 'release', 'cut a release', 'ship a version', 'publish the app', '/release'."
---

# Release a version (maintainers)

Releases are automated by release-please (`.github/workflows/release-please.yml`):

- After every merge to `main`, it updates one open pull request titled like
  `chore(main): release 0.2.0`, with the next version and the new changelog
  section written from merged pull request titles.
- Merging that pull request tags `vX.Y.Z` and creates the GitHub release as a
  draft. A Mac runner builds the app zips, attaches them, and only then
  publishes the release, so the "latest" download link never points at a
  release without its zip.

Your job is to check it, merge it, and confirm the result.

## 1. Find the release pull request

```sh
gh pr list --label "autorelease: pending" --json number,title,url
```

No pull request means nothing user-visible has merged since the last release.

## 2. Check it

```sh
gh pr view <N> --json title,body
gh pr diff <N>
```

- The version bump is right: before 1.0.0, any `feat` bumps the minor
  (0.1.0 → 0.2.0), only `fix` bumps the patch.
- Every changelog line reads well to someone who uses the app. If one
  doesn't, fix the *title of the merged pull request it came from*
  (`gh pr edit <old N> --title ...`); release-please rewrites the release
  pull request on the next run. Don't hand-edit CHANGELOG.md.

## 3. Test the app zip before releasing

```sh
git checkout main && git pull --ff-only
packaging/build.sh
```

Unzip `dist/Music Coach.zip` somewhere temporary, open the app, and check it
starts, shows the welcome, and plays a note. A local build is signed for this
Mac only; to test the signed and notarized app, build with your Developer ID
(needs the certificate and a `music-coach` notarytool profile in your Keychain):

```sh
SIGN_IDENTITY="Developer ID Application: STYLUS NEXUS HOLDINGS, LLC (ML8HXS6BGB)" \
  NOTARY_PROFILE=music-coach packaging/build.sh
```

The release job signs and notarizes with the `MACOS_CERT_P12`,
`MACOS_CERT_PASSWORD`, `NOTARY_KEY_P8`, `NOTARY_KEY_ID` and `NOTARY_ISSUER`
secrets, kept in the `release` environment (Settings → Environments), which
only `main` can use. Without them it stops before publishing.

## 4. Merge it

```sh
gh pr merge <N> --squash
```

No `test` or `pr-title` check on it? GitHub's own token opened it, and that
never starts other workflows. Close and reopen it under your account, which
does:

```sh
gh pr close <N> && gh pr reopen <N>
gh pr checks <N> --watch
```

Adding a `RELEASE_PLEASE_TOKEN` secret (a fine-grained token with contents
and pull-request write access) makes the checks run on their own instead.

Release tags are protected: once pushed, a `v*` tag can't be moved or
deleted.

## 5. Confirm

```sh
gh run watch $(gh run list --workflow release --limit 1 --json databaseId --jq '.[0].databaseId')
gh release view --json tagName,assets --jq '{tag: .tagName, assets: [.assets[].name]}'
```

The release should list two copies of the app: `Music.Coach.zip` (a stable
name for the README's "latest" link) and `Music-Coach-X.Y.Z.zip`. Download one
from the release page and open it, as a new user would: the version shows next
to the name at the top of the app and in Finder's Get Info.

After the first release (`v0.1.0`), update the README's Start section to point
at the latest release download instead of building the zip by hand.
