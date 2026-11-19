"""Playwright adapters for MIDAD-owned persistent browser profiles.

Setup is an attended user flow. Agent sessions are persistent but read-only by
default. This module never exports cookies or browser storage state.
"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any, Callable
from urllib.parse import urlsplit

from profile_vault import ProfileError, ProfileRecord, ProfileStore, request_policy, validate_profile_url
from runner import BrowserPolicyError, validate_navigation_url


@dataclass
class BrowserProfileSession:
    """Narrow read-only surface for agents; no public Playwright page/context handle."""
    profile_id: str
    allowed_hosts: tuple[str, ...]
    _context: Any
    _page: Any
    mode: str = "agent_read_only"

    async def snapshot(self, *, max_text_chars: int = 12000) -> dict:
        """Return bounded visible text for in-memory agent reasoning; callers must not log it."""
        limit = max(1, min(int(max_text_chars), 20000))
        page_url = urlsplit(self._page.url)
        safe_url = f"{page_url.scheme}://{page_url.hostname}/" if page_url.hostname else "about:blank"
        title = (await self._page.title())[:300]
        text = (await self._page.locator("body").inner_text(timeout=10000))[:limit]
        return {"profile_id": self.profile_id, "url": safe_url, "title": title, "text": text}

    async def navigate(self, url: str, *, timeout_ms: int = 15000) -> dict:
        """Navigate with GET only inside this profile's exact HTTPS host scope."""
        target = validate_profile_url(url, self.allowed_hosts)
        try:
            validate_navigation_url(target, self.allowed_hosts)
        except BrowserPolicyError as exc:
            raise ProfileError(str(exc)) from exc
        await self._page.goto(target, wait_until="domcontentloaded", timeout=max(1000, min(int(timeout_ms), 30000)))
        return await self.snapshot()


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
        if not request_policy(request.url, request.method, allowed_hosts, mode=mode):
            # Do not log the URL: it may contain private query values.
            await route.abort("blockedbyclient")
            return
        try:
            # Resolve and validate public DNS as well as scheme/host before each request.
            validate_navigation_url(request.url, allowed_hosts)
        except (BrowserPolicyError, ValueError, OSError):
            await route.abort("blockedbyclient")
            return
        await route.continue_()
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
    """Yield a signed-in, persistent read-only profile facade to an MIDAD agent.

    Only exact allowlisted HTTPS hosts and GET/HEAD/OPTIONS requests are
    permitted. This first release intentionally exposes no click, fill, submit,
    download, publication, claim, wallet, transfer, or signing API.
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
            allowed_hosts=record.allowed_hosts,
            _context=context,
            _page=page,
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
