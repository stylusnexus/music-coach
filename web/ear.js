// Ear lab drills. Each makes one question: what to play, the answer buttons, and
// the right answer. Pure, so they can be tested; the app does the playing.
import { keyPitchClasses, keyChords, spell, voicing } from './music.js';

// Easiest first (the music teacher's order): two choices, then yes/no on
// timing, then more categories, then an open choice from memory.
export const DRILLS = [
  { id: 'major-minor', title: 'Major or minor?', intro: 'A chord plays. Bright and settled, or sad and wistful?' },
  { id: 'change', title: 'Did the chord change?', intro: 'Two chords play, one after the other. Same chord, or did it change?' },
  { id: 'moods', title: 'Two-note moods', intro: 'Two notes play together. What mood is the gap between them?' },
  { id: 'home', title: 'Find home', intro: 'A short chord progression plays in a key. Which note feels like home, where it could stop and rest?' },
];

const MOODS = [
  { semitones: 1, mood: 'Clash' },
  { semitones: 6, mood: 'Clash' },
  { semitones: 3, mood: 'Sad' },
  { semitones: 4, mood: 'Bright' },
  { semitones: 5, mood: 'Open' },
  { semitones: 7, mood: 'Open' },
];

const pick = (rand, list) => list[Math.floor(rand() * list.length)];
const root = (rand) => 55 + Math.floor(rand() * 12); // G3 to F#4, mid-keyboard

// A question: plays is a list of steps, each {notes, at} in seconds from the start.
export function makeQuestion(drillId, rand = Math.random) {
  if (drillId === 'major-minor') {
    const minor = rand() < 0.5;
    const r = root(rand);
    return { plays: [{ notes: [r, r + (minor ? 3 : 4), r + 7], at: 0 }], choices: ['Major', 'Minor'], answer: minor ? 'Minor' : 'Major' };
  }
  if (drillId === 'change') {
    const r = root(rand);
    const first = [r, r + 4, r + 7];
    const changed = rand() < 0.5;
    let second = first;
    if (changed) {
      // Either the mood flips (major to minor) or the whole chord moves.
      second = rand() < 0.5 ? [r, r + 3, r + 7] : first.map((n) => n + pick(rand, [-5, -2, 2, 5]));
    }
    return { plays: [{ notes: first, at: 0 }, { notes: second, at: 1.4 }], choices: ['Changed', 'Same'], answer: changed ? 'Changed' : 'Same' };
  }
  if (drillId === 'moods') {
    const m = pick(rand, MOODS);
    const low = root(rand) - 5;
    return { plays: [{ notes: [low, low + m.semitones], at: 0 }], choices: ['Clash', 'Sad', 'Bright', 'Open'], answer: m.mood };
  }
  if (drillId === 'home') {
    // Major keys only for now; I, IV, V, I says clearly where home is.
    const k = Math.floor(rand() * 12);
    const chords = keyChords(k, 'major');
    const order = [0, 3, 4, 0];
    const plays = order.map((deg, i) => ({ notes: voicing(chords[deg].name), at: i * 1.1 }));
    const inKey = keyPitchClasses(k, 'major');
    // The home note plus three other notes from the key, in keyboard order.
    const others = [inKey[1], inKey[2], inKey[4], inKey[5]].sort(() => rand() - 0.5).slice(0, 3);
    const options = [k, ...others].sort((a, b) => a - b);
    return {
      plays,
      choices: options.map((pc) => spell(pc, k, 'major')),
      choiceNotes: options.map((pc) => 60 + pc),
      answer: spell(k, k, 'major'),
    };
  }
  throw new Error(`Unknown drill: ${drillId}`);
}

// The last few answers as dots: filled for right, hollow for a miss. Old ones
// fade off the end instead of a score dropping to zero.
export function streakDots(history, size = 8) {
  return history.slice(-size).map((ok) => (ok ? '●' : '○')).join('');
}
