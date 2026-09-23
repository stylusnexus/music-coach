// Lesson content, the checker that ticks lesson steps off, and gear-name resolution.
import { chordPitchClasses, hasInterval, keyPitchClasses, lessonKey, matchesChord, NOTE_NAMES, parseKey, pitchClass, SCALES } from './music.js';

// Gear tokens in lesson text resolve to the first plugin you have installed,
// falling back to the effect that ships with GarageBand.
export const GEAR = {
  chorus: { prefer: ['Triad Chorus v6'], label: 'Triad Chorus', fallback: "GarageBand's Chorus" },
  echo: { prefer: ['Tape Echo v6', 'Space Delay v6', 'Delay Lab v6'], labels: ['Tape Echo', 'Space Delay', 'Delay Lab'], fallback: "GarageBand's Tape Delay" },
  reverb: { prefer: ['CSR Plate v6', 'Prism Reverb v6', 'CSR Hall v6'], labels: ['CSR Plate', 'Prism Reverb', 'CSR Hall'], fallback: "GarageBand's ChromaVerb" },
  amp: { prefer: ['AmpliTube 5'], label: 'AmpliTube 5', fallback: "GarageBand's Amp Designer" },
  reverse: { prefer: ['CSR Inverse v6'], label: 'CSR Inverse', fallback: 'a reverse reverb plugin' },
  fuzz: { prefer: ['AmpliTube 5'], label: 'a fuzz pedal in AmpliTube 5', fallback: "GarageBand's Distortion" },
  guitarPlayer: { prefer: ['VG-SPARKLE2'], label: 'VG-SPARKLE2', fallback: 'a clean electric guitar sound' },
  tape: { prefer: ['Tape Machine 80 v6', 'TASCAM PORTA ONE v6'], labels: ['Tape Machine 80', 'TASCAM Porta One'], fallback: 'nothing extra' },
  wobble: { prefer: ['Tape Machine 80 v6', 'TASCAM PORTA ONE v6'], labels: ['Tape Machine 80', 'TASCAM Porta One'], fallback: "GarageBand's Chorus at a slow rate" },
};

// What this Mac has, for lesson text. A bare list of plugin names still works.
// sounds: recorded instruments found; kits: recorded drum kits; loopGroups: sampler loop
// folders; folder: the first sample folder, as shown; tags: gear added by hand, by tag.
function gearEnv(env) {
  if (env && env.installed instanceof Set) return env;
  const e = Array.isArray(env) ? { installed: env } : env || {};
  return {
    installed: new Set(e.installed || []),
    sounds: new Set(e.sounds || []),
    kits: new Set(e.kits || []),
    loopGroups: new Set(e.loopGroups || []),
    folder: e.folder || null,
    tags: e.tags || {},
    durutti: Boolean(e.durutti),
  };
}

// "Studio headphones" reads as "your studio headphones"; brand names and plugin names
// keep their capitals.
function yours(name, e) {
  const plain = /^[A-Z][a-z]+( [a-z]+)*$/.test(name) && !e?.installed.has(name);
  return `your ${plain ? name[0].toLowerCase() + name.slice(1) : name}`;
}

function preferred(key, e) {
  return GEAR[key].prefer.findIndex((p) => e.installed.has(p));
}

export function gearName(key, env) {
  const g = GEAR[key];
  if (!g) return key;
  const e = gearEnv(env);
  const idx = preferred(key, e);
  if (idx !== -1) return g.labels ? g.labels[idx] : g.label;
  // Gear added by hand with this job's tag: only the name swaps, never the steps.
  if (e.tags[key]) return yours(e.tags[key], e);
  return g.fallback;
}

// Sentences that depend on what this Mac has, so a lesson never names a sound, a folder
// or a menu that isn't there. The first wording is the original, kept when the gear is.
const PHRASES = {
  fxRoute: (e) => (['chorus', 'echo', 'reverb'].every((k) => preferred(k, e) !== -1)
    ? 'Audio Units → IK Multimedia'
    : 'click an empty slot and pick each one from its menu'),
  guitarBonus: (e) => (preferred('guitarPlayer', e) !== -1
    ? 'Bonus: add a new Software Instrument track with VG-SPARKLE2 and hold the same chords. It plays real recorded guitar.'
    : 'Bonus: add a new Software Instrument track, pick a guitar from the Library (press Y), and hold the same chords.'),
  auExample: (e) => (e.installed.has('Triad Chorus v6')
    ? '(for example IK Multimedia, then Triad Chorus)'
    : '(your installed plug-ins are listed by maker)'),
  moogReal: (e) => (e.sounds.has('moog-bass') ? 'a real Minimoog' : 'a synth bass, standing in for a Minimoog'),
  minimoog: (e) => (e.sounds.has('moog-bass') ? 'a Minimoog' : 'a synth bass'),
  Organ: (e) => (e.sounds.has('farfisa') ? 'Farfisa Organ' : 'Organ'),
  Moog: (e) => (e.sounds.has('moog-bass') ? 'Minimoog Bass' : 'Synth Bass'),
  vp330: (e) => (e.sounds.has('vp330-strings') ? 'VP-330 strings' : 'soft strings'),
  vp330Cap: (e) => (e.sounds.has('vp330-strings') ? 'VP-330 strings' : 'Soft strings'),
  VP330: (e) => (e.sounds.has('vp330-strings') ? 'VP-330 Strings' : 'Strings'),
  farfisa: (e) => (e.sounds.has('farfisa') ? 'a Farfisa organ' : 'an organ-like synth, standing in for a Farfisa'),
  cr78: (e) => (e.kits.has('cr78') ? 'a real CR-78 drum machine' : 'the built-in drum machine'),
  kitSwap: (e) => (e.kits.has('minipops')
    ? 'Switch Kit to Minipops: the same pattern from a different machine and era.'
    : 'Play 2 more bars and change one box while it plays: the beat changes on the next pass.'),
  kitCheck: (e) => (e.kits.has('minipops') ? '2 bars on the Minipops kit' : '2 more bars of your beat'),
  // With no loops to cut up, recording a sound is the way in: hum, tap or clap into the mic.
  samplerStart: (e) => (e.loopGroups.has('Minipops drum loops')
    ? 'The sound is "Sampler". Pick a loop from the list. "Can Ballad" in the Minipops drum loops is a good start. The tempo changes to match it.'
    : e.loopGroups.size
      ? 'The sound is "Sampler". Pick a loop from the list, or press ● Record a sound to sample your own. A loop with its tempo in the name sets the tempo to match.'
      : `The sound is "Sampler". Press ● Record a sound${e.tags.microphone ? ` with ${yours(e.tags.microphone, e)}` : ''} and hum, tap or clap for 3 to 5 seconds, then press it again to stop. Your recording becomes the loop, cut into 8 slices. Can and Cluster sampled the room around them.`),
  loopCheck: (e) => (e.loopGroups.size ? 'Load a loop' : 'Record a sound'),
  textureTip: (e) => (e.loopGroups.has('Tape fragments') || e.loopGroups.has('VP-330 string loops')
    ? 'Try a tape fragment or a VP-330 string loop: slices of those make instant textures.'
    : 'Try a very different sound, like a pad or a noise: slices of those make instant textures.'),
  stringBed: (e) => (e.loopGroups.has('VP-330 string loops')
    ? 'In GarageBand, drag a file from ~/Music/Samples/Vintage Synths/VP330 From Mars/SVC350 Loops/01. WAV onto an empty track for an instant string bed.'
    : 'In GarageBand, press O for the Loop Browser, search "strings", and drag a loop onto an empty track for an instant string bed.'),
  gbChop: (e) => (e.folder
    ? `In GarageBand: drag the same WAV from ${e.folder} onto a track, click where you want to cut, and press Cmd+T to split it there. Drag the pieces into a new order.`
    : 'In GarageBand: drag a loop from the Loop Browser (press O) onto a track, click where you want to cut, and press Cmd+T to split it there. Drag the pieces into a new order.'),
  samplesFolder: (e) => e.folder || 'your samples folder',
  tapeStep: (e) => (e.loopGroups.has('Tape fragments')
    ? 'Switch the sound to Sampler, pick a tape fragment, and turn on Half speed and Reverse. Play one slice every few seconds and let it hang.'
    : e.loopGroups.size
      ? 'Switch the sound to Sampler. Pick a loop, or press ● Record a sound and hum or rumble for a few seconds. Turn on Half speed and Reverse, then play one slice every few seconds and let it hang.'
      : 'Switch the sound to Sampler and press ● Record a sound: hum low or rumble for 3 to 5 seconds, then press it again. Turn on Half speed and Reverse, then play one slice every few seconds and let it hang.'),
  // Basics speak technique first; a copy that began with the Durutti examples keeps them.
  hearWhy: (e) => (e.durutti
    ? 'The Durutti Column sound is mostly three effects on a clean, plucked tone: chorus (shimmer), echo (repeats), and reverb (space). Hearing each one on its own is how you learn to reach for it later.'
    : 'A lot of guitar music leans on three effects over a clean, plucked tone: chorus (shimmer), echo (repeats), and reverb (space). Hearing each one on its own is how you learn to reach for it later.'),
  pickWhy: (e) => (e.durutti
    ? 'Vini Reilly rarely strums. He picks one string at a time, fast, and the echo fills the gaps.'
    : 'Many guitarists rarely strum. They pick one string at a time, fast, and an echo fills the gaps.'),
  pickTip: (e) => (e.durutti
    ? 'Try the other pattern choices. "picking" is the closest to Durutti.'
    : 'Try the other pattern choices. "picking" sounds most like a guitarist picking.'),
  drumWhy: (e) => (e.durutti
    ? 'Early Durutti Column records often sit on a plain, slightly stiff drum machine. The contrast between the machine and the drifting guitar is part of the charm.'
    : 'Plenty of records sit on a plain, slightly stiff drum machine. The contrast between the machine and a drifting guitar is part of the charm.'),
  bitterWhy: (e) => (e.durutti ? 'Much of the Durutti feel lives here.' : 'Much of that dreamy, bittersweet feel lives here.'),
  gbWhy: (e) => (e.durutti ? 'the Durutti sound' : 'the sound'),
  susLove: (e) => (e.durutti ? 'shoegaze and Durutti' : 'shoegaze and ambient music'),
  // With a microphone added and loops to pick from, recording your own is an extra;
  // with no loops, samplerStart already opens with it.
  micStep: (e) => (e.tags.microphone && e.loopGroups.size
    ? `Record your own: press ● Record a sound${e.tags.microphone ? ` with ${yours(e.tags.microphone, e)}` : ''} and make a noise for a few seconds: your voice, a cup, keys, a door. It is cut into 8 slices the same way. Can and Cluster sampled the room around them.`
    : ''),
};

export function resolveGear(text, env) {
  const e = gearEnv(env);
  return text.replace(/\{(\w+)\}/g, (m, key) => {
    if (GEAR[key]) return gearName(key, e);
    if (PHRASES[key]) return PHRASES[key](e);
    return m;
  });
}

// A lesson's checks, fitted to this Mac: a drum kit that isn't there can't be required.
export function fitChecks(lesson, env) {
  const e = gearEnv(env);
  if (!lesson.checks.some((c) => c.kit && !e.kits.has(c.kit))) return lesson;
  return { ...lesson, checks: lesson.checks.map((c) => (c.kit && !e.kits.has(c.kit) ? { ...c, kit: undefined } : c)) };
}

const CHART_4 = ['Em', 'Em', 'C', 'C', 'G', 'G', 'D', 'D'];
const CHART_COLOR = ['Em7', 'Em7', 'Cmaj7', 'Cmaj7', 'G', 'G', 'D', 'D'];

