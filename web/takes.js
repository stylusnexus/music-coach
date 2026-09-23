// Measure a recorded take. These facts are all the scoring model gets: it cannot
// hear the audio, so anything not measured here must be reported as unassessable.
import { matchesChord } from './music.js';

// raw: {
//   bpm, bars, targetBars,
//   barLog: [{notes, expected}]  what was sounding at each bar line, and the chart chord due there
//   changes: [t]                 seconds from the start when a new chord began
//   presses: [{t, vel}]          every key press
//   stopT                        seconds from the start when Stop was pressed
//   layers: {sound, arp, pattern, bass, drone, drums, drumPattern, kit, fx: {chorus, echo, reverb}}
//   lesson                       lesson title
// }
export function measureTake(raw) {
  const beatSec = 60 / raw.bpm;
  const barSec = beatSec * 4;

  // Chords: bars where a chart chord was due, and whether it was sounding.
  const due = raw.barLog.filter((b) => b.expected);
  const chords = due.length
    ? {
        compared: due.length,
        matched: due.filter((b) => b.notes.length && matchesChord(b.notes, b.expected)).length,
        missed: due.filter((b) => !(b.notes.length && matchesChord(b.notes, b.expected))).map((b) => b.expected),
      }
    : null;

  // Timing: how far each chord change landed from the nearest bar line, in beats.
  // Positive means late. The first change is the take's opening, so it counts too.
  const offsets = raw.changes.map((t) => (t - Math.round(t / barSec) * barSec) / beatSec);
  const timing = offsets.length >= 2
    ? {
        changes: offsets.length,
        withinEighth: offsets.filter((o) => Math.abs(o) <= 0.5).length,
        medianBeats: round(median(offsets), 2),
        worstBeats: round(offsets.reduce((w, o) => (Math.abs(o) > Math.abs(w) ? o : w), 0), 2),
      }
    : null;

  // Feel: how much the key presses varied in strength. Computer keys always send
  // the same strength, so there is nothing to judge.
  const vels = raw.presses.map((p) => p.vel);
  const constant = vels.length > 0 && vels.every((v) => v === vels[0]);
  const feel = vels.length >= 4 && !constant
    ? { presses: vels.length, softest: Math.min(...vels), hardest: Math.max(...vels), range: Math.max(...vels) - Math.min(...vels) }
    : null;

  // Ending: how far past a bar line Stop landed, and how long nothing new was played.
  const lastPress = raw.presses.length ? raw.presses[raw.presses.length - 1].t : 0;
  const stopPastBarBeats = round(((raw.stopT % barSec) + barSec) % barSec / beatSec, 2);
  const ending = {
    bars: raw.bars,
    targetBars: raw.targetBars,
    stopPastBarBeats,
    secondsWithoutNewNotes: round(raw.stopT - lastPress, 1),
  };

  return {
    lesson: raw.lesson,
    bpm: raw.bpm,
    seconds: round(raw.stopT, 1),
    presses: raw.presses.length,
    chords,
    timing,
    feel,
    feelNote: constant ? 'Every press had the same strength (computer keys or a fixed-velocity setting).' : null,
    ending,
    layers: raw.layers,
    expected: raw.expected ?? null,
  };
}

// The fixed rulebook for the scorecard. Scores are rough 1-10 coaching signals.
// An area without a measurement gets null, shown as UNABLE TO ASSESS.
export function scoreAreas(m) {
  const clamp = (x) => Math.max(1, Math.min(10, Math.round(x)));
  const card = {};

  card.chords = m.chords
    ? {
        score: clamp((10 * m.chords.matched) / m.chords.compared),
        evidence: `${m.chords.matched} of ${m.chords.compared} bars had the chart chord sounding${m.chords.missed.length ? `; missed: ${[...new Set(m.chords.missed)].join(', ')}` : ''}.`,
      }
    : { score: null, evidence: 'This lesson has no chord chart.' };

  card.timing = m.timing
    ? {
        score: clamp(1 + (9 * m.timing.withinEighth) / m.timing.changes),
        evidence: `${m.timing.withinEighth} of ${m.timing.changes} chord changes landed within an eighth note of the bar line; the furthest was ${Math.abs(m.timing.worstBeats)} beats ${m.timing.worstBeats > 0 ? 'late' : 'early'}.`,
      }
    : { score: null, evidence: 'Fewer than 2 chord changes to measure.' };

  if (m.feel) {
    const r = m.feel.range;
    card.feel = {
      score: r >= 40 ? 9 : r >= 25 ? 7 : r >= 12 ? 5 : 3,
      evidence: `Key strength ranged from ${m.feel.softest} to ${m.feel.hardest} (of 127) over ${m.feel.presses} presses.`,
    };
  } else {
    card.feel = { score: null, evidence: m.feelNote || 'Too few key presses to judge.' };
  }

  // Setup: compare the settings that define the lesson's sound. Differences are
  // reported, and cost little, because lessons invite trying other settings.
  const e = m.expected || {};
  const l = m.layers || {};
  const checks = [
    ['sound', e.sound, l.sound],
    ['arpeggiator', e.arp, l.arp],
    ['pattern', e.arp ? e.arpPattern : undefined, l.pattern],
    ['bass', e.bass, l.bass],
    ['drone', e.drone, l.drone],
  ].filter(([, want]) => want !== undefined);
  const differ = checks.filter(([, want, got]) => (want ?? false) !== (got ?? false));
  card.sound = {
    score: clamp(10 - 1.5 * differ.length),
    evidence: differ.length
      ? `Differs from the lesson setup in: ${differ.map(([name, want, got]) => `${name} (${got ?? 'off'} instead of ${want})`).join(', ')}.`
      : 'Matches the lesson setup.',
  };

  // Ending: reaching the target length and pressing Stop close to a bar line.
  const past = m.ending.stopPastBarBeats;
  const distance = Math.min(past, 4 - past);
  let ending = 10;
  if (m.ending.bars < m.ending.targetBars) ending -= 3;
  if (distance > 1) ending -= 3;
  else if (distance > 0.5) ending -= 1;
  card.ending = {
    score: clamp(ending),
    evidence: `${m.ending.bars} of ${m.ending.targetBars} target bars; Stop landed ${round(distance, 2)} beats from a bar line.`,
  };
  return card;
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function round(x, places) {
  const f = 10 ** places;
  return Math.round(x * f) / f;
}
