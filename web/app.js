import { Engine, DRUM_PATTERNS, METER_PATTERNS } from './audio.js';
import { setupInput } from './input.js';
import {
  ARP_PATTERNS, CHORD_PATTERNS, Latch, TICKS_PER_STEP, arpNotes, bassLength, bassNote, chordLength, detectChord, hasInterval, swingDelay,
  inKey, keyChords, keyName, keyPitchClasses, snapToKey, spell, CIRCLE, compareKeys, friendlyChords, neighbours,
  circleSpot, keyAtSpot, lessonKey, wheelDemo, isBlackKey, noteName, pitchClass,
  sliceForNote, tempoFromName, voicing, writeMidi, METERS, meterOf, patternStep,
} from './music.js';
import { KEY_MODES, parseKey } from './music.js';
import { SLOTS, gearTags, groupPlugins, searchGear, slotFor, unlabelled } from './gear.js';
import { compareCards, comparePairs, measureTake, scoreAreas } from './takes.js';
import { DRILLS, makeQuestion, streakDots } from './ear.js';
import { INTERVALS, KEY_TEXT, MAJOR_MINOR, STYLE_CHORDS } from './chords.js';
import { Looper } from './looper.js';
import { LESSONS, LISTEN, PICKER_ORDER, SECTIONS, STYLE_INFO, bandcampEmbed, matchesGear, createChecker, firstUnfinished, fitChecks, keyForLesson, lessonHighlightPcs, lessonPath, lockReason, missingBetterWith, resolveGear, varietyNudge } from './lessons.js';

const $ = (id) => document.getElementById(id);
const KEY_LOW = 48;
const KEY_HIGH = 84;
const DRUM_NOTES = { kick: 36, rim: 37, snare: 38, hat: 42, tom: 45, openhat: 46, ghost: 38, gated: 40, brush: 38 };
const DRUM_KINDS = ['kick', 'rim', 'snare', 'hat', 'tom', 'openhat', 'ghost', 'gated', 'brush'];
// Quieter hits: ghost snares and brushes sit under the beat.
const DRUM_LEVELS = { ghost: 0.35, brush: 0.55 };
const GRID_ROWS = [['kick', 'Kick'], ['snare', 'Snare'], ['rim', 'Rim'], ['hat', 'Closed hat'], ['openhat', 'Open hat']];
const SLICES = 8;
const DRONE_SOUND = 'vp330-strings';
const BASS_SOUND = 'moog-bass';

const engine = new Engine();
const looper = new Looper();
const latch = new Latch();
const held = new Set();

const state = {
  arp: false,
  latch: true,
  arpPattern: 'picking',
  drums: false,
  drumPattern: 'simple',
  click: false,
  drone: false,
  bass: false, // bass layer
  bassStyle: 'pump', // 'pump' (new wave) or 'melodic' (post-punk)
  freeTime: false, // "No beat": no click, drums, bass or arpeggiator; held notes just ring
  swing: 0, // 0 straight, 1 hard shuffle: how late the off-beat sixteenths land
  meter: '4/4', // time signature: sets how many sixteenths make a bar
  halfSpeed: false, // sampler plays slices at half speed
  kit: 'synth', // drum kit id
  grid: { kick: [], snare: [], rim: [], hat: [], openhat: [] }, // "my beat": steps per row
  reverse: false, // sampler plays slices backwards
  scaleLock: false, // snap every key played to the nearest note in the chosen key
  droneVoice: null, // {root, release, startBar}
  bar: 0,
  chartStartBar: 0,
  chartRunning: false, // the chart waits for the first chord, and Stop resets it
  drumsWaiting: false, // a lesson's drums start with your first note, not when it opens
  rec: 'idle', // idle | armed | recording | stopped
  recording: null,
  lastTake: null, // measurements of the most recent take, ready to score
  holdSince: null, // audio time the keys held now were pressed
};

// plugins: what lessons may name (installed and not removed, plus plugins added by
// hand); scanned: everything installed; added/hidden/folders: your choices.
let gear = { plugins: [], scanned: [], added: [], hidden: [], folders: [], tags: [] };
let instruments = []; // every instrument: [{id, label, recorded, samples}]
let drumKits = []; // recorded drum kits: [{id, label, sounds}]
let loops = []; // loops for the sampler: [{label, files}]
let pluginDetails = []; // installed plugins: [{name, maker, kind}]
let gearLabels = {}; // what the coach model said about plugins, by maker|name
let describing = 0; // plugins being sorted by the coach model right now
let describeAgain = false; // coach settings changed mid-sort: sort again after
let describeError = '';
let movedSlots = {}; // plugins sorted since Your gear opened: name -> what it was, so rows stay put
let progress = { current: LESSONS[0].id, completed: {}, checks: {} };
let lesson = LESSONS[0];
let checker = createChecker(lesson);

// ---------- persistence ----------

let saveTimer = null;
function saveProgress() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fetch('/api/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(progress),
    }).catch(() => {});
  }, 400);
}

// What this Mac has, for lesson text: see gearEnv in lessons.js.
function lessonEnv() {
  const tags = gearTags(gear.added, pluginDetails, gearLabels, gear.hidden, gear.slots || {});
  const folder = gear.folders.find((f) => f.found) || gear.folders[0];
  return {
    installed: gear.plugins,
    sounds: instruments.filter((i) => i.recorded).map((i) => i.id),
    kits: drumKits.map((k) => k.id),
    loopGroups: loops.map((g) => g.label),
    folder: folder ? shortPath(folder.path) : null,
    tags,
    durutti: progress.flavour === 'durutti',
  };
}

function shortPath(path) {
  return gear.home && path.startsWith(`${gear.home}/`) ? `~${path.slice(gear.home.length)}` : path;
}

async function loadJson(url, fallback) {
  try {
    const r = await fetch(url);
    return r.ok ? await r.json() : fallback;
  } catch {
    return fallback;
  }
}

// ---------- lessons ----------

function lessonRow(id) {
  const l = LESSONS.find((x) => x.id === id);
  const number = LESSONS.indexOf(l) + 1;
  const locked = lockReason(id, progress.completed, progress.unlocked);
  const li = document.createElement('li');
  if (progress.completed[id]) li.classList.add('complete');
  if (id === lesson.id) li.classList.add('current');
  if (locked) li.classList.add('locked');
  const b = document.createElement('button');
  b.innerHTML = `<span class="mark">${progress.completed[id] ? '✓' : locked ? '🔒' : number}</span><span></span>`;
  b.lastChild.textContent = l.title;
  b.title = locked || '';
  b.disabled = Boolean(locked);
  if (locked) b.setAttribute('aria-label', `${l.title}. Locked: ${locked}`);
  b.onclick = () => openLesson(id);
  li.append(b);
  return li;
}

// A style lesson locked behind the Basics can still be opened on purpose.
function unlockRow(id) {
  const li = document.createElement('li');
  li.className = 'unlock-row';
  const b = document.createElement('button');
  b.className = 'link';
  b.textContent = 'Unlock anyway';
  b.onclick = () => unlockStyle(id, true);
  li.append(b);
  return li;
}

function unlockStyle(id, open) {
  progress.unlocked = { ...(progress.unlocked || {}), [id]: true };
  saveProgress();
  renderLessonList();
  if (open) openLesson(id);
}

// My styles first, in the order picked; the rest behind "Show all styles".
function styleIds(sec) {
  const picked = (progress.styles || []).filter((id) => sec.ids.includes(id));
  if (!picked.length) return { shown: sec.ids, rest: [] };
  const rest = sec.ids.filter((id) => !picked.includes(id));
  return { shown: state.showAllStyles ? [...picked, ...rest] : picked, rest };
}

// A nudge for people who skipped gear setup. "Not now" hides it for 3 finished lessons;
// after the second "Not now", or once any gear is added or sorted, it is gone for good.
function renderGearReminder() {
  const r = progress.gearReminder || { dismissed: 0, at: 0 };
  const done = Object.keys(progress.completed).length;
  const hasGear = gear.added.length || gear.folders.length || Object.keys(gear.slots || {}).length;
  const due = r.dismissed === 0 || (r.dismissed === 1 && done >= r.at + 3);
  $('gear-reminder').hidden = !gear.setupDone || Boolean(hasGear) || !due;
}

function renderLessonList() {
  renderGearReminder();
  const list = $('lesson-list');
  list.innerHTML = '';
  for (const sec of SECTIONS) {
    const isStyles = sec.title === 'Styles';
    const head = document.createElement('li');
    head.className = 'section-head';
    head.innerHTML = '<strong></strong><span></span>';
    head.firstChild.textContent = sec.title;
    head.lastChild.textContent = isStyles && progress.styles?.length
      ? 'Your picks. They unlock after the Basics, or unlock one early.'
      : sec.note;
    if (isStyles) {
      const change = document.createElement('button');
      change.className = 'link';
      const fresh = newSuggestions().length;
      change.textContent = `${progress.styles?.length ? 'Change my styles' : 'Choose my styles'}${fresh ? ` · ${fresh} new` : ''}`;
      if (fresh) change.title = 'Gear you added now matches another style';
      change.onclick = () => openStyles(false);
      head.firstChild.after(change);
    }
    list.append(head);
    const { shown, rest } = isStyles ? styleIds(sec) : { shown: sec.ids, rest: [] };
    for (const id of shown) {
      list.append(lessonRow(id));
      if (isStyles && lockReason(id, progress.completed, progress.unlocked)) list.append(unlockRow(id));
    }
    if (rest.length) {
      const li = document.createElement('li');
      li.className = 'styles-toggle';
      const b = document.createElement('button');
      b.className = 'link';
      b.textContent = state.showAllStyles ? 'Show only my styles' : `Show all styles (${rest.length} more)`;
      b.onclick = () => {
        state.showAllStyles = !state.showAllStyles;
        renderLessonList();
      };
      li.append(b);
      list.append(li);
    }
  }
}

// "Hear it": one or two real recordings of the style, from Bandcamp. Nothing loads
// from the internet until a button is pressed. Cards (slim) offer the first record.
function hearIt(box, id, slim = false) {
  const records = LISTEN[id] || [];
  box.innerHTML = '';
  box.hidden = !records.length;
  for (const listen of slim ? records.slice(0, 1) : records) {
    const row = document.createElement('div');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'link';
    b.textContent = slim ? '▶ Hear it' : `▶ Hear the real thing: ${listen.artist}, ${listen.title}`;
    const note = document.createElement('span');
    note.className = 'muted';
    note.textContent = ' (plays from Bandcamp)';
    b.onclick = () => row.replaceChildren(player(listen, slim));
    row.append(b, note);
    box.append(row);
  }
}

// Bandcamp's embed code: the player, with a link inside for browsers that can't show
// it. Offline, just the link, to open later.
function player(listen, slim) {
  const link = document.createElement('a');
  link.href = listen.url;
  link.target = '_blank';
  link.rel = 'noopener';
  link.className = 'muted';
  link.textContent = `${listen.title} by ${listen.artist}`;
  if (!navigator.onLine) {
    link.textContent = `No internet right now. Open ${listen.title} by ${listen.artist} on Bandcamp later.`;
    return link;
  }
  const frame = document.createElement('iframe');
  frame.src = bandcampEmbed(listen, slim);
  frame.title = `${listen.title} by ${listen.artist}, on Bandcamp`;
  frame.className = slim ? 'slim' : '';
  frame.setAttribute('seamless', '');
  frame.append(link);
  return frame;
}

// On a style lesson, name the optional gear that would bring it closer to the record.
function renderBetterWith() {
  const missing = STYLE_INFO[lesson.id] ? missingBetterWith(lesson.id, lessonEnv()) : [];
  $('lesson-better').hidden = !missing.length;
  if (!missing.length) return;
  const list = missing.length > 1 ? `${missing.slice(0, -1).join(', ')} and ${missing.at(-1)}` : missing[0];
  $('lesson-better').firstChild.textContent = `Works now with this app's sounds and GarageBand's. Sounds closer to the record with ${list}: add it any time.`;
}

// What the coach model should aim the learner at.
function coachGoal() {
  const names = (progress.styles || []).map((id) => STYLE_INFO[id]?.name).filter(Boolean);
  if (names.length) return `music in the styles they picked: ${names.join(', ')}. Then finishing it in GarageBand.`;
  if (progress.flavour === 'durutti') {
    return 'music in the spirit of The Durutti Column\'s "Dance II": clean picked guitar, chorus, long echo, reverb, a simple drum machine.';
  }
  return 'making their own music and finishing it in GarageBand.';
}

// ---------- style picker ----------

let stylePicks = [];
let stylesExpanded = false;
let nudgeDismissed = false;
const STARTER_CARDS = 6;

function styleIdsInApp() {
  const ids = SECTIONS.find((s) => s.title === 'Styles').ids.filter((id) => STYLE_INFO[id]);
  return [...PICKER_ORDER.filter((id) => ids.includes(id)), ...ids.filter((id) => !PICKER_ORDER.includes(id))];
}

// Styles where the learner's gear changes what they can do (see `matches` in
// lessons.js). Gear never locks a style; this only says what it matches.
function suggestedStyles() {
  return styleIdsInApp().filter((id) => matchesGear(id, lessonEnv()));
}

function newSuggestions() {
  const seen = progress.seenSuggestions || [];
  return suggestedStyles().filter((id) => !seen.includes(id));
}

// ▷ Try it: five seconds of the style's own setup, played by the app.
let previewTimer = null;
function previewStyle(id) {
  const l = LESSONS.find((x) => x.id === id);
  if (!engine.ctx || !l) return;
  clearTimeout(previewTimer);
  if (!state.previewing) state.beforePreview = { bpm: engine.bpm, sound: engine.sound };
  stopAll();
  state.previewing = true;
  applySetup(l.setup || {});
  if (state.drumsWaiting) {
    state.drums = true;
    state.drumsWaiting = false;
  }
  const chord = l.chart?.[0] || l.checks.find((c) => c.chord)?.chord || 'Am';
  const notes = voicing(chord);
  if (state.arp) {
    latch.clear();
    notes.forEach((n) => latch.press(n, state.arpPattern === 'eno'));
    notes.forEach((n) => latch.release(n));
  } else {
    notes.forEach((n) => engine.playNote(n, 80, engine.ctx.currentTime, 4, engine.sound));
  }
  renderStudio();
  previewTimer = setTimeout(endPreview, 5000);
}

function endPreview() {
  clearTimeout(previewTimer);
  if (!state.previewing) return;
  stopAll();
  applySetup(lesson.setup || {});
  // Put back the tempo and sound the learner had, where the lesson doesn't set them.
  const before = state.beforePreview || {};
  if (!lesson.setup?.bpm && before.bpm) engine.setBpm(before.bpm);
  if (!lesson.setup?.sound && before.sound) engine.sound = before.sound;
  renderStudio();
  state.previewing = false;
}

function renderStyles() {
  const ids = styleIdsInApp();
  const shown = stylesExpanded ? ids : ids.slice(0, STARTER_CARDS);
  $('style-cards').innerHTML = '';
  for (const id of shown) {
    const info = STYLE_INFO[id];
    const card = document.createElement('div');
    card.className = 'style-card';
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'pick';
    pick.setAttribute('aria-pressed', String(stylePicks.includes(id)));
    pick.innerHTML = '<span class="artists"></span><span class="name"></span><span class="sound"></span>';
    pick.querySelector('.artists').textContent = info.artists;
    pick.querySelector('.name').textContent = info.name;
    pick.querySelector('.sound').textContent = info.sound;
    pick.onclick = () => toggleStyle(id);
    card.append(pick);
    const setup = LESSONS.find((l) => l.id === id)?.setup || {};
    if (setup.sound !== 'chop') {
      const tryIt = document.createElement('div');
      tryIt.className = 'hear';
      const t = document.createElement('button');
      t.type = 'button';
      t.className = 'link';
      t.textContent = '▷ Try it';
      t.title = 'Five seconds of this style, played by the app';
      t.onclick = () => previewStyle(id);
      const note = document.createElement('span');
      note.className = 'muted';
      note.textContent = ' (5 seconds, this app)';
      tryIt.append(t, note);
      card.append(tryIt);
    }
    if (LISTEN[id]) {
      const hear = document.createElement('div');
      hear.className = 'hear';
      hearIt(hear, id, true);
      card.append(hear);
    }
    if (lockReason(id, progress.completed, progress.unlocked)) {
      const lock = document.createElement('p');
      lock.className = 'lock';
      lock.textContent = 'After the Basics · ';
      const u = document.createElement('button');
      u.type = 'button';
      u.className = 'link';
      u.textContent = 'Unlock anyway';
      u.onclick = () => {
        unlockStyle(id, false);
        renderStyles();
      };
      lock.append(u);
      card.append(lock);
    }
    $('style-cards').append(card);
  }
  const suggested = suggestedStyles();
  $('styles-suggested').hidden = !suggested.length;
  $('styles-suggested-list').innerHTML = '';
  for (const id of suggested) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ghost small';
    b.textContent = STYLE_INFO[id].name;
    b.setAttribute('aria-pressed', String(stylePicks.includes(id)));
    b.onclick = () => toggleStyle(id);
    $('styles-suggested-list').append(b);
  }
  const more = ids.length - STARTER_CARDS;
  $('styles-more').hidden = more <= 0;
  $('styles-more').textContent = stylesExpanded ? 'Show fewer' : `Show ${more} more`;
  const nudge = nudgeDismissed ? null : varietyNudge(stylePicks);
  $('styles-nudge').hidden = !nudge;
  if (nudge) $('styles-nudge').firstChild.textContent = nudge;
  $('styles-note').textContent = stylePicks.length ? `${stylePicks.length} of 5 picked.` : '';
}

