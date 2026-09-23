// Chord explorer content: what a key is, major versus minor, each style's typical
// chords, and what two notes sound like together. Typical, not rules.

export const KEY_TEXT =
  'A key is a family of seven notes that sound good together. The white keys alone make C major (or its sad twin, A minor): any chord built only from white keys sits well beside the others. That is why most chords in these lessons are white keys, and why one black key, like the F sharp in D, stands out.';

export const MAJOR_MINOR = {
  text: 'Major and minor differ by one note, the middle one. C major is C E G. Move E down one key to E flat and it becomes C minor: same chord, sadder mood.',
  chords: ['C', 'Cm', 'G', 'Gm', 'E', 'Em'],
};

// Checked against the app's own lesson charts.
export const STYLE_CHORDS = [
  { style: 'Durutti Column', chords: ['Em7', 'Cmaj7', 'G', 'D'], note: '7th chords mixed with plain ones: bittersweet and open.' },
  { style: 'Stereolab', chords: ['Cmaj7', 'Fmaj7'], note: 'Two jazzy 7th chords, repeated for minutes.' },
  { style: 'New wave', chords: ['Am', 'F', 'C', 'G'], note: 'The four-chord loop behind countless 80s songs.' },
  { style: 'Post-punk and darkwave', chords: ['Em', 'C', 'D'], note: 'A minor home chord and few changes.' },
  { style: 'Kosmische', chords: ['Am', 'F'], note: 'One or two chords over a held low note (the drone).' },
  { style: 'Shoegaze', chords: ['G', 'Em', 'C', 'D'], note: 'Plain chords: the blur comes from fuzz and reverse reverb, not the harmony.' },
  { style: 'Ambient (Eno)', notes: [65, 69, 72, 76], note: 'Notes, not chords: single notes tapped one at a time into drifting loops.' },
  { style: 'Dark ambient', pairs: [{ label: 'E + F (half step)', notes: [64, 65] }, { label: 'E + B flat (tritone)', notes: [64, 70] }], note: 'Notes that clash on purpose.' },
];

// Two notes together: the gap between them, and its mood.
export const INTERVALS = [
  { name: 'Half step', notes: [64, 65], semitones: 1, mood: 'tense, clashing' },
  { name: 'Whole step', notes: [60, 62], semitones: 2, mood: 'a little restless' },
  { name: 'Minor third', notes: [57, 60], semitones: 3, mood: 'sad, soft' },
  { name: 'Major third', notes: [60, 64], semitones: 4, mood: 'bright, happy' },
  { name: 'Fourth', notes: [60, 65], semitones: 5, mood: 'open, hollow' },
  { name: 'Tritone', notes: [64, 70], semitones: 6, mood: 'unsettled, dark' },
  { name: 'Fifth', notes: [60, 67], semitones: 7, mood: 'open and strong (a power chord)' },
  { name: 'Octave', notes: [60, 72], semitones: 12, mood: 'the same note, higher' },
];
