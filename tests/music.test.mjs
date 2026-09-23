import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Latch, arpNote, detectChord, matchesChord, spreadChord, voicing, writeMidi, PPQ,
} from '../web/music.js';
import { LESSONS, SECTIONS, STYLE_INFO, createChecker, firstUnfinished, fitChecks, keyForLesson, lessonPath, lockReason, missingBetterWith, resolveGear, varietyNudge } from '../web/lessons.js';

test('names E minor in any order or octave', () => {
  assert.equal(detectChord([64, 67, 71]).name, 'Em');
  assert.equal(detectChord([71, 64, 79]).name, 'Em');
  assert.equal(detectChord([55, 64, 71]).name, 'Em/G');
  assert.ok(matchesChord([67, 76, 83], 'Em'));
});

test('names Cmaj7 and Em7; nothing for a single note', () => {
  assert.equal(detectChord([60, 64, 67, 71]).name, 'Cmaj7');
  assert.equal(detectChord([64, 67, 71, 74]).name, 'Em7');
  assert.equal(detectChord([60]), null);
  assert.ok(!matchesChord([64, 67, 71], 'Em7'));
});

test('suggested hand positions stay mid-keyboard', () => {
  for (const c of ['Em', 'C', 'G', 'D', 'Cmaj7', 'Em7', 'F#m']) {
    const v = voicing(c);
    assert.ok(v[0] >= 55 && v[0] <= 66, `${c} root ${v[0]}`);
    assert.ok(matchesChord(v, c));
  }
});

test('arpeggiator is silent with no keys and picks through the chord', () => {
  assert.equal(arpNote('picking', [], 0), null);
  const strings = spreadChord([64, 67, 71]);
  assert.deepEqual(strings, [40, 52, 55, 59, 64, 67]); // guitar range: low E up
  assert.equal(arpNote('picking', [64, 67, 71], 0), 40); // bass on the beat
  assert.deepEqual(spreadChord([60, 64, 67]), [48, 60, 64, 67, 72, 76]);
  const bar = Array.from({ length: 16 }, (_, i) => arpNote('picking', [64, 67, 71], i));
  assert.ok(bar.every((n) => strings.includes(n)));
});

test('latch keeps the chord after release; a fresh press replaces it', () => {
  const l = new Latch();
  [64, 67, 71].forEach((n) => l.press(n));
  [64, 67, 71].forEach((n) => l.release(n));
  assert.deepEqual(l.notes(true), [64, 67, 71]);
  assert.deepEqual(l.notes(false), []);
  l.press(60);
  assert.deepEqual(l.notes(true), [60]);
});

test('MIDI file has a valid header, tempo and every note', () => {
  const bytes = writeMidi(
    [{ name: 'Guitar', channel: 0, events: [{ tick: 0, note: 64, vel: 90, dur: 120 }, { tick: 120, note: 67, vel: 80, dur: 120 }] },
      { name: 'Drums', channel: 9, events: [{ tick: 0, note: 36, vel: 100, dur: 1 }] }],
    100,
  );
  const text = String.fromCharCode(...bytes.slice(0, 4));
  assert.equal(text, 'MThd');
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint16(8), 1); // format 1
  assert.equal(view.getUint16(10), 3); // conductor + 2 tracks
  assert.equal(view.getUint16(12), PPQ);
  // tempo 600000 µs per beat = 100 BPM
  const s = [...bytes];
  const i = s.findIndex((b, k) => b === 0xff && s[k + 1] === 0x51);
  assert.equal((s[i + 3] << 16) | (s[i + 4] << 8) | s[i + 5], 600000);
  const noteOns = s.filter((b, k) => (b & 0xf0) === 0x90 && s[k + 2] > 0 && k > 22).length;
  assert.ok(noteOns >= 3);
});

test('plugin names fall back to GarageBand built-ins when missing', () => {
  const owned = ['Triad Chorus v6', 'Space Delay v6'];
  assert.equal(resolveGear('{chorus}, {echo}, {reverb}', owned), "Triad Chorus, Space Delay, GarageBand's ChromaVerb");
  assert.equal(resolveGear('{unknown}', owned), '{unknown}');
});

const byId = (id) => LESSONS.find((l) => l.id === id);

// Everything Eve's Mac has, as the app reports it.
const EVE = {
  installed: ['Triad Chorus v6', 'Tape Echo v6', 'CSR Plate v6', 'VG-SPARKLE2', 'AmpliTube 5'],
  sounds: ['guitar', 'moog-bass', 'vp330-strings', 'farfisa'],
  kits: ['cr78', 'minipops'],
  loopGroups: ['Minipops drum loops', 'VP-330 string loops', 'Tape fragments'],
  folder: '~/Music/Samples',
  tags: {},
  durutti: true,
};
const ORIGINAL = {
  'to-garageband': ['Plug-ins → Audio Units → IK Multimedia: add Triad Chorus, then Tape Echo, then CSR Plate.', 'Bonus: add a new Software Instrument track with VG-SPARKLE2 and hold the same chords. It plays real recorded guitar.'],
  kosmische: ['The sound is a real Minimoog. Tap A minor (A C E): a repeating pattern starts. That is a sequence.', 'Switch Drone on. VP-330 strings hold a low A underneath.', 'In GarageBand, drag a file from ~/Music/Samples/Vintage Synths/VP330 From Mars/SVC350 Loops/01. WAV onto an empty track for an instant string bed.'],
  sampling: ['The sound is "Sampler". Pick a loop from the list. "Can Ballad" in the Minipops drum loops is a good start. The tempo changes to match it.', 'In GarageBand: drag the same WAV from ~/Music/Samples onto a track, click where you want to cut, and press Cmd+T to split it there. Drag the pieces into a new order.'],
};

