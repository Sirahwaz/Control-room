"""Playwright adapters for MIDAD-owned persistent browser profiles.

Setup is an attended user flow. Agent sessions are persistent but read-only by
default. This module never exports cookies or browser storage state.
"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any, Callable

from profile_vault import ProfileError, ProfileRecord, ProfileStore, request_policy, validate_profile_url


@dataclass
class BrowserProfileSession:
    profile_id: str
    context: Any
    page: Any
    allowed_hosts: tuple[str, ...]
    mode: str = "agent_read_only"


async def _start_playwright(playwright_factory: Callable | None = None):
    if playwright_factory is None:
        from playwright.async_api import async_playwright
        playwright_factory = async_playwright
    manager = playwright_factory()
    playwright = await manager.start()
    return manager, playwright


async def _guard_context(context, allowed_hosts, mode: str) -> None:
    async def guard(route):
        request = route.request
        if request_policy(request.url, request.method, allowed_hosts, mode=mode):
            await route.continue_()
        else:
            # Do not log the URL: it may contain private query values.
            await route.abort("blockedbyclient")
    await context.route("**/*", guard)


async def setup_login(
    store: ProfileStore,
    profile_id: str,
    start_url: str,
    allowed_hosts,
    *,
    prompt: Callable[[str], str] = input,
    playwright_factory: Callable | None = None,
):
    """Open a visible persistent Chromium profile for a human to sign in.

    The human enters credentials directly into the website in Chromium.
    No page text, form values, cookies, or storage state is read by MIDAD.
    """
    record = store.create_pending(profile_id, start_url, allowed_hosts)
    target_url = validate_profile_url(start_url, record.allowed_hosts)
    manager = playwright = context = None
    try:
        manager, playwright = await _start_playwright(playwright_factory)
        context = await playwright.chromium.launch_persistent_context(
            user_data_dir=str(record.user_data_dir),
            headless=False,
            accept_downloads=False,
            service_workers="block",
            args=["--disable-sync", "--no-first-run", "--disable-background-networking"],
        )
        await _guard_context(context, record.allowed_hosts, mode="setup")
        pages = context.pages
        page = pages[0] if pages else await context.new_page()
        page.set_default_navigation_timeout(20000)
        await page.goto(target_url, wait_until="domcontentloaded", timeout=20000)

        # The prompt does not collect a password; input is typed only in the browser.
        await asyncio.to_thread(
            prompt,
            "Finish signing in in the opened browser (including MFA if required). "
            "When done, return here and press Enter to confirm setup: ",
        )
        pages = context.pages
        final_url = pages[-1].url if pages else page.url
        return store.confirm_setup(profile_id, final_url)
    finally:
        if context is not None:
            try:
                await context.close()
            except Exception:
                pass
        if manager is not None:
            try:
                await manager.stop()
            except Exception:
                pass


@asynccontextmanager
async def open_profile_session(
    store: ProfileStore,
    profile_id: str,
    url: str,
    *,
    headless: bool = True,
    navigation_timeout_ms: int = 15000,
    playwright_factory: Callable | None = None,
):
    """Yield a signed-in Playwright page using an approved persistent profile.

    Only exact allowlisted HTTPS hosts and GET/HEAD/OPTIONS requests are
    permitted. This first release intentionally does not submit forms, publish,
    claim tasks, transfer funds, sign messages, or perform other write actions.
    """
    record: ProfileRecord = store.require_ready(profile_id)
    target_url = validate_profile_url(url, record.allowed_hosts)
    manager = playwright = context = None
    try:
        manager, playwright = await _start_playwright(playwright_factory)
        context = await playwright.chromium.launch_persistent_context(
            user_data_dir=str(record.user_data_dir),
            headless=headless,
            accept_downloads=False,
            service_workers="block",
            args=["--disable-sync", "--no-first-run", "--disable-background-networking"],
        )
        await _guard_context(context, record.allowed_hosts, mode="agent_read_only")
        context.set_default_navigation_timeout(navigation_timeout_ms)
        pages = context.pages
        page = pages[0] if pages else await context.new_page()
        page.set_default_navigation_timeout(navigation_timeout_ms)
        await page.goto(target_url, wait_until="domcontentloaded", timeout=navigation_timeout_ms)
        yield BrowserProfileSession(
            profile_id=record.profile_id,
            context=context,
            page=page,
            allowed_hosts=record.allowed_hosts,
        )
    finally:
        if context is not None:
            try:
                await context.close()
            except Exception:
                pass
        if manager is not None:
            try:
                await manager.stop()
            except Exception:
                pass
