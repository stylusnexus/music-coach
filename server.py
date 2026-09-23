#!/usr/bin/env python3
"""Music Coach local server: serves the app, stores progress, sketches and gear,
scans installed gear, and forwards questions to the coach model (LM Studio, or an
API key the learner adds). Standard library only."""

import base64
import mimetypes
import plistlib
import json
import os
import re
import subprocess
import ssl
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
DATA = Path(os.environ.get("COACH_DATA", ROOT / "data"))
SKETCHES = Path(os.environ.get("COACH_SKETCHES", ROOT / "sketches"))
PLUGIN_DIRS = [
    Path("/Library/Audio/Plug-Ins/Components"),
    Path.home() / "Library/Audio/Plug-Ins/Components",
]
SAMPLES_DIR = Path(os.environ.get("COACH_SAMPLES", "/Volumes/Media/Samples"))
LOCAL_SAMPLES = Path(os.environ.get("COACH_LOCAL_SAMPLES", Path.home() / "Music/Samples"))
MARS = "Vintage Synths"

# Recorded instruments the app can play. Makers label octaves differently, so each
# set carries the offset that makes its file names match the pitch actually heard
# (measured, not assumed): MIDI note = 12 * (octave + offset) + note.
# "dir" is a fixed place: Apple's shared sound library, which GarageBand's Sound Library
# download installs (the folder is named Logic because Logic uses it too). "rel" is
# looked for in each sample folder.
# Without the recordings the app plays a built-in tone, named by "standIn".
INSTRUMENTS = [
    {
        "id": "guitar",
        "label": "12-String Guitar",
        "dir": Path(
            os.environ.get(
                "COACH_GUITAR_DIR",
                "/Library/Application Support/Logic/Alchemy Samples/Guitars/Electric Guitars/12 String Pluck R",
            )
        ),
        "offset": 2,
        "standIn": "Guitar",
    },
    {"id": "moog-bass", "label": "Minimoog Bass", "rel": MARS + "/Mini From Mars/WAV/Mama Bass", "offset": 1, "standIn": "Synth Bass"},
    {"id": "vp330-strings", "label": "VP-330 Strings", "rel": MARS + "/VP330 From Mars/WAV/StringsLow", "offset": 3, "standIn": "Strings"},
    {"id": "farfisa", "label": "Farfisa Organ", "rel": MARS + "/VP330 From Mars/WAV/FarfisaFiesta", "offset": 1, "standIn": "Organ"},
]
# One-shot drum sounds for the beat grid, per kit, looked for in each sample folder.
CR78 = "Drum Machines/CR78 From Mars/WAV/One Shots/Individual Hits/Original/Clean/"
MINIPOPS = "Drum Machines/Minipops Snacks From Mars/WAV/02. One Hits/01. Clean Kit/"
DRUM_KITS = [
    {
        "id": "cr78",
        "label": "CR-78",
        "sounds": {
            "kick": CR78 + "Kick_Orig_CR78.wav",
            "snare": CR78 + "Snare_Orig_CR78.wav",
            "rim": CR78 + "Rim_Orig_CR78.wav",
            "hat": CR78 + "CH1_Orig_CR78.wav",
            "openhat": CR78 + "OH_1_Orig_CR78.wav",
        },
    },
    {
        "id": "minipops",
        "label": "Minipops",
        "sounds": {
            "kick": MINIPOPS + "BD Clean Minipops 01.wav",
            "snare": MINIPOPS + "SD Clean Minipops 01.wav",
            "rim": MINIPOPS + "Clave Clean Minipops.wav",
            "hat": MINIPOPS + "CH Clean Minipops 01.wav",
            "openhat": MINIPOPS + "OH Clean Minipops.wav",
        },
    },
]

# Folders of loops worth cutting up in the sampling lesson.
LOOP_FOLDERS = [
    ("Minipops drum loops", "Drum Machines/Minipops Snacks From Mars/WAV/01. Loops"),
    ("VP-330 string loops", "Vintage Synths/VP330 From Mars/SVC350 Loops/01. WAV"),
    ("Tape fragments", "Tape and Texture/Tape Fragments From Mars/WAV"),
    ("Ambient loops", "Ambient Loops"),
]

AUDIO_TYPES = (".wav", ".aif", ".aiff", ".mp3", ".m4a")
# Tags for gear added by hand. Effect tags let a lesson say "your X" in place of a
# GarageBand effect; keyboard and microphone let lessons and the coach name them.
TAGS = ("keyboard", "microphone", "chorus", "echo", "reverb", "amp", "fuzz", "synth", "bass", "drums")

SAMPLE_FILE = re.compile(r"([A-G]#?)(-?\d)(?:_\d+)?\.wav$", re.I)
NOTE_INDEX = {n: i for i, n in enumerate(["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"])}
LMSTUDIO_CONFIG = Path.home() / ".lmstudio/.internal/http-server-config.json"


def app_version(root=None):
    """The release version: package.json when run from source, the VERSION file the
    build writes into the packaged app."""
    root = ROOT if root is None else root
    try:
        return json.loads((root / "package.json").read_text())["version"]
    except (OSError, ValueError, KeyError):
        pass
    try:
        return (root / "VERSION").read_text().strip() or None
    except OSError:
        return None


VERSION = app_version()


def lmstudio_url():
    """LM Studio's server port is a user setting; read it rather than assume 1234."""
    if os.environ.get("LMSTUDIO_URL"):
        return os.environ["LMSTUDIO_URL"]
    try:
        port = json.loads(LMSTUDIO_CONFIG.read_text())["port"]
    except (OSError, ValueError, KeyError):
        port = 1234
    return f"http://localhost:{port}"


LMSTUDIO_URL = lmstudio_url()
LMSTUDIO_MODEL = os.environ.get("LMSTUDIO_MODEL", "")

COACH_PROMPT = """You are a patient music-production coach inside the Music Coach app.
The learner does not play an instrument but can work out chords on {keyboard}.
They use GarageBand. Their first goal is {goal}

Rules for every answer:
- Answer the question first, in plain words. No jargon without a one-line explanation.
- Give at most 5 numbered steps, each one small action.
- Only name gear from the learner's list below, or GarageBand built-ins.
- Keep it under 200 words. End with one thing to try in the next two minutes.

Their gear: {plugins}
Current lesson: {lesson}

What the learner has done so far (use it to fit your answer to where they are):
{context}"""

