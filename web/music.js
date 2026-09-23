// Pure music logic: note names, chord detection, arpeggiator, latch, MIDI file writing.
// No browser APIs here, so everything is testable with `node --test`.

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_TO_SHARP = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };

export function noteName(midi) {
  return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
}

export function pitchClass(midi) {
  return ((midi % 12) + 12) % 12;
}

export function isBlackKey(midi) {
  return [1, 3, 6, 8, 10].includes(pitchClass(midi));
}

// Ordered so the simplest reading wins when two spellings share a note set.
export const CHORD_TYPES = [
  { suffix: '', label: 'major', ints: [0, 4, 7] },
  { suffix: 'm', label: 'minor', ints: [0, 3, 7] },
  { suffix: 'maj7', label: 'major 7', ints: [0, 4, 7, 11] },
  { suffix: 'm7', label: 'minor 7', ints: [0, 3, 7, 10] },
  { suffix: '7', label: 'dominant 7', ints: [0, 4, 7, 10] },
  { suffix: 'sus2', label: 'suspended 2', ints: [0, 2, 7] },
  { suffix: 'sus4', label: 'suspended 4', ints: [0, 5, 7] },
  { suffix: 'add9', label: 'add 9', ints: [0, 2, 4, 7] },
  { suffix: 'm(add9)', label: 'minor add 9', ints: [0, 2, 3, 7] },
  { suffix: '6', label: 'major 6', ints: [0, 4, 7, 9] },
  { suffix: 'dim', label: 'diminished', ints: [0, 3, 6] },
  { suffix: '5', label: 'power chord', ints: [0, 7] },
];

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

// Parse a chord name like "Em", "Cmaj7", "F#m7", "Bb" into {root, ints, name}.
export function parseChord(name) {
  const m = /^([A-G])([#b]?)(.*)$/.exec(name);
  if (!m) throw new Error(`Unknown chord: ${name}`);
  let rootName = m[1] + m[2];
  if (FLAT_TO_SHARP[rootName]) rootName = FLAT_TO_SHARP[rootName];
  const type = CHORD_TYPES.find((t) => t.suffix === m[3]);
  if (!type) throw new Error(`Unknown chord type: ${name}`);
  return { name, root: NOTE_NAMES.indexOf(rootName), ints: type.ints, label: type.label };
}

export function chordPitchClasses(name) {
  const c = parseChord(name);
  return c.ints.map((i) => (c.root + i) % 12);
}

// True when the held notes are exactly the chord's notes, in any order or octave.
export function matchesChord(notes, name) {
  const pcs = [...new Set(notes.map(pitchClass))];
  return pcs.length > 0 && sameSet(pcs, chordPitchClasses(name));
}

// Name the chord formed by the held notes, or null. Prefers the lowest note as root.
export function detectChord(notes) {
  if (notes.length < 2) return null;
  const sorted = [...notes].sort((a, b) => a - b);
  const bass = pitchClass(sorted[0]);
  const pcs = [...new Set(sorted.map(pitchClass))];
  const roots = [bass, ...pcs.filter((p) => p !== bass)];
  for (const root of roots) {
    const ints = pcs.map((p) => (p - root + 12) % 12);
    for (const type of CHORD_TYPES) {
      if (sameSet(ints, type.ints)) {
        const name = NOTE_NAMES[root] + type.suffix;
        return {
          name: root === bass ? name : `${name}/${NOTE_NAMES[bass]}`,
          root,
          label: type.label,
          pcs,
        };
      }
    }
  }
  return null;
}

// A comfortable one-hand position: root between G3 (55) and F#4 (66), stacked upward.
export function voicing(name) {
  const c = parseChord(name);
  let root = 48 + c.root;
  while (root < 55) root += 12;
  return c.ints.map((i) => root + i);
}

export const SCALES = {
  'E minor pentatonic': [4, 7, 9, 11, 2],
};

// ---- Keys ----

export const KEY_MODES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10], // natural minor
};
const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
// Keys written with flats (the rest use sharps, or no black keys at all).
const FLAT_KEYS = { major: [5, 10, 3, 8, 1, 6], minor: [2, 7, 0, 5, 10, 3] };