const ALL_LESSONS = [
  {
    id: 'hear-the-sound',
    title: 'Hear the sound',
    minutes: 5,
    why: '{hearWhy}',
    steps: [
      'Play any keys. Slow, single notes sound best.',
      'Switch Echo off, play a note, then switch it back on. Hear the repeats disappear and return.',
      'Do the same with Chorus, then Reverb.',
    ],
    setup: { sound: 'guitar', arp: false, drums: false, bpm: 100 },
    checks: [
      { type: 'notes', count: 8, label: 'Play 8 notes' },
      { type: 'fxToggle', which: 'echo', label: 'Echo off, then on' },
      { type: 'fxToggle', which: 'chorus', label: 'Chorus off, then on' },
      { type: 'fxToggle', which: 'reverb', label: 'Reverb off, then on' },
    ],
  },
  {
    id: 'first-chord',
    title: 'Your first chord: E minor',
    minutes: 5,
    why: 'A chord is three or more notes played together. E minor is three white keys, one gap apart each: E, G, B. It sounds wistful, and it is home base for everything that follows.',
    steps: [
      'Find the highlighted keys: E, G and B. All white.',
      'Press all three together and hold. The big display should say "Em".',
      'Try the same three notes in another octave. Still Em.',
    ],
    setup: { sound: 'guitar', arp: false, drums: false },
    targets: ['Em'],
    checks: [{ type: 'chord', chord: 'Em', label: 'Hold E minor' }],
  },
  {
    id: 'four-chords',
    title: 'Four chords that carry a song',
    minutes: 10,
    why: 'Em, C, G and D share most of their notes, so moving between them feels smooth. Thousands of songs use only these four. Each is three white keys, except D, which has one black key (F#).',
    steps: [
      'Em = E G B.',
      'C = C E G. Slide your hand down one white key from Em and it is nearly there.',
      'G = G B D.',
      'D = D F# A. The middle note is the black key just right of F.',
      'Play each one until the display names it.',
    ],
    setup: { sound: 'guitar', arp: false, drums: false },
    targets: ['Em', 'C', 'G', 'D'],
    checks: [
      { type: 'chord', chord: 'Em', label: 'Em' },
      { type: 'chord', chord: 'C', label: 'C' },
      { type: 'chord', chord: 'G', label: 'G' },
      { type: 'chord', chord: 'D', label: 'D' },
    ],
  },
  {
    id: 'arpeggiator',
    title: 'Let the machine do the picking',
    minutes: 5,
    why: '{pickWhy} The arpeggiator does that picking for you: hold a chord, and it plays the notes one after another in time.',
    steps: [
      'Arp is on, with Latch: tap a chord once and it keeps playing.',
      'Tap E minor and listen for two bars (count 1-2-3-4, twice).',
      '{pickTip}',
    ],
    setup: { sound: 'guitar', arp: true, latch: true, arpPattern: 'picking', drums: false, bpm: 100 },
    targets: ['Em'],
    checks: [{ type: 'arpBars', chord: 'Em', bars: 2, label: 'Let Em pick for 2 bars' }],
  },
  {
    id: 'follow-the-chart',
    title: 'Change chords with the count',
    minutes: 10,
    why: 'Songs change chord on the beat, usually at the start of a bar. The chart shows two bars of each chord. The next chord flashes on the last beat, so you know when to move.',
    steps: [
      'The click counts 1-2-3-4. The chart shows which chord is up now.',
      'Tap the new chord when the chart moves. With Latch on you only need to tap, not hold.',
      'Late is fine. The echo hides a lot.',
    ],
    setup: { sound: 'guitar', arp: true, latch: true, arpPattern: 'picking', drums: false, click: true, bpm: 90 },
    chart: CHART_4,
    checks: [
      { type: 'arpBars', chord: 'Em', bars: 1, label: 'A bar of Em' },
      { type: 'arpBars', chord: 'C', bars: 1, label: 'A bar of C' },
      { type: 'arpBars', chord: 'G', bars: 1, label: 'A bar of G' },
      { type: 'arpBars', chord: 'D', bars: 1, label: 'A bar of D' },
    ],
  },
  {
    id: 'drum-machine',
    title: 'Add a drum machine',
    minutes: 10,
    why: '{drumWhy}',
    steps: [
      'Switch Drums on. Try the three patterns and keep the one you like.',
      'Play the chart again over the drums for 4 bars.',
    ],
    setup: { sound: 'guitar', arp: true, latch: true, arpPattern: 'picking', drums: false, click: false, bpm: 100 },
    chart: CHART_4,
    checks: [{ type: 'drumBars', bars: 4, label: '4 bars of picking over drums' }],
  },
  {
    id: 'bittersweet',
    title: 'The bittersweet colour: 7th chords',
    minutes: 10,
    why: 'Add one more note to a chord and the mood shifts. Em7 (E G B D) and Cmaj7 (C E G B) sound open and unresolved, happy and sad at once. {bitterWhy}',
    steps: [
      'Em7 = E G B D. Your Em plus one more white key on top.',
      'Cmaj7 = C E G B. Your C plus B on top.',
      'Play the chart with the new colours and compare it with the chord chart lesson.',
    ],
    setup: { sound: 'guitar', arp: true, latch: true, arpPattern: 'picking', drums: true, bpm: 100 },
    targets: ['Em7', 'Cmaj7'],
    chart: CHART_COLOR,
    checks: [
      { type: 'chord', chord: 'Em7', label: 'Em7' },
      { type: 'chord', chord: 'Cmaj7', label: 'Cmaj7' },
      { type: 'arpBars', chord: 'Cmaj7', bars: 2, label: '2 bars of Cmaj7 picking' },
    ],
  },
  {
    id: 'melody',
    title: 'A melody on top',
    minutes: 10,
    why: 'E minor pentatonic is five notes, E G A B D, all white keys, and none of them clash with our chords. You cannot play a wrong note here, so you can just explore.',
    steps: [
      'The Arp is off. Use every white key except C and F.',
      'Play slowly. Leave gaps and let the echo answer you.',
      'Repeat a little three- or four-note idea you like. Repetition is what makes it a melody.',
    ],
    setup: { sound: 'guitar', arp: false, drums: true, drumPattern: 'sparse', bpm: 100 },
    scale: 'E minor pentatonic',
    checks: [{ type: 'scaleNotes', scale: 'E minor pentatonic', count: 24, label: 'Play 24 notes from the scale' }],
  },
  {
    id: 'record-sketch',
    title: 'Record an 8-bar sketch',
    minutes: 10,
    why: 'A sketch you keep is worth more than a perfect take you never saved. Recording starts at the next bar and captures your chords, the picking and the drums.',
    steps: [
      'Pick a chart speed you like. 90–100 is relaxed.',
      'Press Record. It starts on the next "1".',
      'Play the chart through once (8 bars), then press Stop.',
      'Name the sketch and save it.',
    ],
    setup: { sound: 'guitar', arp: true, latch: true, arpPattern: 'picking', drums: true, bpm: 95 },
    chart: CHART_COLOR,
    checks: [
      { type: 'recorded', bars: 8, label: 'Record at least 8 bars' },
      { type: 'saved', label: 'Save the sketch' },
    ],
  },
  {
    id: 'to-garageband',
    title: 'Take it to GarageBand',
    minutes: 15,
    why: 'The sketch is MIDI: the notes, not the sound. GarageBand plays those notes with its own instruments, then your plugins add {gbWhy} back.',
    steps: [
      'Press "Show in Finder" beside your sketch in the Sketches list.',
      'In GarageBand: File → New → Empty Project → Software Instrument. Set the tempo to match the sketch.',
      'Drag the .mid file onto the empty area under the tracks. It becomes two tracks: Guitar and Drums.',
      'On the Guitar track pick a clean electric guitar or Electric Piano sound from the Library.',
      'Plug-ins → {fxRoute}: add {chorus}, then {echo}, then {reverb}.',
      'Press C to loop, then play.',
      '{guitarBonus}',
    ],
    setup: { sound: 'guitar', arp: false, drums: false },
    checks: [
      { type: 'manual', label: 'Sketch dragged into GarageBand' },
      { type: 'manual', label: '{chorus}, {echo} and {reverb} added' },
      { type: 'manual', label: 'It loops and sounds like yours' },
    ],
  },
  {
    id: 'kosmische',
    title: 'Kosmische sequences',
    minutes: 15,
    why: 'Tangerine Dream, Klaus Schulze and Cluster built long pieces from three things: a short synth pattern repeating forever, a drone underneath, and slow change. The change is mostly the filter, which makes the sound darker or brighter. You play almost nothing; you decide when things change.',
    steps: [
      'The sound is {moogReal}. Tap A minor (A C E): a repeating pattern starts. That is a sequence.',
      'Switch Drone on. {vp330Cap} hold a low A underneath.',
      'Drag Filter to the left, then over about 8 bars slide it slowly all the way right. That slow opening is most of the drama in this music.',
      'Tap F (F A C) when the chart says, then back to Am. Two chords can carry ten minutes.',
      'Optional: Drums on with the "motorik" pattern, the steady krautrock beat.',
      '{stringBed}',
    ],
    setup: { sound: 'moog-bass', arp: true, latch: true, arpPattern: 'sequence', drums: false, drone: false, brightness: 0.55, bpm: 112 },
    chart: ['Am', 'Am', 'Am', 'Am', 'F', 'F', 'F', 'F'],
    checks: [
      { type: 'arpBars', chord: 'Am', bars: 4, label: '4 bars of the Am sequence' },
      { type: 'droneBars', bars: 4, label: '4 bars with the drone on' },
      { type: 'filterSweep', label: 'Filter: close it, then open it slowly' },
      { type: 'arpBars', chord: 'F', bars: 2, label: '2 bars of the F sequence' },
    ],
  },
  {
    id: 'stereolab',
    title: 'Stereolab: organ, motorik, two chords',
    minutes: 15,
    why: 'Stereolab songs often ride one or two jazzy chords for minutes: a buzzing Farfisa organ pumping steady chords, a motorik or bossa-nova beat, and 7th chords (see the bittersweet colour lesson) for the lounge feel. Repetition is the point; the small changes on top are the song.',
    steps: [
      'The sound is {farfisa}, playing your chord on every eighth note. Tap Cmaj7 (C E G B).',
      'Follow the chart: Fmaj7 is F A C E. All white keys.',
      'Switch the pattern to "offbeat": the organ now hits between the beats, a classic Stereolab push.',
      'Switch the drums to "bossa" for the lounge side of Stereolab.',
      'Record 8 bars (see Record an 8-bar sketch). In GarageBand, put the sketch on an organ sound and add {chorus}.',
    ],
    setup: { sound: 'farfisa', arp: true, latch: true, arpPattern: 'eighths', drums: true, drumPattern: 'motorik', drone: false, brightness: 1, bpm: 126 },
    chart: ['Cmaj7', 'Cmaj7', 'Fmaj7', 'Fmaj7', 'Cmaj7', 'Cmaj7', 'Fmaj7', 'Fmaj7'],
    checks: [
      { type: 'arpBars', chord: 'Cmaj7', bars: 2, label: '2 bars of Cmaj7 organ' },
      { type: 'arpBars', chord: 'Fmaj7', bars: 2, label: '2 bars of Fmaj7 organ' },
      { type: 'arpBars', pattern: 'offbeat', bars: 2, label: '2 bars of the offbeat pattern' },
      { type: 'drumBars', drumPattern: 'bossa', bars: 2, label: '2 bars over the bossa beat' },
    ],
  },
  {
    id: 'build-a-beat',
    title: 'Build your own beat',
    minutes: 15,
    why: 'Most beats are three sounds on a grid of 16 boxes, one bar long: a kick (low thump), a snare (crack) and a hi-hat (tick). Boxes 1, 5, 9 and 13 are the four beats you count: 1, 2, 3, 4. Moving a single box changes the whole feel.',
    steps: [
      'The pattern is set to "my beat", with {cr78}. Press Drums to start it (it is silent until you fill in boxes).',
      'Kick: click boxes 1 and 9 (beats 1 and 3).',
      'Snare: click boxes 5 and 13 (beats 2 and 4). That is the backbone of nearly all pop and rock.',
      'Closed hat: click every odd box: 1, 3, 5 … 15. Now it is a beat.',
      'Change one thing: add a kick on box 11, or move a snare from 13 to 14. Listen to how much the feel shifts.',
      '{kitSwap}',
      'To keep it, record 8 bars (see Record an 8-bar sketch). The Drums track of your sketch plays on any GarageBand drum kit.',
    ],
    setup: { sound: 'guitar', arp: false, drums: false, drumPattern: 'my beat', kit: 'cr78', bpm: 100 },
    checks: [
      { type: 'gridHas', row: 'kick', steps: [0, 8], label: 'Kick on boxes 1 and 9' },
      { type: 'gridHas', row: 'snare', steps: [4, 12], label: 'Snare on boxes 5 and 13' },
      { type: 'gridCount', row: 'hat', count: 8, label: 'Closed hat on 8 boxes' },
      { type: 'beatBars', drumPattern: 'my beat', bars: 4, label: '4 bars of your beat' },
      { type: 'beatBars', drumPattern: 'my beat', kit: 'minipops', bars: 2, label: '{kitCheck}' },
    ],
  },
  {
    id: 'sampling',
    title: 'Sampling: cut up a loop',
    minutes: 15,
    why: 'Sampling means turning a recording into an instrument. The app cuts a loop into 8 equal slices and puts one on each white key from middle C up. Play the slices in a new order and you make something new from something old. Can, Cluster and every hip-hop producer worked this way.',
    steps: [
      '{samplerStart}',
      'Play the highlighted white keys C to C (computer keys A to K) in order: you hear the loop as recorded.',
      'Now play them out of order, for example C C E D, then G G A F. That is a chop.',
      'Switch Reverse on for the backwards swell that shoegaze and kosmische records love.',
      '{textureTip}',
      '{micStep}',
      '{gbChop}',
    ],
    setup: { sound: 'chop', arp: false, drums: false, bpm: 95 },
    highlight: [60, 62, 64, 65, 67, 69, 71, 72],
    checks: [
      { type: 'loopLoaded', label: '{loopCheck}' },
      { type: 'distinctSlices', count: 6, label: 'Play 6 different slices' },
      { type: 'sliceNotes', count: 24, label: 'Play 24 slices in any order' },
      { type: 'reverseSlice', label: 'Turn Reverse on and play a slice' },
    ],
  },
  {
    id: 'new-wave',
    title: 'New wave: A Flock of Seagulls',
    minutes: 15,
    why: 'Early-80s new wave like A Flock of Seagulls stacks three simple parts: a synth bass pumping eighth notes that jump between two octaves, a guitar arpeggio drowned in echo and chorus, and a fast drum machine. Each part is simple; together they sound huge.',
    steps: [
      'Guitar picking with Arp and Latch on, at 140 BPM. Tap A minor (A C E).',
      'Switch Bass on: {minimoog} pumps the chord\'s lowest note in octaves underneath. That jumping bass is the new-wave engine.',
      'Follow the chart: Am, F, C, G. All white keys. The bass follows your chords by itself.',
      'The drums join on your first note, set to "new wave". The open hi-hat at the end of each bar gives the lift.',
      'Try the "up" pattern for a brighter, more urgent guitar.',
      'Record 8 bars (see Record an 8-bar sketch). In GarageBand, the Bass track of your sketch plays on any synth bass.',
    ],
    setup: { sound: 'guitar', arp: true, latch: true, arpPattern: 'picking', bass: false, drums: true, drumPattern: 'new wave', bpm: 140 },
    chart: ['Am', 'Am', 'F', 'F', 'C', 'C', 'G', 'G'],
    checks: [
      { type: 'bassBars', bars: 4, label: '4 bars with the bass pumping' },
      { type: 'arpBars', chord: 'F', bars: 1, label: 'A bar of F' },
      { type: 'arpBars', chord: 'G', bars: 1, label: 'A bar of G' },
      { type: 'drumBars', drumPattern: 'new wave', bars: 4, label: '4 bars over the new-wave beat' },
    ],
  },
  {
    id: 'ambient-eno',
    title: 'Ambient: Eno\'s tape loops',
    minutes: 15,
    why: 'Brian Eno made Music for Airports from tape loops of different lengths, each carrying a note or two. Because the loops never line up the same way twice, the music keeps changing by itself. The "eno" pattern does the same: every note you tap repeats on its own slow cycle, so the notes drift in and out of step.',
    steps: [
      '{vp330Cap} at 60 BPM, pattern "eno". Tap F, A, C and E one at a time. Each tap adds a loop; tap a note again to remove it.',
      'Now listen for a full minute. Nothing repeats exactly.',
      'Add a fifth note, a D or a G, and hear a new loop join the drift.',
      'Switch the sound to E-Piano for a Music for Airports feel, and pull the Filter down a little to soften it.',
      'Ambient pieces want length: record 16 bars (about a minute at this tempo) and save it.',
    ],
    setup: { sound: 'vp330-strings', arp: true, latch: true, arpPattern: 'eno', drums: false, drone: false, brightness: 0.75, bpm: 60 },
    highlight: [65, 69, 72, 76],
    checks: [
      { type: 'arpBars', pattern: 'eno', bars: 8, label: '8 bars of drifting loops' },
      { type: 'arpBars', pattern: 'eno', minNotes: 5, bars: 2, label: '2 bars with 5 loops at once' },
      { type: 'arpBars', pattern: 'eno', sound: 'epiano', bars: 2, label: '2 bars on the E-Piano' },
    ],
  },
  {
    id: 'dark-ambient',
    title: 'Dark ambient: drones and slowed tape',
    minutes: 15,
    why: 'Dark ambient (Lustmord, Thomas Köner, the darker side of Coil) is built from very low drones, notes that rub against each other, and recordings slowed down until they sound like distant machinery. Almost nothing happens quickly; the tension comes from sounds that never resolve.',
    steps: [
      '{vp330Cap}, pattern "eno", 50 BPM, filter mostly closed. Tap E and then F: two white keys side by side. A half step apart, they rub and beat against each other. That rub is the dark sound.',
      'Switch Drone on: a low string note settles underneath.',
      'Tap the black key between A and B (B flat). E to B flat is the tritone, the most unsettled interval in music.',
      'Breathe with the Filter: open it a little over 8 bars, then close it again.',
      '{tapeStep}',
      'Record a minute (see Record an 8-bar sketch) and score the take.',
    ],
    setup: { sound: 'vp330-strings', arp: true, latch: true, arpPattern: 'eno', drums: false, drone: false, brightness: 0.3, bpm: 50 },
    highlight: [64, 65, 70],
    checks: [
      { type: 'arpBars', pattern: 'eno', interval: 1, bars: 2, label: '2 bars with a half-step rub' },
      { type: 'arpBars', pattern: 'eno', interval: 6, bars: 2, label: '2 bars with a tritone' },
      { type: 'droneBars', bars: 4, label: '4 bars over the drone' },
      { type: 'filterSweep', label: 'Filter: close it, then open it slowly' },
      { type: 'sliceNotes', halfSpeed: true, count: 4, label: 'Play 4 half-speed slices' },
    ],
  },
  {
    id: 'post-punk',
    title: 'Post-punk and darkwave',
    minutes: 15,
    why: 'Joy Division, The Cure and Siouxsie and the Banshees flipped the usual roles: the bass plays the melody high up, the guitar adds thin chorused notes around it, and the drums pound on toms. Darkwave, like Clan of Xymox, swaps the drummer for a drum machine and adds cold synths. Minor chords throughout.',
    steps: [
      'Guitar with the "up" pattern, Arp and Latch on, 130 BPM. Tap E minor (E G B).',
      'Switch Bass on with the style "melodic": the bass now plays a tune from your chord, high and forward, the post-punk way.',
      'Follow the chart: Em, Em, C, D. The drums join on your first note with the "tribal" pattern: pounding toms.',
      'For darkwave, switch the sound to {VP330} and the drums to "motorik": colder and more mechanical.',
      'Record 8 bars (see Record an 8-bar sketch) and score the take.',
    ],
    setup: { sound: 'guitar', arp: true, latch: true, arpPattern: 'up', bass: false, bassStyle: 'melodic', drums: true, drumPattern: 'tribal', bpm: 130 },
    chart: ['Em', 'Em', 'C', 'D', 'Em', 'Em', 'C', 'D'],
    checks: [
      { type: 'bassBars', bassStyle: 'melodic', bars: 4, label: '4 bars of melodic bass' },
      { type: 'drumBars', drumPattern: 'tribal', bars: 4, label: '4 bars over the tribal toms' },
      { type: 'arpBars', chord: 'D', bars: 1, label: 'A bar of D' },
      { type: 'arpBars', sound: 'vp330-strings', bars: 2, label: 'Darkwave: 2 bars on {vp330}' },
    ],
  },
  {
    id: 'shoegaze',
    title: 'Shoegaze: reverse reverb and the wall of sound',
    minutes: 15,
    why: 'My Bloody Valentine, Slowdive and Ride blurred guitars into a wall of sound. The key trick is reverse reverb: instead of fading away, each note\'s echo swells up toward you and cuts off. Kevin Shields got it from the "reverse" setting on a rack reverb. Stack it with fuzz and chorus at a slow tempo, and single notes turn into clouds.',
    steps: [
      'Guitar with the "up-down" pattern, Arp and Latch on, 84 BPM. Tap G major (G B D).',
      'Switch Reverse reverb on (in Effects): every note now swells up into itself. Switch it off and on to hear the difference.',
      'Switch Fuzz on: grit under the swell. The wall of sound is fuzz, chorus and reverse reverb at once.',
      'Follow the chart: G, Em, C, D. Nothing needs to be exact; the blur is the point.',
      'Try {VP330} with Reverse reverb on for a Slowdive-style pad.',
      'In GarageBand: add {reverse} after {chorus} on your guitar track, then {fuzz}.',
    ],
    setup: { sound: 'guitar', arp: true, latch: true, arpPattern: 'up-down', drums: false, bpm: 84, fx: { reverse: false, fuzz: false } },
    chart: ['G', 'G', 'Em', 'Em', 'C', 'C', 'D', 'D'],
    checks: [
      { type: 'arpBars', fx: ['reverse'], bars: 4, label: '4 bars with reverse reverb' },
      { type: 'arpBars', fx: ['reverse', 'fuzz', 'chorus'], bars: 2, label: '2 bars of the full wall: fuzz, chorus, reverse reverb' },
      { type: 'arpBars', chord: 'C', fx: ['reverse'], bars: 1, label: 'A bar of C in the swell' },
      { type: 'arpBars', sound: 'vp330-strings', fx: ['reverse'], bars: 2, label: '2 bars of reversed {vp330}' },
    ],
  },
  {
    id: 'gb-iphone',
    title: 'Optional: GarageBand on iPhone and iPad',
    minutes: 15,
    why: 'Apple makes a free GarageBand for iPhone and iPad. The practice room stays on your Mac, but your sketches are MIDI files, so you can carry one to your phone and keep working on it anywhere. This lesson is optional: nothing else waits for it.',
    differences: [
      'Touch instruments: you play a keyboard, drums or guitar on the screen. Chord Strips play a whole chord with one tap.',
      'Live Loops: a grid of loops you start and stop live. It is only on iPhone and iPad; GarageBand on the Mac does not have it.',
      'Your Mac plugins stay on the Mac. iPhone and iPad use their own plugin apps from the App Store.',
      'Editing and mixing are simpler. The Mac has more room and more detail: the Piano Roll, Smart Controls and plug-in slots.',
      'Imported MIDI does not follow tempo changes you make later, so set the tempo before you import.',
    ],
    guided: true,
    steps: [
      { label: 'Sketch is on the phone', text: 'Get a sketch onto your iPhone or iPad: in Sketches, press Show in Finder, then share the .mid file with AirDrop, or save it to iCloud Drive. Either way it ends up in the Files app. No sketch yet? Record an 8-bar sketch makes one.' },
      { label: 'Imported into GarageBand', text: 'In GarageBand for iPhone, start a new song with the Keyboard. Tap the Tracks button, then the Loop Browser button, choose the Files tab, tap Browse items from the Files app, and tap your sketch. Drag it to line its left edge up with bar 1. Each part becomes its own Keyboard track. (Apple\'s tip: set the song section to Automatic first, so the whole sketch comes in.)' },
      { label: 'Tracks have sounds', text: 'Select one of the new tracks, tap the Navigation button, then Sounds, and pick a sound. Try an electric piano for chords and a bass for the low part.' },
      { label: 'Played along with chord strips', text: 'Open the Keyboard and tap the Chord Strips button: each strip plays a whole chord with one tap. Play along with your sketch.' },
      { label: 'Song shared', text: 'In My Songs, touch and hold your song and tap Share. Song makes an audio file for Files, Messages or AirDrop; Project saves a GarageBand project that GarageBand on your Mac can open, so you can finish it there.' },
    ],
    setup: { sound: 'epiano', arp: false, drums: false },
    checks: [],
  },
  {
    id: 'lofi-hip-hop',
    title: 'Lo-fi hip-hop: lazy drums and warm chords',
    minutes: 15,
    why: 'J Dilla and Nujabes made beats that feel relaxed and a little off the grid: the drums drag behind the beat, the chords are soft 7ths on a worn electric piano, and everything sounds like old tape. That laid-back push is called swing, and it is the whole feel.',
    steps: [
      'E-Piano, pattern "ripple", Arp and Latch on, drums on "simple", 80 BPM. Swing is already up and Wobble is on. Tap Fmaj7 (F A C E).',
      'Listen to the drums: the in-between hits land late. Turn Swing down to 0 and back up to hear the difference.',
      'Follow the chart: Fmaj7, Em7 (E G B D), Dm7 (D F A C), Cmaj7 (C E G B). Each chord is one white key lower.',
      'Optional: switch the sound to Sampler, press ● Record a sound and hum or tap for a few seconds, then play the slices over the beat. Lo-fi loves a found sound.',
      'In GarageBand: put the chords on an electric piano, add a vintage drum kit, and turn the kit\'s Swing up in the Drummer or Piano Roll settings.',
    ],
    setup: { sound: 'epiano', arp: true, latch: true, arpPattern: 'ripple', drums: true, drumPattern: 'simple', swing: 0.6, bpm: 80, brightness: 0.55, fx: { wobble: true, chorus: false, echo: false, reverb: true } },
    chart: ['Fmaj7', 'Fmaj7', 'Em7', 'Em7', 'Dm7', 'Dm7', 'Cmaj7', 'Cmaj7'],
    checks: [
      { type: 'arpBars', chord: 'Fmaj7', swing: 0.4, bars: 2, label: '2 bars of Fmaj7 with swing' },
      { type: 'drumBars', swing: 0.4, bars: 4, label: '4 bars of lazy, swung drums' },
      { type: 'arpBars', chord: 'Em7', bars: 2, label: '2 bars of Em7' },
      { type: 'arpBars', chord: 'Dm7', bars: 2, label: '2 bars of Dm7' },
    ],
  },
  {
    id: 'dub',
    title: 'Dub: throw the echo, drop the bass',
    minutes: 15,
    why: 'King Tubby and Lee "Scratch" Perry took reggae tracks and remixed them live at the mixing desk: an organ skank on the off-beat, a one-drop beat with the kick on beat 3, and then the magic, throwing single hits into a huge echo and dropping whole parts out so they crash back in. The mixer is the instrument.',
    mixer: true,
    steps: [
      'The sound is {Organ}, pattern "skank", Arp and Latch on, drums on "one drop", Bass on, 74 BPM. Tap A minor (A C E): the organ chops on beats 2 and 4.',
      'Hear the one drop: nothing on beat 1, kick and rim together on beat 3. It feels like the beat is leaning back.',
      'Hold the Throw button (in Effects) for a moment, then let go: one hit flies off into the echo. Do it three times, sparingly.',
      'In the mixer below, press M on Bass for a bar, then press it again: the bass drops out and crashes back in. That is dub.',
      'Follow the chart: Am, then Dm (D F A). In GarageBand: add {echo} as a send and automate it up on single hits.',
    ],
    setup: { sound: 'farfisa', arp: true, latch: true, arpPattern: 'skank', drums: true, drumPattern: 'one drop', bass: true, bassStyle: 'melodic', bpm: 74, fx: { chorus: false, echo: true, reverb: true } },
    chart: ['Am', 'Am', 'Am', 'Am', 'Dm', 'Dm', 'Dm', 'Dm'],
    checks: [
      { type: 'arpBars', chord: 'Am', pattern: 'skank', bars: 2, label: '2 bars of the A minor skank' },
      { type: 'drumBars', drumPattern: 'one drop', bars: 4, label: '4 bars of the one drop' },
      { type: 'throws', count: 3, label: 'Throw the echo 3 times' },
      { type: 'dropOut', part: 'bass', count: 1, label: 'Drop the bass out and bring it back' },
    ],
  },
  {
    id: 'ambient-drone',
    title: 'Ambient drone: chords that swell and hang',
    minutes: 15,
    why: 'Stars of the Lid and William Basinski make music from long, swelling chords with no beat at all. Nothing is played quickly: a chord fades in over several seconds, hangs in the air, and fades away. It is the gentlest lesson here: there is no chart to follow and no timing to hit.',
    steps: [
      'The sound is Swell and "No beat" is on: no drums, no click, no arpeggio. Hold D major (D F# A) and keep holding for 8 seconds: it fades in slowly.',
      'Let go and listen: the chord hangs and fades for a long time.',
      'Now G major (G B D), held for 8 seconds. D and G share the note D, so the change is soft.',
      'Switch Reverse reverb on and hold B minor (B D F#) for 8 seconds: the swell now swells twice.',
      'In GarageBand: put the sketch on a pad or string sound with a slow attack, and add {reverb} with a long decay.',
    ],
    setup: { sound: 'swell', freeTime: true, arp: false, drums: false, bpm: 60, brightness: 0.7, fx: { chorus: true, echo: true, reverb: true, reverse: false } },
    checks: [
      { type: 'holdSeconds', chord: 'D', seconds: 8, label: 'Hold D major for 8 seconds' },
      { type: 'holdSeconds', chord: 'G', seconds: 8, label: 'Hold G major for 8 seconds' },
      { type: 'holdSeconds', chord: 'Bm', seconds: 8, label: 'Hold B minor for 8 seconds' },
    ],
  },
  {
    id: 'afrobeat',
    title: 'Afrobeat: one chord, many parts',
    minutes: 15,
    why: 'Fela Kuti and his drummer Tony Allen built Afrobeat from interlocking parts over one or two chords: a busy, rolling drum pattern, a picked guitar riff, a bass line, and short horn stabs, each simple on its own and hypnotic together. You build it the same way, one layer at a time, with the looper.',
    steps: [
      'Drums on "afrobeat", 112 BPM, Guitar, pattern "up", Arp and Latch on. Tap Dm7 (D F A C): a picked riff over Tony Allen\'s groove.',
      'Press ↻ Record loop: 2 bars of that riff become your first layer.',
      'Switch the sound to {Organ} and the pattern to "stab", and record a second layer: short horn-like stabs.',
      'Switch Bass on (style "melodic") for the bass line under it all. One chord can carry ten minutes.',
      'In GarageBand: put each part on its own track (guitar, organ or horns, bass) and keep them all on Dm7.',
    ],
    setup: { sound: 'guitar', arp: true, latch: true, arpPattern: 'up', drums: true, drumPattern: 'afrobeat', bass: false, bassStyle: 'melodic', bpm: 112, fx: { chorus: false, echo: false } },
    chart: ['Dm7', 'Dm7', 'Dm7', 'Dm7', 'Dm7', 'Dm7', 'Dm7', 'Dm7'],
    checks: [
      { type: 'drumBars', drumPattern: 'afrobeat', bars: 4, label: '4 bars over the Afrobeat groove' },
      { type: 'arpBars', chord: 'Dm7', bars: 2, label: '2 bars of the Dm7 riff' },
      { type: 'loopLayers', count: 2, label: 'Loop 2 layers' },
      { type: 'arpBars', pattern: 'stab', bars: 2, label: '2 bars of stabs' },
    ],
  },
  {
    id: 'gothic-rock',
    title: 'Gothic rock: echo, shadows and the half-step',
    minutes: 15,
    why: 'Bauhaus, Siouxsie and the Banshees and Christian Death took post-punk somewhere darker and more dramatic: slower tempos, guitar drowned in chorus and echo, a bass that carries the tune, and chords that move just one half step. That small step, A minor up to B flat, is the shadow at the heart of the sound.',
    steps: [
      'Guitar, pattern "up-down", Arp and Latch on, drums on "goth", 100 BPM. Keep Chorus, Echo and Reverb on. Tap A minor (A C E).',
      'Switch Bass on with the style "melodic": the bass plays the tune, high and forward.',
      'Now B flat: B♭ D F, the black key left of B plus two white keys. From A minor it is one half step up, and the whole room darkens.',
      'Follow the chart: Am, B♭, Am, then E (E G# B) to pull back toward home.',
      'In GarageBand: put the sketch on a clean electric guitar, add {chorus} then {echo}, and let the bass sit loud.',
    ],
    setup: { sound: 'guitar', arp: true, latch: true, arpPattern: 'up-down', bass: false, bassStyle: 'melodic', drums: true, drumPattern: 'goth', bpm: 100, fx: { chorus: true, echo: true, reverb: true } },
    chart: ['Am', 'Am', 'Bb', 'Bb', 'Am', 'Am', 'E', 'E'],
    checks: [
      { type: 'arpBars', chord: 'Am', fx: ['chorus', 'echo'], bars: 2, label: '2 bars of A minor through chorus and echo' },
      { type: 'bassBars', bassStyle: 'melodic', bars: 4, label: '4 bars of melodic bass' },
      { type: 'arpBars', chord: 'Bb', bars: 2, label: '2 bars of B♭: the half-step shadow' },
      { type: 'drumBars', drumPattern: 'goth', bars: 4, label: '4 bars over the goth beat' },
    ],
  },
  {
    id: 'punk',
    title: 'Punk: power chords and fast eighths',
    minutes: 15,
    why: 'The Ramones, the Buzzcocks and the Sex Pistols played fast, loud and simple, and made it sound huge. The trick is the power chord: just two notes, a root and the note five white keys up. It is neither major nor minor, so it takes fuzz without turning to mush. One shape, moved around, is most of punk.',
    steps: [
      'Guitar, pattern "eighths", Arp and Latch on, drums on "punk", 170 BPM. Switch Fuzz on.',
      'Play a power chord: E and B together (E5). Two keys, with three white keys in between.',
      'Keep the same shape and move it: G and D (G5), then A and E (A5). Same fingers, new chord.',
      'Follow the chart: E5, G5, A5. Hit each change on the count of 1.',
      'In GarageBand: put the sketch on a distorted electric guitar from the Library, or add {amp} to a guitar track.',
    ],
    setup: { sound: 'guitar', arp: true, latch: true, arpPattern: 'eighths', drums: true, drumPattern: 'punk', bpm: 170, fx: { fuzz: true, chorus: false, echo: false } },
    chart: ['E5', 'E5', 'G5', 'G5', 'A5', 'A5', 'A5', 'A5'],
    checks: [
      { type: 'arpBars', chord: 'E5', fx: ['fuzz'], bars: 2, label: '2 bars of E5 with fuzz' },
      { type: 'drumBars', drumPattern: 'punk', bars: 4, label: '4 bars over the punk beat' },
      { type: 'arpBars', chord: 'G5', bars: 2, label: '2 bars of G5' },
      { type: 'arpBars', chord: 'A5', bars: 2, label: '2 bars of A5' },
    ],
  },
  {
    id: 'house',
    title: 'House: four on the floor',
    minutes: 15,
    why: 'House grew out of Chicago clubs in the 1980s, with DJs like Frankie Knuckles, and later Daft Punk took it everywhere. Its engine is the kick drum on every beat, "four on the floor", with short chord stabs between the beats and a filter that opens slowly to build excitement.',
    steps: [
      'Drums on "house", 122 BPM: a kick on every beat. The sound is {Organ}, pattern "offbeat", Arp and Latch on. Tap Am7 (A C E G).',
      'Hear how the chord stabs land between the kicks. That push and pull is the groove.',
      'Follow the chart: Am7, then Dm7 (D F A C). Two chords can carry a whole track.',
      'Pull the Filter down, then open it slowly over 8 bars. That build is how a house track lifts a room.',
      'In GarageBand: put the drums on a dance kit from the Library, and the chords on an organ or electric piano.',
    ],
    setup: { sound: 'farfisa', arp: true, latch: true, arpPattern: 'offbeat', drums: true, drumPattern: 'house', bpm: 122, brightness: 0.8, fx: { echo: false } },
    chart: ['Am7', 'Am7', 'Am7', 'Am7', 'Dm7', 'Dm7', 'Dm7', 'Dm7'],
    checks: [
      { type: 'drumBars', drumPattern: 'house', bars: 4, label: '4 bars of four on the floor' },
      { type: 'arpBars', chord: 'Am7', pattern: 'offbeat', bars: 2, label: '2 bars of Am7 stabs' },
      { type: 'arpBars', chord: 'Dm7', bars: 2, label: '2 bars of Dm7' },
      { type: 'filterSweep', label: 'Filter: close it, then open it slowly' },
    ],
  },
  {
    id: 'ambient-techno',
    title: 'Ambient techno: warm pads on a soft beat',
    minutes: 15,
    why: 'Aphex Twin\'s "Selected Ambient Works 85–92" and Boards of Canada put dreamy, warm chords over a steady, gentle dance beat. It is dance music you can sit with: the beat keeps moving while the chords drift, and nothing is in a hurry.',
    steps: [
      'Pad, pattern "ripple", Arp and Latch on, drums on "house", 112 BPM. Tap Cmaj7 (C E G B).',
      'Pull the Filter about halfway down: warm and soft, not bright.',
      'Follow the chart: Cmaj7, then Am7 (A C E G). The two share three notes, so the change is gentle.',
      'Play a few slow single notes up high with your other hand: a simple melody over the drift.',
      'In GarageBand: put the chords on a warm synth pad from the Library, and turn the drums down under them.',
    ],
    setup: { sound: 'pad', arp: true, latch: true, arpPattern: 'ripple', drums: true, drumPattern: 'house', bpm: 112, brightness: 0.55, fx: { chorus: true, echo: true, reverb: true } },
    chart: ['Cmaj7', 'Cmaj7', 'Cmaj7', 'Cmaj7', 'Am7', 'Am7', 'Am7', 'Am7'],
    checks: [
      { type: 'arpBars', chord: 'Cmaj7', sound: 'pad', bars: 2, label: '2 bars of Cmaj7 on the pad' },
      { type: 'drumBars', drumPattern: 'house', bars: 4, label: '4 bars over the steady beat' },
      { type: 'arpBars', chord: 'Am7', bars: 2, label: '2 bars of Am7' },
      { type: 'notes', count: 8, label: 'Play 8 melody notes on top' },
    ],
  },
  {
    id: 'folk',
    title: 'Folk: fingerpicking and open chords',
    minutes: 15,
    why: 'Nick Drake, Joni Mitchell and Vashti Bunyan made records with one guitar, picked close to the microphone, with almost nothing added. The magic is in the picking and in open chords: shapes with a string left ringing that is neither major nor minor.',
    steps: [
      'Guitar, "picking" pattern, Arp and Latch on. Tap D major (D F# A).',
      'Turn Chorus, Echo and Reverb off (in Effects). The guitar goes dry and close, like someone playing in the room with you.',
      'Now Dsus2: D E A. Move the middle finger down from F# to E. The chord floats, neither happy nor sad.',
      'Follow the chart: D, Dsus2, G, G. G is G B D.',
      'In GarageBand: put the sketch on an acoustic guitar from the Library (press Y) and leave the effects off.',
    ],
    setup: { sound: 'guitar', arp: true, latch: true, arpPattern: 'picking', drums: false, bpm: 92 },
    chart: ['D', 'D', 'Dsus2', 'Dsus2', 'G', 'G', 'G', 'G'],
    checks: [
      { type: 'arpBars', chord: 'D', bars: 2, label: '2 bars of D, picked' },
      { type: 'arpBars', dry: true, bars: 2, label: '2 bars with the effects off' },
      { type: 'arpBars', chord: 'Dsus2', bars: 2, label: '2 bars of Dsus2' },
      { type: 'arpBars', chord: 'G', dry: true, bars: 2, label: '2 bars of G, dry' },
    ],
  },
  {
    id: 'bossa-nova',
    title: 'Bossa nova: soft chords on the offbeat',
    minutes: 15,
    why: 'Antônio Carlos Jobim and João Gilberto made bossa nova in Rio at the end of the 1950s: quiet 7th chords on a nylon guitar, played just off the beat over a light, rolling rhythm. It sounds relaxed because it never pushes; the chords lean into the beat instead of landing on it.',
    steps: [
      'Guitar, pattern "offbeat", Arp and Latch on, drums on "bossa". Tap Cmaj7 (C E G B).',
      'Turn Fuzz off and Chorus off if they are on. Keep a little Reverb: soft, not washy.',
      'Follow the chart: Cmaj7, Am7 (A C E G), Dm7 (D F A C), G7 (G B D F). All white keys.',
      'Listen to how the chord hits between the beats while the drums roll on. That gap is the bossa feel.',
      'In GarageBand: put the sketch on a nylon or acoustic guitar from the Library, and add a soft brush kit if you like.',
    ],
    setup: { sound: 'guitar', arp: true, latch: true, arpPattern: 'offbeat', drums: true, drumPattern: 'bossa', bpm: 120, fx: { chorus: false, echo: false } },
    chart: ['Cmaj7', 'Cmaj7', 'Am7', 'Am7', 'Dm7', 'Dm7', 'G7', 'G7'],
    checks: [
      { type: 'arpBars', chord: 'Cmaj7', pattern: 'offbeat', bars: 2, label: '2 bars of Cmaj7 off the beat' },
      { type: 'drumBars', drumPattern: 'bossa', bars: 4, label: '4 bars over the bossa beat' },
      { type: 'arpBars', chord: 'Am7', bars: 2, label: '2 bars of Am7' },
      { type: 'arpBars', chord: 'G7', bars: 2, label: '2 bars of G7' },
    ],
  },
  {
    id: 'minimal-wave',
    title: 'Minimal wave: one synth, one drum machine',
    minutes: 15,
    why: 'Around 1980, bands like Oppenheimer Analysis, Das Ding and Linear Movement recorded at home with one cheap synth and a basic drum machine. The sound is cold, sparse and patient. You make it by taking things away: one line, a plain beat, lots of space, and a chord that lasts four bars instead of one.',
    steps: [
      'The sound is {Moog}, pattern "up", Arp and Latch on, drums on "sparse". Tap A minor (A C E).',
      'Turn Chorus and Reverb off. Leave Echo on: one echo is all the space this music needs.',
      'Stay on A minor for 4 bars. Then E minor (E G B) for 4. Resist the urge to add anything.',
      'Pull the Filter down to make the synth duller and colder, the way a cheap synth sounds.',
      'In GarageBand: put the sketch on a simple synth from the Library (Synthesizer category) and a vintage drum machine kit.',
    ],
    setup: { sound: 'moog-bass', arp: true, latch: true, arpPattern: 'up', drums: true, drumPattern: 'sparse', bpm: 118, brightness: 0.8 },
    chart: ['Am', 'Am', 'Am', 'Am', 'Em', 'Em', 'Em', 'Em'],
    checks: [
      { type: 'arpBars', chord: 'Am', bars: 4, label: '4 bars on A minor' },
      { type: 'drumBars', drumPattern: 'sparse', bars: 4, label: '4 bars over the sparse beat' },
      { type: 'arpBars', chord: 'Em', bars: 4, label: '4 bars on E minor' },
      { type: 'filterSweep', label: 'Filter: pull it down, then bring it back' },
    ],
  },
  {
    id: 'classical-minimalism',
    title: 'Classical minimalism: Pärt, Reich and Glass',
    minutes: 15,
    why: 'Arvo Pärt, Steve Reich and Philip Glass wrote music from tiny patterns repeated many times, changing slowly. Pärt\'s "Spiegel im Spiegel" is little more than a rising piano pattern over one low note. It was never about playing fast; it is about patience and small changes you can hear.',
    steps: [
      'E-Piano, pattern "up", Arp and Latch on, 60 BPM, no drums. Tap F major (F A C).',
      'Switch Drone on: a low F holds underneath, like the long notes in "Spiegel im Spiegel".',
      'Follow the chart: F, then C (C E G), then F again. Let each chord ring for 2 bars.',
      'Switch the pattern to "ripple": the notes now loop in a Glass-like wave. Same chord, new motion.',
      'In GarageBand: put the sketch on a grand piano from the Library and add a string pad on a second track for the long note.',
    ],
    setup: { sound: 'epiano', arp: true, latch: true, arpPattern: 'up', drums: false, bpm: 60, fx: { chorus: false, echo: false } },
    chart: ['F', 'F', 'C', 'C', 'F', 'F', 'F', 'F'],
    checks: [
      { type: 'arpBars', chord: 'F', bars: 2, label: '2 bars of F, rising' },
      { type: 'droneBars', bars: 4, label: '4 bars with the drone on' },
      { type: 'arpBars', chord: 'C', bars: 2, label: '2 bars of C' },
      { type: 'arpBars', pattern: 'ripple', bars: 2, label: '2 bars of the ripple pattern' },
    ],
  },
  {
    id: 'looping',
    title: 'Looping: build a piece in layers',
    minutes: 10,
    why: 'A looper records a short phrase and plays it back forever, so you can layer more on top. Fripp and Eno built whole albums from tape loops, and shoegaze and ambient players still loop live. You never have to play more than one short thing at a time.',
    steps: [
      'Loop length is 2 bars. Press the blue Loop button: recording starts on the next bar. Play a few notes, or just hold one. After 2 bars it starts repeating by itself.',
      'Press Loop again: at the start of the loop, your next 2 bars become a new layer on top.',
      'Change the Sound between layers: {Moog} for one, {VP330} for another. Each layer keeps its own sound.',
      'Made a mess? Undo layer removes only the last one. Stop (Esc) pauses the loop; Loop plays it again.',
      'Let it play and listen: that is a piece. To keep it, press the red Record button while it plays and save the sketch.',
    ],
    setup: { sound: 'moog-bass', arp: false, drums: false, bpm: 90 },
    checks: [
      { type: 'loopLayers', count: 1, label: 'Record your first loop' },
      { type: 'loopLayers', count: 3, label: 'Stack 3 layers' },
      { type: 'loopUndo', label: 'Undo a layer' },
      { type: 'loopBars', minLayers: 2, bars: 4, label: 'Let 2 or more layers play for 4 bars' },
    ],
  },

  {
    id: 'major-minor',
    title: 'Major and minor: happy and sad',
    minutes: 10,
    why: 'Every chord you have played is major or minor. The difference is one note, the middle one, moved by a single key. Major sounds bright and settled; minor sounds sad or wistful. Once you can hear it, you can make any chord darker or brighter on purpose.',
    steps: [
      'Play C major: C E G (computer keys A D G). The display says "C".',
      'Move the middle note down one key, to the black key E flat (computer key E). Now it is C minor, "Cm". Listen to the mood change.',
      'Do the same with G major (G B D): lower B to B flat for G minor.',
      'Go the other way: E minor (E G B) becomes E major when G moves up one key to G sharp.',
      'Open Chords at the top to hear the chords each style leans on.',
    ],
    // A sound that keeps ringing while keys are held, so the whole chord is
    // heard changing from major to minor.
    setup: { sound: 'pad', arp: false, drums: false },
    targets: ['C', 'Cm'],
    checks: [
      { type: 'chord', chord: 'C', label: 'C major' },
      { type: 'chord', chord: 'Cm', label: 'C minor' },
      { type: 'chord', chord: 'Gm', label: 'G minor' },
      { type: 'chord', chord: 'E', label: 'E major' },
    ],
  },
  {
    id: 'gb-map',
    title: 'GarageBand: the map',
    minutes: 10,
    why: 'GarageBand looks busy, but it is four areas and two ideas: a track is one instrument, and a region is the block of notes it plays. Knowing where things live is most of what makes a DAW feel less confusing.',
    guided: true,
    steps: [
      { label: 'Your sketch is open in GarageBand', text: 'Open a sketch: in Sketches, press Show in Finder, then drag the .mid file onto the GarageBand icon in the Dock. It opens as a new project, one track per part.' },
      { label: 'Found the four areas', text: 'Find the four areas: the Library on the left (sounds; press Y), the tracks in the middle, Smart Controls at the bottom (knobs and plug-ins; press B), and the control bar at the top (play, record, cycle, tempo).', image: 'img/gb/map.jpg', boxes: [
        { x: 0, y: 8, w: 21.5, h: 91, label: 'Library' },
        { x: 21.7, y: 8.5, w: 78, h: 60.5, label: 'Tracks' },
        { x: 21.7, y: 69.5, w: 78, h: 30, label: 'Smart Controls' },
        { x: 28.5, y: 1.5, w: 45, h: 6, label: 'Control bar' },
      ] },
      { label: 'Tracks and regions make sense', text: 'A track is one row: one instrument. A region is the green block on it: the notes that instrument plays. Moving regions around is how you arrange a song.', image: 'img/gb/tracks.jpg', boxes: [
        { x: 0, y: 11.5, w: 18.8, h: 35.8, label: 'Tracks' },
        { x: 19.3, y: 11.5, w: 25.2, h: 35.8, label: 'Regions' },
      ] },
      { label: 'Tracks named', text: 'Name each track after its job: double-click the name, type Guitar, Bass or Drums, and press Return. Imported tracks get odd names like "Epic Cloud Formation" until you do.', image: 'img/gb/rename.jpg', boxes: [{ x: 2.6, y: 15.2, w: 15.8, h: 2.8, label: 'Double-click to rename' }] },
      { label: 'Found the plug-in slots', text: 'Plug-ins live in Smart Controls (press B). Select a track, click an empty Plug-ins slot, and choose Audio Units, then the maker, then the plug-in {auExample}. Select Stereo Out instead and the Master tab adds plug-ins to the whole song: the place for final polish.', image: 'img/gb/plugins.jpg', boxes: [
        { x: 12.9, y: 23.4, w: 4.9, h: 20.8, label: 'Empty slot' },
        { x: 0.6, y: 2.6, w: 9.3, h: 6.5, label: 'Track / Master' },
      ] },
      { label: 'Tracks coloured', text: 'Give each track its own colour: select the track, choose Track → Assign Track Color…, and click a colour in the palette that opens at the bottom. Colours help you find parts at a glance.', image: 'img/gb/color.jpg', boxes: [{ x: 5.8, y: 32, w: 91.6, h: 63, label: 'Pick a colour' }] },
    ],
  },
  {
    id: 'gb-drag',
    title: 'Drag and drop',
    minutes: 10,
    why: 'Almost everything gets into GarageBand by dragging: loops, samples, sketches. And most arranging is dragging regions around.',
    guided: true,
    steps: [
      { label: 'Loop Browser open', text: 'Open the Loop Browser: press O, or the loop button at the top right. Apple gives you over 15,000 loops, searchable by instrument, genre and mood.', image: 'img/gb/loops.jpg', boxes: [{ x: 74, y: 8, w: 26, h: 92, label: 'Loop Browser' }] },
      { label: 'Dragged in a loop', text: 'Drag a loop onto the empty area under your tracks, where it says "Drag Apple Loops here to create tracks". GarageBand makes a new track for it.', image: 'img/gb/loops.jpg', boxes: [{ x: 30, y: 70, w: 35, h: 8, label: 'Drop here' }] },
      { label: 'Dragged in a sample', text: 'Drag a WAV from {samplesFolder} in Finder onto the same empty area: it becomes an audio track.' },
      { label: 'Moved and looped a region', text: 'Drag a region by its middle to move it. Drag its top-right corner to the right to loop it: the part repeats.' },
      { label: 'Resized a region', text: 'Drag the bottom-right corner of a region to make it longer or shorter.' },
    ],
  },
  {
    id: 'gb-snap',
    title: 'Snap and the grid',
    minutes: 10,
    why: 'The grid keeps parts in time: regions jump to bar lines instead of landing a hair early or late. Knowing when it is on, and how to turn it off, saves a lot of frustration.',
    guided: true,
    steps: [
      { label: 'Can read the bars', text: 'The numbers along the top ruler are bars. Drag the zoom slider at the top right of the tracks until you can read every bar.', image: 'img/gb/tracks.jpg', boxes: [{ x: 19.3, y: 8, w: 25, h: 2.5, label: 'Bars' }, { x: 95.3, y: 8.6, w: 4.3, h: 2, label: 'Zoom' }] },
      { label: 'Felt the snap', text: 'Drag a region sideways: it jumps neatly from bar line to bar line. That is Snap to Grid at work.' },
      { label: 'Tried it off and on', text: 'Choose Edit → Snap to Grid to turn it off, nudge a region a tiny bit, then turn it back on. Off is for nudging by feel; on is for everything else.' },
      { label: 'Copied a region', text: 'Copy a region: hold Option while you drag it, and drop the copy right after the original to repeat the part.' },
    ],
  },
  {
    id: 'gb-piano-roll',
    title: 'The Piano Roll: fix and write notes',
    minutes: 15,
    why: 'The Piano Roll shows a region\'s notes as bars on a grid: up and down is pitch, left to right is time. It is the other way to make music: instead of playing a part perfectly, you record it roughly (or draw it) and fix it here.',
    guided: true,
    steps: [
      { label: 'Piano Roll open', text: 'Double-click a green region, or select it and press E. The Piano Roll opens at the bottom. Each green bar is one note: the keyboard on the left tells you which.', image: 'img/gb/pianoroll.jpg', boxes: [
        { x: 16.4, y: 16, w: 2.6, h: 82, label: 'Pitch' },
        { x: 19.3, y: 36, w: 80, h: 30, label: 'Notes over time' },
      ] },
      { label: 'Know GarageBand\'s middle C', text: 'GarageBand calls middle C "C3". This app and most piano books call the same key C4. Same key, different name.', image: 'img/gb/pianoroll.jpg', boxes: [{ x: 16.4, y: 61, w: 2.8, h: 4.6, label: 'C3 = middle C' }] },
      { label: 'Quantized a part', text: 'Fix timing in one go: on the Region tab, set Time Quantize to 1/16 Note. Every note in the region snaps onto the grid. Lower Strength to keep a little human feel.', image: 'img/gb/pianoroll.jpg', boxes: [{ x: 1, y: 40, w: 14.8, h: 9, label: 'Time Quantize' }] },
      { label: 'Fixed a note', text: 'Drag a note up or down to change its pitch, left or right to change when it plays, and drag its right edge to make it longer or shorter.' },
      { label: 'Added and deleted a note', text: 'Add a note: hold Command and click an empty spot. Delete one: click it and press Delete.' },
      { label: 'Transposed a region', text: 'Transpose (Region tab) moves every note up or down, one key per step: same mood, different pitch. Leave drum tracks alone: on a drum track, moving notes changes which drum plays.', image: 'img/gb/pianoroll.jpg', boxes: [{ x: 1, y: 66, w: 14.8, h: 9.4, label: 'Transpose' }] },
    ],
  },
  {
    id: 'gb-sound-real',
    title: 'Make it sound played',
    minutes: 15,
    why: 'A sketch made in a grid sounds like a machine: every note the same strength, exactly on the beat, the same length. Real players are never that even. Most of what makes an instrument sound real is how its notes are played, not which sound you pick, and you can fix that in the Piano Roll. The ⓘ next to Sound in the practice room lists more ways: a pedal and mod wheel without a keyboard, Drummer, recorded loops, and your own microphone.',
    guided: true,
    steps: [
      { label: 'Parts fit their instruments', text: 'Open your sketch\'s Piano Roll (press E). Make each part something its instrument could play. A guitar has six strings, so spread a chord out the way they would: E major, low to high, is E B E G♯ B E, not three notes bunched together. Keep a bass line to one note at a time, low down.' },
      { label: 'Varied how hard notes are hit', text: 'Real players never hit two notes the same. Select a few notes and drag the Velocity slider on the Note tab: lower is softer. Make the notes on the beat a little louder than the ones between. Play it and compare.' },
      { label: 'Loosened the timing', text: 'Choose Edit → Snap to Grid to turn it off, zoom in, and nudge a few notes slightly early or late. For a strum, spread a chord\'s notes 10 to 30 milliseconds apart: low string first on a down-strum, high string first on an up-strum. Turn Snap to Grid back on when you are done.' },
      { label: 'Varied how long notes last', text: 'Drawn notes all run the same length and never stop. Drag the right edge of some notes shorter to leave small gaps; horn and wind parts need gaps to breathe. Let string notes overlap slightly so they connect.' },
      { label: 'Gave it a room', text: 'Select a track and press B for Smart Controls. Turn up the Reverb knob a little, if the sound has one: now it sounds played in a space. For an electric guitar part, click an empty Plug-ins slot and add Amp Designer: it plays through a copy of a real amp.' },
    ],
  },
  {
    id: 'gb-major-minor',
    title: 'Major to minor in GarageBand',
    minutes: 15,
    why: 'Every major chord has a "third": the note four keys above its root (the note the chord is named after). Lower that one note by a single key and the chord turns minor. In GarageBand the whole skill is finding that note in the Piano Roll and dragging it down one row.',
    guided: true,
    steps: [
      { label: 'Practice file open', text: 'In Finder, open Music, then Music Coach Practice, and drag "Major and Minor.mid" onto the GarageBand icon. Open its Piano Roll. Each bar is one chord: odd bars are major, even bars are their minor twin. Press Space and listen.' },
      { label: 'Read a chord name', text: 'Ask GarageBand what a chord is: drag a box around one bar\'s notes (or Command-click each). The top left then says, for example, "3 Notes selected (C)": the name in brackets is the chord, and the keyboard lights the keys in blue. Use this to check every change you make.', image: 'img/gb/chord-name.jpg', boxes: [
        { x: 1.5, y: 9.5, w: 20.5, h: 5, label: 'Chord name' },
        { x: 44.4, y: 56.5, w: 5.9, h: 22, label: 'Keys lit' },
        { x: 51.5, y: 57.4, w: 46.5, h: 21, label: 'Selected notes' },
      ] },
      { label: 'Heard plain major and minor', text: 'Plain chords (bars 1 and 2): C E G becomes C E flat G. Only the middle note moves, down one row.', image: 'img/gb/pianoroll.jpg', boxes: [
        { x: 19.3, y: 53.6, w: 17.6, h: 3.8, label: 'E: major' },
        { x: 37.8, y: 56.2, w: 17.5, h: 3.6, label: 'E flat: minor' },
      ] },
      { label: 'Heard 7th chords change', text: '7th chords (bars 3 to 6): Cmaj7 (C E G B) becomes Cm7 (C E flat G B flat), so two notes move down one row: the third and the top note. A C7 (C E G B flat, bar 5) already has B flat, so only its third moves to make Cm7 (bar 6).', image: 'img/gb/pianoroll.jpg', boxes: [
        { x: 56.4, y: 39.8, w: 17.2, h: 3.4, label: 'B' },
        { x: 75, y: 41.8, w: 17.3, h: 3.4, label: 'B flat' },
        { x: 56.4, y: 53.6, w: 17.2, h: 3.8, label: 'E' },
        { x: 75, y: 56.2, w: 17.3, h: 3.6, label: 'E flat' },
      ] },
      { label: 'Found the third in a flipped chord', text: 'Flipped chords (bars 7 and 8): played E G C, the root C is on top and the third E is at the bottom. Find the root first, then the note four keys above it, wherever it sits, and lower that one.' },
      { label: 'Changed an add9 chord', text: 'Add9 chords (bars 9 and 10): keep the extra D, lower only the E.' },
      { label: 'Heard a sus chord', text: 'Sus chords (bars 11 and 12) have no third at all, so they are neither major nor minor: the open, floating sound {susLove} love. To make one minor, add the third: E flat.' },
      { label: 'Changed a chord in my own song', text: 'Now in your own sketch: select a chord\'s notes to read its name, drag its third down one row, and select them again: the name gains an m for minor. Play it: the passage turns darker.' },
    ],
  },
  {
    id: 'gb-multitrack',
    title: 'Multi-tracking',
    minutes: 15,
    why: 'Multi-tracking is recording one part at a time while the others play back. It is how one person makes a whole band.',
    guided: true,
    steps: [
      { label: 'Added a track', text: 'Add a track: the + above the track names (or Track → New Tracks…). Choose MIDI (Software Instrument) for your keyboard, then Create.', image: 'img/gb/new-track.jpg', boxes: [{ x: 24.2, y: 30.5, w: 12.6, h: 19.3, label: 'For a MIDI keyboard' }] },
      { label: 'Picked a sound', text: 'Pick its sound in the Library (press Y to open it).' },
      { label: 'Cycle set', text: 'Press C to turn on Cycle, and drag the yellow strip in the ruler across 4 bars. Playback now loops over just those bars.' },
      { label: 'Recorded a part', text: 'Select the new track, press R to record, play along while the other tracks play, and press Space to stop. Every track keeps playing together.' },
    ],
  },
  {
    id: 'gb-blend',
    title: 'Blending: volume, pan and solo',
    minutes: 15,
    why: 'Blending is giving every part its own space: some louder, some softer, some left, some right. Practise it by ear here first, then do the same in GarageBand.',
    guided: true,
    mixer: true,
    setup: { sound: 'guitar', arp: true, latch: true, arpPattern: 'picking', bass: true, drone: true, drums: true, drumPattern: 'motorik', bpm: 100 },
    steps: [
      { label: 'Everything playing', text: 'Tap E minor so the guitar, bass, drone and drums all play.', check: { type: 'chord', chord: 'Em' } },
      { label: 'Soloed a part, then unsoloed', text: 'In the mixer below, press S on Bass to hear it alone, then press it again.', check: { type: 'mixSolo' } },
      { label: 'Panned two parts apart', text: 'Pan the guitar left and the drone right. Hear the space open up in the middle.', check: { type: 'mixPan' } },
      { label: 'Drums sit under the guitar', text: 'Lower the drums until the guitar sits clearly on top.', check: { type: 'mixLevel' } },
      { label: 'Found the same controls in GarageBand', text: 'GarageBand track headers have the same controls: speaker = Mute, headphones = Solo, the long slider = volume, the knob = pan. The third small button is input monitoring; leave it off.', image: 'img/gb/header.jpg', boxes: [
        { x: 15.7, y: 16.4, w: 6, h: 4.6, label: 'Mute' },
        { x: 22, y: 16.4, w: 6, h: 4.6, label: 'Solo' },
        { x: 47, y: 16, w: 39.5, h: 5.4, label: 'Volume' },
        { x: 88.2, y: 15.4, w: 8.5, h: 6.6, label: 'Pan' },
      ] },
      { label: 'Balanced the song', text: 'Balance your song in GarageBand: bass and drums in the middle, other parts a little left or right, the main part loudest. Check it on headphones too: laptop speakers hide the low end, so a kosmische or dark ambient drone that sounds right on them can boom on headphones.' },
    ],
  },
  {
    id: 'gb-fades',
    title: 'Fades and arranging',
    minutes: 15,
    why: 'A fade makes a song start or end gently. GarageBand draws volume as a line over time, called automation, that you can shape by dragging points.',
    guided: true,
    steps: [
      { label: 'Song fades out', text: 'Choose Mix → Create Volume Fade-Out on Main Output. GarageBand adds a Stereo Out track with a falling line at the end.', image: 'img/gb/fade.jpg', boxes: [{ x: 0, y: 47.5, w: 100, h: 11.5, label: 'Stereo Out: the fade' }] },
      { label: 'Reshaped the fade', text: 'That line is automation: volume over time. Drag its points to make the fade longer or shorter. Mix → Show Automation shows these lines on every track.', image: 'img/gb/fade.jpg', boxes: [{ x: 19, y: 51, w: 26, h: 8.5, label: 'Drag these points' }] },
      { label: 'One part fades in', text: 'Fade one part in: on its track, change "Display off" to Volume, click the line near the start to add points, and drag the first point to the bottom.', image: 'img/gb/fade.jpg', boxes: [{ x: 2.6, y: 18.8, w: 15.4, h: 2.4, label: 'Display off → Volume' }] },
      { label: 'Arranged in three parts', text: 'Arrange in three parts: an intro with one or two tracks, a middle with everything, and an ending where parts drop out. Option-drag regions to copy them into place.' },
    ],
  },
  {
    id: 'gb-export',
    title: 'Finish: export your song',
    minutes: 5,
    why: 'A song is finished when it is a file you can play anywhere, send to a friend, or keep. This is the last step every time.',
    guided: true,
    steps: [
      { label: 'Exported', text: 'Choose Share → Export Song to Disk… Name the song, then pick a format: AAC is already selected and fine; MP3 plays on anything. It saves into Music → GarageBand unless you choose another folder. Press Export.', image: 'img/gb/export.jpg', boxes: [
        { x: 32.6, y: 8.6, w: 34.8, h: 6.2, label: 'Name it' },
        { x: 30, y: 62.2, w: 34.4, h: 5.6, label: 'Format' },
        { x: 84.6, y: 89.8, w: 13.8, h: 6.6, label: 'Export' },
      ] },
      { label: 'Played the file', text: 'Double-click the exported file: that is your finished song, playable anywhere.' },
      { label: 'Saved the project', text: 'Save the project too, with File → Save, so you can come back and change it.' },
    ],
  },
];

