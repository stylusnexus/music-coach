// Sound engine: instruments, the chorus → echo → reverb chain, drum machine,
// and a sixteenth-note clock that drives the arpeggiator and drums.

export const DRUM_PATTERNS = {
  simple: { kick: [0, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
  motorik: { kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14] },
  sparse: { kick: [0, 10], snare: [12], hat: [0, 4, 8, 12] },
  bossa: { kick: [0, 6, 8, 14], rim: [0, 6, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
  'new wave': { kick: [0, 6, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12], openhat: [14] },
  tribal: { kick: [0, 8], tom: [0, 3, 6, 8, 10, 11, 14], snare: [12], hat: [4, 12] },
  // Straight eighths, snare on 2 and 4, for fast punk tempos.
  punk: { kick: [0, 6, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
  // Slow and ominous: rim shots on 2 and 4, a tom rolling in at the end of the bar.
  goth: { kick: [0, 10], rim: [4, 12], tom: [7, 14, 15], hat: [0, 4, 8, 12] },
  // Four on the floor: a kick on every beat, open hats between them.
  house: { kick: [0, 4, 8, 12], snare: [4, 12], openhat: [2, 6, 10, 14] },
  // Reggae: nothing on beat 1; kick and rim land together on beat 3.
  'one drop': { kick: [8], rim: [8], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
  // 80s: a big gated snare on 2 and 4 over sixteenth hats.
  synthwave: { kick: [0, 8], gated: [4, 12], hat: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
  // Country: brushes on every sixteenth, like a train on the tracks.
  train: { kick: [0, 8], snare: [4, 12], brush: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
  // Drum and bass: the "Amen" break, the most sampled drum solo there is.
  breakbeat: { kick: [0, 2, 10, 11], snare: [4, 7, 9, 12, 15], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
  // Afrobeat, after Tony Allen: a busy kick, open hats, quiet ghost snares between.
  afrobeat: { kick: [0, 3, 6, 10, 11], snare: [4, 12], ghost: [2, 7, 9, 14, 15], hat: [0, 4, 8, 12], openhat: [2, 6, 10, 14] },
};

// Sustained sounds get a longer fade when a key is released (seconds).
const RELEASE = { pad: 1.2, 'vp330-strings': 1.2, farfisa: 1.2, swell: 4, saw: 0.3, sub: 0.3 };
// Sounds built here, with no recordings needed.
const BUILT_IN = ['guitar', 'nylon', 'epiano', 'pad', 'swell', 'saw', 'sub'];

const midiToFreq = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class Engine {
  constructor() {
    this.ctx = null;
    this.sound = 'guitar';
    this.brightness = 1;
    this.bpm = 100;
    this.fx = { fuzz: false, chorus: true, echo: true, reverb: true, reverse: false, wobble: false };
    this.drumFuzz = false;
    this.voices = new Map(); // note -> {gain, stop(time)}
    this.guitarCache = new Map();
    this.sampleSets = {}; // instrument id -> [{note, buffer}] recorded notes
    this.loading = {}; // instrument id -> promise
    this.takeCounter = 0;
    this.kit = 'synth'; // drum kit: 'synth' or a recorded kit id
    this.drumKits = {}; // kit id -> {kick, snare, rim, hat, openhat: AudioBuffer}
    this.chop = null; // {buffer, reversed, name} the loop the sampler plays
    this.onStep = null; // (step, time) called for every sixteenth
  }

  async start() {
    if (this.ctx) return;
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;

    this.master = ctx.createDynamicsCompressor();
    this.master.threshold.value = -14;
    this.master.ratio.value = 3;
    const out = ctx.createGain();
    out.gain.value = 0.9;
    this.master.connect(out).connect(ctx.destination);

    this.instrumentBus = ctx.createGain();
    this.instrumentBus.gain.value = 0.8;

    const chorus = this.buildChorus();
    const echo = this.buildEcho();
    const reverb = this.buildReverb();
    const fuzz = this.buildFuzz();
    const reverse = this.buildReverseReverb();
    const wobble = this.buildWobble();
    // The filter darkens or brightens everything played, before the effects.
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 2;
    this.setBrightness(1);
    this.instrumentBus.connect(this.filter).connect(wobble.input);
    wobble.output.connect(fuzz.input);
    // One channel per part, so the mixer can set each part's volume and pan.
    this.channels = {};
    for (const part of ['instrument', 'bass', 'drone']) {
      const input = ctx.createGain();
      const pan = ctx.createStereoPanner();
      input.connect(pan).connect(this.instrumentBus);
      this.channels[part] = { input, pan };
    }
    fuzz.output.connect(chorus.input);
    chorus.output.connect(echo.input);
    echo.output.connect(reverb.input);
    reverb.output.connect(reverse.input);
    reverse.output.connect(this.master);
    this.fxNodes = { fuzz, chorus, echo, reverb, reverse, wobble };

    this.drumBus = ctx.createGain();
    this.drumBus.gain.value = 0.7;
    const drumPan = ctx.createStereoPanner();
    // Fuzz on drums: the same fuzz, on its own copy, between the drums and their pan.
    this.drumFuzzNode = this.buildFuzz();
    this.drumBus.connect(this.drumFuzzNode.input);
    this.drumFuzzNode.output.connect(drumPan).connect(this.master);
    this.channels.drums = { input: this.drumBus, pan: drumPan, base: 0.7 };
    // The key finder's held notes: quiet, so they sit under a song playing in another app.
    const finder = ctx.createGain();
    finder.gain.value = 0.15;
    finder.connect(this.instrumentBus);
    this.channels.finder = { input: finder, pan: null };
    const drumSend = ctx.createGain();
    drumSend.gain.value = 0.15;
    this.drumBus.connect(drumSend).connect(reverb.wetIn);

    this.noise = this.makeNoise(1);
    this.setBpm(this.bpm);
    for (const k of Object.keys(this.fx)) this.setFx(k, this.fx[k]);
    this.setDrumFuzz(this.drumFuzz);
    this.startClock();
    // Build everything before waiting on the browser, so a click that arrives while
    // audio is still being allowed never finds a half-built engine.
    await ctx.resume();
  }

  // ---- effects ----

  wetDry(input, wetNode, wetLevel) {
    const ctx = this.ctx;
    const output = ctx.createGain();
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    wet.gain.value = wetLevel;
    input.connect(dry).connect(output);
    wetNode.connect(wet).connect(output);
    return { output, wet, level: wetLevel };
  }

  buildChorus() {
    const ctx = this.ctx;
    const input = ctx.createGain();
    const merge = ctx.createGain();
    [[0.012, 0.6, -0.7], [0.017, 0.83, 0.7]].forEach(([base, rate, pan]) => {
      const d = ctx.createDelay(0.05);
      d.delayTime.value = base;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const depth = ctx.createGain();
      depth.gain.value = 0.0035;
      lfo.connect(depth).connect(d.delayTime);
      lfo.start();
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      input.connect(d).connect(p).connect(merge);
    });
    return { input, ...this.wetDry(input, merge, 0.55) };
  }

  buildEcho() {
    const ctx = this.ctx;
    const input = ctx.createGain();
    const delay = ctx.createDelay(3);
    const feedback = ctx.createGain();
    feedback.gain.value = 0.48;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2600;
    const wow = ctx.createOscillator();
    wow.frequency.value = 0.35;
    const wowDepth = ctx.createGain();
    wowDepth.gain.value = 0.0012;
    wow.connect(wowDepth).connect(delay.delayTime);
    wow.start();
    input.connect(delay);
    delay.connect(tone).connect(feedback).connect(delay);
    this.echoDelay = delay;
    this.echoFeedback = feedback;
    return { input, ...this.wetDry(input, tone, 0.42) };
  }

  // Dub throw: while held, the echo is turned right up and its repeats pile up;
  // on release both go back to where they were.
  setThrow(on) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const echo = this.fxNodes.echo;
    const send = on ? 1 : this.fx.echo ? echo.level : 0;
    echo.wet.gain.setTargetAtTime(send, now, on ? 0.01 : 0.08);
    this.echoFeedback.gain.setTargetAtTime(on ? 0.78 : 0.48, now, on ? 0.01 : 0.3);
  }

  buildReverb() {
    const ctx = this.ctx;
    const input = ctx.createGain();
    const wetIn = ctx.createGain();
    const conv = ctx.createConvolver();
    const seconds = 3.6;
    const len = Math.floor(ctx.sampleRate * seconds);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    conv.buffer = ir;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 5000;
    input.connect(wetIn);
    wetIn.connect(conv).connect(damp);
    return { input, wetIn, ...this.wetDry(input, damp, 0.38) };
  }

  // Fuzz: the signal clipped hard into a buzzing square-ish wave, blended under the clean one.
  buildFuzz() {
    const ctx = this.ctx;
    const input = ctx.createGain();
    const drive = ctx.createGain();
    drive.gain.value = 6;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / (curve.length - 1)) * 2 - 1) * 4);
    shaper.curve = curve;
    shaper.oversample = '4x';
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3800;
    const trim = ctx.createGain();
    trim.gain.value = 0.35;
    input.connect(drive).connect(shaper).connect(tone).connect(trim);
    return { input, ...this.wetDry(input, trim, 0.9) };
  }

  // Reverse reverb: a reverb whose tail rises instead of fading, then cuts off,
  // so every note swells up into itself. The "reverse" setting on 80s rack
  // reverbs that My Bloody Valentine used.
  buildReverseReverb() {
    const ctx = this.ctx;
    const input = ctx.createGain();
    const conv = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 1.1);
    const fade = Math.floor(ctx.sampleRate * 0.03);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const rise = Math.pow(i / len, 2.2);
        const cut = i > len - fade ? (len - i) / fade : 1;
        data[i] = (Math.random() * 2 - 1) * rise * cut;
      }
    }
    conv.buffer = ir;
    input.connect(conv);
    return { input, ...this.wetDry(input, conv, 0.7) };
  }

  // Tape wobble: the sound through a short delay whose length drifts slowly, so
  // the pitch sags and rises like a worn cassette. All wet when on: any dry
  // signal left in would turn the drift into a chorus.
  buildWobble() {
    const ctx = this.ctx;
    const input = ctx.createGain();
    const output = ctx.createGain();
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    wet.gain.value = 0;
    const d = ctx.createDelay(0.1);
    d.delayTime.value = 0.02;
    // A slow drift plus a slower one, so the wobble never repeats exactly.
    [[0.55, 0.0024], [0.13, 0.004]].forEach(([rate, amount]) => {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const depth = ctx.createGain();
      depth.gain.value = amount;
      lfo.connect(depth).connect(d.delayTime);
      lfo.start();
    });
    input.connect(dry).connect(output);
    input.connect(d).connect(wet).connect(output);
    return { input, output, wet, dry, level: 1 };
  }

  setFx(which, enabled) {
    this.fx[which] = enabled;
    if (!this.ctx) return;
    const node = this.fxNodes[which];
    node.wet.gain.setTargetAtTime(enabled ? node.level : 0, this.ctx.currentTime, 0.03);
    if (node.dry) node.dry.gain.setTargetAtTime(enabled ? 0 : 1, this.ctx.currentTime, 0.03);
  }

  setDrumFuzz(enabled) {
    this.drumFuzz = enabled;
    if (!this.ctx) return;
    const node = this.drumFuzzNode;
    node.wet.gain.setTargetAtTime(enabled ? node.level : 0, this.ctx.currentTime, 0.03);
  }

  setBpm(bpm) {
    this.bpm = bpm;
    if (this.echoDelay) {
      // Dotted eighth: the classic "galloping" echo.
      this.echoDelay.delayTime.setTargetAtTime((60 / bpm) * 0.75, this.ctx.currentTime, 0.05);
    }
  }

  // 0 = dark and muffled, 1 = fully open. Exponential, so the sweep sounds even.
  setBrightness(value) {
    this.brightness = value;
    if (this.filter) this.filter.frequency.setTargetAtTime(180 * Math.pow(2, value * 6.5), this.ctx.currentTime, 0.05);
  }

  get secondsPerStep() {
    return 60 / this.bpm / 4;
  }

  // ---- instruments ----

  // Load an instrument's recorded notes once. Until they arrive (or if they are
  // missing), a synthesized sound stands in.
  loadInstrument(inst) {
    if (!this.loading[inst.id]) {
      this.loading[inst.id] = Promise.all(
        inst.samples.map(async (s) => {
          try {
            const res = await fetch(`/samples/${inst.id}/${encodeURIComponent(s.file)}`);
            return { note: s.note, buffer: await this.ctx.decodeAudioData(await res.arrayBuffer()) };
          } catch {
            return null;
          }
        }),
      ).then((loaded) => {
        this.sampleSets[inst.id] = loaded.filter(Boolean);
        return this.sampleSets[inst.id].length;
      });
    }
    return this.loading[inst.id];
  }

  // Load a recorded drum kit's one-shots from ~/Music/Samples.
  async loadDrumKit(kit) {
    if (this.drumKits[kit.id]) return true;
    const entries = await Promise.all(
      Object.entries(kit.sounds).map(async ([kind, path]) => {
        const res = await fetch(`/local/${encodeURIComponent(path)}`);
        return [kind, await this.ctx.decodeAudioData(await res.arrayBuffer())];
      }),
    );
    this.drumKits[kit.id] = Object.fromEntries(entries);
    return true;
  }

  // Load a loop for the sampler, plus a reversed copy for backwards playback.
  async loadChop(path) {
    const res = await fetch(`/local/${encodeURIComponent(path)}`);
    if (!res.ok) throw new Error('Loop not found');
    return this.setChop(await this.ctx.decodeAudioData(await res.arrayBuffer()), path.split('/').pop());
  }

  // Use a sound (a loop, or your own recording) in the sampler.
  setChop(buffer, name) {
    const reversed = this.ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      reversed.getChannelData(ch).set(buffer.getChannelData(ch).slice().reverse());
    }
    this.chop = { buffer, reversed, name };
    return this.chop;
  }

  // Play one slice of the loaded loop. Slices play through to their end.
  playSlice(index, slices, vel, time, reverse, rate = 1) {
    const { buffer, reversed } = this.chop;
    const ctx = this.ctx;
    const len = buffer.duration / slices;
    // Reversed: play the same slice backwards, found at the mirrored position.
    const offset = (reverse ? slices - 1 - index : index) * len;
    const src = ctx.createBufferSource();
    src.buffer = reverse ? reversed : buffer;
    src.playbackRate.value = rate; // 0.5 = half speed: an octave lower and twice as long
    const heard = len / rate;
    const amp = ctx.createGain();
    const level = 0.3 + (vel / 127) * 0.6;
    amp.gain.setValueAtTime(0, time);
    amp.gain.linearRampToValueAtTime(level, time + 0.004);
    amp.gain.setValueAtTime(level, time + heard - 0.01);
    amp.gain.linearRampToValueAtTime(0, time + heard);
    src.connect(amp).connect(this.instrumentBus);
    src.start(time, offset, len);
    setTimeout(() => amp.disconnect(), (time - ctx.currentTime + heard + 0.2) * 1000);
  }

  // Nearest recorded note, rotating through takes so repeats don't sound robotic.
  pickSample(sound, note) {
    const set = this.sampleSets[sound];
    let best = Infinity;
    for (const s of set) best = Math.min(best, Math.abs(s.note - note));
    const near = set.filter((s) => Math.abs(s.note - note) === best);
    const s = near[this.takeCounter++ % near.length];
    return { buf: s.buffer, rate: Math.pow(2, (note - s.note) / 12) };
  }

  // nylon: a softer pluck (flesh, not a pick) that dies away sooner.
  guitarBuffer(note, nylon = false) {
    const cacheKey = nylon ? `nylon${note}` : note;
    if (this.guitarCache.has(cacheKey)) return this.guitarCache.get(cacheKey);
    const sr = this.ctx.sampleRate;
    const freq = midiToFreq(note);
    const period = Math.max(2, Math.round(sr / freq));
    const ring = nylon ? 1.6 : 4;
    const seconds = ring + 0.5;
    const len = Math.floor(sr * seconds);
    const buf = this.ctx.createBuffer(1, len, sr);
    const y = buf.getChannelData(0);
    // Karplus-Strong plucked string. Decay tuned so every note rings about `ring` seconds.
    const decay = Math.pow(0.001, 1 / (freq * ring));
    const soft = nylon ? 0.75 : 0.45;
    let prev = 0;
    for (let i = 0; i < period; i++) {
      const r = Math.random() * 2 - 1;
      prev = prev * soft + r * (1 - soft); // soften the pick
      y[i] = prev;
    }
    for (let i = period; i < len; i++) {
      y[i] = decay * 0.5 * (y[i - period] + y[i - period - 1 >= 0 ? i - period - 1 : 0]);
    }
    const entry = { buf, rate: (freq * period) / sr };
    this.guitarCache.set(cacheKey, entry);
    return entry;
  }

  // Start a note. Returns a function that releases it.
  // Set a part's volume (0 = silent, 1 = normal) and pan (-1 left, 1 right).
  setChannel(part, { volume, pan }) {
    const ch = this.channels?.[part];
    if (!ch) return;
    const now = this.ctx.currentTime;
    if (volume !== undefined) ch.input.gain.setTargetAtTime(volume * (ch.base ?? 1), now, 0.02);
    if (pan !== undefined) ch.pan.pan.setTargetAtTime(pan, now, 0.02);
  }

  voice(note, vel, time, sound = this.sound, part = 'instrument') {
    const ctx = this.ctx;
    const amp = ctx.createGain();
    const level = 0.15 + (vel / 127) * 0.55;
    amp.connect(this.channels?.[part]?.input || this.instrumentBus);
    const stops = [];

    const recorded = this.sampleSets[sound]?.length > 0;
    if (!recorded && !BUILT_IN.includes(sound)) sound = 'pad';

    if (recorded || sound === 'guitar' || sound === 'nylon') {
      const nylon = !recorded && sound === 'nylon';
      const { buf, rate } = recorded ? this.pickSample(sound, note) : this.guitarBuffer(note, nylon);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      const body = ctx.createBiquadFilter();
      // Nylon: the top rolled off, darker than the steel string's bright bump.
      body.type = nylon ? 'lowpass' : 'peaking';
      body.frequency.value = nylon ? 2000 : 2400;
      body.gain.value = recorded ? 0 : 3;
      src.connect(body).connect(amp);
      amp.gain.setValueAtTime(nylon ? level * 0.85 : level, time);
      src.start(time);
      stops.push((t) => src.stop(t));
    } else if (sound === 'epiano') {
      const f = midiToFreq(note);
      const car = ctx.createOscillator();
      car.frequency.value = f;
      const mod = ctx.createOscillator();
      mod.frequency.value = f;
      const idx = ctx.createGain();
      idx.gain.setValueAtTime(f * 1.6 * (0.4 + vel / 127), time);
      idx.gain.exponentialRampToValueAtTime(f * 0.15, time + 1.2);
      mod.connect(idx).connect(car.frequency);
      const tine = ctx.createOscillator();
      tine.frequency.value = f * 4;
      const tineAmp = ctx.createGain();
      tineAmp.gain.setValueAtTime(level * 0.12, time);
      tineAmp.gain.exponentialRampToValueAtTime(0.0001, time + 0.25);
      tine.connect(tineAmp).connect(amp);
      car.connect(amp);
      amp.gain.setValueAtTime(0, time);
      amp.gain.linearRampToValueAtTime(level * 0.8, time + 0.005);
      amp.gain.setTargetAtTime(0, time + 0.01, 1.4);
      [car, mod, tine].forEach((o) => {
        o.start(time);
        stops.push((t) => o.stop(t));
      });
    } else if (sound === 'saw') {
      // Bright sawtooth lead: two saws a hair apart, only the harshest top filtered off.
      const f = midiToFreq(note);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 6000;
      lp.Q.value = 1;
      [-5, 5].forEach((cents) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = cents;
        o.connect(lp);
        o.start(time);
        stops.push((t) => o.stop(t));
      });
      lp.connect(amp);
      amp.gain.setValueAtTime(0, time);
      amp.gain.linearRampToValueAtTime(level * 0.3, time + 0.01);
    } else if (sound === 'sub') {
      // Sub bass: a plain low sine, with a quiet octave above so small speakers show it.
      const f = midiToFreq(note);
      [[f, 1], [f * 2, 0.15]].forEach(([freq, mix]) => {
        const o = ctx.createOscillator();
        o.frequency.value = freq;
        const g = ctx.createGain();
        g.gain.value = mix;
        o.connect(g).connect(amp);
        o.start(time);
        stops.push((t) => o.stop(t));
      });
      amp.gain.setValueAtTime(0, time);
      amp.gain.linearRampToValueAtTime(level * 0.9, time + 0.015);
    } else if (sound === 'swell') {
      // Swell: a soft pad that fades in over several seconds, for ambient drones.
      const f = midiToFreq(note);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      lp.Q.value = 0.3;
      [['sawtooth', -9, 1], ['sawtooth', 9, 1], ['sine', 0, 0.5]].forEach(([type, cents, mult]) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = f * mult;
        o.detune.value = cents;
        o.connect(lp);
        o.start(time);
        stops.push((t) => o.stop(t));
      });
      lp.connect(amp);
      amp.gain.setValueAtTime(0, time);
      amp.gain.linearRampToValueAtTime(level * 0.35, time + 3.5);
    } else {
      // pad
      const f = midiToFreq(note);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1400;
      lp.Q.value = 0.4;
      [-7, 7].forEach((cents) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = cents;
        o.connect(lp);
        o.start(time);
        stops.push((t) => o.stop(t));
      });
      lp.connect(amp);
      amp.gain.setValueAtTime(0, time);
      amp.gain.linearRampToValueAtTime(level * 0.35, time + 0.45);
    }

    const release = RELEASE[sound] ?? 0.6;
    return (t) => {
      const at = Math.max(t, ctx.currentTime);
      amp.gain.cancelAndHoldAtTime(at);
      amp.gain.setTargetAtTime(0, at, release / 4);
      stops.forEach((s) => s(at + release + 0.1));
      setTimeout(() => amp.disconnect(), (at - ctx.currentTime + release + 0.3) * 1000);
    };
  }

  noteOn(note, vel) {
    if (!this.ctx) return;
    this.noteOff(note);
    this.voices.set(note, this.voice(note, vel, this.ctx.currentTime));
  }

  noteOff(note) {
    const release = this.voices.get(note);
    if (release) {
      release(this.ctx.currentTime);
      this.voices.delete(note);
    }
  }

  allOff() {
    for (const n of [...this.voices.keys()]) this.noteOff(n);
  }

  // A scheduled note of fixed length, used by the arpeggiator.
  playNote(note, vel, time, dur, sound = this.sound, part = 'instrument') {
    const release = this.voice(note, vel, time, sound, part);
    release(time + dur);
  }

  // ---- drums ----

  makeNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  drum(kind, time, accent = 1) {
    const ctx = this.ctx;
    // A ghost note is a snare played softly; the caller passes the low accent.
    if (kind === 'ghost') kind = 'snare';
    if (kind === 'gated') {
      // Gated reverb: the snare, then a burst of noise that holds and cuts off dead.
      this.drum('snare', time, accent * 1.2);
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 5000;
      const gate = ctx.createGain();
      gate.gain.setValueAtTime(0, time);
      gate.gain.linearRampToValueAtTime(0.28 * accent, time + 0.01);
      gate.gain.setValueAtTime(0.22 * accent, time + 0.2);
      gate.gain.linearRampToValueAtTime(0, time + 0.23);
      src.connect(lp).connect(gate).connect(this.drumBus);
      src.start(time);
      src.stop(time + 0.25);
      return;
    }
    const g = ctx.createGain();
    g.connect(this.drumBus);
    if (kind === 'kick' && !this.drumKits[this.kit]?.kick) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(120, time);
      o.frequency.exponentialRampToValueAtTime(42, time + 0.12);
      g.gain.setValueAtTime(0.9 * accent, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.4);
      o.connect(g);
      o.start(time);
      o.stop(time + 0.45);
    } else if (this.drumKits[this.kit]?.[kind]) {
      const src = ctx.createBufferSource();
      src.buffer = this.drumKits[this.kit][kind];
      g.gain.setValueAtTime(0.9 * accent, time);
      src.connect(g);
      src.start(time);
    } else if (kind === 'tom') {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(150, time);
      o.frequency.exponentialRampToValueAtTime(85, time + 0.25);
      g.gain.setValueAtTime(0.6 * accent, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.45);
      o.connect(g);
      o.start(time);
      o.stop(time + 0.5);
    } else if (kind === 'rim') {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 1700;
      g.gain.setValueAtTime(0.25 * accent, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
      o.connect(g);
      o.start(time);
      o.stop(time + 0.05);
    } else if (['snare', 'hat', 'openhat', 'click', 'brush'].includes(kind)) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const hp = ctx.createBiquadFilter();
      // A brush is a soft swish: the noise's middle band, not its hiss.
      hp.type = kind === 'brush' ? 'bandpass' : 'highpass';
      const len = { snare: 0.18, hat: 0.045, openhat: 0.3, click: 0.02, brush: 0.09 }[kind];
      hp.frequency.value = { snare: 1200, hat: 7000, openhat: 6500, click: 3000, brush: 3200 }[kind];
      const lvl = { snare: 0.5, hat: 0.18, openhat: 0.16, click: 0.35, brush: 0.35 }[kind] * accent;
      g.gain.setValueAtTime(lvl, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + len);
      src.connect(hp).connect(g);
      src.start(time);
      src.stop(time + len + 0.02);
      if (kind === 'snare') {
        const body = ctx.createOscillator();
        body.type = 'triangle';
        body.frequency.value = 185;
        const bg = ctx.createGain();
        bg.gain.setValueAtTime(0.35 * accent, time);
        bg.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
        body.connect(bg).connect(this.drumBus);
        body.start(time);
        body.stop(time + 0.12);
      }
    }
  }

  // ---- clock ----

  startClock() {
    this.step = 0;
    this.nextStepTime = this.ctx.currentTime + 0.1;
    setInterval(() => {
      const ahead = this.ctx.currentTime + 0.12;
      while (this.nextStepTime < ahead) {
        if (this.onStep) this.onStep(this.step, this.nextStepTime);
        this.nextStepTime += this.secondsPerStep;
        this.step += 1;
      }
    }, 25);
  }

  // Run fn at (roughly) the moment `time` is heard, for UI updates.
  atTime(time, fn) {
    setTimeout(fn, Math.max(0, (time - this.ctx.currentTime) * 1000));
  }
}