TAKE_PROMPT = """You are the take coach inside the Music Coach app, working like a kind,
direct practice coach. The learner does not play an instrument; they are learning with
a small MIDI keyboard. Score one practice take.

You cannot hear the take. You get the measurements and a scorecard the app already
computed from them. Rules:
- Ground every statement in a measurement or scorecard line. Never infer talent, taste,
  emotion or how it sounded. Areas marked UNABLE TO ASSESS have no measurement: do not
  comment on them.
- "overall": a rough 1-10 practice score, a coaching signal, not a grade. A take that
  ends cleanly with a few chart misses is a practice success.
- "overall_why": one sentence.
- "worked": exactly two specific things, each tied to a number.
- "one_change": the single highest-impact change. Never a list.
- "objective": one small action that fits in one more try, e.g. "change to F on the
  count of 1", "stop on the bar line after bar 8".
- Aim "one_change" at the lowest-scoring area that has a score.
- If a previous take is given, compare only measured changes.
- Plain words. No jargon without a short explanation. No new gear.

Lesson: {lesson}
Measurements of this take (JSON): {metrics}
Scorecard computed by the app: {scorecard}
Previous take on this lesson (JSON, or null): {previous}"""

COMPARE_PROMPT = """You are the take coach inside the Music Coach app. The learner does not
play an instrument; they are learning with a small MIDI keyboard. Compare two takes of
the same lesson: an earlier one (A) and a later one (B).

You cannot hear the takes. You get each take's measurements and the scorecard the app
computed from them. Rules:
- Ground every statement in a measurement or a score. Never invent a score.
- "improved": lead with what got better from A to B, as a behaviour the learner can
  feel ("you're landing chord changes on the beat now"), not as numbers alone. If
  nothing improved, say what held steady.
- "slipped": one short sentence on what got worse, or an empty string if nothing did.
  A dip is normal between takes; say it plainly, never as failure.
- "next_step": exactly one concrete thing to do in the next take. Never a list.
- One throughline: pick the change that matters most, don't list all five areas.
- Plain words. No jargon without a short explanation.

Lesson: {lesson}
Take A (take {a}): measurements {a_metrics}; scorecard {a_card}
Take B (take {b}): measurements {b_metrics}; scorecard {b_card}"""

COMPARE_SCHEMA = {
    "type": "object",
    "properties": {
        "improved": {"type": "string"},
        "slipped": {"type": "string"},
        "next_step": {"type": "string"},
    },
    "required": ["improved", "slipped", "next_step"],
}

REPORT_SCHEMA = {
    "type": "object",
    "properties": {
        "overall": {"type": "integer", "minimum": 1, "maximum": 10},
        "overall_why": {"type": "string"},
        "worked": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 2},
        "one_change": {"type": "string"},
        "objective": {"type": "string"},
    },
    "required": ["overall", "overall_why", "worked", "one_change", "objective"],
}
AREAS = ("chords", "timing", "feel", "sound", "ending")


# Requests run on threads: gear and coach files are read and written one at a time.
FILE_LOCK = threading.RLock()