// Guided lessons list their steps as checks: a Done button, or an automatic check.
for (const l of ALL_LESSONS.filter((x) => x.guided)) {
  l.checks = l.steps.map((st) => (st.check ? { ...st.check, label: st.label } : { type: 'manual', label: st.label }));
}

// The key a lesson lives in, for the Key bar: from its chord chart, its target
// chords, or its scale. Null (Key off) when the lesson has none, or when any of
// its chords reach outside that key, so the keys it asks for are never greyed.
export function keyForLesson(l) {
  let key = lessonKey(l.chart) || lessonKey(l.targets);
  if (!key && l.scale) {
    const [note, mode] = l.scale.split(' ');
    key = { root: NOTE_NAMES.indexOf(note), mode };
  }
  if (!key) return null;
  const chords = [...(l.chart || []), ...(l.targets || []), ...l.checks.map((c) => c.chord).filter(Boolean)];
  const inKey = new Set(keyPitchClasses(key.root, key.mode));
  const fits = chords.every((c) => chordPitchClasses(c).every((pc) => inKey.has(pc)));
  const scaleFits = !l.scale || SCALES[l.scale].every((pc) => inKey.has(pc));
  return fits && scaleFits ? key : null;
}

// ---- Order and locks ----

// The sidebar sections, in the order lessons are taken. Basics build on each other;
// quick wins need no chords; styles assume the basics.
export const SECTIONS = [
  {
    title: 'Basics',
    note: 'In order. Each lesson builds on the one before.',
    ids: ['hear-the-sound', 'first-chord', 'four-chords', 'major-minor', 'arpeggiator', 'follow-the-chart', 'drum-machine', 'bittersweet', 'melody', 'record-sketch', 'to-garageband'],
  },
  {
    title: 'Quick wins',
    note: 'No chords needed. Open any time.',
    ids: ['build-a-beat', 'sampling', 'looping'],
  },
  {
    title: 'GarageBand skills',
    note: 'Unlocks after Take it to GarageBand. Do these with GarageBand open; Pop out steps keeps each step on top.',
    ids: ['gb-map', 'gb-drag', 'gb-snap', 'gb-piano-roll', 'gb-sound-real', 'gb-major-minor', 'gb-multitrack', 'gb-blend', 'gb-fades', 'gb-export'],
    requiresLessons: ['to-garageband'],
  },
  {
    title: 'Styles',
    note: 'Locked until you finish the Basics: these assume you can tap chords and follow a chart. Suggested path: Kosmische, then Ambient, then Dark ambient. The rest in any order.',
    ids: ['kosmische', 'ambient-eno', 'dark-ambient', 'stereolab', 'new-wave', 'post-punk', 'shoegaze', 'folk', 'bossa-nova', 'minimal-wave', 'classical-minimalism', 'punk', 'house', 'ambient-techno', 'gothic-rock', 'lofi-hip-hop', 'dub', 'ambient-drone', 'afrobeat'],
    requiresSection: 'Basics',
  },
  {
    title: 'Optional',
    note: 'Extras. Nothing else waits for these, and Next lesson never sends you here.',
    ids: ['gb-iphone'],
    optional: true,
  },
];