function toggleStyle(id) {
  if (stylePicks.includes(id)) stylePicks = stylePicks.filter((x) => x !== id);
  else if (stylePicks.length >= 5) {
    $('styles-note').textContent = 'Up to 5 to start. Unpick one first; the rest stay one click away.';
    return;
  } else stylePicks = [...stylePicks, id];
  renderStyles();
}

let welcomeAdvancing = false;

function openStyles(welcome) {
  stylePicks = [...(progress.styles || [])];
  // Opening the picker counts as seeing the current suggestions.
  progress.seenSuggestions = suggestedStyles();
  saveProgress();
  renderLessonList();
  stylesExpanded = false;
  nudgeDismissed = false;
  $('styles-step').hidden = !welcome;
  $('styles-dialog').dataset.welcome = welcome ? '1' : '';
  $('styles-done').textContent = welcome ? 'Continue' : 'Save';
  $('styles-skip').textContent = welcome ? 'Skip — show me every style' : 'Show every style';
  renderStyles();
  $('styles-dialog').showModal();
}

function saveStyles(picks) {
  progress.styles = picks;
  state.showAllStyles = false;
  saveProgress();
  renderLessonList();
  welcomeAdvancing = true;
  $('styles-dialog').close();
}

// The welcome: gear, then styles, then the coach model, one window at a time.
// × or Escape ends it where it is.
function wireWelcome() {
  const next = (from, open) => {
    welcomeAdvancing = true;
    $(from).close();
    open();
  };
  $('gear-next').onclick = () => next('gear-dialog', () => openStyles(true));
  $('gear-skip').onclick = () => next('gear-dialog', () => openStyles(true));
  $('styles-more').onclick = () => {
    stylesExpanded = !stylesExpanded;
    renderStyles();
  };
  $('styles-nudge').querySelector('button').onclick = () => {
    nudgeDismissed = true;
    renderStyles();
  };
  $('styles-done').onclick = () => saveStyles(stylePicks);
  $('styles-skip').onclick = () => saveStyles([]);
  $('styles-dialog').addEventListener('close', () => {
    endPreview();
    const advancing = welcomeAdvancing;
    welcomeAdvancing = false;
    if (advancing && $('styles-dialog').dataset.welcome) openCoach(true);
  });
  $('better-gear').onclick = () => openGear(false);
}

function openLesson(id) {
  endPreview();
  lesson = LESSONS.find((l) => l.id === id) || LESSONS[0];
  progress.current = lesson.id;
  checker = createChecker(fitChecks(lesson, lessonEnv()), progress.checks[lesson.id]);
  applySetup(lesson.setup || {});
  state.chartRunning = false;
  latch.clear();
  $('lesson-title').textContent = lesson.title;
  $('lesson-minutes').textContent = `about ${lesson.minutes} min`;
  $('lesson-why').textContent = resolveGear(lesson.why, lessonEnv());
  $('lesson-diff').hidden = !lesson.differences;
  $('lesson-diff').querySelector('ul').replaceChildren(
    ...(lesson.differences || []).map((d) => Object.assign(document.createElement('li'), { textContent: d })),
  );
  hearIt($('lesson-listen'), lesson.id);
  renderBetterWith();
  // The Key bar follows the lesson, so the keys a lesson asks for are never greyed.
  // A lesson can name its key outright (setup.key, e.g. "A blues") and lock to it.
  const key = parseKey(lesson.setup?.key) || keyForLesson(lesson);
  progress.key = key ? `${key.root}:${key.mode}` : null;
  state.scaleLock = Boolean(key && lesson.setup?.scaleLock);
  if ($('key-select').options.length > 1) renderKeyPicker();
  resetMixer();
  $('mixer').hidden = !lesson.mixer;
  $('popout').hidden = !(lesson.guided && 'documentPictureInPicture' in window);
  renderLessonList();
  renderChecks();
  renderChart();
  renderLessonWheel();
  renderKeyboard();
  updateChordDisplay();
  saveProgress();
}

// "Go further": optional free plugins, each linked to its maker's own download page.
function renderFurther() {
  const g = lesson.goFurther;
  const p = $('lesson-further');
  p.hidden = !g;
  if (!g) return;
  p.innerHTML = `<strong>Go further (optional):</strong> ${esc(g.text)} ${g.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">Get ${esc(l.name)}</a>`).join(' · ')}`;
}

function renderSteps() {
  renderFurther();
  const steps = $('lesson-steps');
  steps.innerHTML = '';
  steps.classList.toggle('guided-steps', Boolean(lesson.guided));
  if (!lesson.guided) {
    for (const s of lesson.steps) {
      const text = resolveGear(s, lessonEnv());
      if (!text) continue; // a step for gear this Mac doesn't have
      const li = document.createElement('li');
      li.textContent = text;
      steps.append(li);
    }
    return;
  }
  const status = checker.progress();
  lesson.steps.forEach((st, i) => steps.append(guidedStep(st, i, status[i].done, document)));
}

// One guided step: its tick, its words, a Done button (or a note that the app
// ticks it), and a screenshot with the areas to look at outlined.
function guidedStep(st, i, done, doc) {
  const li = doc.createElement('li');
  li.className = `guided-step${done ? ' done' : ''}`;
  const row = doc.createElement('div');
  row.className = 'row';
  row.innerHTML = `<span class="box">${done ? '✓' : ''}</span><span class="text"></span>`;
  row.querySelector('.text').textContent = resolveGear(st.text, lessonEnv());
  if (!done && !st.check) {
    const b = doc.createElement('button');
    b.className = 'done-btn primary';
    b.textContent = 'Done';
    b.onclick = () => emit({ type: 'manual', index: i });
    row.append(b);
  } else if (!done) {
    const note = doc.createElement('span');
    note.className = 'auto';
    note.textContent = 'ticks when you do it';
    row.append(note);
  }
  li.append(row);
  if (st.image) li.append(shot(st, doc, doc === document));
  return li;
}

function shot(st, doc, zoomable) {
  const fig = doc.createElement('div');
  fig.className = 'shot';
  const img = doc.createElement('img');
  img.src = new URL(st.image, location.href).href;
  img.alt = st.label;
  fig.append(img);
  for (const b of st.boxes || []) {
    const hl = doc.createElement('div');
    hl.className = 'hl';
    Object.assign(hl.style, { left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%` });
    const tag = doc.createElement('span');
    tag.textContent = b.label;
    hl.append(tag);
    fig.append(hl);
  }
  if (zoomable) {
    fig.onclick = () => {
      $('shot-body').replaceChildren(shot(st, document, false));
      $('shot-dialog').showModal();
    };
  }
  return fig;
}

// ---------- pop-out steps (a small window that stays on top of GarageBand) ----------

let pip = null;

async function popOut() {
  if (pip) return pip.focus();
  pip = await documentPictureInPicture.requestWindow({ width: 460, height: 640 });
  const css = pip.document.createElement('link');
  css.rel = 'stylesheet';
  css.href = new URL('styles.css', location.href).href;
  pip.document.head.append(css);
  pip.document.body.classList.add('pip');
  pip.addEventListener('pagehide', () => (pip = null));
  renderPip();
}

// Shows only the next step to do, with a big Done button.
function renderPip() {
  if (!pip) return;
  const doc = pip.document;
  const status = checker.progress();
  const next = lesson.guided ? status.findIndex((p) => !p.done) : -1;
  const main = doc.createElement('main');
  main.style.padding = '14px';
  const title = doc.createElement('h2');
  title.textContent = lesson.title;
  main.append(title);
  if (!lesson.guided) {
    main.append(Object.assign(doc.createElement('p'), { textContent: 'This lesson has no GarageBand steps.' }));
  } else if (next === -1) {
    main.append(Object.assign(doc.createElement('p'), { textContent: 'Lesson complete. Pick the next one in Music Coach.' }));
  } else {
    main.append(Object.assign(doc.createElement('p'), { className: 'muted', textContent: `Step ${next + 1} of ${lesson.steps.length}` }));
    const ul = doc.createElement('ul');
    ul.className = 'guided-steps';
    const li = guidedStep(lesson.steps[next], next, false, doc);
    const done = li.querySelector('.done-btn');
    if (done) done.classList.add('big');
    ul.append(li);
    main.append(ul);
  }
  doc.body.replaceChildren(main);
}

function renderChecks() {
  renderSteps();
  renderPip();
  const ul = $('lesson-checks');
  ul.innerHTML = '';
  if (lesson.guided) {
    // Guided lessons show their ticks on the steps themselves.
    $('lesson-done').hidden = !checker.complete();
    $('next-lesson').hidden = !nextOpenLesson();
    return;
  }
  checker.progress().forEach((p, i) => {
    const li = document.createElement('li');
    if (p.done) li.classList.add('done');
    const box = document.createElement('span');
    box.className = 'box';
    box.textContent = p.done ? '✓' : '';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = resolveGear(p.label, lessonEnv());
    li.append(box, label);
    if (p.target && !p.done) {
      const bar = document.createElement('progress');
      bar.max = p.target;
      bar.value = p.current;
      const count = document.createElement('span');
      count.className = 'muted';
      count.textContent = `${p.current} / ${p.target}`;
      li.append(bar, count);
    }
    if (p.type === 'manual' && !p.done) {
      const b = document.createElement('button');
      b.className = 'manual';
      b.textContent = 'Done';
      b.onclick = () => emit({ type: 'manual', index: i });
      li.append(b);
    }
    ul.append(li);
  });
  const complete = checker.complete();
  $('lesson-done').hidden = !complete;
  $('next-lesson').hidden = !nextOpenLesson();
}

// The next lesson after this one that is not locked.
function nextOpenLesson() {
  // A style opened from "Show all styles" isn't on the picked path: walk every lesson then.
  const picked = lessonPath(progress.styles || []);
  const path = picked.includes(lesson) ? picked : LESSONS;
  const here = path.indexOf(lesson);
  return path.slice(here + 1).find((l) => !lockReason(l.id, progress.completed, progress.unlocked));
}

// Every musical event goes through here so lesson checks can tick.
function emit(evt) {
  if (state.previewing) return; // a style preview never ticks the open lesson
  if (!checker.handle(evt)) return;
  progress.checks[lesson.id] = checker.values();
  if (checker.complete() && !progress.completed[lesson.id]) {
    progress.completed[lesson.id] = new Date().toISOString();
    renderLessonList();
    renderEarButton();
  }
  renderChecks();
  saveProgress();
}

// ---------- chart ----------

function renderChart() {
  const chart = $('chart');
  if (!lesson.chart) {
    chart.hidden = true;
    return;
  }
  chart.hidden = false;
  chart.innerHTML = '';
  lesson.chart.forEach((c) => {
    const d = document.createElement('div');
    d.className = 'cell';
    d.textContent = c;
    chart.append(d);
  });
  highlightChart(false);
}

function chartIndex(offset = 0) {
  const n = lesson.chart.length;
  const bars = Math.max(0, state.bar + offset - state.chartStartBar);
  return bars % n;
}

function highlightChart(lastBeat) {
  if (!lesson.chart) return;
  const cells = [...$('chart').children];
  if (!state.chartRunning) {
    // Waiting: point at the first chord.
    cells.forEach((c, i) => {
      c.classList.remove('current');
      c.classList.toggle('next', i === 0);
    });
    return;
  }
  const now = chartIndex();
  const next = chartIndex(1);
  const changing = lesson.chart[next] !== lesson.chart[now];
  cells.forEach((c, i) => {
    c.classList.toggle('current', i === now);
    c.classList.toggle('next', lastBeat && changing && i === next);
  });
}

// ---------- keyboard ----------

function renderKeyboard() {
  const kb = $('keyboard');
  kb.innerHTML = '';
  const whites = [];
  for (let n = KEY_LOW; n <= KEY_HIGH; n++) if (!isBlackKey(n)) whites.push(n);
  const w = 100 / whites.length;
  const targets = new Set([...(lesson.targets || []).flatMap((c) => voicing(c)), ...(lesson.highlight || [])]);
  const scalePcs = new Set(lessonHighlightPcs(lesson));
  let wi = 0;
  for (let n = KEY_LOW; n <= KEY_HIGH; n++) {
    const k = document.createElement('div');
    const black = isBlackKey(n);
    k.className = `key ${black ? 'black' : 'white'}`;
    k.dataset.note = n;
    if (black) {
      k.style.left = `calc(${wi * w}% - ${w * 0.3}%)`;
      k.style.width = `${w * 0.6}%`;
    } else {
      k.style.left = `${wi * w}%`;
      k.style.width = `${w}%`;
      wi++;
    }
    if (targets.has(n)) k.classList.add('target');
    else if (scalePcs.has(pitchClass(n))) k.classList.add('scale');
    const label = document.createElement('span');
    label.className = 'name';
    if (!black || targets.has(n)) label.textContent = noteName(n).replace(/\d/, '') + (pitchClass(n) === 0 ? noteName(n).slice(-1) : '');
    k.append(label);
    k.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      k.setPointerCapture(e.pointerId);
      inputOn(n, 90);
    });
    k.addEventListener('pointerup', () => inputOff(n));
    k.addEventListener('pointercancel', () => inputOff(n));
    kb.append(k);
  }
  paintKeys();
}

function paintKeys() {
  const sounding = new Set(activeNotes());
  const key = currentKey();
  for (const k of $('keyboard').children) {
    const n = Number(k.dataset.note);
    k.classList.toggle('down', held.has(n) || sounding.has(n));
    k.classList.toggle('outofkey', Boolean(key) && !inKey(n, key.root, key.mode));
  }
}

// ---------- key picker ----------

// The chosen key, or null. Stored as "root:mode", e.g. "0:minor" for C minor.
function currentKey() {
  const v = progress.key;
  if (!v) return null;
  const [root, mode] = v.split(':');
  return { root: Number(root), mode };
}

const KEY_MODE_LABELS = { major: 'Major', minor: 'Minor', blues: 'Blues scale', ambassel: 'Ambassel (Ethiopian)' };

function renderKeyPicker() {
  const select = $('key-select');
  if (select.options.length === 1) {
    for (const mode of Object.keys(KEY_MODES)) {
      const group = document.createElement('optgroup');
      group.label = KEY_MODE_LABELS[mode];
      for (let root = 0; root < 12; root++) group.append(new Option(keyName(root, mode), `${root}:${mode}`));
      select.append(group);
    }
  }
  select.value = progress.key || '';
  const key = currentKey();
  const chords = $('key-chords');
  $('key-warning').textContent = '';
  if (!key) {
    $('key-notes').textContent = 'Pick a key to light up its seven notes.';
    chords.hidden = true;
  } else {
    const names = keyPitchClasses(key.root, key.mode).map((pc) => spell(pc, key.root, key.mode));
    $('key-notes').textContent = `Notes: ${names.join('  ')}. Greyed keys are outside the key.`;
    chords.hidden = false;
    chords.innerHTML = '<span class="muted">Chords in this key:</span>';
    const lock = document.createElement('button');
    lock.id = 'scale-lock';
    lock.className = state.scaleLock ? 'on' : '';
    lock.textContent = state.scaleLock ? 'Scale lock: on' : 'Scale lock: off';
    lock.title = 'On: every key you press snaps to the nearest note in this key, so nothing clashes. Turn it off for lessons that clash on purpose.';
    lock.onclick = () => {
      state.scaleLock = !state.scaleLock;
      renderKeyPicker();
    };
    for (const c of keyChords(key.root, key.mode)) {
      const b = document.createElement('button');
      b.textContent = c.label;
      b.title = 'Click to hear it';
      b.onclick = () => engine.ctx && audition(voicing(c.name));
      chords.append(b);
    }
    chords.append(lock);
  }
  if (!key) state.scaleLock = false;
  paintKeys();
}

