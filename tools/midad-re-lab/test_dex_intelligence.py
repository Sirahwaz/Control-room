import tempfile
import unittest
import zipfile
from pathlib import Path

from dex_intelligence import analyze_apk_dex, summarize_dex


class FakeMethod:
    def __init__(self, name, descriptor, access="public"):
        self.name = name
        self.descriptor = descriptor
        self.access = access

    def get_name(self):
        return self.name

    def get_descriptor(self):
        return self.descriptor

    def get_access_flags_string(self):
        return self.access

    def get_code(self):
        return None


class FakeClass:
    def __init__(self, name, superclass, methods):
        self.name = name
        self.superclass = superclass
        self.methods = methods

    def get_name(self):
        return self.name

    def get_superclassname(self):
        return self.superclass

    def get_methods(self):
        return self.methods


class FakeDex:
    def __init__(self, classes, strings):
        self.classes = classes
        self.strings = strings

    def get_classes(self):
        return self.classes

    def get_strings(self):
        return self.strings


class DexIntelligenceTests(unittest.TestCase):
    def test_summarizes_classes_methods_and_string_indicators(self):
        dex = FakeDex(
            [FakeClass("Lcom/midad/Main;", "Ljava/lang/Object;", [
                FakeMethod("onCreate", "()V"),
                FakeMethod("loadConfig", "()Ljava/lang/String;", "private"),
            ])],
            ["https://api.example.test/v1?token=do-not-leak", "ordinary label", "content://provider/items"],
        )
        report = summarize_dex("classes.dex", dex)
        self.assertEqual(report["status"], "completed")
        self.assertEqual(report["class_count"], 1)
        self.assertEqual(report["method_count"], 2)
        self.assertEqual(report["classes"][0]["methods"][0]["name"], "onCreate")
        self.assertEqual(report["string_count"], 3)
        self.assertEqual(len(report["string_indicators"]), 2)
        self.assertNotIn("do-not-leak", str(report["string_indicators"]))

    def test_processes_all_dex_files_and_preserves_partial_failures(self):
        with tempfile.TemporaryDirectory() as tmp:
            apk = Path(tmp) / "multi.apk"
            dex_one = bytes.fromhex("6465780a30333500") + b"one"
            dex_two = bytes.fromhex("6465780a30333500") + b"two"
            with zipfile.ZipFile(apk, "w") as archive:
                archive.writestr("classes.dex", dex_one)
                archive.writestr("classes2.dex", dex_two)
            calls = []

            def factory(raw):
                calls.append(raw)
                if raw == dex_two:
                    raise ValueError("malformed dex fixture")
                return FakeDex([], [])

            report = analyze_apk_dex(apk, dex_factory=factory)
            self.assertEqual(calls, [dex_one, dex_two])
            self.assertEqual(report["dex_file_count"], 2)
            self.assertEqual(report["parsed_dex_count"], 1)
            self.assertEqual(report["status"], "partial")
            self.assertIn("malformed dex fixture", report["errors"][0]["error"])

    def test_caps_dex_file_count_and_reports_omitted_entries(self):
        with tempfile.TemporaryDirectory() as tmp:
            apk = Path(tmp) / "many-dex.apk"
            valid = bytes.fromhex("6465780a30333500") + b"fixture"
            with zipfile.ZipFile(apk, "w") as archive:
                archive.writestr("classes.dex", valid)
                for index in range(2, 19):
                    archive.writestr(f"classes{index}.dex", valid)
            report = analyze_apk_dex(apk, dex_factory=lambda raw: FakeDex([], []))
            self.assertEqual(report["dex_file_count"], 17)
            self.assertEqual(report["parsed_dex_count"], 16)
            self.assertEqual(report["status"], "partial")
            self.assertEqual(report["errors"][0]["error"], "DEX_FILE_LIMIT_EXCEEDED")
            self.assertEqual(report["errors"][0]["omitted_count"], 1)

    def test_reports_missing_dex_as_failed_not_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            apk = Path(tmp) / "no-dex.apk"
            with zipfile.ZipFile(apk, "w") as archive:
                archive.writestr("assets/readme.txt", "no bytecode")
            report = analyze_apk_dex(apk, dex_factory=lambda raw: FakeDex([], []))
            self.assertEqual(report["status"], "failed")
            self.assertEqual(report["dex_file_count"], 0)


if __name__ == "__main__":
    unittest.main()