def write_json(path, value, private=False):
    """Write whole or not at all. Private files (the API key) are readable by you only."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{threading.get_ident()}.tmp")
    try:
        # A private file is created unreadable to others before anything is written.
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600 if private else 0o644)
        with os.fdopen(fd, "w") as f:
            f.write(json.dumps(value, indent=2))
        tmp.replace(path)
    finally:
        tmp.unlink(missing_ok=True)


def clean_prefs(raw):
    """Gear choices, checked: absolute folder paths, named items with a known tag."""
    raw = raw if isinstance(raw, dict) else {}
    folders = [os.path.expanduser(f) for f in raw.get("folders") or [] if isinstance(f, str)]
    folders = [f.rstrip("/") or "/" for f in folders if f.startswith("/")]
    added = []
    for item in raw.get("added") or []:
        if not isinstance(item, dict):
            continue
        name = " ".join(str(item.get("name", "")).split())[:80]
        if not name or any(a["name"].lower() == name.lower() for a in added):
            continue
        added.append({
            "name": name,
            "tag": item.get("tag") if item.get("tag") in TAGS else "",
            "kind": "plugin" if item.get("kind") == "plugin" else "hardware",
        })
    hidden = sorted({h[:120] for h in raw.get("hidden") or [] if isinstance(h, str) and h.strip()})
    return {
        "folders": list(dict.fromkeys(folders))[:20],
        "added": added[:200],
        "hidden": hidden[:500],
        "setupDone": bool(raw.get("setupDone")),
    }


def load_prefs():
    """Your gear choices. The file is made once: on the first run it takes over the
    sample folders this Mac already used, so an existing setup carries over exactly
    (an unplugged drive included). After that it is only ever changed by you."""
    f = DATA / "gear.json"
    with FILE_LOCK:
        if f.exists():
            try:
                return clean_prefs(json.loads(f.read_text()))
            except ValueError:
                # Unreadable (a hand edit gone wrong): keep it aside, never write over it.
                f.rename(f.with_name(f"gear.json.broken-{time.strftime('%Y%m%d-%H%M%S')}"))
        existing = (DATA / "progress.json").exists()
        prefs = clean_prefs({
            "folders": [str(p) for p in (LOCAL_SAMPLES, SAMPLES_DIR) if existing or p.is_dir()],
            "setupDone": existing,
        })
        write_json(f, prefs)
        return prefs


def change_prefs(change, prefs):
    """Apply one change to your gear choices. The page sends changes, never whole
    lists, so a page that hasn't loaded your gear yet can't wipe it."""
    op = change.get("op")
    name = " ".join(str(change.get("name", "")).split())[:120]
    added, hidden, folders = list(prefs["added"]), list(prefs["hidden"]), list(prefs["folders"])
    if op == "add" and name:
        added.append({"name": name, "tag": change.get("tag", ""), "kind": change.get("kind", "hardware")})
    elif op == "remove":
        added = [a for a in added if a["name"] != name]
    elif op == "tag":
        added = [{**a, "tag": change.get("tag", "")} if a["name"] == name else a for a in added]
    elif op == "hide" and name:
        hidden.append(name)
    elif op == "unhide":
        hidden = [h for h in hidden if h != name]
    elif op == "removeFolder":
        folders = [f for f in folders if f != change.get("path")]
    elif op == "addFolder":
        path = str(change.get("path", ""))
        # Put back a folder (a network drive may be unplugged right now), or a real folder.
        if path.startswith("/Volumes/") or Path(path).is_dir():
            folders.append(path)
    elif op == "setupDone":
        return clean_prefs({**prefs, "setupDone": True})
    else:
        raise ValueError("Unknown change.")
    return clean_prefs({**prefs, "added": added, "hidden": hidden, "folders": folders})


def sample_roots(root=None):
    """Folders to look in: the one given (tests), or your sample folders."""
    if root is None:
        return [Path(f) for f in load_prefs()["folders"]]
    return [root] if isinstance(root, Path) else list(root)


def scan_gear(plugin_dirs=None, samples_dir=None):
    plugin_dirs = PLUGIN_DIRS if plugin_dirs is None else plugin_dirs
    roots = [r for r in sample_roots(samples_dir) if r.is_dir()]
    plugins = sorted({p.stem for d in plugin_dirs if d.is_dir() for p in d.glob("*.component")})
    installers, zipped = [], []
    for root in roots:
        # Top level and one folder down, so grouping a drive into folders still works.
        for p in sorted([*root.glob("*"), *root.glob("*/*")], key=lambda p: p.name.lower()):
            suffix = p.suffix.lower()
            if suffix in (".pkg", ".dmg"):
                installers.append(p.name)
            elif suffix == ".zip":
                zipped.append(p.name)
    return {
        "plugins": plugins,
        "installers": sorted(installers, key=str.lower),
        "zippedPacks": sorted(zipped, key=str.lower),
        "samplesMounted": bool(roots),
    }


def strip_thinking(text):
    """Local reasoning models emit <think>...</think> notes; the learner only sees the answer."""
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    text = re.sub(r"^.*?</think>", "", text, flags=re.S)  # opening tag was cut off
    if "<think>" in text:  # never closed: the model ran out of room mid-thought
        text = text.split("<think>")[0]
    return text.strip()


def instrument_samples(folder, offset):
    """Map each recorded note file in a folder to the MIDI note it sounds."""
    if not folder.is_dir():
        return []
    samples = []
    for p in sorted(folder.iterdir()):
        m = SAMPLE_FILE.search(p.name)
        if m and not p.name.startswith("."):
            name, octave = m.group(1).upper(), int(m.group(2))
            samples.append({"note": 12 * (octave + offset) + NOTE_INDEX[name], "file": p.name})
    return samples


def instrument_dir(inst, roots=None):
    if "dir" in inst:
        return inst["dir"]
    return next((r / inst["rel"] for r in sample_roots(roots) if (r / inst["rel"]).is_dir()), None)


def available_instruments(instruments=None, roots=None):
    """Every instrument, with its recordings when this Mac has them. Without them the
    app plays a built-in tone, and the button says what it really is."""
    instruments = INSTRUMENTS if instruments is None else instruments
    found = []
    for inst in instruments:
        folder = instrument_dir(inst, roots)
        samples = instrument_samples(folder, inst["offset"]) if folder else []
        found.append({
            "id": inst["id"],
            "label": inst["label"] if samples else inst.get("standIn", inst["label"]),
            "recorded": bool(samples),
            "samples": samples,
        })
    return found


def available_drum_kits(root=None):
    roots = sample_roots(root)
    return [
        kit for kit in DRUM_KITS
        if any(all((r / f).is_file() for f in kit["sounds"].values()) for r in roots)
    ]


def first_audio_files(base, limit, max_dirs=400):
    """Up to `limit` audio files under base, stopping early: a big drive stays quick."""
    files, seen = [], 0
    for folder, dirs, names in os.walk(base):
        dirs[:] = sorted(d for d in dirs if not d.startswith("."))
        seen += 1
        files += [Path(folder, n) for n in sorted(names) if n.lower().endswith(AUDIO_TYPES) and not n.startswith(".")]
        if len(files) >= limit or seen >= max_dirs:
            break
    return files[:limit]


def loop_files(root=None, per_folder=60):
    """Loops for the sampler, grouped by where they came from. Paths are relative to
    the sample folder they are in. Known packs get their own groups; any other folder
    is one group, named after it."""
    groups = []
    for r in sample_roots(root):
        if not r.is_dir():
            continue
        known = [(label, r / folder) for label, folder in LOOP_FOLDERS if (r / folder).is_dir()]
        # A drive's own name says more than "Samples": "Samples on Media".
        name = f"{r.name} on {r.parts[2]}" if len(r.parts) > 3 and r.parts[1] == "Volumes" else r.name
        for label, base in known or [(name, r)]:
            files = sorted(p for p in base.rglob("*.wav") if not p.name.startswith(".")) if known else first_audio_files(base, per_folder)
            if files:
                groups.append({"label": label, "files": [str(p.relative_to(r)) for p in files[:per_folder]]})
    return groups


def local_sample_path(relative, root=None):
    """Resolve a path inside one of your sample folders, refusing anything outside them."""
    for r in sample_roots(root):
        r = r.resolve()
        path = (r / relative).resolve()
        if path.suffix.lower() in AUDIO_TYPES and path.is_relative_to(r) and path.is_file():
            return path
    return None


def plugin_details(plugin_dirs=None):
    """Name, maker and kind (instrument or effect) of each installed Audio Unit."""
    plugin_dirs = PLUGIN_DIRS if plugin_dirs is None else plugin_dirs
    kinds = {"aumu": "instrument", "aufx": "effect", "aumf": "effect", "aumi": "midi"}
    details = []
    for d in plugin_dirs:
        if not d.is_dir():
            continue
        for comp in sorted(d.glob("*.component")):
            maker, kind = "Other", "effect"
            try:
                info = plistlib.loads((comp / "Contents/Info.plist").read_bytes())
                au = info.get("AudioComponents", [{}])[0]
                full = au.get("name", "")
                if ":" in full:
                    maker = full.split(":", 1)[0].strip()
                kind = kinds.get(au.get("type", ""), "effect")
            except (OSError, ValueError, plistlib.InvalidFileException, IndexError, AttributeError):
                pass
            details.append({"name": comp.stem, "maker": maker, "kind": kind})
    return details


def safe_sketch_name(name):
    stem = re.sub(r"[^A-Za-z0-9 _-]+", "", Path(str(name)).stem).strip()[:60]
    return stem or "sketch"


TAG_RULES = [
    ("", r"headphone|monitor|interface|scarlett|focusrite|theremin|speaker|cable"),
    ("microphone", r"\bmic\b|microphone|sm5\d|sm7|shure|rode|at20\d\d|condenser"),
    ("keyboard", r"mpk|keystep|launchkey|keylab|minilab|oxygen|keyboard|controller"),
    ("drums", r"drum|beat|808|909"),
    ("bass", r"bass"),
    ("chorus", r"chorus|ensemble"),
    ("echo", r"echo|delay"),
    ("reverb", r"reverb|verb|plate|hall"),
    ("amp", r"\bamp\b|amplifier|amplitube|tonex"),
    ("fuzz", r"fuzz|distort|overdrive"),
    ("synth", r"synth|moog|korg|arturia|minifreak|op-1|juno"),
]


def rule_tag(name):
    """A tag from the name alone, or None when the name gives nothing away."""
    for tag, pattern in TAG_RULES:
        if re.search(pattern, name, re.I):
            return tag
    return None


def lmstudio(path, payload=None, timeout=120):
    req = urllib.request.Request(
        LMSTUDIO_URL + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def pick_model(ids):
    """Embedding models cannot chat; coding models answer music questions poorly."""
    chat = [i for i in ids if "embed" not in i.lower()]
    general = [i for i in chat if "coder" not in i.lower()]
    return (general or chat or [None])[0]


LMSTUDIO_DOWN = {
    "error": "LM Studio isn't answering. Open LM Studio, load a model, "
    "then go to the Developer tab and switch the server on."
}


def chat_model():
    try:
        model = LMSTUDIO_MODEL or pick_model([m["id"] for m in lmstudio("/v1/models", timeout=3)["data"]])
    except (urllib.error.URLError, OSError, KeyError, IndexError, ValueError):
        return None
    return model


PROVIDERS = {
    "local": {"label": "LM Studio"},
    "openai": {"label": "OpenAI", "url": "https://api.openai.com/v1", "model": "gpt-5-nano"},
    "anthropic": {"label": "Anthropic", "url": "https://api.anthropic.com/v1", "model": "claude-haiku-4-5-20251001"},
    "other": {"label": "Your model service"},
}
NO_MODEL = " Or add an API key: press Coach model at the top."
JSON_ONLY = "\n\nReply with only the JSON object, no other text."


class CoachOff(Exception):
    """There is no model to ask. The message says how to set one up."""


class CoachError(Exception):
    """The model was asked and something went wrong."""


def coach_settings():
    try:
        raw = json.loads((DATA / "coach.json").read_text())
    except (OSError, ValueError):
        raw = {}
    raw = raw if isinstance(raw, dict) else {}
    return {
        "provider": raw.get("provider") if raw.get("provider") in PROVIDERS else "local",
        "model": str(raw.get("model") or "").strip()[:100],
        "baseUrl": str(raw.get("baseUrl") or "").strip()[:300],
        "apiKey": str(raw.get("apiKey") or "").strip(),
    }


def save_coach(body):
    """Store the coach choice. A saved key only ever goes to the service it was entered
    for: changing the service or its address without a new key forgets the old one."""
    with FILE_LOCK:
        return _save_coach(body)


def _save_coach(body):
    old = coach_settings()
    body = body if isinstance(body, dict) else {}
    new = {
        "provider": body.get("provider") if body.get("provider") in PROVIDERS else "local",
        "model": " ".join(str(body.get("model") or "").split())[:100],
        "baseUrl": str(body.get("baseUrl") or "").strip()[:300] if body.get("provider") == "other" else "",
    }
    if new["provider"] == "other" and not re.match(r"https?://", new["baseUrl"]):
        raise ValueError("The address must start with http:// or https://.")
    key = body.get("apiKey")
    if isinstance(key, str) and key.strip():
        new["apiKey"] = key.strip()
    elif not body.get("forgetKey") and (old["provider"], old["baseUrl"]) == (new["provider"], new["baseUrl"]):
        new["apiKey"] = old["apiKey"]
    else:
        new["apiKey"] = ""
    write_json(DATA / "coach.json", new, private=True)
    return new


def coach_ready(settings):
    """Whether a question would reach a model: LM Studio answering, or a key saved."""
    if settings["provider"] == "local":
        return chat_model() is not None
    if settings["provider"] == "other":
        return bool(settings["baseUrl"])
    return bool(settings["apiKey"])


def public_coach(settings):
    """The coach settings the page may see: never the key itself."""
    return {
        "provider": settings["provider"],
        "model": settings["model"],
        "baseUrl": settings["baseUrl"],
        "hasKey": bool(settings["apiKey"]),
        "ready": coach_ready(settings),
        "defaults": {k: v.get("model", "") for k, v in PROVIDERS.items()},
    }


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """A redirect would carry the API key to another address: treat it as an error."""

    def redirect_request(self, *args, **kwargs):
        return None


def tls_context():
    """Python from python.org ships without trusted certificates until you run its
    Install Certificates step; macOS's own list works in the meantime."""
    ctx = ssl.create_default_context()
    if os.path.exists("/etc/ssl/cert.pem"):
        ctx.load_verify_locations("/etc/ssl/cert.pem")
    return ctx