// ---------- scale lock: keys pressed become notes played ----------

const lockMap = new Map(); // physical key -> note actually played

function inputOn(n, vel) {
  const key = currentKey();
  const played = state.scaleLock && key ? snapToKey(n, key.root, key.mode) : n;
  lockMap.set(n, played);
  noteOn(played, vel);
}

function inputOff(n) {
  const played = lockMap.get(n) ?? n;
  lockMap.delete(n);
  // Two keys can snap to the same note; keep it sounding while either is down.
  if ([...lockMap.values()].includes(played)) return;
  noteOff(played);
}

// ---------- key finder: hold a quiet note under a song ----------

const finder = { pc: null, mode: null, releases: [] };

function finderStop() {
  const t = engine.ctx?.currentTime ?? 0;
  finder.releases.forEach((r) => r(t));
  finder.releases = [];
}

function finderPlay() {
  finderStop();
  if (finder.pc === null || !engine.ctx) return;
  const root = 48 + finder.pc;
  const notes = finder.mode ? [root, root + (finder.mode === 'minor' ? 3 : 4) + 12, root + 7 + 12] : [root, root + 12];
  const now = engine.ctx.currentTime;
  finder.releases = notes.map((n) => engine.voice(n, 70, now, 'pad', 'finder'));
}

function renderFinder() {
  const row = $('finder-notes');
  if (!row.children.length) {
    for (let pc = 0; pc < 12; pc++) {
      const b = document.createElement('button');
      b.dataset.pc = pc;
      b.textContent = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'][pc];
      b.onclick = () => {
        finder.pc = finder.pc === pc ? null : pc;
        finder.mode = null;
        finderPlay();
        renderFinder();
      };
      row.append(b);
    }
  }
  for (const b of row.children) b.classList.toggle('on', Number(b.dataset.pc) === finder.pc);
  $('finder-major').classList.toggle('on', finder.mode === 'major');
  $('finder-minor').classList.toggle('on', finder.mode === 'minor');
  $('finder-use').disabled = finder.pc === null || !finder.mode;
}

function wireFinder() {
  $('find-key').onclick = () => {
    $('finder').hidden = !$('finder').hidden;
    if ($('finder').hidden) finderStop();
    renderFinder();
  };
  for (const mode of ['major', 'minor']) {
    $(`finder-${mode}`).onclick = () => {
      if (finder.pc === null) return;
      finder.mode = finder.mode === mode ? null : mode;
      finderPlay();
      renderFinder();
    };
  }
  $('finder-stop').onclick = () => {
    finder.pc = null;
    finder.mode = null;
    finderStop();
    renderFinder();
  };
  $('finder-use').onclick = () => {
    progress.key = `${finder.pc}:${finder.mode}`;
    saveProgress();
    renderKeyPicker();
  };
}

// ---------- ear lab ----------

const ear = { drill: DRILLS[0].id, q: null, answered: false };

function earHistory(id) {
  progress.ear ??= {};
  progress.ear[id] ??= [];
  return progress.ear[id];
}

function playQuestion() {
  if (!engine.ctx || !ear.q) {
    $('ear-feedback').textContent = 'Press Start in Music Coach first.';
    return;
  }
  const now = engine.ctx.currentTime + 0.05;
  for (const step of ear.q.plays) for (const n of step.notes) engine.playNote(n, 80, now + step.at, 1.1, 'epiano');
}

function newQuestion() {
  ear.q = makeQuestion(ear.drill);
  ear.answered = false;
  $('ear-feedback').textContent = '';
  renderEar();
  playQuestion();
}

function answer(choice, button) {
  if (ear.answered) return;
  ear.answered = true;
  const right = choice === ear.q.answer;
  earHistory(ear.drill).push(right);
  saveProgress();
  const buttons = [...$('ear-choices').children];
  if (right) {
    button.classList.add('right');
    $('ear-feedback').textContent = 'Yes.';
    renderDots();
    setTimeout(newQuestion, 700);
  } else {
    button.classList.add('wrong');
    buttons.find((b) => b.textContent === ear.q.answer)?.classList.add('right');
    $('ear-feedback').textContent = `It was ${ear.q.answer}. Press Play to hear it again, then Next.`;
    renderDots();
    const next = document.createElement('button');
    next.textContent = 'Next →';
    next.className = 'primary';
    next.onclick = newQuestion;
    $('ear-feedback').append(' ', next);
  }
}

function renderDots() {
  $('ear-dots').textContent = streakDots(earHistory(ear.drill));
}

function renderEar() {
  const tabs = $('ear-tabs');
  tabs.innerHTML = '';
  DRILLS.forEach((d, i) => {
    const b = document.createElement('button');
    b.textContent = `${i + 1}. ${d.title}`;
    b.classList.toggle('on', d.id === ear.drill);
    b.onclick = () => {
      ear.drill = d.id;
      newQuestion();
    };
    tabs.append(b);
  });
  $('ear-intro').textContent = DRILLS.find((d) => d.id === ear.drill).intro;
  const box = $('ear-choices');
  box.innerHTML = '';
  for (const c of ear.q?.choices || []) {
    const b = document.createElement('button');
    b.textContent = c;
    b.onclick = () => answer(c, b);
    box.append(b);
  }
  renderDots();
}

function earUnlocked() {
  return Boolean(progress.completed['major-minor']);
}

function renderEarButton() {
  $('ear-btn').textContent = earUnlocked() ? 'Ear lab' : 'Ear lab 🔒';
  $('ear-btn').title = earUnlocked() ? 'Ear training: short drills' : 'Unlocks after the Major and minor lesson';
}

// Locked: say why, and offer the way in, instead of a button that does nothing.
function showEarLocked() {
  const number = LESSONS.findIndex((l) => l.id === 'major-minor') + 1;
  $('ear-tabs').innerHTML = '';
  $('ear-intro').textContent = `The Ear lab opens after lesson ${number}, "Major and minor: happy and sad". Its drills start with telling major from minor, so that lesson comes first.`;
  $('ear-choices').innerHTML = '';
  $('ear-dots').textContent = '';
  $('ear-play').hidden = true;
  const go = Object.assign(document.createElement('button'), { className: 'primary', textContent: `Go to lesson ${number}` });
  go.onclick = () => {
    $('ear-dialog').close();
    openLesson('major-minor');
  };
  $('ear-feedback').replaceChildren(go);
}

// A played note outside the chosen key is named, so it can be fixed.
function checkKey(note) {
  const key = currentKey();
  if (!key || inKey(note, key.root, key.mode)) return;
  $('key-warning').textContent = `${spell(note, key.root, key.mode)} is not in ${keyName(key.root, key.mode)}`;
  clearTimeout(checkKey.timer);
  checkKey.timer = setTimeout(() => ($('key-warning').textContent = ''), 2500);
}

// ---------- notes ----------

function activeNotes() {
  return state.arp ? latch.notes(state.latch) : [...held];
}

// Note names as the chosen key writes them (E♭ in C minor), or plain sharps.
function nameOf(note) {
  const key = currentKey();
  return key ? spell(note, key.root, key.mode) : noteName(note).replace(/\d/, '');
}

function respell(chordName) {
  const key = currentKey();
  if (!key) return chordName;
  return chordName.replace(/[A-G]#?/g, (n) => spell(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].indexOf(n), key.root, key.mode));
}

function updateChordDisplay() {
  const notes = activeNotes().sort((a, b) => a - b);
  const chord = detectChord(notes);
  $('chord-name').textContent = chord ? respell(chord.name) : notes.length === 1 ? nameOf(notes[0]) : '—';
  $('chord-notes').textContent = notes.length
    ? `${notes.map(nameOf).join('  ')}${chord ? ` · ${chord.label}` : ''}`
    : state.arp ? 'Tap a chord' : 'Play something';
}

function noteOn(note, vel) {
  if (state.rec === 'recording') {
    const t = engine.ctx.currentTime - state.recording.startTime;
    state.recording.presses.push({ t, vel });
    // A press with no other key down starts a new chord (in eno mode, every tap does).
    if (held.size === 0 || state.arpPattern === 'eno') state.recording.changes.push(t);
  }
  if (state.drumsWaiting) {
    state.drumsWaiting = false;
    state.drums = true;
    renderStudio();
  }
  if (!state.chartRunning) {
    // The chart starts with the chord you play now; it moves on at the next bar line.
    state.chartRunning = true;
    state.chartStartBar = state.bar + 1;
    highlightChart(false);
  }
  holdChanged();
  held.add(note);
  checkKey(note);
  latch.press(note, state.arp && state.arpPattern === 'eno');
  if (!state.arp && engine.ctx) looper.noteOn(note, vel, engine.sound, engine.ctx.currentTime, engine.secondsPerStep);
  if (!state.arp) {
    if (engine.sound === 'chop') playSliceNow(note, vel, engine.ctx?.currentTime);
    else engine.noteOn(note, vel);
    recordDirectOn(note, vel);
  }
  emit({ type: 'noteOn', note });
  emit({ type: 'held', notes: activeNotes() });
  updateChordDisplay();
  paintKeys();
}

function noteOff(note) {
  if (!held.has(note)) return;
  holdChanged();
  held.delete(note);
  latch.release(note);
  if (!state.arp) {
    engine.noteOff(note);
    recordDirectOff(note);
    if (engine.ctx) looper.noteOff(note, engine.ctx.currentTime, engine.secondsPerStep);
  }
  // Lifting a finger can land on a target chord too (Cmaj7 minus B is C).
  if (held.size) emit({ type: 'held', notes: activeNotes() });
  updateChordDisplay();
  paintKeys();
}

// How long the keys held right now have been held, for "hold a chord for 8
// seconds". Reported when they change, and on every beat while they ring.
function reportHold(ongoing) {
  if (!held.size || state.holdSince === null || !engine.ctx) return;
  const seconds = Math.round((engine.ctx.currentTime - state.holdSince) * 10) / 10;
  emit({ type: 'hold', notes: [...held], seconds, ongoing, freeTime: state.freeTime });
}

function holdChanged() {
  reportHold(false);
  state.holdSince = engine.ctx ? engine.ctx.currentTime : null;
}

// ---------- clock: arp, drums, click, bars ----------

engine.onStep = (step, time) => {
  // pos: the sixteenth within the bar. How many make a bar follows the time signature.
  const meter = meterOf(state.meter);
  const pos = step % meter.steps;
  const onBeat = meter.beats.includes(pos); // a counted beat: played a little harder
  if (pos === 0) onBarStart(step, time);

  // Swing moves the off-beat sixteenths of the arpeggio, bass, drums and loop.
  const swung = time + swingDelay(step, state.swing) * engine.secondsPerStep;
  const loop = looper.tick(step, time, engine.secondsPerStep);
  for (const e of loop.events) {
    if (e.sound === 'chop') playSliceNow(e.note, e.vel, swung);
    else engine.playNote(e.note, e.vel, swung, engine.secondsPerStep * e.dur, e.sound);
    recordStep('keys', step, e.note, e.vel, e.dur);
  }
  if (loop.changed) {
    const layers = looper.layers.length;
    engine.atTime(time, () => {
      renderLooper();
      if (loop.finished) emit({ type: 'loopLayer', layers });
    });
  }

  if (state.drums && !state.freeTime) {
    // A pattern written for this time signature plays as is; a 4/4 one is fitted to the bar.
    const own = state.drumPattern !== 'my beat' && METER_PATTERNS[state.meter]?.[state.drumPattern];
    const p = own || (state.drumPattern === 'my beat' ? state.grid : DRUM_PATTERNS[state.drumPattern]);
    const at = own ? pos : patternStep(pos);
    for (const kind of DRUM_KINDS) {
      if (p[kind]?.includes(at)) {
        const accent = (DRUM_LEVELS[kind] ?? 1) * ((kind === 'hat' || kind === 'brush') && !onBeat ? 0.7 : 1);
        engine.drum(kind, swung, accent);
        recordStep('drums', step, DRUM_NOTES[kind], Math.round(100 * accent), 1);
      }
    }
  }
  if (state.click && !state.freeTime && meter.beats.includes(pos)) engine.drum('click', time, pos === 0 ? 1.4 : 0.8);

  const notes = latch.notes(state.latch);
  if (state.bass && !state.freeTime && notes.length) {
    const b = bassNote(notes, patternStep(pos), state.bassStyle);
    if (b !== null) {
      const vel = onBeat ? 100 : 84;
      const len = bassLength(state.bassStyle, meter.steps);
      const steps = len < 1 ? len : Math.round(len);
      const sound = state.bassStyle === 'sub' ? 'sub' : BASS_SOUND;
      engine.playNote(b, vel, swung, engine.secondsPerStep * len, sound, 'bass');
      recordStep('bass', step, b, vel, steps);
      looper.addAt(step, b, vel, steps, sound);
    }
  }

  if (state.arp && !state.freeTime && notes.length) {
    const chordHit = Boolean(CHORD_PATTERNS[state.arpPattern]);
    const eno = state.arpPattern === 'eno';
    for (const n of arpNotes(state.arpPattern, notes, step, pos)) {
      const vel = eno ? 58 + Math.floor(Math.random() * 16) : (onBeat ? 96 : 76) + Math.floor(Math.random() * 12) - (chordHit ? 14 : 0);
      const steps = eno ? 24 : chordHit ? chordLength(state.arpPattern) : 3.5;
      // Short chord hits (skank, stab) stay short when recorded or looped.
      const kept = steps < 1 ? steps : Math.round(steps);
      if (engine.sound === 'chop') playSliceNow(n, vel, swung);
      else engine.playNote(n, vel, swung, engine.secondsPerStep * steps);
      recordStep('keys', step, n, vel, kept);
      looper.addAt(step, n, vel, kept, engine.sound);
    }
  }

  if (state.drums && state.drumPattern === 'my beat') engine.atTime(time, () => markGridStep(patternStep(pos)));
  const beat = meter.beats.indexOf(pos);
  if (beat !== -1) {
    engine.atTime(time, () => {
      reportHold(true);
      $('bar').textContent = state.chartRunning && !state.freeTime ? `bar ${Math.max(1, state.bar - state.chartStartBar + 1)} · beat ${beat + 1}` : '';
      highlightChart(beat === meter.beats.length - 1);
    });
  }
};

function onBarStart(step, time) {
  progressionBar(time);
  const notes = latch.notes(state.latch);
  const arpOn = state.arp;
  const drums = state.drums;
  const { arpPattern: pattern, drumPattern, kit, bass, bassStyle, swing, meter } = state;
  const fx = { ...engine.fx };
  const { drumFuzz } = engine;
  const sound = engine.sound;
  const loopPlaying = ['playing', 'overdubArmed', 'overdubbing'].includes(looper.status);
  const loopLayers = looper.layers.length;
  const drone = updateDrone(notes, time);
  if (state.rec === 'armed') {
    state.rec = 'recording';
    state.recording = {
      startStep: step, startTime: time, keys: [], bass: [], drums: [], pending: new Map(), bpm: engine.bpm, meter: state.meter,
      barLog: [], changes: [], presses: [],
    };
    engine.atTime(time, renderRecordButton);
  }
  if (state.rec === 'recording') {
    // What was sounding at this bar line, and which chart chord was due.
    const n = lesson.chart?.length;
    const expected = state.chartRunning && n ? lesson.chart[Math.max(0, state.bar + 1 - state.chartStartBar) % n] : null;
    state.recording.barLog.push({ notes: state.arp ? notes : [...held], expected });
  }
  engine.atTime(time, () => {
    state.bar += 1;
    highlightChart(false);
    // The bar that just finished counts toward "hold this chord for N bars".
    if (arpOn && notes.length) emit({ type: 'arpBar', notes, drums, pattern, drumPattern, drone, bass, bassStyle, sound, fx, drumFuzz, swing, meter });
    emit({ type: 'bar', drums, drumPattern, kit, drumFuzz, swing, meter });
    if (loopPlaying) emit({ type: 'loopBar', layers: loopLayers });
  });
}

// ---------- drone ----------

// Hold the chord's lowest note as a low string drone, restarting it every
// 4 bars (the recordings are about 12 seconds long) or when the chord changes.
function updateDrone(notes, time) {
  const current = state.droneVoice;
  if (!state.drone || !notes.length) {
    if (current) {
      current.release(time);
      state.droneVoice = null;
    }
    return false;
  }
  let root = Math.min(...notes);
  while (root > 52) root -= 12;
  while (root < 40) root += 12;
  const due = !current || current.root !== root || state.bar + 1 - current.startBar >= 4;
  if (due) {
    if (current) current.release(time + 0.8); // overlap so the drone never gaps
    const release = engine.voice(root, 70, time, DRONE_SOUND, 'drone');
    const fifth = engine.voice(root + 7, 55, time, DRONE_SOUND, 'drone');
    state.droneVoice = { root, startBar: state.bar + 1, release: (t) => (release(t), fifth(t)) };
  }
  return true;
}

// ---------- recording ----------

// Swung notes are written late too, so the sketch keeps its groove in GarageBand.
function recordStep(track, step, note, vel, steps) {
  const r = state.recording;
  if (state.rec !== 'recording' || !r || step < r.startStep) return;
  const tick = (step - r.startStep) * TICKS_PER_STEP + Math.round(swingDelay(step, state.swing) * TICKS_PER_STEP);
  r[track].push({ tick, note, vel, dur: steps * TICKS_PER_STEP });
}

function currentTick() {
  const r = state.recording;
  return Math.max(0, Math.round(((engine.ctx.currentTime - r.startTime) / engine.secondsPerStep) * TICKS_PER_STEP));
}

function recordDirectOn(note, vel) {
  if (state.rec !== 'recording') return;
  state.recording.pending.set(note, { tick: currentTick(), note, vel });
}

function recordDirectOff(note) {
  if (state.rec !== 'recording') return;
  const p = state.recording.pending.get(note);
  if (!p) return;
  state.recording.pending.delete(note);
  state.recording.keys.push({ ...p, dur: Math.max(30, currentTick() - p.tick) });
}

function renderRecordButton() {
  const b = $('record');
  b.classList.toggle('armed', state.rec === 'armed');
  b.classList.toggle('on', state.rec === 'recording');
  b.textContent = { idle: '● Record', stopped: '● Record', armed: 'Starts on next bar…', recording: '■ Stop' }[state.rec];
  lockTempo();
}

// Tempo is fixed while recording or looping, so notes stay on the beat.
function lockTempo() {
  $('bpm').disabled = state.rec === 'recording' || looper.active;
  $('meter').disabled = $('bpm').disabled;
}

// ---------- looper ----------

const LOOPER_LABELS = {
  empty: '↻ Record loop',
  armed: 'Starts on next bar…',
  recording: 'Recording loop…',
  playing: '↻ Add layer',
  overdubArmed: 'Layer starts at the loop start…',
  overdubbing: 'Recording layer…',
  paused: '▶ Play loop',
  resumeArmed: 'Starts on next bar…',
};

function renderLooper() {
  const b = $('looper-btn');
  b.textContent = LOOPER_LABELS[looper.status];
  b.classList.toggle('on', looper.capturing);
  b.classList.toggle('waiting', ['armed', 'overdubArmed', 'resumeArmed'].includes(looper.status));
  $('looper-undo').disabled = !looper.layers.length;
  $('looper-clear').disabled = !looper.active;
  $('looper-bars').disabled = looper.active;
  const n = looper.layers.length;
  $('looper-info').textContent = n ? `${n} layer${n === 1 ? '' : 's'}` : '';
  lockTempo();
}

function wireLooper() {
  $('looper-btn').onclick = () => {
    if (!engine.ctx) return;
    looper.press();
    renderLooper();
  };
  $('looper-bars').onchange = (e) => {
    looper.bars = Number(e.target.value);
  };
  $('looper-undo').onclick = () => {
    looper.undo();
    renderLooper();
    emit({ type: 'loopUndo' });
  };
  $('looper-clear').onclick = () => {
    looper.clear();
    renderLooper();
  };
}

function toggleRecord() {
  if (state.rec === 'idle' || state.rec === 'stopped') {
    state.rec = 'armed';
  } else if (state.rec === 'armed') {
    state.rec = 'idle';
  } else if (state.rec === 'recording') {
    const r = state.recording;
    for (const note of [...r.pending.keys()]) recordDirectOff(note);
    const steps = (engine.ctx.currentTime - r.startTime) / engine.secondsPerStep;
    r.bars = Math.max(1, Math.round(steps / meterOf(r.meter).steps));
    state.lastTake = measureTake({
      lesson: lesson.title,
      bpm: r.bpm,
      bars: r.bars,
      barBeats: meterOf(r.meter).steps / 4,
      targetBars: lesson.chart?.length || 8,
      barLog: r.barLog,
      changes: r.changes,
      presses: r.presses,
      stopT: engine.ctx.currentTime - r.startTime,
      layers: {
        sound: engine.sound, arp: state.arp, pattern: state.arp ? state.arpPattern : null,
        bass: state.bass, drone: state.drone, drums: state.drums,
        drumPattern: state.drums ? state.drumPattern : null, kit: state.kit, fx: { ...engine.fx },
      },
      expected: lesson.setup || {},
    });
    state.lastTake.sketch = null;
    showTakePanel();
    state.rec = 'stopped';
    $('save-info').textContent = `${r.bars} bar${r.bars === 1 ? '' : 's'} recorded at ${r.bpm} BPM.`;
    $('sketch-name').value = lesson.chart ? lesson.chart.filter((c, i, a) => a.indexOf(c) === i).join(' ') : '';
    $('save-row').hidden = false;
    emit({ type: 'recorded', bars: r.bars, meter: r.meter });
  }
  renderRecordButton();
}

async function saveSketch() {
  const r = state.recording;
  if (!r) return;
  const limit = r.bars * meterOf(r.meter).steps * TICKS_PER_STEP;
  const within = (events) => events.filter((e) => e.tick < limit);
  const bytes = writeMidi(
    [
      { name: 'Guitar', channel: 0, events: within(r.keys) },
      ...(r.bass.length ? [{ name: 'Bass', channel: 1, events: within(r.bass) }] : []),
      { name: 'Drums', channel: 9, events: within(r.drums) },
    ],
    r.bpm,
    r.meter,
  );
  const data = btoa(String.fromCharCode(...bytes));
  const name = $('sketch-name').value.trim() || 'sketch';
  const res = await fetch('/api/sketches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `${name} ${r.bpm}bpm`, data }),
  });
  if (!res.ok) {
    $('save-info').textContent = 'Could not save. Is the server still running?';
    return;
  }
  const saved = await res.json();
  if (state.lastTake) state.lastTake.sketch = saved.file;
  state.recording = null;
  state.rec = 'idle';
  $('save-row').hidden = true;
  renderRecordButton();
  await loadSketches();
  emit({ type: 'saved' });
}