test('with all of Eve\'s gear, lessons read as they always did', () => {
  for (const [id, lines] of Object.entries(ORIGINAL)) {
    const l = byId(id);
    const text = l.steps.map((s) => resolveGear(typeof s === 'string' ? s : s.text, EVE));
    for (const line of lines) assert.ok(text.includes(line), `${id}: ${line}`);
  }
  // No microphone added and loops present: no mic step.
  assert.ok(!byId('sampling').steps.map((s) => resolveGear(s, EVE)).some((t) => t.includes('Record your own')));
});

test('on a bare Mac, lessons claim no sound, folder or plugin it lacks', () => {
  const all = LESSONS.flatMap((l) => [l.why, ...l.steps.map((s) => (typeof s === 'string' ? s : s.text)), ...l.checks.map((c) => c.label || '')]);
  const text = all.map((t) => resolveGear(t, [])).join('\n');
  for (const claim of ['Durutti', 'Vini Reilly', 'real Minimoog', 'VP-330', 'CR-78', 'Farfisa organ,', 'Minipops', 'IK Multimedia', '~/Music/Samples', 'VG-SPARKLE2', '{']) {
    assert.ok(!text.includes(claim), claim);
  }
  assert.ok(text.includes('Record your own'), 'no loops: the mic step shows');
});

test('gear added by hand names the job, and a missing kit is not required', () => {
  assert.equal(resolveGear('{chorus}', { tags: { chorus: 'Boss CE-2' } }), 'your Boss CE-2');
  assert.ok(resolveGear('{micStep}', { tags: { microphone: 'Microphone' }, loopGroups: ['x'] }).includes('with your microphone and'));
  const beat = byId('build-a-beat');
  assert.ok(beat.checks.some((c) => c.kit === 'minipops'));
  assert.ok(!fitChecks(beat, []).checks.some((c) => c.kit));
  assert.equal(fitChecks(beat, EVE), beat);
});

test('lesson 1 ticks after 8 notes and each effect off then on', () => {
  const c = createChecker(byId('hear-the-sound'));
  for (let i = 0; i < 8; i++) c.handle({ type: 'noteOn', note: 60 });
  c.handle({ type: 'fx', which: 'echo', enabled: true }); // on without off first does not count
  for (const which of ['echo', 'chorus']) {
    c.handle({ type: 'fx', which, enabled: false });
    c.handle({ type: 'fx', which, enabled: true });
  }
  assert.ok(!c.complete());
  c.handle({ type: 'fx', which: 'reverb', enabled: false });
  c.handle({ type: 'fx', which: 'reverb', enabled: true });
  assert.ok(c.complete());
});

test('chord and arpeggio-bar checks tick only for the right chord', () => {
  const c = createChecker(byId('arpeggiator'));
  c.handle({ type: 'arpBar', notes: [60, 64, 67] });
  c.handle({ type: 'arpBar', notes: [64, 67, 71] });
  assert.ok(!c.complete());
  c.handle({ type: 'arpBar', notes: [64, 67, 71] });
  assert.ok(c.complete());
});

test('recording checks need 8 bars and a save; progress survives reload', () => {
  const lesson = byId('record-sketch');
  const c = createChecker(lesson);
  c.handle({ type: 'recorded', bars: 4 });
  assert.equal(c.progress()[0].done, false);
  c.handle({ type: 'recorded', bars: 8 });
  const restored = createChecker(lesson, c.values());
  assert.equal(restored.progress()[0].done, true);
  restored.handle({ type: 'saved' });
  assert.ok(restored.complete());
});

test('every lesson chord and target is a known chord', () => {
  for (const l of LESSONS) {
    for (const name of [...(l.targets || []), ...(l.chart || []), ...l.checks.map((c) => c.chord).filter(Boolean)]) {
      assert.doesNotThrow(() => voicing(name), `${l.id}: ${name}`);
    }
  }
});

test('chord patterns play the whole chord on their beats only', async () => {
  const { arpNotes } = await import('../web/music.js');
  assert.deepEqual(arpNotes('offbeat', [67, 60, 64], 2), [60, 64, 67]);
  assert.deepEqual(arpNotes('offbeat', [60, 64, 67], 0), []);
  assert.equal(arpNotes('eighths', [60, 64, 67], 4).length, 3);
  assert.equal(arpNotes('sequence', [57, 60, 64], 0).length, 1);
  assert.deepEqual(arpNotes('sequence', [], 0), []);
});

test('kosmische sequence keeps returning to the low pedal note', async () => {
  const { arpNotes, spreadChord } = await import('../web/music.js');
  const low = spreadChord([57, 60, 64])[0];
  const bar = Array.from({ length: 16 }, (_, i) => arpNotes('sequence', [57, 60, 64], i)[0]);
  assert.equal(bar.filter((n) => n === low).length, 8);
});