def post_json(url, payload, headers, label, timeout):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json", **headers}
    )
    opener = urllib.request.build_opener(NoRedirect, urllib.request.HTTPSHandler(context=tls_context()))
    try:
        with opener.open(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise CoachError(f"{label} refused the API key. Check it under Coach model at the top.") from exc
        try:
            err = json.loads(exc.read()).get("error")
            detail = err.get("message") if isinstance(err, dict) else str(err or "")
        except (ValueError, AttributeError, OSError):
            detail = ""
        raise CoachError(f"{label} returned error {exc.code}" + (f": {detail[:200]}" if detail else ".")) from exc
    except (urllib.error.URLError, OSError, ValueError) as exc:
        raise CoachError(f"{label} could not be reached ({getattr(exc, 'reason', exc)}).") from exc


def complete(system, user, max_tokens, temperature, schema=None, timeout=120):
    """One reply from the coach's model: LM Studio, or the service your key is for.
    Returns (message, model); message has "content" and, from reasoning models,
    sometimes "reasoning_content"."""
    s = coach_settings()
    p = s["provider"]
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    if p == "local":
        model = chat_model()
        if not model:
            raise CoachOff(LMSTUDIO_DOWN["error"] + NO_MODEL)
        payload = {"model": model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens}
        if schema:
            payload["response_format"] = {"type": "json_schema", "json_schema": {"name": "reply", "schema": schema}}
        try:
            return lmstudio("/v1/chat/completions", payload, timeout=timeout)["choices"][0]["message"], model
        except (urllib.error.URLError, OSError, KeyError, IndexError, ValueError) as exc:
            raise CoachError(f"LM Studio returned an error: {exc}") from exc

    label = PROVIDERS[p]["label"]
    if not s["apiKey"] and p != "other":
        raise CoachOff(f"Add your {label} API key: press Coach model at the top.")
    model = s["model"] or PROVIDERS[p].get("model", "")
    if not model:
        raise CoachOff("Type the model's name: press Coach model at the top.")
    if p == "anthropic":
        body = {
            "model": model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "system": system + (JSON_ONLY if schema else ""),
            "messages": messages[1:],
        }
        headers = {"x-api-key": s["apiKey"], "anthropic-version": "2023-06-01"}
        result = post_json(PROVIDERS[p]["url"] + "/messages", body, headers, label, timeout)
        text = "".join(b.get("text", "") for b in result.get("content", []) if b.get("type") == "text")
        return {"content": text}, model

    payload = {"model": model, "messages": messages}
    if p == "openai":
        # Small OpenAI models reason before answering: those tokens count toward the cap,
        # and they take no temperature.
        payload["max_completion_tokens"] = max_tokens + 4000
        if schema:
            payload["response_format"] = {"type": "json_schema", "json_schema": {"name": "reply", "schema": schema}}
    else:
        payload["max_tokens"] = max_tokens
        payload["temperature"] = temperature
        if schema:
            messages[0]["content"] += JSON_ONLY
    base = PROVIDERS["openai"]["url"] if p == "openai" else s["baseUrl"].rstrip("/")
    headers = {"Authorization": f"Bearer {s['apiKey']}"} if s["apiKey"] else {}
    result = post_json(base + "/chat/completions", payload, headers, label, timeout)
    try:
        return result["choices"][0]["message"], model
    except (KeyError, IndexError, TypeError) as exc:
        raise CoachError(f"{label} sent a reply in an unexpected shape.") from exc


TAG_SCHEMA = {
    "type": "object",
    "properties": {"tag": {"type": "string", "enum": [*TAGS, "none"]}},
    "required": ["tag"],
}


def suggest_tag(name):
    """A tag for gear added by hand: from the name if it says, else from the coach model."""
    tag = rule_tag(name)
    if tag is not None:
        return {"tag": tag, "source": "name"}
    system = (
        "You sort music gear for a beginner's practice app. Pick the one tag that says what "
        f"this item is used for: {', '.join(TAGS)}, or none. keyboard means a MIDI keyboard "
        "or controller; synth means an instrument that makes its own sound. "
        'Reply as JSON: {"tag": "..."}.'
    )
    try:
        message, _ = complete(system, f"Gear: {name}", 300, 0, schema=TAG_SCHEMA, timeout=30)
        tag = report_json(message).get("tag")
    except (CoachOff, CoachError, ValueError, AttributeError):
        return {"tag": "", "source": "none"}
    return {"tag": tag if tag in TAGS else "", "source": "model"}


# The "Your gear" groups (web/gear.js), and the tags a plugin can carry.
GEAR_FAMILIES = {
    "instrument": ["Players: hold a chord, it plays", "Keys and pianos", "Synthesizers", "Bass and drums", "Sound libraries"],
    "effect": [
        "Reverbs", "Echoes and delays", "Chorus and movement", "Guitar amps", "Tape, grit and saturation",
        "EQ and tone", "Compressors and limiters", "Mastering and metering",
    ],
}
PLUGIN_TAGS = ("chorus", "echo", "reverb", "amp", "fuzz", "synth", "bass", "drums")
# An effect can't be your synth, and an instrument can't be your reverb.
TAGS_BY_KIND = {"effect": ("chorus", "echo", "reverb", "amp", "fuzz"), "instrument": ("synth", "bass", "drums")}
DESCRIBE_BATCH = 40
DESCRIBE_LOCK = threading.Lock()
DESCRIBE_PROMPT = f"""You sort audio plug-ins for a beginner's music app. For each item you get an id, name, maker and kind (instrument or effect).
Return one entry per id:
- family: one of the families listed for its kind, or "unknown".
- description: what it does, in plain words a beginner understands, 12 words or fewer. No brand talk, no praise.
- good_for: zero or more of the listed tags.
Only describe a plug-in you actually recognise, or whose name plainly says what it does (e.g. "Plate Reverb"). If you are not sure, use family "unknown", description "" and good_for []. A blank is better than a guess.
Families (instrument): {"; ".join(GEAR_FAMILIES["instrument"])}
Families (effect): {"; ".join(GEAR_FAMILIES["effect"])}
Tags: {", ".join(PLUGIN_TAGS)}
Reply as JSON: {{"items": [{{"id": 1, "family": "...", "description": "...", "good_for": []}}]}}"""
DESCRIBE_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer"},
                    "family": {"type": "string", "enum": [*GEAR_FAMILIES["instrument"], *GEAR_FAMILIES["effect"], "unknown"]},
                    "description": {"type": "string"},
                    "good_for": {"type": "array", "items": {"type": "string", "enum": list(PLUGIN_TAGS)}},
                },
                "required": ["id", "family", "description", "good_for"],
            },
        }
    },
    "required": ["items"],
}


