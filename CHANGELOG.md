# Changelog

All notable changes to this project are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- A style picker: new users pick up to 5 styles in a 3-step welcome (gear,
  styles, coach model). "Change my styles" and "Show all styles" in the
  lesson list; "Unlock anyway" opens a style before finishing the Basics.
- Four new styles that need nothing extra installed: folk, bossa nova,
  minimal wave, and classical minimalism.
- Style lessons name optional gear that would bring them closer to the
  record, only when it's missing.
- 30 lessons in four sections: Basics, Quick wins, GarageBand skills and
  Styles (kosmische, Eno-style ambient, dark ambient, Stereolab, new wave,
  post-punk and darkwave, shoegaze).
- A studio: sounds, effects, arpeggiator, drum patterns and a beat grid, bass
  and drone layers, looper, sampler with microphone recording, mixer, and
  progression builder.
- Chord explorer, circle-of-fifths wheel, key picker with scale lock, and a key
  finder by ear.
- Ear lab drills.
- Take coach: records a take and scores chords, timing, feel, sound and ending
  from measurements.
- Your gear: finds installed plugins; add sample folders and hardware by hand;
  remove and restore gear. Lessons name the user's gear, or GarageBand's
  built-ins when it's missing.
- Coach model choice: LM Studio on the Mac, or the user's own OpenAI,
  Anthropic or OpenAI-compatible key.
- Sketches saved as MIDI files for GarageBand.
- A packaged Mac app built by `packaging/build.sh`.
- `./music-coach shortcut` makes a double-click app that starts a copy run from source.

### Changed

- Basics lessons and the coach model's goal describe techniques, not one
  band; copies that started before this keep their original wording.