async function loadSketches() {
  const files = await loadJson('/api/sketches', []);
  const ul = $('sketch-list');
  ul.innerHTML = '';
  if (!files.length) {
    ul.innerHTML = '<li class="muted">None yet. The recording lesson makes your first.</li>';
    return;
  }
  for (const f of files) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = f.replace(/\.mid$/, '');
    const b = document.createElement('button');
    b.textContent = 'Show in Finder';
    b.onclick = () =>
      fetch('/api/sketches/reveal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: f }) });
    li.append(span, b);
    ul.append(li);
  }
}

// ---------- where things live: sketches folder, About, uninstall ----------

let places = null; // {data, sketches, customSketches, app, home} from the server
let appVersion = '';

function placePath(path) {
  return places?.home && path.startsWith(`${places.home}/`) ? `~${path.slice(places.home.length)}` : path;
}

async function loadPlaces() {
  places = await loadJson('/api/places', null);
  renderSketchFolder();
}

function renderSketchFolder() {
  if (!places) return;
  $('sketch-folder').innerHTML = `Saved in <code>${esc(placePath(places.sketches))}</code> · <button id="sketch-change" class="link" type="button">Change folder…</button>${places.customSketches ? ' · <button id="sketch-default" class="link" type="button">Use the default</button>' : ''}`;
  $('sketch-change').onclick = () => changeSketchFolder(false);
  if (places.customSketches) $('sketch-default').onclick = () => changeSketchFolder(true);
}

// Pick where new sketches are saved. Sketches already saved stay put unless you say move them.
async function changeSketchFolder(reset) {
  const res = await fetch('/api/sketches/folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reset }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.cancelled) return;
  await loadPlaces();
  await loadSketches();
  const note = $('sketch-move');
  if (!body.left) {
    note.hidden = true;
    return;
  }
  note.hidden = false;
  note.innerHTML = `${body.left} sketch${body.left === 1 ? ' is' : 'es are'} still in <code>${esc(placePath(body.previous))}</code>. <button id="sketch-move-go" class="link" type="button">Move them here</button> · <button id="sketch-move-no" class="link" type="button">Leave them</button>`;
  $('sketch-move-no').onclick = () => { note.hidden = true; };
  $('sketch-move-go').onclick = async () => {
    const r = await fetch('/api/sketches/move', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const m = await r.json().catch(() => ({}));
    note.textContent = r.ok
      ? `Moved ${m.moved}.${m.skipped ? ` ${m.skipped} stayed behind: a file with the same name is already here.` : ''}`
      : m.error || 'Could not move them.';
    await loadSketches();
  };
}

async function openAbout() {
  await loadPlaces();
  $('about-version').textContent = appVersion ? `Version ${appVersion}` : 'Running from its code folder.';
  $('about-data').textContent = places ? placePath(places.data) : '';
  $('about-sketches').textContent = places ? placePath(places.sketches) : '';
  $('uninstall-confirm').hidden = true;
  $('uninstall-start').hidden = false;
  $('uninstall-status').textContent = '';
  $('uninstall-data').checked = false;
  const packaged = Boolean(places?.app);
  $('uninstall-btn').hidden = !packaged;
  $('uninstall-note').textContent = packaged
    ? 'Moves Music Coach to the Trash. Your saved things stay unless you choose otherwise.'
    : "You're running Music Coach from its code folder. To remove it, delete that folder, and any Music Coach shortcut you made.";
  $('uninstall-sketches-note').textContent = places?.customSketches
    ? ' (the sketches folder you chose stays where it is)'
    : ', and my sketches';
  $('about-dialog').showModal();
}

function wireAbout() {
  $('app-version').onclick = openAbout;
  $('uninstall-btn').onclick = () => {
    $('uninstall-start').hidden = true;
    $('uninstall-confirm').hidden = false;
    $('uninstall-cancel').focus();
  };
  $('uninstall-cancel').onclick = () => {
    $('uninstall-confirm').hidden = true;
    $('uninstall-start').hidden = false;
    $('uninstall-btn').focus();
  };
  $('uninstall-go').onclick = async () => {
    $('uninstall-go').disabled = true;
    $('uninstall-cancel').disabled = true;
    try {
      const res = await fetch('/api/uninstall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ removeData: $('uninstall-data').checked }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      $('uninstall-confirm').hidden = true;
      const kept = body.kept?.length ? ` Left where they are: ${body.kept.map(placePath).join(', ')}.` : '';
      const failed = body.failed?.length ? ` Couldn't move: ${body.failed.join('; ')}. Drag those to the Trash yourself.` : '';
      $('uninstall-status').textContent = `Music Coach is in the Trash, and the coach has stopped. You can close this tab. Changed your mind? Open the Trash and drag Music Coach back out.${kept}${failed}`;
    } catch (err) {
      $('uninstall-go').disabled = false;
      $('uninstall-cancel').disabled = false;
      $('uninstall-status').textContent = `Couldn't uninstall: ${err.message || 'the coach did not answer.'}`;
    }
  };
}

// ---------- studio controls ----------

function setSeg(id, value) {
  for (const b of $(id).querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === value);
}

function renderStudio() {
  setSeg('sound', engine.sound);
  $('bpm').value = engine.bpm;
  $('bpm-val').textContent = `${engine.bpm} BPM`;
  for (const b of document.querySelectorAll('[data-fx]')) b.classList.toggle('on', engine.fx[b.dataset.fx]);
  $('arp').classList.toggle('on', state.arp);
  $('latch').classList.toggle('on', state.latch);
  $('drums').classList.toggle('on', state.drums);
  $('drum-fuzz').classList.toggle('on', engine.drumFuzz);
  $('free-time').classList.toggle('on', state.freeTime);
  $('click').classList.toggle('on', state.click);
  $('drone').classList.toggle('on', state.drone);
  $('bass').classList.toggle('on', state.bass);
  $('bass-style').value = state.bassStyle;
  $('swing').value = Math.round(state.swing * 100);
  $('meter').value = state.meter;
  $('half-speed').classList.toggle('on', state.halfSpeed);
  $('drum-kit').value = state.kit;
  $('reverse').classList.toggle('on', state.reverse);
  $('beat').hidden = state.drumPattern !== 'my beat';
  $('sampler').hidden = engine.sound !== 'chop';
  $('filter').value = Math.round(engine.brightness * 100);
  $('arp-pattern').value = state.arpPattern;
  $('drum-pattern').value = state.drumPattern;
}

function applySetup(s) {
  if (s.sound) engine.sound = s.sound;
  if (s.bpm) engine.setBpm(s.bpm);
  if (s.brightness !== undefined) engine.setBrightness(s.brightness);
  else engine.setBrightness(1);
  loadSound(engine.sound);
  for (const key of ['arp', 'latch', 'arpPattern', 'drums', 'drumPattern', 'click', 'drone', 'bass', 'bassStyle']) {
    if (s[key] !== undefined) state[key] = s[key];
  }
  if (s.click === undefined) state.click = false;
  if (s.drone === undefined) state.drone = false;
  if (s.bass === undefined) state.bass = false;
  if (state.bass) loadSound(BASS_SOUND);
  state.swing = s.swing ?? 0;
  // The meter never changes under a recording, and a lesson that doesn't name
  // one leaves a loop (and the meter it was recorded in) alone.
  if (state.rec !== 'recording' && (s.meter || !looper.active)) setMeter(s.meter || '4/4');
  setFreeTime(Boolean(s.freeTime));
  engine.setDrumFuzz(Boolean(s.drumFuzz));
  // Never start drums just because a lesson opened: wait for the first note.
  state.drumsWaiting = state.drums;
  state.drums = false;
  if (s.kit) setKit(s.kit);
  // The Durutti chain is on by default; fuzz and reverse reverb only when a lesson asks.
  const fx = { fuzz: false, chorus: true, echo: true, reverb: true, reverse: false, wobble: false, ...(s.fx || {}) };
  for (const [name, on] of Object.entries(fx)) engine.setFx(name, on);
  engine.allOff();
  renderStudio();
}

// A new time signature changes how long a bar is. A loop recorded in the old
// one no longer fits its bars, so it is cleared.
function setMeter(name) {
  const next = METERS[name] ? name : '4/4';
  if (next === state.meter) return;
  state.meter = next;
  if (looper.active) {
    looper.clear();
    renderLooper();
  }
  looper.stepsPerBar = METERS[next].steps;
}

// True while anything is sounding: a chord, the drums, or a playing loop.
function somethingPlaying() {
  return activeNotes().length > 0 || state.drums || ['playing', 'overdubArmed', 'overdubbing'].includes(looper.status);
}

// "No beat": the clock keeps running for the chart, but nothing plays on it.
// The arpeggiator goes off too, so the keys play straight through and ring.
function setFreeTime(on) {
  state.freeTime = on;
  if (!on) return;
  state.arp = false;
  state.drums = false;
  state.click = false;
  state.bass = false;
  latch.clear();
}

// Silence everything: held notes, the latched arpeggio chord, and the drums.
function stopAll() {
  finderStop();
  if (prog.playing) {
    prog.playing = false;
    renderProgression();
  }
  looper.pause();
  renderLooper();
  state.chartRunning = false;
  state.drumsWaiting = false;
  highlightChart(false);
  held.clear();
  latch.clear();
  state.drone = false;
  if (state.droneVoice) {
    state.droneVoice.release(engine.ctx.currentTime);
    state.droneVoice = null;
  }
  engine.allOff();
  state.drums = false;
  state.click = false;
  renderStudio();
  updateChordDisplay();
  paintKeys();
}

function wireStudio() {
  for (const name of [...Object.keys(ARP_PATTERNS), ...Object.keys(CHORD_PATTERNS), 'eno']) $('arp-pattern').add(new Option(name, name));
  for (const name of [...Object.keys(DRUM_PATTERNS), 'my beat']) $('drum-pattern').add(new Option(name, name));
  $('drum-kit').onchange = (e) => setKit(e.target.value);
  $('grid-clear').onclick = () => {
    for (const [row] of GRID_ROWS) state.grid[row] = [];
    gridChanged();
  };
  $('bass-style').onchange = (e) => {
    state.bassStyle = e.target.value;
  };
  $('half-speed').onclick = () => {
    state.halfSpeed = !state.halfSpeed;
    renderStudio();
  };
  $('reverse').onclick = () => {
    state.reverse = !state.reverse;
    renderStudio();
  };
  $('loop').onchange = (e) => e.target.value && loadLoop(e.target.value);
  $('mic-rec').onclick = toggleMicRecording;

  $('sound').onclick = (e) => {
    if (!e.target.dataset.v) return;
    engine.allOff();
    engine.sound = e.target.dataset.v;
    loadSound(engine.sound);
    renderStudio();
  };
  $('bass').onclick = () => {
    state.bass = !state.bass;
    if (state.bass) state.freeTime = false;
    loadSound(BASS_SOUND);
    renderStudio();
  };
  $('drone').onclick = () => {
    state.drone = !state.drone;
    loadSound(DRONE_SOUND);
    renderStudio();
  };
  $('filter').oninput = (e) => {
    engine.setBrightness(Number(e.target.value) / 100);
    emit({ type: 'filter', value: engine.brightness });
  };
  $('bpm').oninput = (e) => {
    engine.setBpm(Number(e.target.value));
    renderStudio();
  };
  for (const b of document.querySelectorAll('[data-fx]')) {
    b.onclick = () => {
      const which = b.dataset.fx;
      engine.setFx(which, !engine.fx[which]);
      renderStudio();
      emit({ type: 'fx', which, enabled: engine.fx[which] });
    };
  }
  $('arp').onclick = () => {
    state.arp = !state.arp;
    if (state.arp) state.freeTime = false;
    engine.allOff();
    latch.clear();
    for (const n of held) latch.press(n);
    renderStudio();
    updateChordDisplay();
    paintKeys();
  };
  $('latch').onclick = () => {
    state.latch = !state.latch;
    renderStudio();
    updateChordDisplay();
    paintKeys();
  };
  $('arp-pattern').onchange = (e) => (state.arpPattern = e.target.value);
  $('drum-pattern').onchange = (e) => {
    state.drumPattern = e.target.value;
    renderStudio();
  };
  $('drums').onclick = () => {
    state.drumsWaiting = false;
    state.drums = !state.drums;
    if (state.drums) state.freeTime = false;
    renderStudio();
  };
  $('click').onclick = () => {
    state.click = !state.click;
    if (state.click) state.freeTime = false;
    renderStudio();
  };
  for (const name of Object.keys(METERS)) $('meter').add(new Option(name, name));
  $('meter').onchange = (e) => {
    setMeter(e.target.value);
    renderStudio();
    emit({ type: 'meter', meter: state.meter });
  };
  $('swing').oninput = (e) => {
    state.swing = Number(e.target.value) / 100;
  };
  $('swing').onchange = () => emit({ type: 'swing', value: state.swing });
  $('drum-fuzz').onclick = () => {
    engine.setDrumFuzz(!engine.drumFuzz);
    renderStudio();
    emit({ type: 'drumFuzz', enabled: engine.drumFuzz });
  };
  $('free-time').onclick = () => {
    setFreeTime(!state.freeTime);
    state.drumsWaiting = false;
    engine.allOff();
    renderStudio();
    updateChordDisplay();
    paintKeys();
    emit({ type: 'freeTime', enabled: state.freeTime });
  };
  // Throw: hold for a burst of dub echo; let go and it settles back.
  const throwBtn = $('throw');
  const throwOn = () => {
    if (!engine.ctx || throwBtn.classList.contains('on')) return;
    throwBtn.classList.add('on');
    engine.setThrow(true);
    emit({ type: 'throw', playing: somethingPlaying() });
  };
  const throwOff = () => {
    if (!throwBtn.classList.contains('on')) return;
    throwBtn.classList.remove('on');
    engine.setThrow(false);
  };
  throwBtn.addEventListener('pointerdown', (e) => {
    throwBtn.setPointerCapture(e.pointerId);
    throwOn();
  });
  throwBtn.addEventListener('pointerup', throwOff);
  throwBtn.addEventListener('pointercancel', throwOff);
  throwBtn.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    throwOn();
  });
  throwBtn.addEventListener('keyup', throwOff);
  throwBtn.addEventListener('blur', throwOff);
  $('stop').onclick = stopAll;
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') stopAll();
  });
  $('record').onclick = toggleRecord;
  $('save').onclick = saveSketch;
  $('discard').onclick = () => {
    state.recording = null;
    state.rec = 'idle';
    $('save-row').hidden = true;
    renderRecordButton();
  };
  $('next-lesson').onclick = () => {
    const next = nextOpenLesson();
    if (next) openLesson(next.id);
  };
}

