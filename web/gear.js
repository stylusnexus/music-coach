// Grouping and search for the "Your gear" panel. Pure functions, testable in Node.

// What a plugin does, in plain words, where we know it.
export const DESCRIPTIONS = {
  'VG-SPARKLE2': 'A real clean electric guitarist: hold a chord, it plays recorded guitar patterns. Closest thing you own to the Durutti guitar.',
  'VG-SILK2': 'Same idea as Sparkle, with a soft nylon-string guitar.',
  'Virtual Pianist': 'Hold a chord and it plays a piano part for you.',
  'VB-ROWDY': 'A bass player that follows the note you hold.',
  'VB-SLAP': 'Same idea, slap bass.',
  'VD-BRUTE': 'A drummer: press one key per pattern, it plays a full beat.',
  'VD-LEGEND': 'Same idea, a different drum style.',
  BEATMAKER: 'Drum-machine-style beats, one key per pattern.',
  Pianoverse: 'Detailed acoustic pianos.',
  'SampleTank 4': 'A big library of recorded sounds: pianos, guitars, strings, organs.',
  Electric: 'Electric pianos like the Rhodes.',
  'Essential Keyboards': 'Pianos, organs and electric pianos in one.',
  'MODO BASS 2': 'A realistic bass guitar.',
  'MODO DRUM': 'A realistic acoustic drum kit.',
  Zebralette3: 'A synthesizer for pads and drones.',
  USYNTH: 'A simple synthesizer from UJAM.',
  Hype: 'A synthesizer with ready-made modern sounds.',
  'MPC Beats': 'Akai drum pads and samples; matches the pads on Akai keyboards like the MPK Mini.',
  'AmpliTube 5': 'Guitar amps and pedals (chorus, delay) in one window.',
  TONEX: 'Copies of real guitar amps.',
  MixBox: 'A rack of mixing effects in one plugin.',
  'T-RackS 6': 'Mastering: makes a finished song louder and more even. Last step, not first.',
  'Triad Chorus v6': 'Chorus: the shimmer on the Durutti guitar.',
  'Tape Echo v6': 'A tape echo: repeats that darken and wobble. The Durutti and kosmische echo.',
  'Space Delay v6': 'A spacey echo, modelled on the Roland Space Echo.',
  'CSR Plate v6': 'Plate reverb: a bright, smooth wash of space.',
  'Dual Spring v6': 'Spring reverb: the boingy reverb in guitar amps.',
  'Leslie v6': 'The spinning-speaker organ sound.',
  'CSR Inverse v6': 'Reverse (inverse) reverb: the note swells up into itself. The shoegaze sound.',
  'FIN-FLUXX': 'One-knob "make it move" effect from UJAM.',
};

// Effect families, matched by name, in order. The note explains the family once.
export const EFFECT_FAMILIES = [
  { title: 'Reverbs', note: 'Add space, as if played in a room, hall or plate.', match: /reverb|hall|plate|room|spring|csr/i },
  { title: 'Echoes and delays', note: 'Repeat the sound after a moment.', match: /delay|echo/i },
  { title: 'Chorus and movement', note: 'Make a sound shimmer, swirl or move.', match: /chorus|leslie|fluxx|filter fusion|soften|triad/i },
  { title: 'Guitar amps', note: 'Make any sound go through a guitar amplifier.', match: /amplitube|tonex/i },
  { title: 'Tape, grit and saturation', note: 'Warm, old or dirty the sound up.', match: /tape|tascam|teac|saturat|clipper|lo-?fi|distort|punch|retro|vood|micro/i },
  { title: 'EQ and tone', note: 'Turn up or down the lows, mids and highs.', match: /eq|channel|filter/i },
  { title: 'Compressors and limiters', note: 'Even out loud and quiet parts. Mostly for mixing.', match: /comp|limit|76|2a|670|dyna|de esser|opto|bus/i },
  { title: 'Mastering and metering', note: 'Final polish and measuring. Last step, not first.', match: /master|meter|lurssen|image|t-racks|mixbox|one v6|landr|suite/i },
];