// The style picker's cards. Artists come first: without sound previews they are
// what a beginner recognises. Texture groups styles by how they are made, so the
// picker can nudge toward variety; it is never shown.
export const STYLE_INFO = {
  kosmische: { name: 'Kosmische', artists: 'Tangerine Dream, Cluster', sound: 'Repeating synth patterns over a drone, slowly opening up.', texture: 'drone',
    betterWith: [{ any: ['sound:moog-bass', 'tag:synth'], label: 'a synth plugin' }] },
  'ambient-eno': { name: 'Ambient', artists: 'Brian Eno, Harold Budd', sound: 'Notes that loop at different lengths and drift into new patterns.', texture: 'drone',
    betterWith: [{ any: ['gear:reverb'], label: 'a reverb plugin' }] },
  'dark-ambient': { name: 'Dark ambient', artists: 'Lustmord, Thomas Köner', sound: 'Low drones, clashing notes and slowed-down tape.', texture: 'drone',
    // Gear that changes what the lesson can do, not just how it sounds: something to sample.
    matches: ['folder', 'tag:microphone'],
    betterWith: [{ any: ['gear:tape'], label: 'a tape plugin' }, { any: ['folder'], label: 'a folder of samples' }] },
  stereolab: { name: 'Lounge pop', artists: 'Stereolab, Broadcast', sound: 'A buzzing organ on two jazzy chords over a steady beat.', texture: 'chord',
    betterWith: [{ any: ['sound:farfisa', 'tag:synth'], label: 'an organ or synth plugin' }, { any: ['gear:chorus'], label: 'a chorus plugin' }] },
  'new-wave': { name: 'New wave', artists: 'A Flock of Seagulls, The Cure', sound: 'Echoing guitar, a jumping synth bass and a fast drum machine.', texture: 'chord',
    betterWith: [{ any: ['sound:moog-bass', 'tag:bass', 'tag:synth'], label: 'a synth bass plugin' }, { any: ['gear:echo'], label: 'an echo plugin' }] },
  'post-punk': { name: 'Post-punk and darkwave', artists: 'Joy Division, Siouxsie and the Banshees', sound: 'A melodic bass up front, tribal drums and cold minor chords.', texture: 'chord',
    betterWith: [{ any: ['gear:chorus'], label: 'a chorus plugin' }, { any: ['gear:amp', 'gear:fuzz'], label: 'an amp plugin' }] },
  house: { name: 'House', artists: 'Frankie Knuckles, Daft Punk', sound: 'A kick on every beat, chord stabs between, and a filter that builds.', texture: 'groove',
    betterWith: [{ any: ['tag:drums'], label: 'a drum machine plugin' }] },
  'ambient-techno': { name: 'Ambient techno', artists: 'Aphex Twin, Boards of Canada', sound: 'Warm, drifting chords over a soft, steady dance beat.', texture: 'groove',
    betterWith: [{ any: ['tag:synth'], label: 'a synth plugin' }, { any: ['gear:reverb'], label: 'a reverb plugin' }] },
  'lofi-hip-hop': { name: 'Lo-fi hip-hop', artists: 'J Dilla, Nujabes', sound: 'Lazy, swung drums under warm 7th chords on a worn electric piano.', texture: 'sample',
    betterWith: [{ any: ['gear:tape'], label: 'a tape plugin' }],
    matches: ['folder', 'tag:microphone'] },
  dub: { name: 'Dub', artists: 'King Tubby, Lee "Scratch" Perry', sound: 'An off-beat skank and a one-drop beat, remixed live with echo throws.', texture: 'mix',
    betterWith: [{ any: ['gear:echo'], label: 'a tape echo plugin' }] },
  'ambient-drone': { name: 'Ambient drone', artists: 'Stars of the Lid, William Basinski', sound: 'Long chords that swell in slowly and hang, with no beat at all.', texture: 'drone',
    betterWith: [{ any: ['gear:reverb'], label: 'a long reverb plugin' }] },
  afrobeat: { name: 'Afrobeat', artists: 'Fela Kuti, Tony Allen', sound: 'Interlocking riffs, stabs and bass over a rolling groove on one chord.', texture: 'groove',
    betterWith: [{ any: ['tag:drums'], label: 'a drum plugin' }] },
  'gothic-rock': { name: 'Gothic rock', artists: 'Bauhaus, Christian Death', sound: 'Echoing guitar, a bass that carries the tune, and a dark half-step move.', texture: 'chord',
    betterWith: [{ any: ['gear:echo'], label: 'an echo plugin' }, { any: ['gear:chorus'], label: 'a chorus plugin' }] },
  punk: { name: 'Punk', artists: 'Ramones, Buzzcocks', sound: 'Two-note power chords, fuzz and fast, straight drums.', texture: 'chord',
    betterWith: [{ any: ['gear:amp'], label: 'an amp plugin' }] },
  folk: { name: 'Folk', artists: 'Nick Drake, Joni Mitchell', sound: 'One guitar, picked close, with open chords that ring.', texture: 'chord',
    betterWith: [{ any: ['plugin:VG-SILK2'], label: 'an acoustic or nylon guitar plugin' }] },
  'bossa-nova': { name: 'Bossa nova', artists: 'Antônio Carlos Jobim, João Gilberto', sound: 'Soft 7th chords off the beat over a rolling rhythm.', texture: 'groove',
    betterWith: [{ any: ['plugin:VG-SILK2'], label: 'a nylon guitar plugin' }] },
  'minimal-wave': { name: 'Minimal wave', artists: 'Oppenheimer Analysis, Das Ding', sound: 'One cheap synth, a basic drum machine, lots of space.', texture: 'synth',
    betterWith: [{ any: ['tag:synth', 'sound:moog-bass'], label: 'a simple synth plugin' }] },
  'classical-minimalism': { name: 'Classical minimalism', artists: 'Arvo Pärt, Philip Glass', sound: 'A small piano pattern repeating over one long low note.', texture: 'drone',
    betterWith: [{ any: ['gear:reverb'], label: 'a reverb plugin' }] },
  shoegaze: { name: 'Shoegaze', artists: 'My Bloody Valentine, Slowdive', sound: 'A wall of fuzz, and reverb that swells up backwards into each note.', texture: 'chord',
    betterWith: [{ any: ['gear:reverse'], label: 'a reverse reverb plugin' }, { any: ['gear:amp', 'gear:fuzz'], label: 'an amp plugin' }] },
};