// The effect buttons are the app's own imitations. Say so, and name the real
// plugin to reach for in GarageBand.
function renderFxNote() {
  for (const b of document.querySelectorAll('[data-fx]')) {
    const plugin = resolveGear(`{${b.dataset.fx}}`, lessonEnv());
    b.title = `Built into this app. In GarageBand, use ${plugin}.`;
  }
  const g = (k) => resolveGear(`{${k}}`, lessonEnv());
  $('fx-note').textContent = `Built into this app, not your plugins. In GarageBand use: ${g('chorus')} · ${g('echo')} · ${g('reverb')}`;
}

// ---------- mixer ----------

const MIX_PARTS = [['drums', 'Drums'], ['bass', 'Bass'], ['instrument', 'Guitar / main'], ['drone', 'Drone']];
const mix = { volumes: {}, pans: {}, mute: {}, solo: {} };

function resetMixer() {
  for (const [part] of MIX_PARTS) {
    mix.volumes[part] = 1;
    mix.pans[part] = 0;
    mix.mute[part] = false;
    mix.solo[part] = false;
  }
  applyMix();
  renderMixer();
}

// A muted part is silent; while any part is soloed, only soloed parts play.
function applyMix() {
  if (!engine.channels) return;
  const anySolo = MIX_PARTS.some(([p]) => mix.solo[p]);
  for (const [part] of MIX_PARTS) {
    const silent = mix.mute[part] || (anySolo && !mix.solo[part]);
    engine.setChannel(part, { volume: silent ? 0 : mix.volumes[part], pan: mix.pans[part] });
  }
}

function mixChanged() {
  applyMix();
  renderMixer();
  emit({
    type: 'mix',
    volumes: { ...mix.volumes },
    pans: { ...mix.pans },
    soloed: MIX_PARTS.filter(([p]) => mix.solo[p]).map(([p]) => p),
    muted: MIX_PARTS.filter(([p]) => mix.mute[p]).map(([p]) => p),
  });
}

function renderMixer() {
  const box = $('mixer-strips');
  box.innerHTML = '';
  for (const [part, name] of MIX_PARTS) {
    const strip = document.createElement('div');
    strip.className = 'strip';
    const pan = mix.pans[part];
    strip.innerHTML = `
      <strong>${name}</strong>
      <label>Volume <span>${Math.round(mix.volumes[part] * 100)}%</span></label>
      <input type="range" min="0" max="1.5" step="0.05" value="${mix.volumes[part]}" aria-label="${name} volume">
      <label>Pan <span>${pan === 0 ? 'centre' : pan < 0 ? `${Math.round(-pan * 100)}% left` : `${Math.round(pan * 100)}% right`}</span></label>
      <input type="range" min="-1" max="1" step="0.05" value="${pan}" aria-label="${name} pan">
      <div class="ms"><button class="${mix.mute[part] ? 'on' : ''}" title="Mute">M</button><button class="${mix.solo[part] ? 'on' : ''}" title="Solo">S</button></div>`;
    const [vol, panInput] = strip.querySelectorAll('input');
    vol.onchange = () => { mix.volumes[part] = Number(vol.value); mixChanged(); };
    panInput.onchange = () => { mix.pans[part] = Number(panInput.value); mixChanged(); };
    const [m, sBtn] = strip.querySelectorAll('.ms button');
    m.onclick = () => {
      mix.mute[part] = !mix.mute[part];
      mixChanged();
      // Dropping a part out and back in while the music plays, as dub does.
      emit({ type: 'mute', part, muted: mix.mute[part], playing: somethingPlaying() });
    };
    sBtn.onclick = () => { mix.solo[part] = !mix.solo[part]; mixChanged(); };
    box.append(strip);
  }
}

// ---------- chord explorer ----------

function audition(notes, stagger = 0) {
  if (!engine.ctx) {
    $('chord-dialog-note').textContent = 'Press Start in Music Coach first, then click a chord to hear it.';
    return;
  }
  const sound = engine.sound === 'chop' ? 'epiano' : engine.sound;
  const now = engine.ctx.currentTime + 0.02;
  notes.forEach((n, i) => engine.playNote(n, 85, now + i * stagger, 2.2, sound));
  $('chord-dialog-note').textContent = 'Click any chord or pair to hear it.';
}

function chordButton(label, notes, stagger) {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = () => audition(notes, stagger);
  return b;
}

function chordRow(title, buttons, note) {
  const row = document.createElement('div');
  row.className = 'chord-row';
  const t = document.createElement('strong');
  t.textContent = title;
  const wrap = document.createElement('div');
  wrap.className = 'buttons';
  wrap.append(...buttons);
  row.append(t, wrap);
  if (note) row.append(Object.assign(document.createElement('div'), { className: 'note', textContent: note }));
  return row;
}

// ---------- circle of fifths ----------

// Keys the lessons use, drawn a little bolder so the familiar area stands out.
const LESSON_KEYS = [5, 0, 7, 2]; // F, C, G, D (and their minor twins)
const wheel = { mode: 'major' };

function keyLabel(root, mode) {
  return mode === 'minor' ? `${spell(root, root, 'minor')}m` : spell(root, root, 'major');
}

function wheelSelected() {
  const key = currentKey();
  if (key && key.mode === wheel.mode) return key.root;
  return wheel.mode === 'minor' ? 9 : 0;
}

function describePair(a, b, mode) {
  const c = compareKeys(mode === 'minor' ? (a + 3) % 12 : a, mode === 'minor' ? (b + 3) % 12 : b);
  const [na, nb] = [keyLabel(a, mode), keyLabel(b, mode)];
  if (c.shared.length === 6) {
    return `${na} and ${nb} share 6 of 7 notes: only ${spell(c.onlyA[0], a, mode)} changes to ${spell(c.onlyB[0], b, mode)}.`;
  }
  return `${na} and ${nb} share only ${c.shared.length} of 7 notes.`;
}

function keyChordsFriendly(root, mode) {
  return keyChords(root, mode).filter((c) => !c.name.endsWith('dim'));
}

// Draw the 12 keys around a circle. options.mini draws a small, read-only copy.
function drawRing(selected, mode, options = {}) {
  const spot = circleSpot(selected, mode);
  const ring = document.createElement('div');
  ring.className = `wheel${options.mini ? ' mini' : ''}`;
  for (let i = 0; i < 12; i++) {
    const root = keyAtSpot(i, mode);
    const b = document.createElement(options.mini ? 'span' : 'button');
    b.className = 'wheel-key';
    const relativeMajor = mode === 'minor' ? (root + 3) % 12 : root;
    if (LESSON_KEYS.includes(relativeMajor)) b.classList.add('lesson-key');
    b.style.setProperty('--angle', `${i * 30}deg`);
    const twin = mode === 'minor' ? keyLabel(relativeMajor, 'major') : keyLabel((root + 9) % 12, 'minor');
    b.innerHTML = options.mini ? `<strong>${keyLabel(root, mode)}</strong>` : `<strong>${keyLabel(root, mode)}</strong><small>${twin}</small>`;
    b.title = `${keyName(root, mode)}: ${keyPitchClasses(root, mode).map((pc) => spell(pc, root, mode)).join(' ')}`;
    const dist = Math.min((i - spot + 12) % 12, (spot - i + 12) % 12);
    b.classList.add(dist === 0 ? 'selected' : dist === 1 ? 'near' : 'far');
    if (!options.mini) b.onclick = () => options.onPick(root);
    ring.append(b);
  }
  return ring;
}

function playChordNames(names, gap = 1.2) {
  if (!engine.ctx) return;
  const sound = engine.sound === 'chop' ? 'epiano' : engine.sound;
  const now = engine.ctx.currentTime + 0.05;
  names.forEach((n, i) => voicing(n).forEach((note) => engine.playNote(note, 82, now + i * gap, gap * 0.95, sound)));
}

function buildWheel(container) {
  const mode = wheel.mode;
  const selected = wheelSelected();
  const spot = circleSpot(selected, mode);
  container.innerHTML = '';

  const modeRow = document.createElement('div');
  modeRow.className = 'wheel-modes';
  for (const m of ['major', 'minor']) {
    const b = document.createElement('button');
    b.textContent = m === 'major' ? 'Major keys' : 'Minor keys';
    b.classList.toggle('on', m === mode);
    b.onclick = () => {
      wheel.mode = m;
      buildWheel(container);
    };
    modeRow.append(b);
  }
  container.append(modeRow);

  container.append(drawRing(selected, mode, {
    onPick: (root) => {
      progress.key = `${root}:${mode}`;
      saveProgress();
      renderKeyPicker();
      buildWheel(container);
    },
  }));

  const info = document.createElement('div');
  info.className = 'wheel-info';
  const left = keyAtSpot(spot - 1, mode);
  const right = keyAtSpot(spot + 1, mode);
  const across = keyAtSpot(spot + 6, mode);
  info.append(Object.assign(document.createElement('p'), { textContent: 'Neighbours sound natural together, because they share almost every note:' }));
  for (const other of [left, right]) info.append(Object.assign(document.createElement('p'), { textContent: describePair(selected, other, mode) }));
  info.append(Object.assign(document.createElement('p'), { textContent: `${describePair(selected, across, mode)} That is the far side of the wheel: a jump there sounds dramatic.` }));

  const hear = document.createElement('div');
  hear.className = 'buttons';
  const step = wheelDemo(selected, mode, 'step');
  const jump = wheelDemo(selected, mode, 'jump');
  const stepBtn = Object.assign(document.createElement('button'), { textContent: `▶ One step around (${step.map((n) => respellName(n, selected, mode)).join(' → ')})` });
  stepBtn.onclick = () => playChordNames(step);
  const jumpBtn = Object.assign(document.createElement('button'), { textContent: `▶ Jump across (${jump.map((n) => respellName(n, selected, mode)).join(' → ')})` });
  jumpBtn.onclick = () => playChordNames(jump);
  hear.append(stepBtn, jumpBtn);
  info.append(hear);

  const row = document.createElement('div');
  row.className = 'buttons';
  row.append(Object.assign(document.createElement('span'), { className: 'muted', textContent: `Six chords that always work in ${keyName(selected, mode)}. ▶ hears it, + adds it to Build a progression:` }));
  for (const c of keyChordsFriendly(selected, mode)) row.append(chordChip(c));
  info.append(row);
  container.append(info);
}

function respellName(name, root, mode) {
  return name.replace(/^[A-G]#?/, (n) => spell(NOTE_INDEX[n], root, mode));
}
const NOTE_INDEX = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };

// One chord: a button to hear it, and a separate + to add it to the progression.
function chordChip(c) {
  const chip = document.createElement('span');
  chip.className = 'chip';
  const hearBtn = Object.assign(document.createElement('button'), { textContent: `▶ ${c.label}` });
  hearBtn.onclick = () => playChordNames([c.name], 1.6);
  const add = Object.assign(document.createElement('button'), { textContent: '+', title: `Add ${c.label} to Build a progression` });
  add.className = 'add';
  add.onclick = () => addToProgression(c);
  chip.append(hearBtn, add);
  return chip;
}

// ---------- mini wheel in lessons with a chord chart ----------

function renderLessonWheel() {
  const box = $('lesson-wheel');
  const key = lessonKey(lesson.chart);
  box.hidden = !key;
  if (!key) return;
  box.innerHTML = '';
  box.append(drawRing(key.root, key.mode, { mini: true }));
  const chords = [...new Set(lesson.chart)].join(', ');
  box.append(Object.assign(document.createElement('p'), {
    className: 'muted',
    textContent: `This lesson is in ${keyName(key.root, key.mode)}. Its chords (${chords}) come from that key's family, so they blend.`,
  }));
}

// ---------- build a progression ----------

const prog = { slots: [null, null, null, null], playing: false, bar: 0 };

function addToProgression(c) {
  const i = prog.slots.indexOf(null);
  prog.slots[i === -1 ? prog.slots.length - 1 : i] = { name: c.name, label: c.label };
  $('prog').hidden = false;
  renderProgression();
  $('prog').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderProgression() {
  const box = $('prog-slots');
  box.innerHTML = '';
  prog.slots.forEach((slot, i) => {
    const cell = document.createElement('div');
    cell.className = 'prog-slot';
    cell.dataset.slot = i;
    if (slot) {
      cell.innerHTML = `<strong>${slot.label}</strong>`;
      const clear = Object.assign(document.createElement('button'), { textContent: '×', title: 'Clear this slot', className: 'ghost' });
      clear.onclick = () => {
        prog.slots[i] = null;
        renderProgression();
      };
      cell.append(clear);
    } else {
      cell.innerHTML = '<span class="muted">empty</span>';
    }
    box.append(cell);
  });
  const key = currentKey() || { root: 0, mode: 'major' };
  const chips = $('prog-chords');
  chips.innerHTML = '';
  chips.append(Object.assign(document.createElement('span'), { className: 'muted', textContent: `Chords in ${keyName(key.root, key.mode)}:` }));
  for (const c of keyChordsFriendly(key.root, key.mode)) chips.append(chordChip(c));
  $('prog-play').textContent = prog.playing ? '■ Stop' : '▶ Play the loop';
  $('prog-play').disabled = !prog.slots.some(Boolean);
  $('prog-save').disabled = !prog.slots.some(Boolean);
}

// Called at every bar line: move to the next filled slot and play its chord
// with the current sound, arpeggiator and drums.
function progressionBar(time) {
  if (!prog.playing) return;
  const filled = prog.slots.map((s, i) => ({ s, i })).filter((x) => x.s);
  if (!filled.length) return;
  const { s, i } = filled[prog.bar % filled.length];
  prog.bar += 1;
  const notes = voicing(s.name);
  if (state.arp) {
    latch.clear();
    notes.forEach((n) => latch.press(n));
    notes.forEach((n) => latch.release(n));
  } else {
    const sound = engine.sound === 'chop' ? 'epiano' : engine.sound;
    notes.forEach((n) => engine.playNote(n, 80, time, engine.secondsPerStep * (meterOf(state.meter).steps - 1), sound));
  }
  engine.atTime(time, () => {
    for (const c of $('prog-slots').children) c.classList.toggle('now', Number(c.dataset.slot) === i);
    updateChordDisplay();
  });
}

async function saveProgression() {
  const filled = prog.slots.filter(Boolean);
  const events = [];
  const bar = meterOf(state.meter).steps * TICKS_PER_STEP;
  for (let rep = 0; rep < 2; rep++) {
    filled.forEach((s, i) => {
      const tick = (rep * filled.length + i) * bar;
      for (const note of voicing(s.name)) events.push({ tick, note, vel: 85, dur: bar - 30 });
    });
  }
  const bytes = writeMidi([{ name: 'Chords', channel: 0, events }], engine.bpm, state.meter);
  const res = await fetch('/api/sketches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `${filled.map((s) => s.name).join(' ')} progression ${engine.bpm}bpm`, data: btoa(String.fromCharCode(...bytes)) }),
  });
  $('prog-note').textContent = res.ok ? 'Saved to Sketches: drag it into GarageBand from Show in Finder.' : 'Could not save. Is the server running?';
  loadSketches();
}

function wireProgression() {
  $('prog-open').onclick = () => {
    $('prog').hidden = !$('prog').hidden;
    renderProgression();
    if (!$('prog').hidden) $('prog').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  $('prog-play').onclick = () => {
    prog.playing = !prog.playing;
    prog.bar = 0;
    if (!prog.playing) {
      latch.clear();
      for (const c of $('prog-slots').children) c.classList.remove('now');
    }
    renderProgression();
  };
  $('prog-save').onclick = saveProgression;
}

function buildChordExplorer() {
  const body = $('chord-body');
  body.innerHTML = '';
  const h = (text) => Object.assign(document.createElement('h3'), { textContent: text });
  const p = (text) => Object.assign(document.createElement('p'), { textContent: text });
  const show = document.createElement('button');
  show.textContent = 'Show the wheel (what sounds good together)';
  const wheelBox = document.createElement('div');
  wheelBox.hidden = true;
  show.onclick = () => {
    wheelBox.hidden = !wheelBox.hidden;
    show.textContent = wheelBox.hidden ? 'Show the wheel (what sounds good together)' : 'Hide the wheel';
    if (!wheelBox.hidden) buildWheel(wheelBox);
  };
  body.append(show, wheelBox);
  body.append(h('Major and minor'), p(MAJOR_MINOR.text));
  body.append(chordRow('Try them', MAJOR_MINOR.chords.map((c) => chordButton(c, voicing(c))), null));
  body.append(h('What is a key?'), p(KEY_TEXT));
  body.append(h('Typical chords by style'), p('Typical, not rules.'));
  for (const s of STYLE_CHORDS) {
    let buttons;
    if (s.chords) buttons = s.chords.map((c) => chordButton(c, voicing(c)));
    else if (s.notes) buttons = [chordButton('Play the notes', s.notes, 0.6)];
    else buttons = s.pairs.map((pair) => chordButton(pair.label, pair.notes));
    body.append(chordRow(s.style, buttons, s.note));
  }
  body.append(h('Two notes together'), p('The gap between two notes has its own mood.'));
  for (const iv of INTERVALS) body.append(chordRow(iv.name, [chordButton('Hear it', iv.notes)], iv.mood));
}

// ---------- drum kits and the beat grid ----------

async function setKit(id) {
  state.kit = id;
  renderStudio();
  const kit = drumKits.find((k) => k.id === id);
  if (!kit || !engine.ctx) {
    engine.kit = 'synth';
    return;
  }
  try {
    await engine.loadDrumKit(kit);
    if (state.kit === id) engine.kit = id;
  } catch {
    engine.kit = 'synth';
  }
}

function renderGrid() {
  const grid = $('grid');
  grid.innerHTML = '';
  const nums = document.createElement('div');
  nums.className = 'grid-row';
  nums.innerHTML = '<span></span>' + Array.from({ length: 16 }, (_, i) => `<span class="step-nums">${i + 1}</span>`).join('');
  grid.append(nums);
  for (const [row, label] of GRID_ROWS) {
    const r = document.createElement('div');
    r.className = 'grid-row';
    const name = document.createElement('span');
    name.className = 'row-name';
    name.textContent = label;
    r.append(name);
    for (let i = 0; i < 16; i++) {
      const b = document.createElement('button');
      b.className = 'cell-btn';
      b.dataset.row = row;
      b.dataset.step = i;
      b.setAttribute('aria-label', `${label}, box ${i + 1}`);
      if (i % 4 === 0) b.classList.add('beat-start');
      b.classList.toggle('on', state.grid[row].includes(i));
      b.onclick = () => {
        const steps = state.grid[row];
        state.grid[row] = steps.includes(i) ? steps.filter((x) => x !== i) : [...steps, i].sort((a, c) => a - c);
        gridChanged();
      };
      r.append(b);
    }
    grid.append(r);
  }
}

function gridChanged() {
  progress.grid = state.grid;
  saveProgress();
  renderGrid();
  emit({ type: 'grid', grid: JSON.parse(JSON.stringify(state.grid)) });
}

function markGridStep(step) {
  if ($('beat').hidden) return;
  for (const b of $('grid').querySelectorAll('.cell-btn')) b.classList.toggle('now', Number(b.dataset.step) === step);
}

// ---------- sampler ----------

function renderLoops() {
  const select = $('loop');
  select.querySelectorAll('optgroup').forEach((og) => og.remove());
  for (const group of loops) {
    const og = document.createElement('optgroup');
    og.label = group.label;
    for (const f of group.files) og.append(new Option(f.split('/').pop().replace(/\.(wav|aiff?|mp3|m4a)$/i, ''), f));
    select.append(og);
  }
  $('slice-keys').innerHTML = ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C'].map((k, i) => `<span data-slice="${i}">${k}</span>`).join('');
}

async function loadLoop(path) {
  if (!engine.ctx) {
    $('loop-info').textContent = 'Press Start first, then pick the loop again.';
    return;
  }
  $('loop-info').textContent = 'Loading…';
  try {
    loopReady(await engine.loadChop(path));
  } catch {
    $('loop-info').textContent = 'Could not load that loop.';
  }
}

function loopReady(chop) {
  const bpm = tempoFromName(chop.name);
  if (bpm) engine.setBpm(bpm);
  renderStudio();
  drawWave(null);
  $('loop-info').textContent = `${chop.buffer.duration.toFixed(1)} seconds, cut into ${SLICES} slices.${bpm ? ` Tempo set to ${bpm} BPM from the file name.` : ''}`;
  emit({ type: 'loop' });
}

// Record a few seconds from the microphone and cut it up like a loop.
let micRecorder = null;
async function toggleMicRecording() {
  if (micRecorder) {
    micRecorder.stop();
    return;
  }
  if (!engine.ctx) {
    $('loop-info').textContent = 'Press Start first.';
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch {
    $('loop-info').textContent = 'Chrome was not allowed to use the microphone. Click the icon at the left of the address bar, allow the microphone, then try again.';
    return;
  }
  const chunks = [];
  const rec = new MediaRecorder(stream);
  micRecorder = rec;
  const limit = setTimeout(() => rec.state === 'recording' && rec.stop(), 8000);
  rec.ondataavailable = (e) => chunks.push(e.data);
  rec.onstop = async () => {
    clearTimeout(limit);
    stream.getTracks().forEach((t) => t.stop());
    micRecorder = null;
    $('mic-rec').textContent = '● Record a sound';
    $('mic-rec').classList.remove('on');
    try {
      const data = await new Blob(chunks, { type: rec.mimeType }).arrayBuffer();
      $('loop').value = '';
      loopReady(engine.setChop(await engine.ctx.decodeAudioData(data), 'Your recording'));
    } catch {
      $('loop-info').textContent = 'Could not use that recording. Try again.';
    }
  };
  rec.start();
  $('mic-rec').textContent = '■ Stop recording';
  $('mic-rec').classList.add('on');
  $('loop-info').textContent = 'Recording… make a sound. It stops by itself after 8 seconds.';
}

function playSliceNow(note, vel, time) {
  if (!engine.chop) {
    $('loop-info').textContent = 'Pick a loop first.';
    return;
  }
  const index = sliceForNote(note, SLICES);
  if (index === null) return;
  engine.playSlice(index, SLICES, vel, time, state.reverse, state.halfSpeed ? 0.5 : 1);
  engine.atTime(time, () => {
    drawWave(index);
    for (const k of $('slice-keys').children) k.classList.toggle('hit', Number(k.dataset.slice) === index);
    emit({ type: 'slice', index, reverse: state.reverse, halfSpeed: state.halfSpeed });
  });
}

// The loop's shape, with lines where the slices are cut. The playing slice is lit.
function drawWave(active) {
  const canvas = $('wave');
  const g = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  g.clearRect(0, 0, w, h);
  if (!engine.chop) return;
  const data = engine.chop.buffer.getChannelData(0);
  const css = getComputedStyle(document.documentElement);
  if (active !== null) {
    g.fillStyle = 'rgba(232, 184, 107, 0.18)';
    g.fillRect((active * w) / SLICES, 0, w / SLICES, h);
  }
  g.fillStyle = css.getPropertyValue('--accent').trim() || '#e8b86b';
  const step = Math.max(1, Math.floor(data.length / w));
  for (let x = 0; x < w; x++) {
    let peak = 0;
    for (let i = x * step; i < (x + 1) * step && i < data.length; i += 4) peak = Math.max(peak, Math.abs(data[i]));
    const bar = Math.max(1, peak * h * 0.9);
    g.fillRect(x, (h - bar) / 2, 1, bar);
  }
  g.fillStyle = css.getPropertyValue('--muted').trim() || '#9a978f';
  for (let i = 1; i < SLICES; i++) g.fillRect(Math.round((i * w) / SLICES), 0, 2, h);
}

// ---------- recorded instruments ----------

function renderSoundButtons() {
  const seg = $('sound');
  // The Sampler is always there: with no loops, you can record a sound of your own.
  if (!seg.querySelector('[data-v="chop"]')) {
    const b = document.createElement('button');
    b.dataset.v = 'chop';
    b.textContent = 'Sampler';
    seg.append(b);
  }
  for (const inst of instruments) {
    if (inst.id === 'guitar') continue;
    let b = seg.querySelector(`[data-v="${inst.id}"]`);
    if (!b) {
      b = document.createElement('button');
      b.dataset.v = inst.id;
      seg.insertBefore(b, seg.querySelector('[data-v="chop"]'));
    }
    b.textContent = inst.label;
    b.title = inst.recorded ? 'Recorded notes of the real instrument' : 'A built-in tone standing in for this instrument';
  }
  renderStudio();
}

// Fetch an instrument's recordings the first time it is needed.
async function loadSound(id) {
  const inst = instruments.find((i) => i.id === id);
  if (!inst || !engine.ctx) return;
  const button = $('sound').querySelector(`[data-v="${id}"]`);
  const label = id === 'guitar' && inst.recorded ? '12-String Guitar' : inst.label;
  if (!inst.recorded) {
    if (button) button.textContent = label;
    return;
  }
  if (button && !engine.sampleSets[id]) button.textContent = `${label} (loading…)`;
  const n = await engine.loadInstrument(inst);
  if (button) button.textContent = n ? label : `${label} (missing)`;
}

// ---------- take coach ----------

function showTakePanel() {
  const t = state.lastTake;
  $('take').hidden = false;
  $('score').disabled = false;
  $('report').innerHTML = '';
  $('take-info').textContent = `${t.ending.bars} bars at ${t.bpm} BPM, ${t.presses} key presses.`;
}

async function scoreTake() {
  const t = state.lastTake;
  if (!t) return;
  $('score').disabled = true;
  $('report').innerHTML = '<p class="muted">Scoring… the coach model reads the measurements (about 20–60 seconds).</p>';
  try {
    const res = await fetch('/api/takes/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metrics: t, scorecard: scoreAreas(t), lesson: t.lesson, sketch: t.sketch }),
    });
    const body = await res.json();
    if (res.status === 503 && body.noModel) {
      // No model to write the summary: the app's own scores still stand.
      t.takeNumber = body.take;
      renderReport({ scorecard: scoreAreas(t) }, t, null, body.error);
      loadScores();
      return;
    }
    if (!res.ok) {
      $('report').innerHTML = `<p class="answer error">${esc(body.error)}</p>`;
      $('score').disabled = false;
      return;
    }
    t.takeNumber = body.take;
    renderReport(body.report, t, body.previous);
    loadScores();
  } catch {
    $('report').innerHTML = '<p class="answer error">The Music Coach server is not running. Start it with ./music-coach</p>';
    $('score').disabled = false;
  }
}

const AREA_NAMES = { chords: 'Chords', timing: 'Timing', feel: 'Feel', sound: 'Sound setup', ending: 'Ending' };

function renderReport(r, t, previous, noModel) {
  const rows = Object.entries(AREA_NAMES)
    .map(([key, name]) => {
      const a = r.scorecard[key];
      const score = a.score === null ? '<td class="num unable">UNABLE TO ASSESS</td>' : `<td class="num">${a.score}/10</td>`;
      return `<tr><td>${name}</td>${score}<td>${esc(a.evidence)}</td></tr>`;
    })
    .join('');
  const facts = [
    `${t.seconds} s, ${t.ending.bars} of ${t.ending.targetBars} target bars at ${t.bpm} BPM`,
    t.chords ? `${t.chords.matched} of ${t.chords.compared} bars matched the chart` : 'no chord chart in this lesson',
    t.timing ? `${t.timing.withinEighth} of ${t.timing.changes} chord changes within an eighth note of the bar line` : 'fewer than 2 chord changes',
    t.feel ? `key strength ${t.feel.softest}–${t.feel.hardest}` : t.feelNote || 'too few presses to judge strength',
    `stopped ${t.ending.stopPastBarBeats} beats past a bar line, ${t.ending.secondsWithoutNewNotes} s after the last new note`,
  ];
  const head = t.takeNumber ? `<p class="take-no">Take ${t.takeNumber} of ${esc(t.lesson)}</p>` : '';
  const compare = t.takeNumber > 1 ? '<p><button type="button" class="link" id="compare-open">Compare with an earlier take</button></p><div id="compare" class="compare"></div>' : '';
  if (noModel) {
    $('report').innerHTML = head + `
      <h3>Scorecard</h3><table><tr><th>Area</th><th>Score</th><th>Evidence</th></tr>${rows}</table>
      <p class="facts">Measured: ${facts.map(esc).join('; ')}.</p>
      <p class="muted">These scores come from the app's own rules. A written summary needs a coach model. ${esc(noModel)}</p>` + compare;
    wireCompare(t);
    return;
  }
  $('report').innerHTML = head + `
    <div class="overall">${r.overall}/10 <small>practice score${previous ? `, last take ${previous}/10` : ''}</small></div>
    <p>${esc(r.overall_why)}</p>
    <h3>What worked</h3><ul>${r.worked.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
    <h3>Scorecard</h3><table><tr><th>Area</th><th>Score</th><th>Evidence</th></tr>${rows}</table>
    <h3>One change for the next take</h3><p>${esc(r.one_change)}</p>
    <h3>Next-take objective</h3><p>${esc(r.objective)}</p>
    <p class="facts">Measured: ${facts.map(esc).join('; ')}. The coach cannot hear the take; it scores only these measurements.</p>` + compare;
  wireCompare(t);
}

// ---------- compare two takes ----------

function wireCompare(t) {
  const open = $('compare-open');
  if (open) open.onclick = () => openCompare(t);
}

async function openCompare(t) {
  const box = $('compare');
  box.innerHTML = '<p class="muted">Loading your takes…</p>';
  const takes = await loadJson(`/api/takes?lesson=${encodeURIComponent(t.lesson)}`, []);
  // The take's own lesson, not whichever lesson is open now.
  const own = LESSONS.find((l) => l.title === t.lesson);
  const pairs = comparePairs(takes, own && progress.completed[own.id]);
  if (!pairs) {
    box.innerHTML = '<p class="muted">Record another take of this lesson to compare.</p>';
    return;
  }
  const label = (n) => (n === takes[0].take ? `First take (take ${n})` : n === pairs.firstPass ? `First pass (take ${n})` : `Take ${n}`);
  const order = [pairs.defaultOlder, ...(pairs.firstPass ? [pairs.firstPass] : []), ...pairs.older.filter((n) => n !== pairs.defaultOlder && n !== pairs.firstPass)];
  box.innerHTML = `<div class="compare-head"><label for="compare-older">Compare</label>
    <select id="compare-older">${order.map((n) => `<option value="${n}">${esc(label(n))}</option>`).join('')}</select>
    <span>with your latest (take ${pairs.latest})</span></div><div id="compare-body"></div>`;
  const show = () => renderComparison(t.lesson, takes, Number($('compare-older').value), pairs.latest);
  $('compare-older').onchange = show;
  show();
}

let compareSeq = 0;
async function renderComparison(lessonTitle, takes, older, latest) {
  const seq = ++compareSeq; // a slow answer for an earlier pair must not land under a newer one
  const a = takes.find((x) => x.take === older);
  const b = takes.find((x) => x.take === latest);
  const rows = compareCards(a.report.scorecard, b.report.scorecard)
    .map((r) => `<tr class="${r.change}"><td>${esc(r.name)}</td><td class="num">${r.a ?? '–'}</td><td class="num">${r.b ?? '–'}</td><td>${esc(r.words)}</td></tr>`)
    .join('');
  $('compare-body').innerHTML = `<table><tr><th>Area</th><th>Take ${older}</th><th>Take ${latest}</th><th>Change</th></tr>${rows}</table>
    <div id="compare-words" class="muted">The coach is comparing the two takes…</div>`;
  try {
    const res = await fetch('/api/takes/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lesson: lessonTitle, a: older, b: latest }),
    });
    const body = await res.json();
    if (seq !== compareSeq || !$('compare-words')) return;
    if (!res.ok) {
      $('compare-words').textContent = body.noModel
        ? "These scores come from the app's own rules. For a written comparison, set up a coach model: press Coach model at the top."
        : body.error;
      return;
    }
    const c = body.comparison;
    $('compare-words').classList.remove('muted');
    $('compare-words').innerHTML = `<h3>What got better</h3><p>${esc(c.improved)}</p>${c.slipped ? `<h3>What slipped</h3><p>${esc(c.slipped)}</p>` : ''}<h3>Next take</h3><p>${esc(c.next_step)}</p>`;
  } catch {
    $('compare-words').textContent = 'The Music Coach server is not running.';
  }
}