export function usesFlats(root, mode) {
  return FLAT_KEYS[mode].includes(root);
}

// A note's name spelled the way the key writes it (E♭ in C minor, not D♯).
export function spell(pc, root, mode) {
  return (usesFlats(root, mode) ? FLAT_NAMES : SHARP_NAMES)[pitchClass(pc)];
}

export function keyName(root, mode) {
  return `${spell(root, root, mode)} ${mode}`;
}

export function keyPitchClasses(root, mode) {
  return KEY_MODES[mode].map((i) => (root + i) % 12);
}

export function inKey(note, root, mode) {
  return keyPitchClasses(root, mode).includes(pitchClass(note));
}

// Scale lock: the nearest note in the key (a tie goes down).
export function snapToKey(note, root, mode) {
  for (let d = 0; d < 12; d++) {
    if (inKey(note - d, root, mode)) return note - d;
    if (inKey(note + d, root, mode)) return note + d;
  }
  return note;
}

// The seven chords built only from the key's notes: every other note, from each note of the key.
export function keyChords(root, mode) {
  const pcs = keyPitchClasses(root, mode);
  return pcs.map((pc, i) => {
    const triad = [pc, pcs[(i + 2) % 7], pcs[(i + 4) % 7]];
    const ints = triad.map((p) => (p - pc + 12) % 12);
    const type = CHORD_TYPES.find((t) => t.ints.length === 3 && t.ints.every((x, j) => x === ints[j]));
    const suffix = type ? type.suffix : '';
    return { name: NOTE_NAMES[pc] + suffix, label: spell(pc, root, mode) + suffix, notes: triad };
  });
}

// ---- Circle of fifths ----

// The 12 major keys clockwise: each is a fifth above the one before.
export const CIRCLE = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

export function neighbours(root) {
  const i = CIRCLE.indexOf(root);
  return { left: CIRCLE[(i + 11) % 12], right: CIRCLE[(i + 1) % 12], across: CIRCLE[(i + 6) % 12] };
}

// What two major keys have in common, and which notes differ.
export function compareKeys(a, b) {
  const pa = keyPitchClasses(a, 'major');
  const pb = keyPitchClasses(b, 'major');
  return {
    shared: pa.filter((pc) => pb.includes(pc)),
    onlyA: pa.filter((pc) => !pb.includes(pc)),
    onlyB: pb.filter((pc) => !pa.includes(pc)),
  };
}

// The six chords that always work in a major key (the diminished one left out).
export function friendlyChords(root) {
  return keyChords(root, 'major').filter((c) => !c.name.endsWith('dim'));
}