// One or two real recordings per style, from the artist's or label's own Bandcamp page, so a
// learner can hear what the style sounds like. Loaded only when they press Hear it.
// id: the Bandcamp album or track id (from the page's bc-page-properties).
// Checked by hand: each is the artist's or label's official Bandcamp page. Where the
// artists on a card aren't on Bandcamp, it is the closest honest match that is.
export const LISTEN = {
  folk: [{ artist: 'Vashti Bunyan', title: 'Lookaftering', url: 'https://fatcatrecords.bandcamp.com/album/lookaftering', kind: 'album', id: 3414026607 }],
  punk: [{ artist: 'Amyl and the Sniffers', title: 'Amyl and the Sniffers', url: 'https://amylandthesniffers.bandcamp.com/album/amyl-and-the-sniffers', kind: 'album', id: 513673940 }],
  house: [{ artist: 'Mr. Fingers', title: 'Cerebral Hemispheres', url: 'https://alleviatedrecords.bandcamp.com/album/mr-fingers-cerebral-hemispheres', kind: 'album', id: 1094426324 }],
  kosmische: [{ artist: 'Cluster', title: 'Sowiesoso', url: 'https://clusterofficial.bandcamp.com/album/sowiesoso', kind: 'album', id: 3099152958 }],
  shoegaze: [{ artist: 'Slowdive', title: 'Slowdive', url: 'https://slowdive.bandcamp.com/album/slowdive', kind: 'album', id: 2948336751 }],
  'ambient-techno': [{ artist: 'Boards of Canada', title: 'Music Has the Right to Children', url: 'https://boardsofcanada.bandcamp.com/album/music-has-the-right-to-children', kind: 'album', id: 3297123711 }],
  'bossa-nova': [{ artist: 'Sessa', title: 'Grandeza', url: 'https://sessa.bandcamp.com/album/grandeza-2', kind: 'album', id: 3088703589 }],
  stereolab: [{ artist: 'Stereolab', title: 'Emperor Tomato Ketchup', url: 'https://stereolab.bandcamp.com/album/emperor-tomato-ketchup', kind: 'album', id: 1014556783 }],
  'post-punk': [
    { artist: 'Boy Harsher', title: 'Careful', url: 'https://boyharsher.bandcamp.com/album/careful', kind: 'album', id: 711789267 },
    { artist: 'Molchat Doma', title: 'Etazhi', url: 'https://domamolchat.bandcamp.com/album/etazhi-2018', kind: 'album', id: 3397703812 },
  ],
  'lofi-hip-hop': [{ artist: 'J Dilla', title: 'Donuts', url: 'https://dilla.bandcamp.com/album/donuts', kind: 'album', id: 3103314719 }],
  dub: [{ artist: 'King Tubby & The Aggrovators', title: 'Dubbing in the Backyard', url: 'https://pressuresounds.bandcamp.com/album/dubbing-in-the-backyard', kind: 'album', id: 2626304650 }],
  'ambient-drone': [
    { artist: 'Stars of the Lid', title: 'And Their Refinement of the Decline', url: 'https://starsofthelid.bandcamp.com/album/and-their-refinement-of-the-decline', kind: 'album', id: 605498052 },
    { artist: 'William Basinski', title: 'The Disintegration Loops', url: 'https://williambasinski.bandcamp.com/album/the-disintegration-loops', kind: 'album', id: 1686158765 },
  ],
  afrobeat: [{ artist: 'Tony Allen with Afrika 70', title: 'Jealousy', url: 'https://tonyallen.bandcamp.com/album/jealousy', kind: 'album', id: 450597284 }],
  'gothic-rock': [
    { artist: 'Bauhaus', title: 'In the Flat Field', url: 'https://beggarsbanquet.bandcamp.com/album/in-the-flat-field', kind: 'album', id: 2976272377 },
    { artist: 'Christian Death', title: 'Only Theatre of Pain', url: 'https://frontierrecords-christiandeath.bandcamp.com/album/only-theatre-of-pain', kind: 'album', id: 2830794502 },
  ],
  'minimal-wave': [{ artist: 'Minimal Wave label', title: 'The Bedroom Tapes', url: 'https://minimalwave.bandcamp.com/album/the-bedroom-tapes', kind: 'album', id: 850253089 }],
  'classical-minimalism': [{ artist: 'Philip Glass', title: 'Philip Glass Solo', url: 'https://philipglass.bandcamp.com/album/philip-glass-solo', kind: 'album', id: 3793286961 }],
  'ambient-eno': [{ artist: 'Stars of the Lid', title: 'And Their Refinement of the Decline', url: 'https://starsofthelid.bandcamp.com/album/and-their-refinement-of-the-decline', kind: 'album', id: 605498052 }],
  'new-wave': [
    { artist: 'Gary Numan', title: 'Cars', url: 'https://garynuman.bandcamp.com/track/cars-2', kind: 'track', id: 3873035885 },
    { artist: 'Tubeway Army', title: "Are 'Friends' Electric?", url: 'https://garynuman.bandcamp.com/track/are-friends-electric', kind: 'track', id: 3794820183 },
  ],
  'dark-ambient': [{ artist: 'Lustmord', title: 'The Word as Power', url: 'https://lustmord.bandcamp.com/album/the-word-as-power', kind: 'album', id: 4167059370 }],
};

