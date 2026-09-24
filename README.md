# Music Coach

[![test](https://github.com/stylusnexus/music-coach/actions/workflows/test.yml/badge.svg)](https://github.com/stylusnexus/music-coach/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg)
![Python 3.9+](https://img.shields.io/badge/python-3.9%2B-3776ab.svg)
![Dependencies: none](https://img.shields.io/badge/dependencies-none-brightgreen.svg)

Learn to make music on your Mac, and learn GarageBand while you do it.

Guided lessons take you from your first chord to a finished track. You play
chords, beats and loops in a practice room that sounds good from the first
note, then take what you made into GarageBand and learn its tools step by
step, with screenshots: tracks, the grid, the Piano Roll, mixing, fades and
exporting. You don't need to play an instrument: a small MIDI keyboard helps,
and your computer keys work too.

![Music Coach: a lesson, the chord display and the keyboard](docs/img/app.jpg)

It runs on your Mac and opens in Chrome. Your files stay on your Mac, and
there's no account.

## Why this exists

I built Music Coach because I was lost. I had GarageBand, a small keyboard and
plenty of plugins, but no sense of how it all fits together, and not much
patience for learning each tool from its manual. I wanted to make something
first and understand it along the way. If that sounds like you, this is for
you.

— Eve, Stylus Nexus

## What's inside

- **49 short lessons: 48 in four sections, plus one optional.**
  - **Basics:** your first chord, four chords that carry a song, major and
    minor, letting an arpeggiator do the picking, a drum machine, 7th chords,
    recording a sketch, and taking it to GarageBand.
  - **Quick wins:** build a beat, cut up a loop in the sampler, build a piece
    in layers with the looper.
  - **GarageBand skills:** the map, drag and drop, the grid, the Piano Roll,
    making instruments sound played, multi-tracking, blending, fades,
    exporting. Most steps have a screenshot.
  - **Optional:** carry a sketch to GarageBand on iPhone and iPad, with what's
    different from the Mac.
  - **Styles:** pick up to 5 of 24 (to start): folk, punk, house, lo-fi
    hip-hop, ambient drone, dub, kosmische, synthwave, downtempo, reggae, metal,
    techno, shoegaze, ambient techno, Afrobeat, bossa nova, lounge pop,
    post-punk and darkwave, gothic rock, minimal wave, classical minimalism,
    Eno-style ambient, new wave and dark ambient. Each has a 5-second taste
    played by the app, and a real record to hear in full on Bandcamp. Every
    starter works on a Mac with nothing extra installed.
- **A studio:** sounds, effects, arpeggiator, drum patterns and your own beat
  grid, bass and drone layers, a looper, a sampler (it can record a sound from
  your microphone and chop it up), a mixer, and a progression builder.
- **Hear the real thing:** each style links one or two real records, played
  from the artist's or label's Bandcamp page when you press Hear it.
- **Chords and keys:** a chord explorer, a circle-of-fifths wheel, a key
  picker with scale lock, and a way to find a song's key by ear.
- **Ear lab:** short ear-training drills that unlock as you go.
- **A take coach:** record a take and it scores chords, timing, feel, sound and
  ending from what it measured. It can't hear you; it only scores the numbers.
- **Your gear:** it finds the plugins on your Mac and sorts them by what they
  do. With a coach model set up, it also sorts and describes plugins it
  doesn't recognise. You can add sample folders and hardware, or remove
  anything. Lessons name your own gear when you have it, and GarageBand's
  built-in effects when you don't.

## What you need

- A Mac with **GarageBand 10.4.14 or later** (free from Apple; it needs
  macOS 15.6 or later). The lessons are checked against this version; older
  ones may name menus differently. Check yours under GarageBand > About
  GarageBand.
- **Google Chrome.** Safari can't read MIDI keyboards.
- **Python 3.9 or newer.** The app tells you where to get it if it's missing.
- A small MIDI keyboard is nice but optional: computer keys A–K play white
  notes, W E T Y U the black ones, and Z to , the octave below.

## Start

**The app:** [download Music Coach](https://github.com/stylusnexus/music-coach/releases/latest/download/Music.Coach.zip)
(the latest release, about 1 MB). Unzip it and drag **Music Coach** to your
Applications folder (from Downloads, macOS runs a temporary copy, and
Uninstall can't remove that). Then right-click it and choose **Open** (it
isn't notarized yet, so the first open needs the right-click). It starts the coach, which listens only on this Mac at
http://localhost:8765, and opens Chrome.

Which version do you have? It's next to the name at the top of the app, in
Finder's Get Info, and in the file name if you download a specific release
(`Music-Coach-0.3.0.zip`) from [Releases](https://github.com/stylusnexus/music-coach/releases).

**From source:**

```sh
git clone https://github.com/stylusnexus/music-coach.git
cd music-coach
./music-coach
```

This starts the local server and opens http://localhost:8765 in Chrome. The
server listens only on this Mac, on port 8765. To use another port:
`COACH_PORT=9000 ./music-coach`.

To start it with a double-click next time, make a shortcut:

```sh
./music-coach shortcut
```

This puts a **Music Coach** app on your Desktop that starts this copy (add a
folder to put it elsewhere, e.g. `./music-coach shortcut ~/Applications`).

The first time, a welcome screen asks what gear you have. Skip it if you have
none: every lesson works with the app's own sounds and GarageBand's.

## The coach model (bring your own key)

The coach model answers your questions ("why does my chord sound muddy?") and
writes a short summary under a take's scores. Press **Coach model** at the top
of the app to pick one:

- **A model on your Mac**, in [LM Studio](https://lmstudio.ai): load a model,
  open the Developer tab, and switch the server on. Free, and nothing leaves
  your Mac.
- **OpenAI or Anthropic**: paste your own API key. The defaults are small, cheap
  models (gpt-5-nano, Claude Haiku 4.5), well under a cent per question.
- **Another service that works like OpenAI's**, such as Ollama or OpenRouter:
  its address, the model name, and a key if it needs one.

Your key is saved only on your Mac, readable by your account only, and sent
only to the service you picked. Without any model, the lessons, the studio
and the take scores all still work. Only the written summary and the Ask box
need one.

## Why doesn't my instrument sound like a real one?

Most of the difference is how the notes are played, not which sound you pick. These work on any track in GarageBand:

1. **Write what the real instrument could play.** A guitar has six strings, so spread a chord out the way they would: E major, low to high, is E B E G♯ B E, not three notes bunched together. Keep a bass line to one note at a time, low down. Wrong notes sound fake even with a great sound.
2. **Vary how hard each note is hit.** Real players never hit two notes the same. In the Piano Roll, select notes and change their velocity. Make the notes on the beat a little louder than the ones between.
3. **Loosen the timing.** Notes locked exactly to the grid sound robotic. Turn off Edit > Snap to Grid, then nudge a few notes slightly early or late. For a strum, spread the chord's notes 10 to 30 milliseconds apart: low string first on a down-strum, high string first on an up-strum.
4. **Vary how long notes last.** Drawn notes all run the same length and never stop. Real players shorten some notes and leave gaps; horn and wind players stop to breathe. Overlap string notes slightly so they connect, and hold the sustain pedal on piano.
5. **Give it a room.** A little reverb makes it sound played in a space. Run an electric guitar through Amp Designer and the Pedalboard, like a real amp and pedals.

More ways:

- **No pedal or mod wheel?** Musical Typing (Command-K) has both: Tab is the sustain pedal, and 4 to 8 move the mod wheel (3 sets it back). On Studio Strings and Studio Horns, the mod wheel makes long notes swell and fade.
- **Use recordings.** Drummer plays like a session drummer, with human timing and feel. Apple Loops (press O) with a blue icon are audio recordings, often of real players; green ones are MIDI.
- **Record the real thing.** With a microphone and headphones you can record a voice, a shaker or hand claps.
- **Use better sounds.** In GarageBand, choose GarageBand > Sound Library > Download All Available Sounds, then pick instruments from the Library (press Y). Sample libraries and instrument plugins you own usually sound more detailed still; the Your gear window lists them.

The practice room's own sounds are simple stand-ins, there so you can hear chords and rhythm while you learn. Once GarageBand's full Sound Library is downloaded, its guitar switches to a recorded 12-string.

## Privacy

Everything runs on your Mac. Your progress, gear list, sketches and key stay
in local files. The app goes online only in three cases:

- when you pick an online coach model, and then only to that service. It
  gets your questions and your take's numbers. To sort plugins the app
  doesn't recognise, it also gets their names, makers and type (instrument
  or effect), once each, plus the names of gear you add by hand. Your
  folders, samples, sketches and recordings are never sent. With LM Studio,
  none of this leaves your Mac;
- when you press **Hear it** on a style, which loads that track's player from
  Bandcamp. Bandcamp, and the analytics its player uses, see that visit.
  Nothing loads until you press it;
- when you press **Check for updates** in About, which asks GitHub for the
  latest version number. Nothing about your music, gear or files is sent,
  and the app never checks on its own.

## Where things live

When you run from source:

- `sketches/`: your saved MIDI sketches.
- `data/progress.json`: which lessons you've finished.
- `data/gear.json`: your sample folders, gear added by hand, gear you removed.
- `data/gear-labels.json`: what the coach model said about your plugins.
- `data/coach.json`: which coach model answers, and your API key.

The packaged app keeps these in `~/Library/Application Support/Music Coach`,
and sketches in `~/Music/Music Coach Sketches`. The two copies don't share
progress, so pick one. None of it is inside the app, so updating or replacing
the app keeps it.

To save sketches somewhere else, press **Change folder…** under Sketches.
Sketches already saved stay where they are unless you choose to move them.
The version number at the top of the app opens **About**, which shows where
everything is.

## Uninstall

Click the version number at the top of the app, then **Uninstall Music
Coach…**. It moves the app to the Trash and stops the coach. Tick the box to
also move your progress, gear list, coach key and takes to the Trash, plus your
sketches if they're in the default folder. A sketches folder you chose yourself
is never moved. Nothing is deleted outright: drag it back out of the Trash to
undo.

By hand: close the Music Coach tab, then stop the coach: restart your Mac, or
in Activity Monitor quit the process named Python. Drag Music Coach to the
Trash and, if you want your data gone too,
`~/Library/Application Support/Music Coach` and `~/Music/Music Coach Sketches`.

Running from the code: delete the `music-coach` folder, and any Music Coach
shortcut you made with `./music-coach shortcut`.

## Build the app

```sh
packaging/build.sh
```

Builds `dist/Music Coach.zip`. Only the app goes in: never your data, sketches
or key.

## Develop

No dependencies and no build step: the Python standard library for the
server, plain browser JavaScript for the app, Node's built-in test runner for
the music logic.

```sh
npm test
```

- `server.py`: serves the app, stores progress and gear, scans plugins, talks
  to the coach model.
- `web/lessons.js`: lesson content. Add a lesson by adding an entry here.
- `web/app.js`: the page. `web/audio.js`: the sound engine. `web/music.js`:
  chords, keys and MIDI files.

## What's next

More styles are planned: blues, country, drum and bass, industrial,
Ethio-jazz and more, plus a few lessons that go beyond GarageBand's own sounds
with free plugins. Also planned: Logic Pro and Ableton Live lessons, phone and
tablet layouts, and Windows. See [the issues](https://github.com/stylusnexus/music-coach/issues).

Mac only for now.

## Support

Questions, bugs or feedback: [open an issue](https://github.com/stylusnexus/music-coach/issues),
or email [admin@stylusnexus.com](mailto:admin@stylusnexus.com) if you'd rather
not use GitHub.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## License

MIT © 2026 Stylus Nexus Holdings LLC. See [LICENSE](LICENSE).