def label_key(plugin):
    return f"{plugin['maker']}|{plugin['name']}"


def load_labels():
    """What the coach model said about each plugin, by maker|name. Saved so each one is asked once."""
    try:
        raw = json.loads((DATA / "gear-labels.json").read_text())
    except (OSError, ValueError):
        return {}
    return raw if isinstance(raw, dict) else {}


def clean_label(entry, kind):
    """One model answer, kept only where it uses the fixed families and tags."""
    family = entry.get("family") if entry.get("family") in GEAR_FAMILIES.get(kind, []) else ""
    words = " ".join(str(entry.get("description") or "").split()).split(" ")
    description = " ".join(words[:12]).strip() if family else ""
    tags = entry.get("good_for") if isinstance(entry.get("good_for"), list) else []
    good_for = [t for t in dict.fromkeys(tags) if t in TAGS_BY_KIND.get(kind, ())] if family else []
    return {"family": family, "description": description, "good_for": good_for}


def describe_plugins(names, plugins=None):
    """Sort and describe the named plugins with the coach model. Only installed plugins the
    model hasn't seen are sent: their name, maker and kind. Returns (status, body)."""
    if not DESCRIBE_LOCK.acquire(blocking=False):
        return 409, {"error": "Already sorting.", "labels": load_labels()}
    try:
        labels = load_labels()
        wanted = set(names)
        todo = [
            p for p in (plugin_details() if plugins is None else plugins)
            if p["name"] in wanted and p["kind"] in GEAR_FAMILIES and label_key(p) not in labels
        ]
        for start in range(0, len(todo), DESCRIBE_BATCH):
            batch = todo[start : start + DESCRIBE_BATCH]
            listing = "\n".join(
                json.dumps({"id": i, "name": p["name"], "maker": p["maker"], "kind": p["kind"]})
                for i, p in enumerate(batch, 1)
            )
            try:
                message, _ = complete(DESCRIBE_PROMPT, listing, 2500, 0, schema=DESCRIBE_SCHEMA, timeout=120)
                items = report_json(message).get("items")
            except CoachOff as exc:
                return 200, {"labels": labels, "status": "off", "message": str(exc)}
            except (CoachError, ValueError, AttributeError) as exc:
                return 200, {"labels": labels, "status": "error", "message": str(exc)}
            by_id = {}
            for e in items if isinstance(items, list) else []:
                try:
                    by_id[int(e.get("id"))] = e
                except (AttributeError, TypeError, ValueError):
                    pass
            # A plugin the model skipped is saved blank, so it is never sent again.
            for i, p in enumerate(batch, 1):
                labels[label_key(p)] = clean_label(by_id.get(i, {}), p["kind"])
            with FILE_LOCK:
                write_json(DATA / "gear-labels.json", labels)
        return 200, {"labels": labels, "status": "done"}
    finally:
        DESCRIBE_LOCK.release()


