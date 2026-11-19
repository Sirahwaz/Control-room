import unittest

from gradle_repo_mirror import inject_maven_central_mirror, MIRROR_URL


class GradleRepositoryMirrorTests(unittest.TestCase):
    def test_mirror_precedes_central_without_removing_google_or_plugin_portal(self):
        source = """pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}
"""
        updated, count = inject_maven_central_mirror(source)
        self.assertEqual(count, 2)
        self.assertEqual(updated.count(MIRROR_URL), 2)
        self.assertLess(updated.index(MIRROR_URL), updated.index("mavenCentral()"))
        self.assertIn("google()", updated)
        self.assertIn("gradlePluginPortal()", updated)

    def test_injection_is_idempotent(self):
        source = """repositories {
    google()
    mavenCentral()
}
"""
        once, count = inject_maven_central_mirror(source)
        twice, second_count = inject_maven_central_mirror(once)
        self.assertEqual(count, 1)
        self.assertEqual(second_count, 0)
        self.assertEqual(twice, once)

    def test_kotlin_dsl_uses_uri_syntax(self):
        source = """repositories {
    mavenCentral()
}
"""
        updated, count = inject_maven_central_mirror(source, kotlin_dsl=True)
        self.assertEqual(count, 1)
        self.assertIn('maven { url = uri("' + MIRROR_URL + '") }', updated)

    def test_no_central_repository_is_left_unchanged(self):
        source = """repositories {
    google()
    gradlePluginPortal()
}
"""
        updated, count = inject_maven_central_mirror(source)
        self.assertEqual(count, 0)
        self.assertEqual(updated, source)


if __name__ == "__main__":
    unittest.main()
