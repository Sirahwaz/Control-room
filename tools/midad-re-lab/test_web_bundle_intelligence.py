import tempfile
import unittest
import zipfile
from pathlib import Path

from web_bundle_intelligence import analyze_apk_web_bundle


class WebBundleIntelligenceTests(unittest.TestCase):
    def test_reports_network_storage_bridge_and_dynamic_execution_indicators(self):
        with tempfile.TemporaryDirectory() as tmp:
            apk = Path(tmp) / "sample.apk"
            with zipfile.ZipFile(apk, "w") as archive:
                archive.writestr(
                    "assets/public/index.html",
                    '<script src="./app.js"></script><link rel="stylesheet" href="./style.css">'
                    '<script src="https://cdn.example.test/lib.js?key=DO_NOT_LEAK"></script>',
                )
                archive.writestr(
                    "assets/public/app.js",
                    'fetch("https://api.example.test/v1?token=DO_NOT_LEAK");'
                    'localStorage.setItem("session","x");'
                    'window.Capacitor.Plugins.Preferences.get({key:"x"});'
                    'window.postMessage({type:"ready"}); eval("1+1");',
                )
                archive.writestr(
                    "assets/public/style.css",
                    '@import url("https://fonts.example.test/font.css?secret=DO_NOT_LEAK");',
                )
                archive.writestr("assets/public/extra.js", 'new WebSocket("wss://socket.example.test"); new Function("return 1");')
                archive.writestr("assets/public/cordova.js", b"")
                archive.writestr("assets/public/cordova_plugins.js", b"")

            manifest = {
                "product_key": "midad-test",
                "web_entry": "mobile/web/index.html",
                "web_assets": ["mobile/web/app.js", "mobile/web/style.css"],
            }
            report = analyze_apk_web_bundle(apk, product_manifest=manifest, package_name="ai.midad.test")

            self.assertEqual(report["status"], "completed")
            self.assertEqual(report["package_name"], "ai.midad.test")
            self.assertEqual(report["product_key"], "midad-test")
            self.assertEqual(report["file_count"], 6)
            self.assertEqual(report["undeclared_files"], ["assets/public/extra.js"])
            self.assertEqual(report["missing_files"], [])
            self.assertGreaterEqual(report["indicators"]["network_calls"], 1)
            self.assertGreaterEqual(report["indicators"]["storage_apis"], 1)
            self.assertGreaterEqual(report["indicators"]["capacitor_bridge"], 1)
            self.assertGreaterEqual(report["indicators"]["message_bridge"], 1)
            self.assertGreaterEqual(report["indicators"]["dynamic_execution"], 1)
            self.assertNotIn("DO_NOT_LEAK", str(report))
            self.assertTrue(report["safety"]["static_only"])

    def test_reports_missing_manifest_assets(self):
        with tempfile.TemporaryDirectory() as tmp:
            apk = Path(tmp) / "missing.apk"
            with zipfile.ZipFile(apk, "w") as archive:
                archive.writestr("assets/public/index.html", "<html></html>")
            manifest = {
                "product_key": "midad-test",
                "web_entry": "index.html",
                "web_assets": ["web/missing.js"],
            }
            report = analyze_apk_web_bundle(apk, product_manifest=manifest)
            self.assertEqual(report["status"], "partial")
            self.assertEqual(report["missing_files"], ["assets/public/missing.js"])

    def test_reports_invalid_archive_as_failed(self):
        with tempfile.TemporaryDirectory() as tmp:
            apk = Path(tmp) / "invalid.apk"
            apk.write_text("not a zip", encoding="utf-8")
            report = analyze_apk_web_bundle(apk)
            self.assertEqual(report["status"], "failed")
            self.assertEqual(report["file_count"], 0)


if __name__ == "__main__":
    unittest.main()