def visible_gear(prefs=None):
    """Your plugins minus the ones you removed, plus gear you added by hand."""
    prefs = prefs or load_prefs()
    hidden = set(prefs["hidden"])
    plugins = [p for p in scan_gear()["plugins"] if p not in hidden]
    return plugins, prefs["added"]


def choose_folder():
    """Ask macOS for a folder with its own picker; a web page is never told a dropped
    folder's full path. Returns the path, or None when you cancel."""
    script = (
        "tell current application\nactivate\n"
        'set f to choose folder with prompt "Pick a folder of samples or loops for Music Coach"\n'
        "end tell\nPOSIX path of f"
    )
    try:
        done = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=600)
    except (OSError, subprocess.TimeoutExpired):
        return None
    path = done.stdout.strip()
    return (path.rstrip("/") or "/") if done.returncode == 0 and path.startswith("/") else None


def clean_scorecard(card):
    """The app's rulebook scorecard, checked: every area present, scores 1-10 or null."""
    clean = {}
    for area in AREAS:
        entry = (card or {}).get(area) or {}
        s = entry.get("score")
        ok = isinstance(s, int) and not isinstance(s, bool)
        clean[area] = {"score": max(1, min(10, s)) if ok else None, "evidence": str(entry.get("evidence", ""))[:300]}
    return clean


def clean_report(raw, scorecard):
    """Hold the model's words to the rules: a 1-10 overall score and exactly two wins.
    The scorecard always comes from the app's measurements, never the model."""
    if not isinstance(raw, dict):
        raise ValueError("report is not an object")
    v = raw.get("overall")
    overall = max(1, min(10, int(v))) if isinstance(v, (int, float)) and not isinstance(v, bool) else None
    worked = [str(w).strip() for w in (raw.get("worked") or []) if str(w).strip()][:2]
    if overall is None or len(worked) < 2:
        raise ValueError("report is missing the overall score or the two things that worked")
    return {
        "overall": overall,
        "overall_why": str(raw.get("overall_why", "")).strip(),
        "worked": worked,
        "scorecard": scorecard,
        "one_change": str(raw.get("one_change", "")).strip(),
        "objective": str(raw.get("objective", "")).strip(),
    }


def report_json(message):
    """The report object from a model reply. With structured output, LM Studio files a
    reasoning model's reply under reasoning_content and leaves content empty."""
    for text in (strip_thinking(message.get("content") or ""), message.get("reasoning_content") or ""):
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            return json.loads(text[start : end + 1])
    raise ValueError("no JSON object in the reply")


def score_take(metrics, scorecard, lesson, previous):
    readable = {
        area: (f"{e['score']}/10" if e["score"] is not None else "UNABLE TO ASSESS") + f" - {e['evidence']}"
        for area, e in scorecard.items()
    }
    prompt = TAKE_PROMPT.format(
        lesson=lesson or "none",
        metrics=json.dumps(metrics),
        scorecard=json.dumps(readable),
        previous=json.dumps(previous) if previous else "null",
    )
    try:
        message, model = complete(prompt, "Score this take.", 1500, 0.3, schema=REPORT_SCHEMA, timeout=180)
        report = clean_report(report_json(message), scorecard)
    except CoachOff as exc:
        return 503, {"error": str(exc), "noModel": True}
    except CoachError as exc:
        return 502, {"error": str(exc)}
    except ValueError as exc:
        return 502, {"error": f"The model's report didn't follow the format ({exc}). Try scoring again."}
    return 200, {"report": report, "model": model}