test('kosmische checks: drone bars and a filter that closes then opens', () => {
  const c = createChecker(byId('kosmische'));
  const am = [57, 60, 64];
  c.handle({ type: 'filter', value: 0.9 }); // opening before closing does not count
  for (let i = 0; i < 4; i++) c.handle({ type: 'arpBar', notes: am, drone: true });
  c.handle({ type: 'filter', value: 0.2 });
  c.handle({ type: 'filter', value: 0.5 });
  assert.ok(!c.progress()[2].done);
  c.handle({ type: 'filter', value: 0.95 });
  for (let i = 0; i < 2; i++) c.handle({ type: 'arpBar', notes: [53, 57, 60], drone: true });
  assert.ok(c.complete());
});

test('Stereolab checks need the offbeat pattern and the bossa beat', () => {
  const c = createChecker(byId('stereolab'));
  const cmaj7 = [60, 64, 67, 71];
  const fmaj7 = [53, 57, 60, 64];
  for (let i = 0; i < 2; i++) c.handle({ type: 'arpBar', notes: cmaj7, pattern: 'eighths', drums: true, drumPattern: 'motorik' });
  for (let i = 0; i < 2; i++) c.handle({ type: 'arpBar', notes: fmaj7, pattern: 'eighths', drums: true, drumPattern: 'motorik' });
  assert.ok(!c.complete());
  for (let i = 0; i < 2; i++) c.handle({ type: 'arpBar', notes: cmaj7, pattern: 'offbeat', drums: true, drumPattern: 'bossa' });
  assert.ok(c.complete());
});

