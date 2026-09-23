import base64
import json
import os
import plistlib
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server  # noqa: E402


class GearScanTest(unittest.TestCase):
    def test_finds_plugins_and_uninstalled_installers(self):
        with tempfile.TemporaryDirectory() as tmp:
            plugins = Path(tmp, "Components")
            (plugins / "Tape Echo v6.component").mkdir(parents=True)
            (plugins / "Triad Chorus v6.component").mkdir()
            samples = Path(tmp, "Samples")
            samples.mkdir()
            (samples / "surge.dmg").write_text("")
            (samples / "Organ.pkg").write_text("")
            (samples / "loops.zip").write_text("")
            (samples / "folder").mkdir()
            (samples / "folder" / "drums.zip").write_text("")
            gear = server.scan_gear([plugins, Path(tmp, "missing")], samples)
            self.assertEqual(gear["plugins"], ["Tape Echo v6", "Triad Chorus v6"])
            self.assertEqual(gear["installers"], ["Organ.pkg", "surge.dmg"])
            self.assertEqual(gear["zippedPacks"], ["drums.zip", "loops.zip"])
            self.assertTrue(gear["samplesMounted"])

    def test_unmounted_samples_drive(self):
        gear = server.scan_gear([], Path("/nonexistent/samples"))
        self.assertFalse(gear["samplesMounted"])
        self.assertEqual(gear["installers"], [])


class InstrumentSamplesTest(unittest.TestCase):
    def test_maps_file_names_to_sounding_notes(self):
        with tempfile.TemporaryDirectory() as tmp:
            for name in ["12 String Pluck 1 E3.wav", "Mini_MamaBass_A#-1.wav", "Mini_X_A2_0001.wav", "notes.txt"]:
                Path(tmp, name).write_text("")
            got = sorted(s["note"] for s in server.instrument_samples(Path(tmp), 2))
            self.assertEqual(got, [22, 57, 64])

    def test_missing_instruments_are_offered_under_their_stand_in_name(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "Strings").mkdir()
            Path(tmp, "Strings", "C3.wav").write_text("")
            found = server.available_instruments(
                [{"id": "a", "label": "A", "dir": Path(tmp, "Strings"), "offset": 2},
                 {"id": "b", "label": "VP-330", "rel": "Missing", "offset": 2, "standIn": "Strings"},
                 {"id": "c", "label": "C", "rel": "Strings", "offset": 2}],
                roots=[Path(tmp)],
            )
            self.assertEqual([(f["id"], f["label"], f["recorded"]) for f in found],
                             [("a", "A", True), ("b", "Strings", False), ("c", "C", True)])
            self.assertEqual(found[0]["samples"][0]["note"], 60)


