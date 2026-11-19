"""Idempotent Maven Central mirror injection for generated Android Gradle projects."""

from __future__ import annotations

import re

MIRROR_URL = "https://maven-central.storage-download.googleapis.com/maven2/"


def inject_maven_central_mirror(source: str, *, kotlin_dsl: bool = False) -> tuple[str, int]:
    """Place Google's Maven Central mirror immediately before each central() entry.

    Google Maven and Gradle Plugin Portal repositories are retained. Maven Central
    remains as a fallback for artifacts that have not reached the mirror yet.
    """
    if not isinstance(source, str):
        raise TypeError("gradle_source_must_be_text")

    block = (
        f'maven {{ url = uri("{MIRROR_URL}") }}'
        if kotlin_dsl
        else f'maven {{ url "{MIRROR_URL}" }}'
    )
    lines = source.splitlines(keepends=True)
    output: list[str] = []
    inserted = 0
    pattern = re.compile(r"^([ \t]*)mavenCentral\(\)\s*(?://.*)?(?:\r?\n)?$")

    for line in lines:
        match = pattern.match(line)
        if match:
            previous = output[-1] if output else ""
            if MIRROR_URL not in previous:
                indent = match.group(1)
                newline = "\r\n" if line.endswith("\r\n") else "\n"
                output.append(indent + block + newline)
                inserted += 1
        output.append(line)

    return "".join(output), inserted