def load_takes():
    f = DATA / "takes.json"
    return json.loads(f.read_text()) if f.exists() else []


def lesson_takes(lesson):
    """A lesson's takes in order, numbered from 1 (older entries have no number stored)."""
    takes = [t for t in load_takes() if t.get("lesson") == lesson]
    return [{**t, "take": i + 1} for i, t in enumerate(takes)]


def readable_card(card):
    return {
        area: (f"{e['score']}/10" if e.get("score") is not None else "UNABLE TO ASSESS") + f" - {e.get('evidence', '')}"
        for area, e in (card or {}).items()
    }


def compare_takes(lesson, a, b):
    """The coach model's words on two takes of a lesson. Scores are the app's own."""
    prompt = COMPARE_PROMPT.format(
        lesson=lesson or "none",
        a=a["take"], a_metrics=json.dumps(a["metrics"]), a_card=json.dumps(readable_card(a["report"]["scorecard"])),
        b=b["take"], b_metrics=json.dumps(b["metrics"]), b_card=json.dumps(readable_card(b["report"]["scorecard"])),
    )
    try:
        message, model = complete(prompt, "Compare these two takes.", 900, 0.3, schema=COMPARE_SCHEMA, timeout=180)
        raw = report_json(message)
    except CoachOff as exc:
        return 503, {"error": str(exc), "noModel": True}
    except CoachError as exc:
        return 502, {"error": str(exc)}
    except ValueError as exc:
        return 502, {"error": f"The model's comparison didn't follow the format ({exc}). Try again."}
    words = {k: str(raw.get(k, "")).strip() for k in ("improved", "slipped", "next_step")} if isinstance(raw, dict) else {}
    if not words.get("improved") or not words.get("next_step"):
        return 502, {"error": "The model's comparison was missing what improved or the next step. Try again."}
    return 200, {"comparison": words, "model": model}


def save_take(entry):
    DATA.mkdir(parents=True, exist_ok=True)
    takes = load_takes() + [entry]
    tmp = DATA / "takes.json.tmp"
    tmp.write_text(json.dumps(takes, indent=2))
    tmp.replace(DATA / "takes.json")
    return takes


DEFAULT_GOAL = "making their own music and finishing it in GarageBand."