// Bandcamp's own embed (Share / Embed on the album page), in this app's colours: the
// standard player with small artwork, or the slim one-line player where space is tight.
export function bandcampEmbed(listen, slim = false) {
  const size = slim ? 'size=small' : 'size=large/tracklist=false/artwork=small';
  return `https://bandcamp.com/EmbeddedPlayer/${listen.kind}=${listen.id}/${size}/bgcol=1e2026/linkcol=e8b86b/transparent=true/`;
}

// The order the picker shows styles in: the first six cover different kinds of sound,
// then the other starters, then styles that suit more gear or come later in skill.
export const PICKER_ORDER = [
  'folk', 'punk', 'house', 'lofi-hip-hop', 'ambient-drone', 'dub',
  'kosmische', 'shoegaze', 'ambient-techno', 'afrobeat',
  'bossa-nova', 'stereolab', 'post-punk', 'gothic-rock', 'minimal-wave', 'classical-minimalism',
  'ambient-eno', 'new-wave', 'dark-ambient',
];

// True when this Mac has gear that changes what a style's lesson can do (its `matches`).
// Most styles have none: their optional gear only makes them sound richer.
export function matchesGear(id, env) {
  const e = gearEnv(env);
  return (STYLE_INFO[id]?.matches || []).some((need) => {
    const [kind, value] = need.split(':');
    if (kind === 'folder') return Boolean(e.folder);
    if (kind === 'tag') return Boolean(e.tags[value]);
    if (kind === 'sound') return e.sounds.has(value);
    return false;
  });
}