async function loadScores() {
  const takes = await loadJson('/api/takes', []);
  const ul = $('score-list');
  if (!takes.length) return;
  ul.innerHTML = takes
    .slice(-6)
    .reverse()
    .map((t) => `<li><span>${esc(t.lesson)}${t.take ? ` · take ${t.take}` : ''}</span><span class="n">${t.report.overall ?? '–'}/10</span></li>`)
    .join('');
  recentTakes = takes;
}

// ---------- ask the coach ----------

let recentTakes = [];

// A plain summary of where the learner is, so the coach can fit its answer.
function tutorContext() {
  const done = LESSONS.filter((l) => progress.completed[l.id]).map((l) => l.title);
  const remaining = checker.progress().filter((p) => !p.done).map((p) => p.label);
  const notStarted = LESSONS.filter((l) => !progress.completed[l.id] && l.id !== lesson.id && !lockReason(l.id, progress.completed, progress.unlocked)).slice(0, 4).map((l) => l.title);
  const sketches = [...$('sketch-list').querySelectorAll('li span')].map((s) => s.textContent);
  const scores = recentTakes.slice(-3).map((t) => `${t.report.overall == null ? `${t.lesson}: scored by the app's rules only` : `${t.lesson}: ${t.report.overall}/10 (next: ${t.report.one_change})`}`);
  return [
    `Finished lessons: ${done.join('; ') || 'none yet'}.`,
    `Current lesson: ${lesson.title}. Steps still to do: ${remaining.join('; ') || 'none, it is complete'}.`,
    `Lessons not yet finished, in order: ${notStarted.join('; ') || 'none'}.`,
    `Saved sketches: ${sketches.length ? sketches.slice(0, 3).join('; ') : 'none yet'}.`,
    `Recent take scores: ${scores.join(' | ') || 'none yet'}.`,
  ].join('\n');
}

function askNextStep() {
  $('question').value = 'What should I do next? Pick exactly one step based on where I am, name the lesson or part, and say why in one sentence.';
  ask();
}

async function ask() {
  const question = $('question').value.trim();
  if (!question) return;
  const out = $('answer');
  out.hidden = false;
  out.classList.remove('error');
  out.textContent = 'Thinking… (this can take 10–30 seconds)';
  $('ask').disabled = true;
  try {
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, lesson: `${lesson.title}: ${lesson.steps.map((s) => resolveGear(typeof s === 'string' ? s : s.text, lessonEnv())).join(' ')}`, context: tutorContext(), goal: coachGoal() }),
    });
    const body = await res.json();
    out.textContent = body.answer || body.error;
    out.classList.toggle('error', !res.ok);
  } catch {
    out.textContent = 'The Music Coach server is not running. Start it with ./music-coach';
    out.classList.add('error');
  } finally {
    $('ask').disabled = false;
  }
}

// ---------- gear ----------

function esc(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

const TAG_NAMES = {
  '': 'What it is for: not sure',
  keyboard: 'Keyboard or controller',
  microphone: 'Microphone',
  chorus: 'Chorus',
  echo: 'Echo or delay',
  reverb: 'Reverb',
  amp: 'Guitar amp',
  fuzz: 'Fuzz or distortion',
  synth: 'Synth or instrument',
  bass: 'Bass',
  drums: 'Drums',
};

function tagOptions(selected, unset = 'No job in lessons') {
  return Object.entries(TAG_NAMES)
    .map(([v, name]) => `<option value="${v}"${v === selected ? ' selected' : ''}>${esc(v ? name : unset)}</option>`)
    .join('');
}

// The server's gear answer, with what lessons may name worked out from your choices.
function setGear(g) {
  const hidden = new Set(g.hidden || []);
  const scanned = g.plugins || [];
  const added = g.added || [];
  gear = {
    ...gear,
    ...g,
    scanned,
    added,
    folders: g.folders || [],
    plugins: [...scanned.filter((p) => !hidden.has(p)), ...added.filter((a) => a.kind === 'plugin').map((a) => a.name)],
  };
}

// Everything in the gear panel, as groups the search can filter. Items you can
// remove carry `remove`; hidden plugins carry `restore`.
function gearGroups() {
  const g = (k) => resolveGear(`{${k}}`, lessonEnv());
  const hidden = new Set(gear.hidden);
  const groups = [
    {
      title: progress.flavour === 'durutti' ? 'Your Durutti chain in GarageBand' : 'Your guitar effects in GarageBand',
      note: 'Add these effects to a track, in this order.',
      open: true,
      items: [
        { name: g('chorus'), maker: '1. chorus', description: 'Shimmer.' },
        { name: g('echo'), maker: '2. echo', description: 'Repeats.' },
        { name: g('reverb'), maker: '3. reverb', description: 'Space.' },
        { name: g('amp'), maker: 'optional', description: 'A guitar amp, for grit.' },
      ],
    },
  ];
  if (gear.added.length) {
    groups.push({
      title: 'Added by you',
      note: 'The tag tells lessons what each one is for.',
      open: true,
      items: gear.added.map((a) => ({ name: a.name, maker: a.kind === 'plugin' ? 'plugin' : 'hardware', description: '', tag: a.tag, noJob: a.noJob, remove: { added: a.name } })),
    });
  }
  groups.push({
    title: 'Sample folders',
    note: gear.folders.length ? 'Loops and sounds the app uses come from these folders.' : 'None yet. Choose a folder of samples or loops above to use them in the Sampler.',
    open: true,
    items: gear.folders.map((f) => ({ name: shortPath(f.path), maker: f.found ? 'folder' : 'not connected right now', description: '', remove: { folder: f.path } })),
  });
  groups.push({
    title: 'Sounds inside this app',
    note: 'Sounds the coach plays itself. These are not plugins and do not appear in GarageBand.',
    open: true,
    items: [
      ...instruments.map((i) => ({ name: i.label, maker: i.recorded ? 'recorded instrument' : 'built-in tone', description: i.recorded ? `${i.samples.length} recorded notes.` : 'Add a sample folder with the recordings to hear the real one.' })),
      ...drumKits.map((k) => ({ name: k.label, maker: 'recorded drum kit', description: 'Kick, snare, rim and hi-hats for the beat grid.' })),
    ],
  });
  const shown = pluginDetails.filter((p) => !hidden.has(p.name));
  const slots = gear.slots || {};
  // A row you just sorted stays where it was until Your gear is opened again.
  const placed = { ...slots };
  for (const [name, was] of Object.entries(movedSlots)) {
    if (was) placed[name] = was;
    else delete placed[name];
  }
  for (const grp of groupPlugins(shown, gearLabels, placed)) {
    groups.push({
      ...grp,
      items: grp.items.map((i) => ({
        ...i,
        slot: slots[i.name] || '',
        moved: i.name in movedSlots ? { to: slotFor(i, slots)?.family || '', was: movedSlots[i.name] } : null,
        remove: { plugin: i.name },
      })),
    });
  }
  if (gear.installers?.length) {
    groups.push({
      title: 'Downloaded but never installed',
      note: 'In your sample folders. Double-click each to install it.',
      items: gear.installers.map((f) => ({ name: f, maker: 'installer', description: '' })),
    });
  }
  const gone = pluginDetails.filter((p) => hidden.has(p.name));
  if (gone.length) {
    groups.push({
      title: 'Removed',
      note: 'Still installed, just left out of lessons and this list. Restore any time.',
      items: gone.map((p) => ({ name: p.name, maker: p.maker, description: '', restore: p.name })),
    });
  }
  return groups;
}

function slotOptions(kind, selected, unset) {
  return [{ id: '', label: unset }, ...(SLOTS[kind] || [])]
    .map((s) => `<option value="${s.id}"${s.id === selected ? ' selected' : ''}>${esc(s.label)}</option>`)
    .join('');
}

function gearItem(i, group) {
  const other = /^Other /.test(group.title);
  const moved = i.moved
    ? ` <span class="gear-moved">✓ ${i.moved.to ? `Now in ${esc(i.moved.to)}` : 'The app sorts it again'} · <button class="link gear-undo" type="button" data-name="${esc(i.name)}" data-was="${esc(i.moved.was)}">Undo</button></span>`
    : '';
  const tag = i.remove?.added !== undefined
    ? i.noJob
      ? ' <span class="gear-nojob">Lessons have no job for this yet.</span>'
      : ` <select class="gear-tag${i.tag ? ' set' : ''}" data-name="${esc(i.name)}" aria-label="What ${esc(i.name)} is for">${tagOptions(i.tag, 'What is it for?')}</select>`
    : i.slottable && SLOTS[i.kind]
      ? `${moved} <select class="gear-slot${i.slot ? ' set' : ''}" data-name="${esc(i.name)}" aria-label="What ${esc(i.name)} is">${slotOptions(i.kind, i.slot, i.slot ? 'Let the app sort it' : other ? 'What is it?' : 'Change')}</select>`
      : '';
  const action = i.remove
    ? `<button class="gear-x ghost" data-remove='${esc(JSON.stringify(i.remove))}' aria-label="Remove ${esc(i.name)}" title="Remove">×</button>`
    : i.restore
      ? `<button class="gear-restore ghost" data-restore="${esc(i.restore)}">Restore</button>`
      : '';
  return `<li><span class="gear-line"><strong>${esc(i.name)}</strong>${i.maker ? ` <span class="maker">${esc(i.maker)}</span>` : ''}${i.description ? `: ${esc(i.description)}` : ''}</span>${tag}${action}</li>`;
}

function renderGear() {
  const query = $('gear-search').value;
  const groups = searchGear(gearGroups(), query);
  const body = $('gear-body');
  if (!groups.length) {
    body.innerHTML = `<p class="empty">Nothing matches "${esc(query)}".</p>`;
    return;
  }
  const status = describing
    ? `<p class="group-note">Sorting ${describing} plugin${describing === 1 ? '' : 's'} this app doesn't know yet, with your coach model…</p>`
    : describeError ? `<p class="group-note">Couldn't sort your other plugins: ${esc(describeError)}</p>` : '';
  body.innerHTML = (query.trim() ? '' : status) + groups
    .map((grp) => {
      const open = query.trim() || grp.open || grp.items.length <= 4 ? ' open' : '';
      return `<details${open}><summary>${esc(grp.title)} <span class="count">(${grp.items.length})</span></summary>${grp.note ? `<p class="group-note">${esc(grp.note)}</p>` : ''}<ul>${grp.items.map((i) => gearItem(i, grp)).join('')}</ul></details>`;
    })
    .join('');
  if (!query.trim() && gear.zippedPacks?.length) {
    body.insertAdjacentHTML('beforeend', `<p class="group-note">${gear.zippedPacks.length} sample packs in your sample folders are still zipped. Unzip a pack before GarageBand can see its sounds.</p>`);
  }
}

// Send one change to your gear choices, then refresh everything that depends on them.
async function changeGear(change) {
  const res = await fetch('/api/gear/change', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(change),
  });
  if (!res.ok) throw new Error('not saved');
  await refreshGear(/Folder$/.test(change.op));
}