def ask_coach(question, lesson, plugins, context="", added=(), goal=""):
    keyboard = next((a["name"] for a in added if a["tag"] == "keyboard"), None)
    gear = [*plugins, *(f"{a['name']} ({a['tag'] or a['kind']})" for a in added)]
    system = COACH_PROMPT.format(
        keyboard=f"their {keyboard}" if keyboard else "a small MIDI keyboard",
        plugins=", ".join(gear) or "none found",
        lesson=lesson or "none",
        context=context or "nothing yet",
        goal=" ".join(str(goal).split())[:300] or DEFAULT_GOAL,
    )
    try:
        message, model = complete(system, question, 900, 0.5)
        answer = strip_thinking(message.get("content") or "")
    except CoachOff as exc:
        return 503, {"error": str(exc), "noModel": True}
    except CoachError as exc:
        return 502, {"error": str(exc)}
    return 200, {"answer": answer or "(The model returned an empty answer. Try again.)", "model": model}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB), **kwargs)

    def log_message(self, fmt, *args):
        if "/api/" in str(args[0] if args else ""):
            sys.stderr.write("%s\n" % (fmt % args))

    def send_json(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(length) or b"null")

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.from_elsewhere():
            return self.send_json(403, {"error": "Requests from other sites are refused."})
        if self.path == "/api/gear":
            prefs = load_prefs()
            folders = [{"path": f, "found": Path(f).is_dir()} for f in prefs["folders"]]
            return self.send_json(200, {**scan_gear(), **prefs, "folders": folders, "tags": TAGS, "home": str(Path.home())})
        if self.path == "/api/coach":
            return self.send_json(200, public_coach(coach_settings()))
        if self.path == "/api/version":
            return self.send_json(200, {"version": VERSION})
        if self.path == "/api/drumkits":
            return self.send_json(200, available_drum_kits())
        if self.path == "/api/loops":
            return self.send_json(200, loop_files())
        if self.path == "/api/plugins":
            return self.send_json(200, plugin_details())
        if self.path == "/api/gear/labels":
            return self.send_json(200, load_labels())
        if self.path.startswith("/local/"):
            path = local_sample_path(urllib.parse.unquote(self.path[len("/local/"):]))
            if not path:
                return self.send_json(404, {"error": "No such sample."})
            data = path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", mimetypes.guess_type(path.name)[0] or "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return None
        if self.path == "/api/instruments":
            return self.send_json(200, available_instruments())
        if self.path.startswith("/samples/"):
            parts = urllib.parse.unquote(self.path[len("/samples/"):]).split("/")
            inst = next((i for i in INSTRUMENTS if len(parts) == 2 and i["id"] == parts[0]), None)
            folder = instrument_dir(inst) if inst else None
            path = folder / Path(parts[1]).name if folder else None
            if not path or not SAMPLE_FILE.search(parts[1]) or not path.is_file():
                return self.send_json(404, {"error": "No such sample."})
            data = path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return None
        if self.path == "/api/progress":
            f = DATA / "progress.json"
            return self.send_json(200, json.loads(f.read_text()) if f.exists() else {})
        if self.path == "/api/takes":
            return self.send_json(200, load_takes()[-20:])
        if self.path.startswith("/api/takes?"):
            query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            return self.send_json(200, lesson_takes(query.get("lesson", [""])[0]))
        if self.path == "/api/sketches":
            files = sorted(SKETCHES.glob("*.mid"), key=lambda p: p.stat().st_mtime, reverse=True) if SKETCHES.is_dir() else []
            return self.send_json(200, [p.name for p in files])
        return super().do_GET()

    def from_elsewhere(self):
        """Any web page can send requests to localhost, and a site can point its own name
        at this Mac. Only this app's own page, at its own address, is answered."""
        port = self.server.server_address[1]
        ours = {f"localhost:{port}", f"127.0.0.1:{port}"}
        if self.headers.get("Host") not in ours:
            return True
        origin = self.headers.get("Origin")
        return bool(origin) and origin not in {f"http://{h}" for h in ours}

    def do_POST(self):
        if self.from_elsewhere():
            return self.send_json(403, {"error": "Requests from other sites are refused."})
        try:
            body = self.read_json()
        except ValueError:
            return self.send_json(400, {"error": "Body must be JSON."})

        if self.path == "/api/progress":
            if not isinstance(body, dict):
                return self.send_json(400, {"error": "Progress must be an object."})
            with FILE_LOCK:
                write_json(DATA / "progress.json", body)
            return self.send_json(200, {"ok": True})

        if self.path == "/api/sketches":
            if not isinstance(body, dict) or "data" not in body:
                return self.send_json(400, {"error": "Missing sketch data."})
            try:
                data = base64.b64decode(body["data"], validate=True)
            except ValueError:
                return self.send_json(400, {"error": "Sketch data is not valid base64."})
            if not data.startswith(b"MThd"):
                return self.send_json(400, {"error": "Sketch is not a MIDI file."})
            SKETCHES.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now().strftime("%Y-%m-%d-%H%M")
            path = SKETCHES / f"{stamp} {safe_sketch_name(body.get('name', 'sketch'))}.mid"
            path.write_bytes(data)
            return self.send_json(200, {"file": path.name})

        if self.path == "/api/sketches/reveal":
            name = Path(str((body or {}).get("file", ""))).name
            path = SKETCHES / name
            if not name or not path.is_file():
                return self.send_json(404, {"error": "Sketch not found."})
            subprocess.run(["open", "-R", str(path)], check=False)
            return self.send_json(200, {"ok": True})

        if self.path == "/api/ask":
            question = str((body or {}).get("question", "")).strip()
            if not question:
                return self.send_json(400, {"error": "Type a question first."})
            plugins, added = visible_gear()
            status, result = ask_coach(
                question, str(body.get("lesson", "")), plugins, str(body.get("context", ""))[:4000], added,
                str(body.get("goal", "")),
            )
            return self.send_json(status, result)

        if self.path == "/api/gear/change":
            if not isinstance(body, dict):
                return self.send_json(400, {"error": "A change must be an object."})
            with FILE_LOCK:
                try:
                    prefs = change_prefs(body, load_prefs())
                except ValueError as exc:
                    return self.send_json(400, {"error": str(exc)})
                write_json(DATA / "gear.json", prefs)
            return self.send_json(200, prefs)

        if self.path == "/api/gear/choose-folder":
            path = choose_folder()
            if not path:
                return self.send_json(200, {"cancelled": True})
            with FILE_LOCK:
                prefs = load_prefs()
                if path not in prefs["folders"]:
                    prefs = clean_prefs({**prefs, "folders": [*prefs["folders"], path]})
                    write_json(DATA / "gear.json", prefs)
            return self.send_json(200, {"folder": path, **prefs})

        if self.path == "/api/gear/describe":
            names = (body or {}).get("names") if isinstance(body, dict) else None
            if not isinstance(names, list):
                return self.send_json(400, {"error": "Send a list of plugin names."})
            return self.send_json(*describe_plugins([str(n) for n in names[:1000]]))

        if self.path == "/api/gear/suggest-tag":
            name = str((body or {}).get("name", "")).strip()[:80]
            if not name:
                return self.send_json(400, {"error": "Type a name first."})
            return self.send_json(200, suggest_tag(name))

        if self.path == "/api/coach":
            try:
                saved = save_coach(body)
            except ValueError as exc:
                return self.send_json(400, {"error": str(exc)})
            return self.send_json(200, public_coach(saved))

        if self.path == "/api/coach/test":
            try:
                message, model = complete("Reply with the single word OK.", "Are you there?", 20, 0, timeout=60)
            except (CoachOff, CoachError) as exc:
                return self.send_json(200, {"ok": False, "error": str(exc)})
            reply = strip_thinking(message.get("content") or "") or "(an empty reply, but it answered)"
            return self.send_json(200, {"ok": True, "model": model, "reply": reply[:80]})

        if self.path == "/api/takes/score":
            if not isinstance(body, dict) or not isinstance(body.get("metrics"), dict):
                return self.send_json(400, {"error": "Missing take measurements."})
            lesson = str(body.get("lesson", ""))
            previous = next((t for t in reversed(load_takes()) if t.get("lesson") == lesson), None)
            scorecard = clean_scorecard(body.get("scorecard"))
            status, result = score_take(
                body["metrics"], scorecard, lesson,
                previous and {"scorecard": previous["report"]["scorecard"], "overall": previous["report"]["overall"]},
            )
            # Without a model the take is still kept, scored by the app's rules, so it can
            # be compared later; only the written report is missing.
            report = result.get("report") if status == 200 else (
                {"overall": None, "overall_why": "", "worked": [], "scorecard": scorecard, "one_change": "", "objective": ""}
                if result.get("noModel") else None
            )
            if report:
                with FILE_LOCK:
                    take = len(lesson_takes(lesson)) + 1
                    save_take({
                        # With its UTC offset, so the page can compare it with lesson times.
                        "at": datetime.now().astimezone().isoformat(timespec="seconds"),
                        "lesson": lesson,
                        "take": take,
                        "sketch": body.get("sketch"),
                        "metrics": body["metrics"],
                        "report": report,
                    })
                result["take"] = take
                if status == 200:
                    result["previous"] = previous and previous["report"]["overall"]
            return self.send_json(status, result)

        if self.path == "/api/takes/compare":
            if not isinstance(body, dict):
                return self.send_json(400, {"error": "Missing takes to compare."})
            lesson = str(body.get("lesson", ""))
            takes = {t["take"]: t for t in lesson_takes(lesson)}
            try:
                a, b = takes[int(body.get("a"))], takes[int(body.get("b"))]
            except (KeyError, TypeError, ValueError):
                return self.send_json(404, {"error": "Those takes aren't saved for this lesson."})
            status, result = compare_takes(lesson, a, b)
            return self.send_json(status, result)

        return self.send_json(404, {"error": "Unknown endpoint."})


def main():
    port = int(os.environ.get("COACH_PORT", "8765"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Music Coach running at http://localhost:{port}  (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