// The optional gear that would bring a style closer to the record, missing on this Mac.
export function missingBetterWith(id, env) {
  const e = gearEnv(env);
  const has = (need) => {
    const [kind, value] = need.split(':');
    if (kind === 'sound') return e.sounds.has(value);
    if (kind === 'tag') return Boolean(e.tags[value]);
    if (kind === 'gear') return preferred(value, e) !== -1 || Boolean(e.tags[value]);
    if (kind === 'folder') return Boolean(e.folder);
    if (kind === 'plugin') return e.installed.has(value);
    return false;
  };
  return (STYLE_INFO[id]?.betterWith || []).filter((b) => !b.any.some(has)).map((b) => b.label);
}

// When three or more picks are made the same way, suggest a different kind of style.
export function varietyNudge(picks) {
  const counts = {};
  for (const id of picks) {
    const t = STYLE_INFO[id]?.texture;
    if (t) counts[t] = (counts[t] || 0) + 1;
  }
  const crowded = Object.keys(counts).find((t) => counts[t] >= 3);
  if (!crowded) return null;
  const others = [...new Set(Object.values(STYLE_INFO).map((s) => s.texture))].filter((t) => t !== crowded);
  const words = { drone: 'drone and ambient', chord: 'chord-based', groove: 'groove-based', sample: 'sample-based', synth: 'synth-based', mix: 'mixing-based' };
  if (!others.length) return null;
  return `These are all ${words[crowded] || crowded} styles. Want to add something ${others.map((t) => words[t] || t).join(' or ')}?`;
}