// A lesson's home key: the chart's most-repeated chord (the opening one wins a
// tie), major or minor as that chord is. A drone note, when the lesson has
// one, confirms the root.
export function lessonKey(chart) {
  if (!chart?.length) return null;
  const counts = new Map();
  for (const c of chart) counts.set(c, (counts.get(c) || 0) + 1);
  let home = chart[0];
  for (const [c, n] of counts) if (n > counts.get(home)) home = c;
  const { root } = parseChord(home);
  const suffix = home.replace(/^[A-G][#b]?/, '');
  const minor = suffix.startsWith('m') && !suffix.startsWith('maj');
  return { root, mode: minor ? 'minor' : 'major' };
}

// Where a key sits on the circle: minor keys sit with their relative major
// (A minor shares C major's notes and spot).
export function circleSpot(root, mode) {
  return CIRCLE.indexOf(mode === 'minor' ? (root + 3) % 12 : root);
}

export function keyAtSpot(spot, mode) {
  const major = CIRCLE[((spot % 12) + 12) % 12];
  return mode === 'minor' ? (major + 9) % 12 : major;
}

// The two "hear the difference" demos, as chord names. One step around: home,
// then the next key's home twice, so the chord that pulled away becomes the
// new home. Jump across: home straight to the far side of the circle.
export function wheelDemo(root, mode, kind) {
  const spot = circleSpot(root, mode);
  const suffix = mode === 'minor' ? 'm' : '';
  const name = (r) => NOTE_NAMES[r] + suffix;
  if (kind === 'step') {
    const next = keyAtSpot(spot + 1, mode);
    return [name(root), name(next), name(next)];
  }
  return [name(root), name(keyAtSpot(spot + 6, mode))];
}

// ---- Arpeggiator ----

export const ARP_PATTERNS = {
  // Guitar-style picking over a spread chord: bass on the beat, strings above.
  picking: [0, 3, 4, 5, 2, 3, 4, 5, 1, 3, 4, 5, 2, 3, 5, 4],
  up: [0, 1, 2, 3, 4, 5],
  'up-down': [0, 1, 2, 3, 4, 5, 4, 3, 2, 1],
  ripple: [0, 2, 1, 3, 2, 4, 3, 5],
  // Berlin-school sequence: a low pedal note alternating with the notes above it.
  sequence: [0, 1, 0, 2, 0, 3, 0, 2, 0, 1, 0, 4, 0, 3, 0, 5],
};

// Eno-style tape loops: each held note repeats on its own cycle (in sixteenths).
// The cycles have different lengths, so the notes drift in and out of phase.
export const ENO_PERIODS = [22, 26, 34, 38, 46, 58];

// New-wave bass: the chord's lowest note on every eighth, jumping up an octave
// on the offbeats. Returns null on steps where the bass rests.
// style 'melodic' is post-punk: the bass plays a tune from the chord's notes,
// high and forward, instead of pumping the root.
const MELODIC_BASS = [0, 1, 2, 1, 0, 2, 3, 2];

export function bassNote(held, step, style = 'pump') {
  if (!held.length || step % 2 !== 0) return null;
  let root = Math.min(...held);
  while (root > 43) root -= 12;
  while (root < 31) root += 12;
  if (style === 'melodic') {
    const pcs = [...new Set(held.map(pitchClass))].sort((a, b) => ((a - pitchClass(root) + 12) % 12) - ((b - pitchClass(root) + 12) % 12));
    const tones = pcs.map((pc) => root + 12 + ((pc - pitchClass(root) + 12) % 12));
    tones.push(root + 24);
    return tones[MELODIC_BASS[(step / 2) % MELODIC_BASS.length] % tones.length];
  }
  return step % 4 === 2 ? root + 12 : root;
}

// True when two of the notes are this many semitones apart (in any octave).
// 1 is a half-step rub; 6 is the tritone.
export function hasInterval(notes, semitones) {
  const pcs = [...new Set(notes.map(pitchClass))];
  return pcs.some((a) => pcs.some((b) => (b - a + 12) % 12 === semitones));
}

// Patterns that play the whole chord at once, on these sixteenths of the bar.
export const CHORD_PATTERNS = {
  eighths: [0, 2, 4, 6, 8, 10, 12, 14],
  offbeat: [2, 6, 10, 14],
};

// Spread held notes across two octaves like guitar strings: a bass note below,
// the chord, then the chord an octave up. Always six "strings".
export function spreadChord(held) {
  const notes = [...new Set(held)].sort((a, b) => a - b);
  if (notes.length === 0) return [];
  const strings = [notes[0] - 12, ...notes];
  let octave = 12;
  while (strings.length < 6) {
    for (const n of notes) {
      if (strings.length < 6) strings.push(n + octave);
    }
    octave += 12;
  }
  // Keep the top string within a real guitar's comfortable range (below F5).
  const shift = strings[5] > 76 ? -12 : 0;
  return strings.slice(0, 6).map((n) => n + shift);
}

// Every note the arpeggiator plays on this step: one for a picking pattern,
// the whole chord (or nothing) for a chord pattern.
export function arpNotes(patternName, held, step) {
  if (patternName === 'eno') {
    const notes = [...new Set(held)].sort((a, b) => a - b);
    return notes.filter((n, i) => (step + i * 7) % ENO_PERIODS[i % ENO_PERIODS.length] === 0);
  }
  const hits = CHORD_PATTERNS[patternName];
  if (hits) return hits.includes(step % 16) ? [...new Set(held)].sort((a, b) => a - b) : [];
  const n = arpNote(patternName, held, step);
  return n === null ? [] : [n];
}

export function arpNote(patternName, held, step) {
  const strings = spreadChord(held);
  if (strings.length === 0) return null;
  const pattern = ARP_PATTERNS[patternName] || ARP_PATTERNS.picking;
  return strings[pattern[step % pattern.length]];
}

// ---- Sampler: which slice a key plays ----

const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11];

// White keys from middle C (C4) upward play slices 0, 1, 2 …, wrapping around.
// Black keys play nothing.
export function sliceForNote(note, slices) {
  const pc = pitchClass(note);
  const w = WHITE_PCS.indexOf(pc);
  if (w === -1) return null;
  const idx = 7 * Math.floor((note - 60) / 12) + w;
  return ((idx % slices) + slices) % slices;
}

// Tempo written in a loop's file name, like "Can Ballad B Minipops 95.wav".
export function tempoFromName(name) {
  const m = /(?:^|[\s_])(\d{2,3})\s*(?:bpm)?\.wav$/i.exec(name);
  const bpm = m ? Number(m[1]) : null;
  return bpm && bpm >= 60 && bpm <= 180 ? bpm : null;
}

// ---- Latch: keep the last chord sounding after the keys are released ----

export class Latch {
  constructor() {
    this.down = new Set();
    this.latched = [];
    this.lifted = new Set(); // keys let go while others were still held
  }
  // accumulate: each tap adds a note, and tapping it again removes it,
  // instead of a fresh chord replacing the old one.
  press(note, accumulate = false) {
    if (accumulate) {
      this.down.add(note);
      this.latched = this.latched.includes(note) ? this.latched.filter((n) => n !== note) : [...this.latched, note];
      return;
    }
    if (this.down.size === 0) {
      this.latched = [];
    } else {
      // Sliding a finger (E up, E flat down) swaps the note out of the chord.
      this.latched = this.latched.filter((n) => !this.lifted.has(n));
    }
    this.lifted.clear();
    this.down.add(note);
    if (!this.latched.includes(note)) this.latched.push(note);
  }
  // Letting go of everything, one finger after another, keeps the whole chord.
  release(note) {
    this.down.delete(note);
    if (this.down.size > 0) this.lifted.add(note);
    else this.lifted.clear();
  }
  clear() {
    this.down.clear();
    this.latched = [];
    this.lifted.clear();
  }
  notes(latchOn) {
    return latchOn ? [...this.latched] : [...this.down];
  }
}

// ---- MIDI file writing (Standard MIDI File, format 1) ----

export const PPQ = 480;
export const TICKS_PER_STEP = PPQ / 4; // one sixteenth note

function vlq(n) {
  const bytes = [n & 0x7f];
  n >>= 7;
  while (n > 0) {
    bytes.unshift((n & 0x7f) | 0x80);
    n >>= 7;
  }
  return bytes;
}

function textBytes(s) {
  return [...new TextEncoder().encode(s)];
}

function chunk(type, body) {
  const len = body.length;
  return [...textBytes(type), (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...body];
}

// tracks: [{name, channel (0-15), events: [{tick, note, vel, dur}]}]
export function writeMidi(tracks, bpm) {
  const tempo = Math.round(60000000 / bpm);
  const conductor = [
    0, 0xff, 0x51, 0x03, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255,
    0, 0xff, 0x58, 0x04, 4, 2, 24, 8,
    0, 0xff, 0x2f, 0x00,
  ];
  const out = [
    ...chunk('MThd', [0, 1, 0, tracks.length + 1, (PPQ >> 8) & 255, PPQ & 255]),
    ...chunk('MTrk', conductor),
  ];
  for (const track of tracks) {
    const raw = [];
    for (const e of track.events) {
      raw.push({ tick: e.tick, on: true, note: e.note, vel: e.vel });
      raw.push({ tick: e.tick + Math.max(1, e.dur), on: false, note: e.note, vel: 0 });
    }
    raw.sort((a, b) => a.tick - b.tick || (a.on === b.on ? 0 : a.on ? 1 : -1));
    const name = textBytes(track.name);
    const body = [0, 0xff, 0x03, ...vlq(name.length), ...name];
    let last = 0;
    for (const e of raw) {
      body.push(...vlq(e.tick - last), (e.on ? 0x90 : 0x80) | track.channel, e.note, e.vel);
      last = e.tick;
    }
    body.push(0, 0xff, 0x2f, 0x00);
    out.push(...chunk('MTrk', body));
  }
  return new Uint8Array(out);
}