class LocalSamplesTest(unittest.TestCase):
    def test_local_paths_cannot_escape_the_samples_folder(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp, "Samples")
            (root / "Loops").mkdir(parents=True)
            (root / "Loops" / "a.wav").write_text("")
            Path(tmp, "secret.wav").write_text("")
            self.assertIsNotNone(server.local_sample_path("Loops/a.wav", root))
            self.assertIsNone(server.local_sample_path("../secret.wav", root))
            self.assertIsNone(server.local_sample_path("Loops/missing.wav", root))

    def test_drum_kit_offered_only_when_every_sound_exists(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for f in server.DRUM_KITS[0]["sounds"].values():
                (root / f).parent.mkdir(parents=True, exist_ok=True)
                (root / f).write_text("")
            self.assertEqual([k["id"] for k in server.available_drum_kits(root)], ["cr78"])

    def test_plugin_details_read_maker_and_kind(self):
        with tempfile.TemporaryDirectory() as tmp:
            comp = Path(tmp, "Tape Echo v6.component/Contents")
            comp.mkdir(parents=True)
            (comp / "Info.plist").write_bytes(plistlib.dumps(
                {"AudioComponents": [{"name": "IK Multimedia: Tape Echo", "type": "aufx"}]}))
            Path(tmp, "Broken.component").mkdir()
            got = server.plugin_details([Path(tmp)])
            self.assertEqual(got[0], {"name": "Broken", "maker": "Other", "kind": "effect"})
            self.assertEqual(got[1], {"name": "Tape Echo v6", "maker": "IK Multimedia", "kind": "effect"})


class SampleFoldersTest(unittest.TestCase):
    def test_any_folder_gives_loops_and_files_are_served_from_each_folder(self):
        with tempfile.TemporaryDirectory() as tmp:
            a, b = Path(tmp, "A"), Path(tmp, "My Loops")
            (a / "Vintage Synths/VP330 From Mars/SVC350 Loops/01. WAV").mkdir(parents=True)
            (a / "Vintage Synths/VP330 From Mars/SVC350 Loops/01. WAV/pad.wav").write_text("")
            (b / "sub").mkdir(parents=True)
            (b / "sub" / "hit.aif").write_text("")
            (b / "notes.txt").write_text("")
            groups = server.loop_files([a, b])
            self.assertEqual([(g["label"], g["files"]) for g in groups], [
                ("VP-330 string loops", ["Vintage Synths/VP330 From Mars/SVC350 Loops/01. WAV/pad.wav"]),
                ("My Loops", ["sub/hit.aif"]),
            ])
            self.assertEqual(server.local_sample_path("sub/hit.aif", [a, b]), (b / "sub/hit.aif").resolve())
            self.assertIsNone(server.local_sample_path("notes.txt", [a, b]))
            self.assertIsNone(server.local_sample_path("../A/Vintage Synths", [a, b]))


class GearPrefsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.saved = server.DATA, server.LOCAL_SAMPLES, server.SAMPLES_DIR
        server.DATA = Path(self.tmp.name, "data")
        server.LOCAL_SAMPLES = Path(self.tmp.name, "Samples")
        server.SAMPLES_DIR = Path("/Volumes/NotMountedNow/Samples")
        server.LOCAL_SAMPLES.mkdir()

    def tearDown(self):
        server.DATA, server.LOCAL_SAMPLES, server.SAMPLES_DIR = self.saved
        self.tmp.cleanup()

    def test_existing_setup_carries_over_once_including_an_unplugged_drive(self):
        server.DATA.mkdir()
        (server.DATA / "progress.json").write_text("{}")
        prefs = server.load_prefs()
        self.assertEqual(prefs["folders"], [str(server.LOCAL_SAMPLES), "/Volumes/NotMountedNow/Samples"])
        self.assertTrue(prefs["setupDone"])
        # Made once: later runs read the file and never re-derive it.
        server.write_json(server.DATA / "gear.json", {**prefs, "folders": []})
        self.assertEqual(server.load_prefs()["folders"], [])

    def test_an_unreadable_file_is_kept_aside_not_written_over(self):
        server.DATA.mkdir()
        (server.DATA / "progress.json").write_text("{}")
        (server.DATA / "gear.json").write_text('{"folders": ["/x",],}')
        prefs = server.load_prefs()
        self.assertTrue(prefs["setupDone"])  # an existing user: no welcome
        broken = list(server.DATA.glob("gear.json.broken-*"))
        self.assertEqual(len(broken), 1)
        self.assertEqual(broken[0].read_text(), '{"folders": ["/x",],}')

    def test_a_new_user_starts_with_only_folders_that_exist(self):
        prefs = server.load_prefs()
        self.assertEqual(prefs["folders"], [str(server.LOCAL_SAMPLES)])
        self.assertFalse(prefs["setupDone"])

    def test_prefs_are_cleaned(self):
        got = server.clean_prefs({
            "folders": ["relative/path", "/a/", "/a"],
            "added": [{"name": " MPK  Mini ", "tag": "keyboard"}, {"name": "mpk mini"}, {"name": "X", "tag": "bogus", "kind": "plugin"}, "junk"],
            "hidden": ["B", "A", "A", 3],
        })
        self.assertEqual(got["folders"], ["/a"])
        self.assertEqual(got["added"], [
            {"name": "MPK Mini", "tag": "keyboard", "kind": "hardware"},
            {"name": "X", "tag": "", "kind": "plugin"},
        ])
        self.assertEqual(got["hidden"], ["A", "B"])

    def test_tags_from_names(self):
        self.assertEqual(server.rule_tag("Akai MPK Mini"), "keyboard")
        self.assertEqual(server.rule_tag("Shure SM58"), "microphone")
        self.assertEqual(server.rule_tag("Studio headphones"), "")
        self.assertEqual(server.rule_tag("Moog Etherwave theremin"), "")
        self.assertIsNone(server.rule_tag("Hypnus"))


class CoachSettingsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.saved = server.DATA
        server.DATA = Path(self.tmp.name)

    def tearDown(self):
        server.DATA = self.saved
        self.tmp.cleanup()

    def test_local_model_is_the_default(self):
        self.assertEqual(server.coach_settings()["provider"], "local")

    def test_key_is_private_and_never_follows_a_new_address(self):
        server.save_coach({"provider": "openai", "apiKey": "sk-test"})
        self.assertEqual(oct((server.DATA / "coach.json").stat().st_mode & 0o777), "0o600")
        shown = server.public_coach(server.coach_settings())
        self.assertTrue(shown["hasKey"])
        self.assertNotIn("sk-test", json.dumps(shown))
        server.save_coach({"provider": "openai", "model": "gpt-x"})  # same service: key kept
        self.assertEqual(server.coach_settings()["apiKey"], "sk-test")
        server.save_coach({"provider": "other", "baseUrl": "https://example.com/v1"})  # new address: key dropped
        self.assertEqual(server.coach_settings()["apiKey"], "")
        with self.assertRaises(ValueError):
            server.save_coach({"provider": "other", "baseUrl": "file:///etc"})

    def test_no_key_says_how_to_add_one(self):
        server.save_coach({"provider": "anthropic"})
        with self.assertRaises(server.CoachOff) as caught:
            server.complete("s", "u", 10, 0)
        self.assertIn("Anthropic API key", str(caught.exception))


class CoachGoalTest(unittest.TestCase):
    def test_the_goal_follows_the_learner_not_one_band(self):
        seen = {}

        def fake(system, user, max_tokens, temperature, schema=None, timeout=120):
            seen["system"] = system
            return {"content": "ok"}, "m"

        saved = server.complete
        server.complete = fake
        try:
            server.ask_coach("q", "", [], goal="music in the styles they picked: Punk.")
            self.assertIn("Their first goal is music in the styles they picked: Punk.", seen["system"])
            server.ask_coach("q", "", [])
            self.assertIn(server.DEFAULT_GOAL, seen["system"])
            self.assertNotIn("Durutti", seen["system"])
        finally:
            server.complete = saved


class CompareTakesTest(unittest.TestCase):
    def test_the_model_writes_words_and_never_scores(self):
        seen = {}

        def fake(system, user, max_tokens, temperature, schema=None, timeout=120):
            seen["system"] = system
            return {"content": '{"improved": "You land the changes on the beat now.", "slipped": "", "next_step": "Hold the last chord to the bar line."}'}, "m"

        saved = server.complete
        server.complete = fake
        try:
            take = lambda n, s: {"take": n, "metrics": {"bpm": 90}, "report": {"scorecard": {"timing": {"score": s, "evidence": "e"}}}}
            status, body = server.compare_takes("Four chords", take(1, 4), take(3, 8))
        finally:
            server.complete = saved
        self.assertEqual(status, 200)
        self.assertEqual(body["comparison"]["next_step"], "Hold the last chord to the bar line.")
        self.assertIn("Take A (take 1)", seen["system"])
        self.assertIn("4/10", seen["system"])


class VersionTest(unittest.TestCase):
    def test_version_from_source_or_the_packaged_app(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.assertIsNone(server.app_version(root))
            (root / "VERSION").write_text("0.2.0\n")
            self.assertEqual(server.app_version(root), "0.2.0")
            (root / "package.json").write_text('{"name": "music-coach", "version": "0.3.0"}')
            self.assertEqual(server.app_version(root), "0.3.0")


class TakeReportTest(unittest.TestCase):
    CARD = server.clean_scorecard({
        "chords": {"score": 6, "evidence": "6 of 8"},
        "timing": {"score": None, "evidence": "Fewer than 2 changes."},
        "feel": {"score": 7, "evidence": "range 30"},
        "sound": {"score": 12, "evidence": "matches"},
        "ending": {"score": True, "evidence": "x"},
    })

    def report(self, **overrides):
        base = {
            "overall": 7,
            "overall_why": "Clean ending.",
            "worked": ["6 of 8 bars matched the chart.", "Stopped on the bar line."],
            "one_change": "Change to F on the 1.",
            "objective": "Play bars 3-4 on time.",
        }
        base.update(overrides)
        return base

    def test_scorecard_comes_from_the_app_and_is_checked(self):
        self.assertEqual(self.CARD["chords"]["score"], 6)
        self.assertIsNone(self.CARD["timing"]["score"])
        self.assertEqual(self.CARD["sound"]["score"], 10)  # clamped
        self.assertIsNone(self.CARD["ending"]["score"])  # not a number
        got = server.clean_report(self.report(scorecard={"chords": {"score": 1}}), self.CARD)
        self.assertEqual(got["scorecard"], self.CARD)  # the model cannot overwrite it

    def test_overall_is_clamped_and_wins_capped_at_two(self):
        got = server.clean_report(self.report(overall=14, worked=["a", "b", "c"]), self.CARD)
        self.assertEqual(got["overall"], 10)
        self.assertEqual(got["worked"], ["a", "b"])

    def test_reads_the_report_wherever_lm_studio_put_it(self):
        self.assertEqual(server.report_json({"content": '{"overall": 5}'}), {"overall": 5})
        self.assertEqual(server.report_json({"content": "", "reasoning_content": '{"overall": 6}'}), {"overall": 6})
        self.assertEqual(server.report_json({"content": '<think>x</think>\n```json\n{"overall": 7}\n```'}), {"overall": 7})
        with self.assertRaises(ValueError):
            server.report_json({"content": "no json here"})

    def test_rejects_a_report_without_two_wins(self):
        with self.assertRaises(ValueError):
            server.clean_report(self.report(worked=["only one"]), self.CARD)


class HelpersTest(unittest.TestCase):
    def test_strips_model_thinking(self):
        self.assertEqual(server.strip_thinking("<think>hmm</think>\nPlay Em."), "Play Em.")
        self.assertEqual(server.strip_thinking("cut off reasoning</think>Answer"), "Answer")
        self.assertEqual(server.strip_thinking("Plain answer"), "Plain answer")
        self.assertEqual(server.strip_thinking("<think>ran out of tokens mid-thought"), "")

    def test_picks_a_chat_model(self):
        self.assertEqual(server.pick_model(["mxbai-embed", "qwen3-coder", "qwen3-27b"]), "qwen3-27b")
        self.assertEqual(server.pick_model(["text-embedding-x", "qwen3-coder"]), "qwen3-coder")
        self.assertIsNone(server.pick_model(["text-embedding-x"]))

    def test_sketch_names_cannot_escape(self):
        self.assertEqual(server.safe_sketch_name("../../etc/passwd"), "passwd")
        self.assertEqual(server.safe_sketch_name("Em C G D 95bpm"), "Em C G D 95bpm")
        self.assertEqual(server.safe_sketch_name("///"), "sketch")


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        server.DATA = Path(cls.tmp.name, "data")
        server.SKETCHES = Path(cls.tmp.name, "sketches")
        server.LMSTUDIO_URL = "http://127.0.0.1:9"  # nothing listens here
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.tmp.cleanup()

    def call(self, path, body=None):
        req = urllib.request.Request(
            self.base + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_version_names_this_copy_of_the_code(self):
        with urllib.request.urlopen(self.base + "/api/version", timeout=5) as r:
            got = json.loads(r.read())
        self.assertEqual(got["build"], server.BUILD)
        self.assertEqual(len(server.BUILD), 12)

    def test_progress_round_trip(self):
        self.assertEqual(self.call("/api/progress"), (200, {}))
        saved = {"current": "first-chord", "completed": {"hear-the-sound": "2026-09-22"}}
        self.assertEqual(self.call("/api/progress", saved)[0], 200)
        self.assertEqual(self.call("/api/progress"), (200, saved))

    def test_rejects_progress_that_is_not_an_object(self):
        self.assertEqual(self.call("/api/progress", [1, 2])[0], 400)

    def test_saves_sketch_and_refuses_escape(self):
        midi = base64.b64encode(b"MThd\x00\x00\x00\x06rest").decode()
        status, body = self.call("/api/sketches", {"name": "../../evil", "data": midi})
        self.assertEqual(status, 200)
        self.assertTrue(body["file"].endswith(" evil.mid"))
        self.assertTrue((server.SKETCHES / body["file"]).is_file())
        self.assertIn(body["file"], self.call("/api/sketches")[1])
        self.assertEqual(self.call("/api/sketches/reveal", {"file": "../server.py"})[0], 404)

    def test_rejects_non_midi_sketch(self):
        data = base64.b64encode(b"not midi").decode()
        self.assertEqual(self.call("/api/sketches", {"name": "x", "data": data})[0], 400)

    def test_without_a_model_takes_are_kept_numbered_and_comparable(self):
        card = {"chords": {"score": 5, "evidence": "5 of 8"}}
        status, body = self.call("/api/takes/score", {"metrics": {"ending": {}}, "scorecard": card, "lesson": "x"})
        self.assertEqual((status, body["take"], body["noModel"]), (503, 1, True))
        self.call("/api/takes/score", {"metrics": {"ending": {}}, "scorecard": {"chords": {"score": 7}}, "lesson": "x"})
        self.call("/api/takes/score", {"metrics": {}, "lesson": "other"})
        takes = self.call("/api/takes?lesson=x")[1]
        self.assertEqual([t["take"] for t in takes], [1, 2])
        self.assertEqual([t["report"]["scorecard"]["chords"]["score"] for t in takes], [5, 7])
        self.assertIsNone(takes[0]["report"]["overall"])
        status, body = self.call("/api/takes/compare", {"lesson": "x", "a": 1, "b": 2})
        self.assertEqual((status, body.get("noModel")), (503, True))
        self.assertEqual(self.call("/api/takes/compare", {"lesson": "x", "a": 1, "b": 9})[0], 404)
        self.assertEqual(self.call("/api/takes/compare", [1, 2])[0], 400)
        self.assertRegex(takes[0]["at"], r"[+-]\d\d:\d\d$")  # carries its UTC offset
        self.assertEqual(self.call("/api/takes/score", {"lesson": "x"})[0], 400)

    def test_ask_explains_when_lm_studio_is_off(self):
        status, body = self.call("/api/ask", {"question": "What is a chord?"})
        self.assertEqual(status, 503)
        self.assertIn("LM Studio", body["error"])

    def test_guitar_sample_route_refuses_other_files(self):
        self.assertEqual(self.call("/samples/guitar/..%2F..%2Fserver.py")[0], 404)
        self.assertEqual(self.call("/samples/nope/C3.wav")[0], 404)

    def test_refuses_requests_from_other_sites(self):
        req = urllib.request.Request(
            self.base + "/api/coach", data=b'{"provider": "other", "baseUrl": "https://evil.example"}',
            headers={"Content-Type": "application/json", "Origin": "https://evil.example"},
        )
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(req, timeout=5)
        self.assertEqual(caught.exception.code, 403)
        self.assertEqual(self.call("/api/coach")[1]["provider"], "local")

    def test_gear_changes_one_at_a_time(self):
        self.assertEqual(self.call("/api/gear/change", {"op": "add", "name": "Akai MPK Mini", "tag": "keyboard"})[0], 200)
        self.call("/api/gear/change", {"op": "add", "name": "Shure SM58", "tag": "microphone"})
        self.call("/api/gear/change", {"op": "hide", "name": "Hype"})
        gear = self.call("/api/gear")[1]
        self.assertEqual([a["name"] for a in gear["added"]], ["Akai MPK Mini", "Shure SM58"])
        self.assertEqual(gear["hidden"], ["Hype"])
        self.call("/api/gear/change", {"op": "remove", "name": "Akai MPK Mini"})
        self.call("/api/gear/change", {"op": "unhide", "name": "Hype"})
        gear = self.call("/api/gear")[1]
        self.assertEqual([a["name"] for a in gear["added"]], ["Shure SM58"])
        self.assertEqual(gear["hidden"], [])
        # A folder that doesn't exist can't be slipped in.
        before = gear["folders"]
        self.assertEqual(len(self.call("/api/gear/change", {"op": "addFolder", "path": "/nonexistent/x"})[1]["folders"]), len(before))
        self.assertEqual(self.call("/api/gear/change", {"op": "wipe"})[0], 400)

    def test_refuses_another_host_name(self):
        req = urllib.request.Request(self.base + "/api/progress", headers={"Host": "evil.example"})
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(req, timeout=5)
        self.assertEqual(caught.exception.code, 403)

    def test_serves_the_app(self):
        with urllib.request.urlopen(self.base + "/", timeout=5) as r:
            self.assertIn(b"Music Coach", r.read())


if __name__ == "__main__":
    unittest.main()