test('sampler: white keys from middle C play slices in order, black keys none', async () => {
  const { sliceForNote, tempoFromName } = await import('../web/music.js');
  assert.deepEqual([60, 62, 64, 65, 67, 69, 71, 72].map((n) => sliceForNote(n, 8)), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(sliceForNote(61, 8), null);
  assert.equal(sliceForNote(59, 8), 7); // wraps below middle C
  assert.equal(tempoFromName('Can Ballad B Minipops 95.wav'), 95);
  assert.equal(tempoFromName('Loops_01_SVC350_C.wav'), null);
});

test('beat checks: kick and snare boxes, hat count, bars per kit', () => {
  const c = createChecker(byId('build-a-beat'));
  c.handle({ type: 'grid', grid: { kick: [0], snare: [4, 12], hat: [0, 2, 4] } });
  assert.equal(c.progress()[0].done, false);
  c.handle({ type: 'grid', grid: { kick: [0, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] } });
  assert.ok(c.progress()[0].done && c.progress()[1].done && c.progress()[2].done);
  for (let i = 0; i < 4; i++) c.handle({ type: 'bar', drums: true, drumPattern: 'my beat', kit: 'cr78' });
  assert.ok(!c.complete());
  for (let i = 0; i < 2; i++) c.handle({ type: 'bar', drums: true, drumPattern: 'my beat', kit: 'minipops' });
  assert.ok(c.complete());
});

test('sampling checks: 6 different slices and a reversed one', () => {
  const lesson = byId('sampling');
  const c = createChecker(lesson);
  c.handle({ type: 'loop' });
  for (let i = 0; i < 24; i++) c.handle({ type: 'slice', index: i % 3, reverse: false });
  assert.equal(c.progress()[1].current, 3);
  for (const index of [3, 4, 5]) c.handle({ type: 'slice', index, reverse: false });
  const restored = createChecker(lesson, c.values());
  assert.ok(restored.progress()[1].done);
  restored.handle({ type: 'slice', index: 0, reverse: true });
  assert.ok(restored.complete());
});

test('gear: groups by kind and family, hides T-RackS 5 copies, searches all words', async () => {
  const { groupPlugins, searchGear } = await import('../web/gear.js');
  const groups = groupPlugins([
    { name: 'CSR Plate v6', maker: 'IK Multimedia', kind: 'effect' },
    { name: 'TR5 CSR Plate', maker: 'IK Multimedia', kind: 'effect' },
    { name: 'Tape Echo v6', maker: 'IK Multimedia', kind: 'effect' },
    { name: 'VG-SPARKLE2', maker: 'UJAM', kind: 'instrument' },
  ]);
  assert.deepEqual(groups.map((g) => g.title), [
    'Players: hold a chord, it plays', 'Reverbs', 'Echoes and delays', 'Older duplicates (T-RackS 5)',
  ]);
  // Older copies stay out of topic searches but are found by name.
  assert.deepEqual(searchGear(groups, 'reverb').flatMap((g) => g.items.map((i) => i.name)), ['CSR Plate v6']);
  assert.deepEqual(searchGear(groups, 'tr5').flatMap((g) => g.items.map((i) => i.name)), ['TR5 CSR Plate']);
  assert.deepEqual(searchGear(groups, 'guitar ujam').flatMap((g) => g.items.map((i) => i.name)), ['VG-SPARKLE2']);
  assert.equal(searchGear(groups, 'zzz').length, 0);
});

test('new-wave bass pumps the root on eighths, jumping an octave on the offbeat', async () => {
  const { bassNote } = await import('../web/music.js');
  const am = [57, 60, 64];
  const bar = Array.from({ length: 8 }, (_, i) => bassNote(am, i));
  assert.deepEqual(bar, [33, null, 45, null, 33, null, 45, null]);
  assert.equal(bassNote([], 0), null);
});

test('eno loops: each note on its own cycle, so they drift apart', async () => {
  const { arpNotes, ENO_PERIODS } = await import('../web/music.js');
  const held = [65, 69, 72, 76];
  const hitsFor = (note) => Array.from({ length: 400 }, (_, s) => s).filter((s) => arpNotes('eno', held, s).includes(note));
  const first = hitsFor(65);
  const second = hitsFor(69);
  assert.equal(first[1] - first[0], ENO_PERIODS[0]);
  assert.equal(second[1] - second[0], ENO_PERIODS[1]);
  assert.notDeepEqual(first.slice(0, 3), second.slice(0, 3));
});

test('eno latch: taps add notes, a second tap removes one', () => {
  const l = new Latch();
  for (const n of [65, 69, 72]) { l.press(n, true); l.release(n); }
  assert.deepEqual(l.notes(true), [65, 69, 72]);
  l.press(69, true);
  assert.deepEqual(l.notes(true), [65, 72]);
});

test('new wave and Eno checks', () => {
  const nw = createChecker(byId('new-wave'));
  for (let i = 0; i < 4; i++) nw.handle({ type: 'arpBar', notes: [57, 60, 64], bass: true, drums: true, drumPattern: 'new wave' });
  nw.handle({ type: 'arpBar', notes: [53, 57, 60], bass: true });
  nw.handle({ type: 'arpBar', notes: [55, 59, 62], bass: true });
  assert.ok(nw.complete());
  const eno = createChecker(byId('ambient-eno'));
  for (let i = 0; i < 8; i++) eno.handle({ type: 'arpBar', notes: [65, 69, 72, 76], pattern: 'eno', sound: 'vp330-strings' });
  assert.equal(eno.progress()[1].done, false);
  for (let i = 0; i < 2; i++) eno.handle({ type: 'arpBar', notes: [62, 65, 69, 72, 76], pattern: 'eno', sound: 'epiano' });
  assert.ok(eno.complete());
});

test('take measurements: chart matches, change timing, feel and ending', async () => {
  const { measureTake } = await import('../web/takes.js');
  const bar = 2.4; // 100 BPM: one bar is 2.4 s, one beat 0.6 s
  const m = measureTake({
    lesson: 'Change chords with the count', bpm: 100, bars: 4, targetBars: 8,
    barLog: [
      { notes: [64, 67, 71], expected: 'Em' },
      { notes: [64, 67, 71], expected: 'Em' },
      { notes: [64, 67, 71], expected: 'C' }, // late change: still on Em
      { notes: [60, 64, 67], expected: 'C' },
    ],
    changes: [0.05, 2 * bar + 0.9], // on time, then 1.5 beats late
    presses: [{ t: 0.05, vel: 70 }, { t: 0.06, vel: 90 }, { t: 0.07, vel: 100 }, { t: 2 * bar + 0.9, vel: 60 }],
    stopT: 4 * bar + 0.3,
    layers: { sound: 'guitar' },
  });
  assert.deepEqual(m.chords, { compared: 4, matched: 3, missed: ['C'] });
  assert.equal(m.timing.changes, 2);
  assert.equal(m.timing.withinEighth, 1);
  assert.equal(m.timing.worstBeats, 1.5);
  assert.deepEqual(m.feel, { presses: 4, softest: 60, hardest: 100, range: 40 });
  assert.equal(m.ending.stopPastBarBeats, 0.5);
});

test('take measurements say what cannot be judged', async () => {
  const { measureTake } = await import('../web/takes.js');
  const m = measureTake({
    lesson: 'x', bpm: 120, bars: 2, targetBars: 8, barLog: [{ notes: [60], expected: null }],
    changes: [0], presses: [{ t: 0, vel: 90 }, { t: 1, vel: 90 }, { t: 2, vel: 90 }, { t: 3, vel: 90 }], stopT: 4, layers: {},
  });
  assert.equal(m.chords, null); // no chart
  assert.equal(m.timing, null); // one change only
  assert.equal(m.feel, null); // computer keys: constant strength
  assert.match(m.feelNote, /same strength/);
});

test('rulebook scorecard: numbers from measurements, UNABLE TO ASSESS without them', async () => {
  const { scoreAreas } = await import('../web/takes.js');
  const card = scoreAreas({
    chords: { compared: 8, matched: 6, missed: ['C', 'D'] },
    timing: { changes: 4, withinEighth: 2, medianBeats: 0.8, worstBeats: 1.83 },
    feel: null, feelNote: 'Every press had the same strength.',
    ending: { bars: 8, targetBars: 8, stopPastBarBeats: 3.8 },
    layers: { sound: 'epiano', arp: true, pattern: 'picking' },
    expected: { sound: 'guitar', arp: true, arpPattern: 'picking' },
  });
  assert.equal(card.chords.score, 8);
  assert.match(card.chords.evidence, /missed: C, D/);
  assert.equal(card.timing.score, 6);
  assert.equal(card.feel.score, null);
  assert.equal(card.sound.score, 9); // one difference: sound
  assert.match(card.sound.evidence, /sound \(epiano instead of guitar\)/);
  assert.equal(card.ending.score, 10); // stopped 0.2 beats before a bar line
});

test('post-punk melodic bass plays chord tones high; intervals are detected', async () => {
  const { bassNote, hasInterval } = await import('../web/music.js');
  const em = [64, 67, 71];
  const line = Array.from({ length: 16 }, (_, s) => bassNote(em, s, 'melodic')).filter((n) => n !== null);
  assert.equal(line.length, 8);
  assert.ok(line.every((n) => n >= 52 && n <= 64)); // an octave above the pumped root
  assert.ok(new Set(line).size >= 3); // a tune, not one note
  assert.ok(hasInterval([64, 65], 1));
  assert.ok(hasInterval([52, 70], 6)); // E and B flat, different octaves
  assert.ok(!hasInterval([64, 67, 71], 6));
});

test('dark ambient and post-punk checks', () => {
  const dark = createChecker(byId('dark-ambient'));
  dark.handle({ type: 'arpBar', pattern: 'eno', notes: [64, 67] });
  for (let i = 0; i < 2; i++) dark.handle({ type: 'arpBar', pattern: 'eno', notes: [64, 65], drone: true });
  for (let i = 0; i < 2; i++) dark.handle({ type: 'arpBar', pattern: 'eno', notes: [64, 65, 70], drone: true });
  dark.handle({ type: 'filter', value: 0.1 });
  dark.handle({ type: 'filter', value: 0.9 });
  for (let i = 0; i < 4; i++) dark.handle({ type: 'slice', index: i, halfSpeed: i > 0 });
  assert.equal(dark.progress()[4].current, 3); // only half-speed slices count
  dark.handle({ type: 'slice', index: 5, halfSpeed: true });
  assert.ok(dark.complete());
  const pp = createChecker(byId('post-punk'));
  for (let i = 0; i < 4; i++) pp.handle({ type: 'arpBar', notes: [62, 66, 69], bass: true, bassStyle: 'melodic', drums: true, drumPattern: 'tribal' });
  for (let i = 0; i < 2; i++) pp.handle({ type: 'arpBar', notes: [64, 67, 71], sound: 'vp330-strings' });
  assert.ok(pp.complete());
});

test('shoegaze checks need the effects actually on', () => {
  const c = createChecker(byId('shoegaze'));
  const g = [55, 59, 62];
  const wall = { fuzz: true, chorus: true, echo: true, reverb: true, reverse: true };
  for (let i = 0; i < 4; i++) c.handle({ type: 'arpBar', notes: g, fx: { ...wall, reverse: false } });
  assert.equal(c.progress()[0].current, 0); // reverse reverb was off
  for (let i = 0; i < 4; i++) c.handle({ type: 'arpBar', notes: g, fx: wall });
  c.handle({ type: 'arpBar', notes: [60, 64, 67], fx: wall });
  for (let i = 0; i < 2; i++) c.handle({ type: 'arpBar', notes: g, sound: 'vp330-strings', fx: wall });
  assert.ok(c.complete());
});

test('reverse reverb names the IK plugin when installed', () => {
  assert.equal(resolveGear('{reverse}', ['CSR Inverse v6']), 'CSR Inverse');
  assert.equal(resolveGear('{reverse}', []), 'a reverse reverb plugin');
});

test('lesson order: basics, then quick wins, then styles; every lesson placed once', () => {
  assert.equal(LESSONS.length, 37);
  assert.ok(LESSONS.every(Boolean));
  assert.equal(new Set(LESSONS.map((l) => l.id)).size, 37);
  assert.equal(lockReason('looping', {}), null); // a quick win: always open
  assert.deepEqual(SECTIONS.map((s) => s.title), ['Basics', 'Quick wins', 'GarageBand skills', 'Styles']);
  assert.equal(LESSONS[3].id, 'major-minor'); // right after the four chords
  // Lesson text names other lessons by title, never by number.
  assert.ok(LESSONS.every((l) => !JSON.stringify(l.steps).match(/lesson \d/i)));
});

test('locks: styles wait for the basics, dark ambient also waits for sampling', () => {
  const none = {};
  assert.equal(lockReason('first-chord', none), null);
  assert.equal(lockReason('sampling', none), null); // quick wins are always open
  assert.match(lockReason('shoegaze', none), /Finish the Basics first/);
  const basics = Object.fromEntries(SECTIONS[0].ids.map((id) => [id, 'done']));
  assert.equal(lockReason('shoegaze', basics), null);
  assert.match(lockReason('dark-ambient', basics), /Sampling: cut up a loop first/);
  assert.equal(lockReason('dark-ambient', { ...basics, sampling: 'done' }), null);
});

test('the app starts on the first unfinished open lesson', () => {
  assert.equal(firstUnfinished({}).id, 'hear-the-sound');
  assert.equal(firstUnfinished({ 'hear-the-sound': 'done' }).id, 'first-chord');
  const basics = Object.fromEntries(SECTIONS[0].ids.map((id) => [id, 'done']));
  assert.equal(firstUnfinished(basics).id, 'build-a-beat');
});

test('looper: records 2 bars, then repeats; layers stack; undo removes the last', async () => {
  const { Looper } = await import('../web/looper.js');
  const sps = 0.15; // seconds per sixteenth
  const L = new Looper();
  const at = (step) => step * sps;
  assert.equal(L.press(), 'armed');
  L.tick(5, at(5), sps); // mid-bar: waits for the bar line
  assert.equal(L.status, 'armed');
  L.tick(16, at(16), sps);
  assert.equal(L.status, 'recording');
  L.noteOn(60, 90, 'guitar', at(16) + 0.02, sps); // a touch late: snaps to step 0
  L.noteOff(60, at(20), sps);
  L.addAt(24, 64, 80, 3, 'moog-bass'); // an arpeggiator note at step 8
  for (let s = 17; s < 48; s++) L.tick(s, at(s), sps);
  const first = L.tick(48, at(48), sps); // loop closes after 2 bars and plays at once
  assert.equal(first.finished, true);
  assert.equal(L.status, 'playing');
  assert.deepEqual(first.events.map((e) => [e.note, e.dur, e.sound]), [[60, 4, 'guitar']]);
  assert.deepEqual(L.tick(56, at(56), sps).events.map((e) => e.note), [64]);

  assert.equal(L.press(), 'overdubArmed');
  for (let s = 57; s < 80; s++) L.tick(s, at(s), sps);
  L.tick(80, at(80), sps);
  assert.equal(L.status, 'overdubbing');
  L.noteOn(67, 70, 'vp330-strings', at(84), sps); // held past the loop end: closed at the boundary
  for (let s = 81; s < 112; s++) L.tick(s, at(s), sps);
  assert.equal(L.tick(112, at(112), sps).finished, true);
  assert.equal(L.layers.length, 2);
  assert.equal(L.layers[1].events[0].dur, 28);

  assert.equal(L.undo(), 1);
  L.pause();
  assert.equal(L.status, 'paused');
  assert.equal(L.press(), 'resumeArmed');
  L.tick(120, at(120), sps); // mid-bar: still waiting
  assert.equal(L.status, 'resumeArmed');
  L.tick(128, at(128), sps);
  assert.equal(L.status, 'playing'); // resumes on the next bar line
});

test('looper: an empty first pass keeps nothing', async () => {
  const { Looper } = await import('../web/looper.js');
  const L = new Looper();
  L.press();
  for (let s = 0; s <= 32; s++) L.tick(s, s * 0.1, 0.1);
  assert.equal(L.status, 'empty');
  assert.equal(L.layers.length, 0);
});

test('looping checks: layers, undo, and bars with 2+ layers', () => {
  const c = createChecker(byId('looping'));
  c.handle({ type: 'loopLayer', layers: 1 });
  assert.ok(c.progress()[0].done);
  c.handle({ type: 'loopLayer', layers: 2 });
  for (let i = 0; i < 4; i++) c.handle({ type: 'loopBar', layers: 1 });
  assert.equal(c.progress()[3].current, 0); // one layer does not count
  for (let i = 0; i < 4; i++) c.handle({ type: 'loopBar', layers: 2 });
  c.handle({ type: 'loopLayer', layers: 3 });
  c.handle({ type: 'loopUndo' });
  assert.ok(c.complete());
});

test('GarageBand skills unlock after Take it to GarageBand; every guided step has a check', () => {
  assert.match(lockReason('gb-map', {}), /Finish Take it to GarageBand first/);
  assert.equal(lockReason('gb-map', { 'to-garageband': 'done' }), null);
  for (const l of LESSONS.filter((x) => x.guided)) {
    assert.equal(l.checks.length, l.steps.length, l.id);
    for (const st of l.steps) if (st.image) assert.match(st.image, /^img\/gb\/.+\.jpg$/);
  }
});

test('blending checks: solo then unsolo, pan apart, drums under the guitar', () => {
  const c = createChecker(byId('gb-blend'));
  const mix = (over) => ({ type: 'mix', volumes: { drums: 1, bass: 1, instrument: 1, drone: 1 }, pans: { drums: 0, bass: 0, instrument: 0, drone: 0 }, soloed: [], ...over });
  c.handle({ type: 'held', notes: [64, 67, 71] });
  c.handle(mix({})); // unsolo before any solo does not count
  assert.equal(c.progress()[1].done, false);
  c.handle(mix({ soloed: ['bass'] }));
  c.handle(mix({}));
  c.handle(mix({ pans: { drums: 0, bass: 0, instrument: -0.5, drone: 0.5 } }));
  c.handle(mix({ volumes: { drums: 0.7, bass: 1, instrument: 1, drone: 1 } }));
  assert.deepEqual(c.progress().slice(0, 4).map((p) => p.done), [true, true, true, true]);
  c.handle({ type: 'manual', index: 4 });
  c.handle({ type: 'manual', index: 5 });
  assert.ok(c.complete());
});

test('major and minor lesson; chord explorer chords parse and intervals are right', async () => {
  const { STYLE_CHORDS, INTERVALS, MAJOR_MINOR } = await import('../web/chords.js');
  const c = createChecker(byId('major-minor'));
  for (const notes of [[60, 64, 67], [60, 63, 67], [55, 58, 62], [64, 68, 71]]) c.handle({ type: 'held', notes });
  assert.ok(c.complete());
  for (const name of [...MAJOR_MINOR.chords, ...STYLE_CHORDS.flatMap((s) => s.chords || [])]) assert.doesNotThrow(() => voicing(name), name);
  for (const iv of INTERVALS) assert.equal(iv.notes[1] - iv.notes[0], iv.semitones, iv.name);
});

test('latch: sliding one finger swaps the note; letting go keeps the chord', () => {
  const l = new Latch();
  [60, 64, 67].forEach((n) => l.press(n));
  l.release(64); // E up while C and G are still held
  l.press(63); // E flat down
  assert.deepEqual([...l.notes(true)].sort((a, b) => a - b), [60, 63, 67]);
  [60, 63, 67].forEach((n) => l.release(n));
  assert.deepEqual([...l.notes(true)].sort((a, b) => a - b), [60, 63, 67]);
});

test('keys: C minor notes, spelling and chords; A minor up 3 keys is C minor', async () => {
  const { keyPitchClasses, keyChords, keyName, spell, inKey } = await import('../web/music.js');
  assert.deepEqual(keyPitchClasses(0, 'minor'), [0, 2, 3, 5, 7, 8, 10]);
  assert.equal(keyName(0, 'minor'), 'C minor');
  assert.deepEqual(keyPitchClasses(0, 'minor').map((pc) => spell(pc, 0, 'minor')), ['C', 'D', 'E♭', 'F', 'G', 'A♭', 'B♭']);
  assert.deepEqual(keyChords(0, 'minor').map((c) => c.label), ['Cm', 'Ddim', 'E♭', 'Fm', 'Gm', 'A♭', 'B♭']);
  assert.deepEqual(keyChords(7, 'major').map((c) => c.label), ['G', 'Am', 'Bm', 'C', 'D', 'Em', 'F♯dim']);
  assert.deepEqual(keyPitchClasses(9, 'minor').map((pc) => (pc + 3) % 12), keyPitchClasses(0, 'minor'));
  assert.ok(inKey(63, 0, 'minor')); // E flat
  assert.ok(!inKey(64, 0, 'minor')); // E natural is outside C minor
  for (const c of keyChords(0, 'minor')) assert.doesNotThrow(() => voicing(c.name));
});

test('scale lock snaps to the nearest note in the key', async () => {
  const { snapToKey } = await import('../web/music.js');
  assert.equal(snapToKey(64, 0, 'minor'), 63); // E becomes E flat in C minor
  assert.equal(snapToKey(63, 0, 'minor'), 63); // already in the key
  assert.equal(snapToKey(66, 0, 'major'), 65); // F sharp: tie between F and G goes down
});

test('ear drills: every question has its answer among the choices', async () => {
  const { DRILLS, makeQuestion, streakDots } = await import('../web/ear.js');
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  assert.deepEqual(DRILLS.map((d) => d.id), ['major-minor', 'change', 'moods', 'home']);
  const seen = {};
  for (const d of DRILLS) {
    for (let i = 0; i < 200; i++) {
      const q = makeQuestion(d.id, rand);
      assert.ok(q.choices.includes(q.answer), `${d.id}: ${q.answer}`);
      assert.ok(q.plays.length >= 1 && q.plays.every((p) => p.notes.length >= 2));
      (seen[d.id] ||= new Set()).add(q.answer);
    }
  }
  assert.equal(seen['major-minor'].size, 2);
  assert.equal(seen.change.size, 2);
  assert.equal(seen.moods.size, 4);
  const q = makeQuestion('home', rand);
  assert.equal(q.choices.length, 4);
  assert.equal(new Set(q.choices).size, 4);
  assert.equal(streakDots([true, false, true, true]), '●○●●');
  assert.equal(streakDots(Array(12).fill(true)).length, 8);
});

test('find home: the answer is the key the progression starts and ends on', async () => {
  const { makeQuestion } = await import('../web/ear.js');
  const { detectChord } = await import('../web/music.js');
  const q = makeQuestion('home', () => 0.42);
  const first = detectChord(q.plays[0].notes).name.replace('#', '♯');
  const last = detectChord(q.plays[3].notes).name.replace('#', '♯');
  assert.equal(first, last);
  assert.ok(first.startsWith(q.answer[0]));
});

test('circle of fifths: neighbours share 6 of 7 notes, the far side shares 2', async () => {
  const { neighbours, compareKeys, friendlyChords, spell } = await import('../web/music.js');
  assert.deepEqual(neighbours(0), { left: 5, right: 7, across: 6 }); // C: F, G, F sharp
  const cg = compareKeys(0, 7);
  assert.equal(cg.shared.length, 6);
  assert.deepEqual([spell(cg.onlyA[0], 0, 'major'), spell(cg.onlyB[0], 7, 'major')], ['F', 'F♯']);
  const cf = compareKeys(0, 5);
  assert.deepEqual([spell(cf.onlyA[0], 0, 'major'), spell(cf.onlyB[0], 5, 'major')], ['B', 'B♭']);
  assert.equal(compareKeys(0, 6).shared.length, 2);
  assert.deepEqual(friendlyChords(0).map((c) => c.label), ['C', 'Dm', 'Em', 'F', 'G', 'Am']);
});

test('lesson keys follow the chart\'s home chord (the music teacher\'s corrections)', async () => {
  const { lessonKey, keyName } = await import('../web/music.js');
  const k = (id) => { const x = lessonKey(byId(id).chart); return x && keyName(x.root, x.mode); };
  assert.equal(k('kosmische'), 'A minor');
  assert.equal(k('post-punk'), 'E minor');
  assert.equal(k('stereolab'), 'C major');
  assert.equal(k('follow-the-chart'), 'E minor');
  assert.equal(k('shoegaze'), 'G major');
  assert.equal(lessonKey(byId('dark-ambient').chart), null); // no chords, no wheel
});

test('minor circle and the two demos', async () => {
  const { circleSpot, keyAtSpot, wheelDemo } = await import('../web/music.js');
  assert.equal(circleSpot(9, 'minor'), circleSpot(0, 'major')); // A minor sits with C major
  assert.equal(keyAtSpot(circleSpot(9, 'minor') + 1, 'minor'), 4); // next to A minor: E minor
  assert.deepEqual(wheelDemo(0, 'major', 'step'), ['C', 'G', 'G']);
  assert.deepEqual(wheelDemo(0, 'major', 'jump'), ['C', 'F#']);
  assert.deepEqual(wheelDemo(9, 'minor', 'step'), ['Am', 'Em', 'Em']);
  for (const names of [wheelDemo(9, 'minor', 'jump'), wheelDemo(7, 'major', 'step')]) {
    for (const n of names) assert.doesNotThrow(() => voicing(n), n);
  }
});

test('each lesson sets the Key bar to its key, or Off when its notes leave the key', async () => {
  const { keyName } = await import('../web/music.js');
  const k = (id) => { const x = keyForLesson(byId(id)); return x ? keyName(x.root, x.mode) : 'Off'; };
  assert.equal(k('first-chord'), 'E minor');
  assert.equal(k('four-chords'), 'E minor'); // D's F sharp is in E minor
  assert.equal(k('melody'), 'E minor');
  assert.equal(k('stereolab'), 'C major');
  assert.equal(k('kosmische'), 'A minor');
  assert.equal(k('major-minor'), 'Off'); // C minor's E flat is outside C major
  assert.equal(k('dark-ambient'), 'Off'); // clashes on purpose
  assert.equal(k('hear-the-sound'), 'Off');
  // Whatever key a lesson gets, every chord it asks for is inside it.
  for (const l of LESSONS) {
    const key = keyForLesson(l);
    if (!key) continue;
    const { keyPitchClasses } = await import('../web/music.js');
    const inKey = new Set(keyPitchClasses(key.root, key.mode));
    for (const c of [...(l.chart || []), ...(l.targets || [])]) {
      const { chordPitchClasses } = await import('../web/music.js');
      assert.ok(chordPitchClasses(c).every((pc) => inKey.has(pc)), `${l.id}: ${c}`);
    }
  }
});

test('every style has a card, and the picker nudges toward variety', () => {
  const styles = SECTIONS.find((s) => s.title === 'Styles').ids;
  for (const id of styles) assert.ok(STYLE_INFO[id]?.artists && STYLE_INFO[id]?.sound, id);
  assert.match(varietyNudge(['kosmische', 'ambient-eno', 'dark-ambient']), /drone and ambient/);
  assert.equal(varietyNudge(['kosmische', 'shoegaze', 'stereolab']), null);
});

test('unlock anyway opens a locked style; better-with names only missing gear', () => {
  assert.ok(lockReason('shoegaze', {}));
  assert.equal(lockReason('shoegaze', {}, { shoegaze: true }), null);
  assert.deepEqual(missingBetterWith('shoegaze', []), ['a reverse reverb plugin', 'an amp plugin']);
  assert.deepEqual(missingBetterWith('shoegaze', { installed: ['CSR Inverse v6', 'AmpliTube 5'] }), []);
});

test('a copy that began with the Durutti examples keeps them; new ones are technique-first', () => {
  const hear = byId('hear-the-sound').why;
  assert.match(resolveGear(hear, EVE), /Durutti Column/);
  assert.doesNotMatch(resolveGear(hear, []), /Durutti/);
});

test('with styles picked, the next lesson is one of the picks, in pick order', () => {
  const allButStyles = Object.fromEntries(LESSONS.filter((l) => !SECTIONS[3].ids.includes(l.id)).map((l) => [l.id, 'done']));
  assert.equal(firstUnfinished(allButStyles, {}, ['shoegaze', 'stereolab']).id, 'shoegaze');
  assert.equal(firstUnfinished(allButStyles).id, 'kosmische');
  assert.deepEqual(lessonPath(['shoegaze']).slice(-1).map((l) => l.id), ['shoegaze']);
});

test('the new styles tick on their own sounds, dry folk needs the effects off', () => {
  const folk = createChecker(byId('folk'));
  const bar = (notes, extra = {}) => ({ type: 'arpBar', notes, pattern: 'picking', sound: 'guitar', fx: { chorus: true, echo: true, reverb: true }, ...extra });
  folk.handle(bar([62, 66, 69]));
  folk.handle(bar([62, 66, 69]));
  assert.equal(folk.progress()[1].done, false); // effects still on
  folk.handle(bar([62, 66, 69], { fx: {} }));
  folk.handle(bar([62, 66, 69], { fx: {} }));
  assert.equal(folk.progress()[1].done, true);
  const bossa = createChecker(byId('bossa-nova'));
  for (let i = 0; i < 2; i++) bossa.handle({ type: 'arpBar', notes: [55, 59, 62, 65], pattern: 'offbeat', fx: {} });
  assert.equal(bossa.progress()[3].done, true); // G7 recognised
});

test('punk: power chords are recognised and need the fuzz on', () => {
  const punk = createChecker(byId('punk'));
  const bar = (notes, fx) => ({ type: 'arpBar', notes, pattern: 'eighths', fx });
  punk.handle(bar([52, 59], {}));
  punk.handle(bar([52, 59], {}));
  assert.equal(punk.progress()[0].done, false); // no fuzz yet
  punk.handle(bar([52, 59, 64], { fuzz: true }));
  punk.handle(bar([52, 59, 64], { fuzz: true }));
  assert.equal(punk.progress()[0].done, true); // E5, with the octave doubled
});