export const INSTRUMENT_FAMILIES = [
  { title: 'Players: hold a chord, it plays', note: 'The easiest instruments if you do not play.', match: /^(vg-|vb-|vd-|beatmaker|virtual pianist)/i },
  { title: 'Keys and pianos', note: '', match: /piano|electric|keyboards/i },
  { title: 'Synthesizers', note: 'For pads, drones and sequences.', match: /zebralette|usynth|hype|gm-one/i },
  { title: 'Bass and drums', note: '', match: /bass|drum|mpc/i },
  { title: 'Sound libraries', note: '', match: /sampletank/i },
];

// T-RackS 5 copies ("TR5 ...") duplicate the T-RackS 6 ("... v6") plugins you also have.
export function isOlderDuplicate(name, allNames) {
  if (!name.startsWith('TR5 ')) return false;
  return allNames.has(`${name.slice(4)} v6`);
}

// What the coach model said about a plugin (server.py, describe_plugins), by maker|name.
export function labelFor(p, labels = {}) {
  return labels[`${p.maker}|${p.name}`] || null;
}

function describe(p, labels) {
  return DESCRIPTIONS[p.name] || labelFor(p, labels)?.description || '';
}

// Jobs lessons can name gear for: gear you added by hand first, then plugins the coach
// model tagged, for jobs nothing you added covers. Removed plugins never count.
export function gearTags(added, plugins, labels = {}, hidden = []) {
  const tags = {};
  for (const a of added) if (a.tag && !tags[a.tag]) tags[a.tag] = a.name;
  const gone = new Set(hidden);
  for (const p of plugins) {
    if (gone.has(p.name)) continue;
    for (const t of labelFor(p, labels)?.good_for || []) if (!tags[t]) tags[t] = p.name;
  }
  return tags;
}

// Plugins the hand-written tables say nothing about and the coach model hasn't seen yet.
export function unlabelled(plugins, labels = {}) {
  const names = new Set(plugins.map((p) => p.name));
  return plugins.filter((p) => p.kind !== 'midi' && !isOlderDuplicate(p.name, names) && !DESCRIPTIONS[p.name] && !labelFor(p, labels));
}

// Hand-written tables first, then the coach model's family, then Other.
export function groupPlugins(plugins, labels = {}) {
  const names = new Set(plugins.map((p) => p.name));
  const groups = new Map();
  const add = (title, note, p) => {
    if (!groups.has(title)) groups.set(title, { title, note, items: [] });
    groups.get(title).items.push({ ...p, description: describe(p, labels) });
  };
  for (const p of plugins) {
    if (p.kind === 'midi') continue;
    if (isOlderDuplicate(p.name, names)) {
      add('Older duplicates (T-RackS 5)', 'Same effects as the T-RackS 6 versions above. Safe to ignore.', p);
      continue;
    }
    const families = p.kind === 'instrument' ? INSTRUMENT_FAMILIES : EFFECT_FAMILIES;
    const family = families.find((f) => f.match.test(p.name)) || families.find((f) => f.title === labelFor(p, labels)?.family);
    const fallback = p.kind === 'instrument' ? 'Other instruments' : 'Other effects';
    add(family ? family.title : fallback, family ? family.note : '', p);
  }
  // Instruments first, then effects in family order, duplicates last.
  const order = [
    ...INSTRUMENT_FAMILIES.map((f) => f.title), 'Other instruments',
    ...EFFECT_FAMILIES.map((f) => f.title), 'Other effects', 'Older duplicates (T-RackS 5)',
  ];
  return order.filter((t) => groups.has(t)).map((t) => groups.get(t));
}

// Every item whose name, maker, description or group matches all the words typed.
export function searchGear(groups, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return groups;
  return groups
    .map((g) => ({
      ...g,
      items: g.items.filter((item) => {
        const text = `${item.name} ${item.maker} ${item.description} ${g.title} ${item.kind}`.toLowerCase();
        return words.every((w) => text.includes(w));
      }),
    }))
    .filter((g) => g.items.length);
}