// Lessons that also need another lesson first, because they use what it teaches.
const REQUIRES = { 'dark-ambient': ['sampling'] };

export const LESSONS = SECTIONS.flatMap((sec) => sec.ids.map((id) => ALL_LESSONS.find((l) => l.id === id)));

export function sectionOf(id) {
  return SECTIONS.find((sec) => sec.ids.includes(id));
}

// Why a lesson is locked, in one line, or null when it is open.
export function lockReason(id, completed, unlocked = {}) {
  if (unlocked[id]) return null; // "Unlock anyway"
  const sec = sectionOf(id);
  const gate = sec?.requiresSection && SECTIONS.find((s) => s.title === sec.requiresSection);
  if (gate && !gate.ids.every((g) => completed[g])) return `Finish the ${gate.title} first.`;
  const needed = (sec?.requiresLessons || []).filter((r) => !completed[r]);
  if (needed.length) return `Finish ${needed.map((r) => ALL_LESSONS.find((l) => l.id === r).title).join(' and ')} first.`;
  const missing = (REQUIRES[id] || []).filter((r) => !completed[r]);
  if (missing.length) return `Do ${missing.map((r) => ALL_LESSONS.find((l) => l.id === r).title).join(' and ')} first: this lesson uses it.`;
  return null;
}

// Where to start: the first open lesson not yet finished. Half-done counts as not finished.
export function firstUnfinished(completed, unlocked = {}, picks = []) {
  return lessonPath(picks).find((l) => !completed[l.id] && !lockReason(l.id, completed, unlocked)) || LESSONS[0];
}

// The order to work through: every lesson, except that with styles picked, only those
// styles, in the order picked.
export function lessonPath(picks = []) {
  const all = LESSONS.filter((l) => !sectionOf(l.id)?.optional);
  if (!picks.length) return all;
  const styles = SECTIONS.find((s) => s.title === 'Styles').ids;
  const rest = all.filter((l) => !styles.includes(l.id));
  return [...rest, ...picks.filter((id) => styles.includes(id)).map((id) => LESSONS.find((l) => l.id === id))];
}

// ---- Checker: turns app events into ticked-off lesson steps ----

function initialValue(check) {
  if (check.type === 'fxToggle') return { sawOff: false, done: false };
  if (check.type === 'mixSolo') return { sawSolo: false, done: false };
  if (check.type === 'mixPan' || check.type === 'mixLevel') return false;
  if (check.type === 'dropOut') return { out: false, count: 0 };
  if (['chord', 'saved', 'manual', 'gridHas', 'loopLoaded', 'reverseSlice', 'loopUndo', 'holdSeconds'].includes(check.type)) return false;
  if (check.type === 'distinctSlices') return [];
  if (check.type === 'filterSweep') return 0;
  return 0;
}

// A scaleNotes check names a scale ("E minor pentatonic") or a key ("A blues").
function scaleOf(check) {
  if (!check.key) return SCALES[check.scale];
  const { root, mode } = parseKey(check.key);
  return keyPitchClasses(root, mode);
}

export function createChecker(lesson, saved) {
  const values = lesson.checks.map((c, i) => (saved && saved[i] !== undefined ? saved[i] : initialValue(c)));

  function target(c) {
    return c.count || c.bars || 1;
  }

  function isDone(c, v) {
    if (c.type === 'fxToggle' || c.type === 'mixSolo') return v.done;
    if (c.type === 'dropOut') return v.count >= target(c);
    if (c.type === 'distinctSlices') return v.length >= c.count;
    if (typeof v === 'boolean') return v;
    return v >= target(c);
  }

  function handle(evt) {
    let changed = false;
    lesson.checks.forEach((c, i) => {
      const v = values[i];
      if (isDone(c, v)) return;
      let next = v;
      switch (c.type) {
        case 'notes':
          if (evt.type === 'noteOn') next = v + 1;
          break;
        case 'fxToggle':
          if (evt.type === 'fx' && evt.which === c.which) {
            if (!evt.enabled) next = { sawOff: true, done: false };
            else if (v.sawOff) next = { sawOff: true, done: true };
          }
          break;
        case 'chord':
          if (evt.type === 'held' && matchesChord(evt.notes, c.chord)) next = true;
          break;
        case 'arpBars':
          if (
            evt.type === 'arpBar' &&
            (!c.chord || matchesChord(evt.notes, c.chord)) &&
            (!c.pattern || evt.pattern === c.pattern) &&
            (!c.sound || evt.sound === c.sound) &&
            (!c.minNotes || new Set(evt.notes).size >= c.minNotes) &&
            (!c.interval || hasInterval(evt.notes, c.interval)) &&
            (!c.fx || c.fx.every((name) => evt.fx?.[name])) &&
            (!c.dry || !['chorus', 'echo', 'reverb', 'fuzz', 'reverse', 'wobble'].some((name) => evt.fx?.[name])) &&
            (!c.swing || evt.swing >= c.swing) &&
            (!c.meter || evt.meter === c.meter)
          ) next = v + 1;
          break;
        case 'drumBars':
          if (evt.type === 'arpBar' && evt.drums && evt.notes.length > 0 && (!c.drumPattern || evt.drumPattern === c.drumPattern) && (!c.drumFuzz || evt.drumFuzz) && (!c.swing || evt.swing >= c.swing) && (!c.meter || evt.meter === c.meter)) next = v + 1;
          break;
        case 'bassBars':
          if (evt.type === 'arpBar' && evt.bass && (!c.bassStyle || evt.bassStyle === c.bassStyle)) next = v + 1;
          break;
        case 'droneBars':
          if (evt.type === 'arpBar' && evt.drone) next = v + 1;
          break;
        case 'filterSweep':
          if (evt.type === 'filter') {
            if (evt.value <= 0.3) next = 0.5; // closed: halfway there
            else if (evt.value >= 0.85 && v === 0.5) next = 1;
          }
          break;
        case 'scaleNotes':
          if (evt.type === 'noteOn' && scaleOf(c).includes(pitchClass(evt.note))) next = v + 1;
          break;
        case 'recorded':
          if (evt.type === 'recorded' && evt.bars >= c.bars && (!c.meter || evt.meter === c.meter)) next = evt.bars;
          break;
        case 'saved':
          if (evt.type === 'saved') next = true;
          break;
        case 'gridHas':
          if (evt.type === 'grid' && c.steps.every((st) => evt.grid[c.row]?.includes(st))) next = true;
          break;
        case 'gridCount':
          if (evt.type === 'grid') next = Math.max(v, evt.grid[c.row]?.length || 0);
          break;
        case 'beatBars':
          if (evt.type === 'bar' && evt.drums && evt.drumPattern === c.drumPattern && (!c.kit || evt.kit === c.kit) && (!c.swing || evt.swing >= c.swing) && (!c.meter || evt.meter === c.meter)) next = v + 1;
          break;
        case 'loopLoaded':
          if (evt.type === 'loop') next = true;
          break;
        case 'sliceNotes':
          if (evt.type === 'slice' && (!c.halfSpeed || evt.halfSpeed)) next = v + 1;
          break;
        case 'distinctSlices':
          if (evt.type === 'slice' && !v.includes(evt.index)) next = [...v, evt.index];
          break;
        case 'reverseSlice':
          if (evt.type === 'slice' && evt.reverse) next = true;
          break;
        case 'loopLayers':
          if (evt.type === 'loopLayer') next = Math.max(v, evt.layers);
          break;
        case 'loopUndo':
          if (evt.type === 'loopUndo') next = true;
          break;
        case 'loopBars':
          if (evt.type === 'loopBar' && evt.layers >= c.minLayers) next = v + 1;
          break;
        case 'mixSolo':
          if (evt.type === 'mix') {
            if (evt.soloed.length) next = { sawSolo: true, done: false };
            else if (v.sawSolo) next = { sawSolo: true, done: true };
          }
          break;
        case 'mixPan':
          if (evt.type === 'mix') {
            const pans = Object.values(evt.pans);
            if (pans.some((p) => p <= -0.25) && pans.some((p) => p >= 0.25)) next = true;
          }
          break;
        case 'mixLevel':
          if (evt.type === 'mix' && evt.volumes.drums <= evt.volumes.instrument - 0.15) next = true;
          break;
        case 'throws':
          // Dub echo throws, pressed while something is sounding.
          if (evt.type === 'throw' && evt.playing) next = v + 1;
          break;
        case 'dropOut':
          // A part muted while the music plays, then brought back in.
          if (evt.type === 'mute' && evt.part === c.part && evt.playing) {
            if (evt.muted) next = { out: true, count: v.count };
            else if (v.out) next = { out: false, count: v.count + 1 };
          }
          break;
        case 'holdSeconds':
          if (
            evt.type === 'hold' && evt.seconds >= c.seconds &&
            (!c.chord || matchesChord(evt.notes, c.chord)) &&
            (!c.minNotes || new Set(evt.notes).size >= c.minNotes) &&
            (!c.freeTime || evt.freeTime)
          ) next = true;
          break;
        case 'manual':
          if (evt.type === 'manual' && evt.index === i) next = true;
          break;
      }
      if (next !== v) {
        values[i] = next;
        changed = true;
      }
    });
    return changed;
  }

  function progress() {
    return lesson.checks.map((c, i) => {
      const v = values[i];
      const done = isDone(c, v);
      const counted = (typeof v === 'number' && c.type !== 'filterSweep') || Array.isArray(v);
      const amount = Array.isArray(v) ? v.length : v;
      const current = counted ? Math.min(amount, target(c)) : null;
      return { label: c.label, type: c.type, done, current, target: counted ? target(c) : null };
    });
  }

  return {
    handle,
    progress,
    values: () => values.map((v) => (Array.isArray(v) ? [...v] : typeof v === 'object' ? { ...v } : v)),
    complete: () => lesson.checks.every((c, i) => isDone(c, values[i])),
  };
}

// Notes to highlight for the lesson's scale, as pitch classes.
export function lessonHighlightPcs(lesson) {
  if (lesson.scale) return SCALES[lesson.scale];
  return [];
}

export { chordPitchClasses };
