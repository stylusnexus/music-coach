// Note input from a MIDI keyboard (Web MIDI, Chrome only) or the computer keyboard.

// Middle row: C4 upward, with the row above for black keys (like a piano).
const KEYMAP = ['a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j', 'k', 'o', 'l', 'p', ';'];
// Bottom row: white keys one octave lower, C3 to C4.
const LOWER = { z: 48, x: 50, c: 52, v: 53, b: 55, n: 57, m: 59, ',': 60 };

export function setupInput({ onNoteOn, onNoteOff, onStatus }) {
  let computerOctave = 0;
  const computerHeld = new Map(); // key -> note

  async function connectMidi() {
    if (!navigator.requestMIDIAccess) {
      onStatus({ connected: false, message: 'This browser has no MIDI support. Use Chrome, or play with the computer keys A–K.' });
      return;
    }
    try {
      const access = await navigator.requestMIDIAccess();
      const bind = () => {
        const names = [];
        for (const input of access.inputs.values()) {
          input.onmidimessage = handleMessage;
          names.push(input.name);
        }
        onStatus(
          names.length
            ? { connected: true, message: names.join(', ') }
            : { connected: false, message: 'No keyboard found. Plug in the MPK Mini, or play with the computer keys A–K.' },
        );
      };
      access.onstatechange = bind;
      bind();
    } catch {
      onStatus({ connected: false, message: 'MIDI access was blocked. Allow it in Chrome, or play with the computer keys A–K.' });
    }
  }

  function handleMessage(e) {
    const [status, note, vel] = e.data;
    const kind = status & 0xf0;
    if (kind === 0x90 && vel > 0) onNoteOn(note, vel);
    else if (kind === 0x80 || (kind === 0x90 && vel === 0)) onNoteOff(note);
  }

  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const active = document.activeElement;
    // Typing in a text box is typing, not playing.
    if (active?.tagName === 'TEXTAREA' || (active?.tagName === 'INPUT' && !['range', 'checkbox'].includes(active.type))) return;
    const key = e.key.toLowerCase();
    // A dropdown keeps focus after you pick from it; a note key should still play,
    // not change the dropdown's choice.
    if (active?.tagName === 'SELECT' && (KEYMAP.includes(key) || key in LOWER || key === '-' || key === '=')) {
      e.preventDefault();
      active.blur();
    }
    if (key === '-') computerOctave = Math.max(-2, computerOctave - 1);
    if (key === '=') computerOctave = Math.min(2, computerOctave + 1);
    const idx = KEYMAP.indexOf(key);
    if ((idx === -1 && !(key in LOWER)) || computerHeld.has(key)) return;
    const note = (idx === -1 ? LOWER[key] : 60 + idx) + computerOctave * 12;
    computerHeld.set(key, note);
    onNoteOn(note, 90);
  });

  window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    const note = computerHeld.get(key);
    if (note === undefined) return;
    computerHeld.delete(key);
    onNoteOff(note);
  });

  connectMidi();
}