async function refreshGear(folders) {
  setGear(await loadJson('/api/gear', gear));
  if (folders) {
    [loops, instruments, drumKits] = await Promise.all([
      loadJson('/api/loops', loops), loadJson('/api/instruments', instruments), loadJson('/api/drumkits', drumKits),
    ]);
    renderLoops();
    renderSoundButtons();
    renderKits();
  }
  renderGear();
  renderFxNote();
  renderChecks();
  renderLessonList(); // a new gear suggestion shows as "1 new"
}

let toastUndo = null;
let toastTimer = null;
function toast(message, undo) {
  const t = $('gear-toast');
  t.querySelector('span').textContent = message;
  t.querySelector('button').hidden = !undo;
  toastUndo = undo;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.hidden = true;
  }, 8000);
}

function gearNote(text) {
  $('gear-drop-note').textContent = text;
}

// Remove one item; Undo sends the opposite change, so nothing else is touched.
async function removeGear(what) {
  if (what.plugin) {
    await changeGear({ op: 'hide', name: what.plugin });
    toast(`Removed ${what.plugin}. Lessons now use the next choice.`, () => changeGear({ op: 'unhide', name: what.plugin }));
  } else if (what.added) {
    const item = gear.added.find((a) => a.name === what.added);
    await changeGear({ op: 'remove', name: what.added });
    toast(`Removed ${what.added}.`, () => changeGear({ op: 'add', ...item }));
  } else {
    await changeGear({ op: 'removeFolder', path: what.folder });
    toast(`Removed ${shortPath(what.folder)}. The files stay where they are.`, () => changeGear({ op: 'addFolder', path: what.folder }));
  }
}

async function addGear(name, kind, tag) {
  const scanned = gear.scanned.find((p) => p.toLowerCase() === name.toLowerCase());
  if (scanned) {
    if (gear.hidden.includes(scanned)) {
      await changeGear({ op: 'unhide', name: scanned });
      return gearNote(`${scanned} is back in your gear.`);
    }
    return gearNote(`${scanned} is already in your gear.`);
  }
  if (gear.added.some((a) => a.name.toLowerCase() === name.toLowerCase())) return gearNote(`${name} is already in your gear.`);
  if (tag === undefined) {
    gearNote(`Adding ${name}…`);
    const s = await fetch('/api/gear/suggest-tag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then((r) => r.json()).catch(() => ({ tag: '' }));
    tag = s.tag || '';
  }
  await changeGear({ op: 'add', name, kind, tag });
  const tagged = tag ? ` Tagged ${TAG_NAMES[tag].toLowerCase()}: change it in the list if that's wrong.` : ' Pick what it is for in the list, if it has a job.';
  const where = kind === 'plugin' ? ' It is not installed where GarageBand looks, so GarageBand may not list it until you install it.' : '';
  gearNote(`Added ${name}.${tagged}${where}`);
}

async function chooseFolder() {
  gearNote('A window opened: pick a folder of samples or loops.');
  try {
    const res = await fetch('/api/gear/choose-folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const body = await res.json();
    if (body.cancelled) return gearNote('No folder picked.');
    await refreshGear(true);
    gearNote(`Added ${shortPath(body.folder)}. Its loops are in the Sampler now.`);
  } catch {
    gearNote('Could not open the folder picker. Is the Music Coach server running?');
  }
}

// Drops: plugins by name. A web page is never told where a dropped folder lives,
// so folders go through the Mac's own picker.
function wireGearDrop() {
  const drop = $('gear-drop');
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', async (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const entries = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
    const plugins = entries.filter((en) => /\.(component|vst3?|aaxplugin)$/i.test(en.name));
    for (const p of plugins) await addGear(p.name.replace(/\.(component|vst3?|aaxplugin)$/i, ''), 'plugin');
    if (plugins.length) return;
    if (entries.some((en) => en.isDirectory)) {
      gearNote('Folders go through the Mac\'s own picker: pick the same folder in the window that opens.');
      return chooseFolder();
    }
    gearNote('That is a single file. To use your own sounds, choose the folder it is in.');
  });
  $('gear-folder').onclick = chooseFolder;
  $('gear-hand').onsubmit = async (e) => {
    e.preventDefault();
    const name = $('gear-name').value.trim().replace(/\s+/g, ' ');
    if (!name) return;
    const tag = $('gear-tag').value;
    await addGear(name, 'hardware', tag === '?' ? undefined : tag);
    $('gear-name').value = '';
    $('gear-tag').value = '?';
  };
  $('gear-tag').innerHTML = `<option value="?">What it is for: let the coach guess</option>${tagOptions('')}`;
  $('gear-tag').value = '?';
  $('gear-body').addEventListener('click', async (e) => {
    const x = e.target.closest('[data-remove]');
    if (x) await removeGear(JSON.parse(x.dataset.remove));
    const undo = e.target.closest('.gear-undo');
    if (undo) {
      const name = undo.dataset.name;
      await changeGear({ op: 'slot', name, slot: undo.dataset.was });
      delete movedSlots[name];
      renderGear();
      return;
    }
    const r = e.target.closest('[data-restore]');
    if (r) {
      await changeGear({ op: 'unhide', name: r.dataset.restore });
      toast(`${r.dataset.restore} is back.`);
    }
  });
  $('gear-body').addEventListener('change', async (e) => {
    const slot = e.target.closest('.gear-slot');
    if (slot) {
      const name = slot.dataset.name;
      if (!(name in movedSlots)) movedSlots[name] = (gear.slots || {})[name] || '';
      await changeGear({ op: 'slot', name, slot: slot.value });
      [...document.querySelectorAll('#gear-body .gear-slot')].find((s) => s.dataset.name === name)?.focus();
      return;
    }
    const sel = e.target.closest('.gear-tag');
    if (!sel) return;
    await changeGear({ op: 'tag', name: sel.dataset.name, tag: sel.value });
  });
  $('gear-toast').querySelector('button').onclick = async () => {
    $('gear-toast').hidden = true;
    if (toastUndo) await toastUndo();
    toastUndo = null;
  };
}

// Ask the coach model about plugins nothing here describes. Each is sent once: name, maker, kind.
async function describeGear() {
  const hidden = new Set(gear.hidden);
  const todo = unlabelled(pluginDetails.filter((p) => !hidden.has(p.name)), gearLabels, gear.slots || {});
  if (describing) {
    describeAgain = true;
    return;
  }
  if (!todo.length) return;
  describing = todo.length;
  describeError = '';
  renderGear();
  try {
    const res = await fetch('/api/gear/describe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names: todo.map((p) => p.name) }),
    });
    const body = res.headers.get('Content-Type')?.includes('json') ? await res.json() : {};
    if (body.labels) gearLabels = body.labels;
    if (res.status === 409) describeError = 'another window of this app is sorting them now. Reopen Your gear in a minute.';
    else if (!res.ok) describeError = body.error || `the app's server said no (${res.status}).`;
    else if (body.status === 'error') describeError = body.message || 'the coach model sent an error.';
  } catch {
    describeError = 'the app could not reach its server.';
  }
  describing = 0;
  if (describeAgain) {
    describeAgain = false;
    describeGear();
  }
  renderGear();
  renderFxNote();
  renderLessonList();
}

function openGear(welcome) {
  movedSlots = {};
  $('gear-search').value = '';
  $('gear-welcome').hidden = !welcome;
  gearNote('');
  renderGear();
  $('gear-dialog').showModal();
}

// ---------- coach settings ----------

let coach = { provider: 'local', model: '', baseUrl: '', hasKey: false, defaults: {} };

function renderCoach() {
  const p = document.querySelector('input[name="coach-provider"]:checked')?.value || coach.provider;
  $('coach-key-row').hidden = p === 'local';
  $('coach-url-row').hidden = p !== 'other';
  $('coach-model-row').hidden = p === 'local';
  const sameService = p === coach.provider;
  $('coach-key-state').textContent = sameService && coach.hasKey ? 'A key is saved. Paste a new one to replace it.' : p === 'other' ? 'Only if the service needs one.' : '';
  $('coach-forget').hidden = !(sameService && coach.hasKey);
  const def = coach.defaults[p];
  $('coach-model-hint').textContent = def ? `Leave empty for ${def}, a small, cheap model.` : 'The model name your service uses.';
}

async function openCoach(welcome = false) {
  $('coach-step').hidden = !welcome;
  $('coach-close').textContent = welcome ? 'Finish' : 'Close';
  coach = await loadJson('/api/coach', coach);
  renderCoachTop();
  for (const r of document.querySelectorAll('input[name="coach-provider"]')) r.checked = r.value === coach.provider;
  $('coach-model').value = coach.model;
  $('coach-url').value = coach.baseUrl;
  $('coach-key').value = '';
  $('coach-status').textContent = '';
  renderCoach();
  $('coach-dialog').showModal();
}

async function saveCoach(extra = {}) {
  const res = await fetch('/api/coach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: document.querySelector('input[name="coach-provider"]:checked').value,
      model: $('coach-model').value,
      baseUrl: $('coach-url').value,
      apiKey: $('coach-key').value,
      ...extra,
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    $('coach-status').textContent = body.error;
    return false;
  }
  coach = body;
  $('coach-key').value = '';
  renderCoach();
  if (coach.ready) describeGear(); // a model to ask now: sort the plugins nothing here describes
  renderCoachTop();
  return true;
}

// The header button says "not set up" until a question would reach a model.
function renderCoachTop() {
  $('coach-top-state').hidden = coach.ready !== false;
  $('coach-top').classList.toggle('needs-setup', coach.ready === false);
}

function wireCoach() {
  $('coach-btn').onclick = () => openCoach();
  $('coach-top').onclick = () => openCoach();
  loadJson('/api/coach', coach).then((c) => {
    coach = c;
    renderCoachTop();
  });
  for (const r of document.querySelectorAll('input[name="coach-provider"]')) r.onchange = renderCoach;
  $('coach-save').onclick = async () => {
    if (await saveCoach()) $('coach-status').textContent = 'Saved.';
  };
  $('coach-forget').onclick = async () => {
    if (await saveCoach({ apiKey: '', forgetKey: true })) $('coach-status').textContent = 'Key forgotten.';
  };
  $('coach-test').onclick = async () => {
    if (!(await saveCoach())) return;
    $('coach-status').textContent = 'Asking the model…';
    const res = await fetch('/api/coach/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const body = await res.json();
    $('coach-status').textContent = body.ok ? `Working: ${body.model} answered.` : body.error;
  };
}

// ---------- boot ----------

// Every pop-up window gets an × in its top-right corner, as well as its Close button.
function addDialogCloseButtons() {
  for (const d of document.querySelectorAll('dialog')) {
    const x = document.createElement('button');
    x.className = 'dialog-x ghost';
    x.textContent = '×';
    x.setAttribute('aria-label', 'Close');
    x.onclick = () => d.close();
    d.prepend(x);
  }
}

let booted = false;

function renderKits() {
  const select = $('drum-kit');
  for (const o of [...select.options]) if (o.value !== 'synth') o.remove();
  for (const k of drumKits) select.add(new Option(k.label, k.id));
  select.value = drumKits.some((k) => k.id === state.kit) ? state.kit : 'synth';
}

async function boot() {
  addDialogCloseButtons();
  // Wire Start first, so an early click works while lessons and gear still load.
  $('start-btn').onclick = async () => {
    await engine.start();
    $('start').hidden = true;
    engine.setBrightness(engine.brightness ?? 1);
    loadSound('guitar');
    if (engine.sound !== 'guitar') loadSound(engine.sound);
    setKit(state.kit);
    if (booted && !gear.setupDone) openGear(true);
  };
  wireStudio();
  wireLooper();
  $('ask').onclick = ask;
  $('next-step').onclick = askNextStep;
  $('score').onclick = scoreTake;
  $('question').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask();
  });
  $('gear-btn').onclick = () => openGear(false);
  $('reminder-gear').onclick = () => openGear(false);
  $('reminder-close').onclick = () => {
    const r = progress.gearReminder || { dismissed: 0, at: 0 };
    progress.gearReminder = { dismissed: r.dismissed + 1, at: Object.keys(progress.completed).length };
    saveProgress();
    renderGearReminder();
    $('lesson-list').querySelector('button')?.focus();
  };
  $('gear-dialog').addEventListener('close', () => {
    welcomeAdvancing = false;
    // Closing the welcome counts as setup done, whatever was added.
    if (!$('gear-welcome').hidden && !gear.setupDone) changeGear({ op: 'setupDone' });
  });
  wireGearDrop();
  wireWelcome();
  wireCoach();
  wireAbout();
  $('gear-search').oninput = renderGear;
  $('sound-info').onclick = () => {
    const help = $('sound-help');
    help.hidden = !help.hidden;
    $('sound-info').setAttribute('aria-expanded', String(!help.hidden));
  };
  $('sketches-info').onclick = () => {
    const help = $('sketches-help');
    help.hidden = !help.hidden;
    $('sketches-info').setAttribute('aria-expanded', String(!help.hidden));
  };
  wireFinder();
  wireProgression();
  $('ear-btn').onclick = () => {
    $('ear-dialog').showModal();
    if (!earUnlocked()) return showEarLocked();
    $('ear-play').hidden = false;
    newQuestion();
  };
  $('ear-play').onclick = playQuestion;
  $('key-select').onchange = (e) => {
    progress.key = e.target.value || null;
    saveProgress();
    renderKeyPicker();
  };
  $('chords-btn').onclick = () => {
    buildChordExplorer();
    $('chord-dialog').showModal();
  };
  $('popout').onclick = popOut;

  $('app-version').textContent = 'About';
  loadJson('/api/version', {}).then(({ version }) => {
    if (!version) return;
    appVersion = version;
    $('app-version').textContent = `v${version}`;
    $('coach-version').textContent = `Music Coach v${version}`;
  });
  loadPlaces();
  const [g, p, inst, kits, loopList, plugins, labels] = await Promise.all([
    loadJson('/api/gear', gear), loadJson('/api/progress', {}), loadJson('/api/instruments', []),
    loadJson('/api/drumkits', []), loadJson('/api/loops', []), loadJson('/api/plugins', []),
    loadJson('/api/gear/labels', {}),
  ]);
  instruments = inst;
  drumKits = kits;
  loops = loopList;
  pluginDetails = plugins;
  gearLabels = labels;
  renderKits();
  if (p.grid) state.grid = { ...state.grid, ...p.grid };
  renderGrid();
  renderLoops();
  renderSoundButtons();
  setGear(g);
  renderFxNote();
  describeGear();
  progress = { ...progress, ...p, completed: { ...(p.completed || {}) }, checks: { ...(p.checks || {}) } };
  // Open where to start: the first unfinished lesson that is not locked.
  // A copy that began before the style picker keeps its Durutti examples and every style.
  if (progress.flavour === undefined) {
    // Every copy that ever opened a lesson saved `current`, so that marks an existing copy.
    progress.flavour = p.current !== undefined || Object.keys(progress.completed).length ? 'durutti' : 'neutral';
    saveProgress();
  }
  // Gear you already had doesn't count as new: only what adding gear brings later.
  if (progress.seenSuggestions === undefined) {
    progress.seenSuggestions = suggestedStyles();
    saveProgress();
  }
  openLesson(firstUnfinished(progress.completed, progress.unlocked, progress.styles || []).id);
  renderKeyPicker();
  renderEarButton();
  loadSketches();
  loadScores();
  booted = true;
  if ($('start').hidden && !gear.setupDone) openGear(true);

  setupInput({
    onNoteOn: inputOn,
    onNoteOff: inputOff,
    onStatus: ({ connected, message }) => {
      const pill = $('midi-status');
      pill.textContent = message;
      pill.classList.toggle('ok', connected);
    },
  });

}

boot();
