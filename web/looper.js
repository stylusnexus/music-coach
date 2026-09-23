// A loop recorder for notes: record a phrase of a fixed number of bars, then it
// repeats; each press of Loop adds a layer on top. Each note keeps the sound it
// was played with, so layers can be different instruments. No audio here: the
// app asks tick() what to play on every sixteenth note.

const RUNNING = ['recording', 'playing', 'overdubArmed', 'overdubbing'];

export class Looper {
  constructor() {
    this.bars = 2;
    this.stepsPerBar = 16; // sixteenths in a bar: 16 in 4/4, 12 in 3/4 …
    this.clear();
  }

  clear() {
    this.status = 'empty'; // empty | armed | recording | playing | overdubArmed | overdubbing | paused | resumeArmed
    this.layers = []; // [{events: [{step, note, vel, dur, sound}]}]
    this.current = null; // the layer being recorded
    this.pending = new Map(); // notes held down while recording: note -> {step, note, vel, sound, t}
    this.startStep = null; // clock step where the loop begins
    this.startTime = null; // audio time of startStep
  }

  get steps() {
    return this.bars * this.stepsPerBar;
  }

  get capturing() {
    return this.status === 'recording' || this.status === 'overdubbing';
  }

  get active() {
    return this.status !== 'empty';
  }

  // The Loop button: start a loop, add a layer, or cancel a waiting start.
  press() {
    const next = {
      empty: 'armed',
      armed: 'empty',
      playing: 'overdubArmed',
      overdubArmed: 'playing',
      paused: 'resumeArmed',
      resumeArmed: 'paused',
    }[this.status];
    if (next) this.status = next;
    return this.status;
  }

  pos(step) {
    return (((step - this.startStep) % this.steps) + this.steps) % this.steps;
  }

  // Nearest sixteenth inside the loop for a moment in time.
  posAt(time, secondsPerStep) {
    const raw = Math.round((time - this.startTime) / secondsPerStep);
    return ((raw % this.steps) + this.steps) % this.steps;
  }

  // Called on every sixteenth. Returns the notes to play now and whether a layer
  // just finished recording.
  tick(step, time, secondsPerStep) {
    const out = { events: [], changed: false, finished: false };
    if ((this.status === 'armed' || this.status === 'resumeArmed') && step % this.stepsPerBar === 0) {
      this.startStep = step;
      this.startTime = time;
      this.status = this.status === 'armed' ? 'recording' : 'playing';
      if (this.status === 'recording') this.current = [];
      out.changed = true;
    }
    if (this.startStep === null || !RUNNING.includes(this.status)) return out;

    const pos = this.pos(step);
    if (pos === 0 && step !== this.startStep) {
      if (this.capturing) {
        out.finished = this.finish(time, secondsPerStep);
        out.changed = true;
      } else if (this.status === 'overdubArmed') {
        this.current = [];
        this.status = 'overdubbing';
        out.changed = true;
      }
    }
    if (this.status !== 'recording') {
      for (const layer of this.layers) for (const e of layer.events) if (e.step === pos) out.events.push(e);
    }
    return out;
  }

  // A note produced by the app itself (arpeggiator, bass) at a known step.
  addAt(step, note, vel, dur, sound) {
    if (this.capturing) this.current.push({ step: this.pos(step), note, vel, dur, sound });
  }

  // A key played by hand: its start snaps to the nearest sixteenth.
  noteOn(note, vel, sound, time, secondsPerStep) {
    if (!this.capturing) return;
    this.pending.set(note, { step: this.posAt(time, secondsPerStep), note, vel, sound, t: time });
  }

  noteOff(note, time, secondsPerStep) {
    const p = this.pending.get(note);
    if (!p) return;
    this.pending.delete(note);
    const dur = Math.max(1, Math.round((time - p.t) / secondsPerStep));
    this.current?.push({ step: p.step, note, vel: p.vel, dur, sound: p.sound });
  }

  // Close the layer being recorded. Returns true when it had notes and was kept.
  finish(time, secondsPerStep) {
    for (const note of [...this.pending.keys()]) this.noteOff(note, time, secondsPerStep);
    const kept = this.current && this.current.length > 0;
    if (kept) this.layers.push({ events: this.current });
    this.current = null;
    this.status = this.layers.length ? 'playing' : 'empty';
    if (!this.layers.length) this.startStep = null;
    return kept;
  }

  undo() {
    this.layers.pop();
    if (!this.layers.length) this.clear();
    return this.layers.length;
  }

  // Stop: keep the layers, stop playing. A layer still being recorded is dropped.
  pause() {
    this.current = null;
    this.pending.clear();
    this.status = this.layers.length ? 'paused' : 'empty';
    if (!this.layers.length) this.startStep = null;
  }
}
