"""In-memory Playwright sessions for approved operator accounts.

Cookies/storage state are never written to disk. Login POSTs are narrowly scoped to
explicit profile paths. All other non-GET/HEAD browser requests are blocked.
"""
from __future__ import annotations

import asyncio
import re
from urllib.parse import urlsplit

from agent_policy import validate_profile
from operator_command_router import validate_operator_command
from runner import BrowserPolicyError, validate_navigation_url
from secret_provider import EnvironmentSecretProvider, SecretBinding

class BrowserSessionError(RuntimeError):
    pass

_SECRET_TEXT = re.compile(
    r"(?i)(bearer\s+[a-z0-9._~+/=-]{12,}|(?:password|access[_ -]?token|refresh[_ -]?token|api[_ -]?key|secret)\s*[:=]\s*[^\s,;]+|(?:gh[pousr]_[a-z0-9]{20,}|sk-[a-z0-9_-]{20,}|eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}))"
)
_GATE_TEXT = re.compile(
    r"(?i)(captcha|verify you are human|prove you are human|two[- ]factor|two[- ]step|"
    r"verification code|authenticator|robot check|رمز التحقق|تحقق أنك إنسان|تحقق انك انسان)"
)
_HIGH_RISK_LABEL = re.compile(
    r"(?i)(pay(?:ment)?|purchase|buy now|withdraw|transfer|wallet|sign|delete|"
    r"submit|publish|send|apply|checkout|دفع|شراء|سحب|تحويل|توقيع|حذف|إرسال|ارسال|نشر|تقديم)"
)

def _safe_preview(value: str, limit: int = 1400) -> str:
    return _SECRET_TEXT.sub("[REDACTED]", value or "")[:limit]

def _host_allowed(raw_url: str, hosts: set[str]) -> str:
    try:
        normalized = validate_navigation_url(raw_url, hosts)
    except (BrowserPolicyError, TypeError) as exc:
        raise BrowserSessionError("TARGET_NOT_ALLOWED") from exc
    return normalized

def _validate_login_profile(profile: dict, global_hosts: set[str]) -> dict:
    safe = validate_profile(profile, global_hosts)
    required = ("login_url", "username_selector", "password_selector",
                "submit_selector", "success_selector", "username")
    if any(not isinstance(profile.get(key), str) or not profile[key].strip() for key in required):
        raise BrowserSessionError("LOGIN_PROFILE_INCOMPLETE")
    if profile["password_selector"] == profile["username_selector"]:
        raise BrowserSessionError("LOGIN_SELECTORS_MUST_DIFFER")
    host = safe["host"]
    resource_hosts = profile.get("resource_hosts", [])
    if not isinstance(resource_hosts, list):
        raise BrowserSessionError("INVALID_RESOURCE_HOSTS")
    hosts = {host}
    for item in resource_hosts:
        if not isinstance(item, str) or not item.strip():
            raise BrowserSessionError("INVALID_RESOURCE_HOSTS")
        resource_host = item.strip().lower().rstrip(".")
        if resource_host not in global_hosts or "*" in resource_host:
            raise BrowserSessionError("RESOURCE_HOST_NOT_ALLOWLISTED")
        hosts.add(resource_host)
    login_url = _host_allowed(profile["login_url"], {host})
    post_paths = profile.get("login_post_paths", [])
    if not isinstance(post_paths, list) or not post_paths or any(
        not isinstance(path, str) or not path.startswith("/") or "?" in path or "#" in path
        for path in post_paths
    ):
        raise BrowserSessionError("EXPLICIT_LOGIN_POST_PATHS_REQUIRED")
    login_path = urlsplit(login_url).path or "/"
    if not any(path.rstrip("/") == login_path.rstrip("/") for path in post_paths):
        raise BrowserSessionError("LOGIN_POST_PATH_MUST_INCLUDE_LOGIN_PATH")
    post_content_types = profile.get("login_post_content_types", [
        "application/x-www-form-urlencoded", "multipart/form-data"
    ])
    if not isinstance(post_content_types, list) or not post_content_types or any(
        not isinstance(item, str) or not item.strip() for item in post_content_types
    ):
        raise BrowserSessionError("LOGIN_POST_CONTENT_TYPES_REQUIRED")
    post_content_types = [item.strip().lower() for item in post_content_types]
    allowed_content_types = {
        "application/x-www-form-urlencoded", "multipart/form-data", "application/json"
    }
    if any(item not in allowed_content_types for item in post_content_types):
        raise BrowserSessionError("LOGIN_POST_CONTENT_TYPE_NOT_ALLOWED")
    action_post_paths = profile.get("action_post_paths", [])
    if not isinstance(action_post_paths, list) or any(
        not isinstance(path, str) or not path.startswith("/") or "?" in path or "#" in path
        for path in action_post_paths
    ):
        raise BrowserSessionError("INVALID_ACTION_POST_PATHS")
    risky_path = re.compile(r"(?i)(payment|checkout|withdraw|transfer|wallet|sign|delete|payout|billing)")
    if any(risky_path.search(path) for path in action_post_paths):
        raise BrowserSessionError("FINANCIAL_OR_DESTRUCTIVE_POST_PATH_FORBIDDEN")
    if not isinstance(profile.get("success_selector"), str) or not profile["success_selector"].strip():
        raise BrowserSessionError("LOGIN_SUCCESS_SELECTOR_REQUIRED")
    return {**profile, **safe, "login_url": login_url,
            "login_post_content_types": post_content_types,
            "action_post_paths": action_post_paths,
            "_session_hosts": hosts}

class PlatformBrowserSession:
    def __init__(self, profile: dict, allowed_hosts: set[str], secret_provider=None,
                 playwright_factory=None, timeout_ms: int = 12000):
        self.profile = _validate_login_profile(profile, {h.strip().lower().rstrip(".") for h in allowed_hosts})
        self.allowed_hosts = set(self.profile["_session_hosts"])
        self.timeout_ms = max(1000, min(int(timeout_ms), 20000))
        self.secret_provider = secret_provider or EnvironmentSecretProvider([
            SecretBinding(self.profile["account_id"], self.profile["host"],
                          self.profile["password_secret_ref"])
        ])
        self.playwright_factory = playwright_factory
        self.playwright = self.browser = self.context = self.page = None
        self.authenticated = False
        self.last_status = "NOT_STARTED"
        self._login_submit_active = False
        self._login_post_used = False
        self._login_post_paths = {p.rstrip("/") or "/" for p in self.profile["login_post_paths"]}
        self._interaction_post_active = False
        self._interaction_post_used = False
        self._action_post_paths = {p.rstrip("/") or "/" for p in self.profile["action_post_paths"]}

    async def _open(self):
        if self.browser is not None and self.context is not None and self.page is not None:
            return
        if self.playwright_factory is None:
            from playwright.async_api import async_playwright
            factory = async_playwright
        else:
            factory = self.playwright_factory
        manager = factory()
        self.playwright = await manager.start()
        self.browser = await self.playwright.chromium.launch(
            headless=True,
            args=["--disable-background-networking", "--disable-sync", "--no-first-run"],
        )
        self.context = await self.browser.new_context(
            accept_downloads=False, service_workers="block", ignore_https_errors=False
        )
        self.page = await self.context.new_page()
        self.page.set_default_navigation_timeout(self.timeout_ms)
        await self.page.route("**/*", self._guard_route)

    async def _guard_route(self, route):
        request = route.request
        try:
            normalized = _host_allowed(request.url, self.allowed_hosts)
            method = request.method.upper()
            if method in {"GET", "HEAD"}:
                await route.continue_()
                return
            if method == "POST":
                parts = urlsplit(normalized)
                content_type = request.headers.get("content-type", "").lower()
                allowed_content = any(content_type.startswith(kind)
                                       for kind in self.profile["login_post_content_types"])
                path = parts.path.rstrip("/") or "/"
                if (
                    self._login_submit_active and not self._login_post_used
                    and parts.hostname == self.profile["host"]
                    and path in self._login_post_paths and allowed_content
                ):
                    # One explicitly configured login POST only.
                    self._login_post_used = True
                    await route.continue_()
                    return
                if (
                    self._interaction_post_active and not self._interaction_post_used
                    and parts.hostname == self.profile["host"]
                    and path in self._action_post_paths and allowed_content
                ):
                    # One explicitly configured low-risk action POST per directly approved action.
                    self._interaction_post_used = True
                    await route.continue_()
                    return
        except Exception:
            pass
        await route.abort("blockedbyclient")

    async def _human_gate_reason(self) -> str | None:
        try:
            for selector in (
                "iframe[src*='captcha' i]", "[data-sitekey]",
                "input[autocomplete='one-time-code']",
                "input[name*='otp' i]", "input[name*='totp' i]",
            ):
                if await self.page.locator(selector).count():
                    return "HUMAN_VERIFICATION_REQUIRED"
            body = _safe_preview(await self.page.locator("body").inner_text(timeout=2500), 5000)
            if _GATE_TEXT.search(body):
                return "HUMAN_VERIFICATION_REQUIRED"
        except Exception:
            return None
        return None

    async def start(self) -> dict:
        if self.authenticated and self.page is not None:
            try:
                if await self.page.locator(self.profile["success_selector"]).is_visible():
                    self.last_status = "SESSION_REUSED"
                    return {"status": self.last_status, "platform_key": self.profile.get("platform_key"), "account_id": self.profile["account_id"]}
            except Exception:
                pass
        await self.close()
        try:
            await self._open()
            await self.page.goto(self.profile["login_url"], wait_until="domcontentloaded", timeout=self.timeout_ms)
            gate = await self._human_gate_reason()
            if gate:
                self.last_status = gate
                await self.close(keep_status=True)
                return {"status": gate, "reason": "Complete the platform's supported verification flow; no bypass was attempted."}
            user_selector = self.profile["username_selector"]
            pass_selector = self.profile["password_selector"]
            submit_selector = self.profile["submit_selector"]
            if not await self.page.locator(user_selector).count() or not await self.page.locator(pass_selector).count():
                raise BrowserSessionError("LOGIN_FIELDS_NOT_FOUND")
            password = self.secret_provider.resolve(self.profile["account_id"], self.profile["host"])
            await self.page.locator(user_selector).fill(self.profile["username"])
            await self.page.locator(pass_selector).fill(password)
            password = ""
            self._login_post_used = False
            self._login_submit_active = True
            try:
                await self.page.locator(submit_selector).click(timeout=self.timeout_ms)
                await self.page.wait_for_timeout(350)
            finally:
                self._login_submit_active = False
            gate = await self._human_gate_reason()
            if gate:
                self.last_status = gate
                await self.close(keep_status=True)
                return {"status": gate, "reason": "Platform requested a human verification step; the worker stopped safely."}
            try:
                await self.page.locator(self.profile["success_selector"]).wait_for(
                    state="visible", timeout=min(self.timeout_ms, 8000)
                )
            except Exception as exc:
                raise BrowserSessionError("LOGIN_SUCCESS_NOT_CONFIRMED") from exc
            self.authenticated = True
            self.last_status = "AUTHENTICATED_IN_MEMORY"
            return {
                "status": self.last_status,
                "platform_key": self.profile.get("platform_key") or self.profile["host"],
                "account_id": self.profile["account_id"],
                "host": self.profile["host"],
                "session_storage": "memory_only",
            }
        except Exception as exc:
            await self.close(keep_status=True)
            if isinstance(exc, BrowserSessionError):
                self.last_status = str(exc)
                raise
            self.last_status = "LOGIN_FAILED"
            raise BrowserSessionError("LOGIN_FAILED") from exc

    async def execute(self, command: dict) -> dict:
        validated = validate_operator_command(command, self.profile, self.allowed_hosts)
        action = validated["action"]
        if action == "start_session":
            return await self.start()
        if action == "stop_session":
            await self.close()
            self.last_status = "STOPPED"
            return {"status": "STOPPED", "account_id": self.profile["account_id"]}
        if action == "status":
            return {
                "status": "AUTHENTICATED_IN_MEMORY" if self.authenticated else self.last_status,
                "account_id": self.profile["account_id"],
                "host": self.profile["host"],
            }
        if not self.authenticated or self.page is None:
            raise BrowserSessionError("SESSION_NOT_AUTHENTICATED")
        current_host = (urlsplit(self.page.url).hostname or "").lower().rstrip(".")
        if current_host not in self.allowed_hosts:
            raise BrowserSessionError("CURRENT_PAGE_HOST_NOT_ALLOWED")
        if action == "navigate":
            target = _host_allowed(validated["target_url"], self.allowed_hosts)
            await self.page.goto(target, wait_until="domcontentloaded", timeout=self.timeout_ms)
            return await self.inspect()
        if action == "inspect":
            return await self.inspect()
        selector = validated.get("selector")
        locator = self.page.locator(selector)
        if action == "wait_for_selector":
            await locator.wait_for(state="visible", timeout=min(self.timeout_ms, 10000))
            return await self.inspect()
        label = ""
        try:
            label = " ".join([
                await locator.inner_text(timeout=1000),
                await locator.get_attribute("aria-label") or "",
                await locator.get_attribute("name") or "",
                await locator.get_attribute("type") or "",
            ])
        except Exception:
            pass
        if action == "click" and _HIGH_RISK_LABEL.search(label):
            raise BrowserSessionError("HIGH_IMPACT_CONTROL_REQUIRES_EXPLICIT_SUBMIT_COMMAND")
        if action == "submit_form" and re.search(r"(?i)(pay|payment|purchase|buy|withdraw|transfer|wallet|sign|delete|checkout|دفع|شراء|سحب|تحويل|توقيع|حذف)", label):
            raise BrowserSessionError("FINANCIAL_OR_DESTRUCTIVE_CONTROL_BLOCKED")
        if action == "click":
            await locator.click(timeout=self.timeout_ms)
            return await self.inspect()
        if action == "fill":
            await locator.fill(validated["value"], timeout=self.timeout_ms)
            return {"status": "FILLED", "selector": selector, "value_length": len(validated["value"])}
        if action == "submit_form":
            await locator.click(timeout=self.timeout_ms)
            await self.page.wait_for_timeout(300)
            return await self.inspect()
        raise BrowserSessionError("ACTION_NOT_IMPLEMENTED")

    async def inspect(self) -> dict:
        if self.page is None:
            return {"status": self.last_status, "authenticated": False}
        body = await self.page.locator("body").inner_text(timeout=self.timeout_ms)
        body = _safe_preview(body, 1400)
        return {
            "status": "INSPECTED",
            "authenticated": self.authenticated,
            "url": _host_allowed(self.page.url, self.allowed_hosts),
            "title": _safe_preview(await self.page.title(), 200),
            "text_preview": body,
            "text_chars": len(body),
        }

    async def close(self, keep_status: bool = False):
        self.authenticated = False
        for resource in (self.context, self.browser):
            if resource is not None:
                try:
                    await resource.close()
                except Exception:
                    pass
        if self.playwright is not None:
            try:
                await self.playwright.stop()
            except Exception:
                pass
        self.page = self.context = self.browser = self.playwright = None
        if not keep_status:
            self.last_status = "STOPPED"

class PersistentSessionPool:
    """Keep authenticated contexts in memory while the single worker is alive."""
    def __init__(self, allowed_hosts: set[str], secret_provider_factory=None,
                 playwright_factory=None, timeout_ms: int = 12000):
        self.allowed_hosts = {h.strip().lower().rstrip(".") for h in allowed_hosts}
        self.secret_provider_factory = secret_provider_factory
        self.playwright_factory = playwright_factory
        self.timeout_ms = timeout_ms
        self.sessions: dict[str, PlatformBrowserSession] = {}

    async def ensure(self, profile: dict) -> PlatformBrowserSession:
        account_id = str(profile.get("account_id", ""))
        if not account_id:
            raise BrowserSessionError("ACCOUNT_ID_REQUIRED")
        session = self.sessions.get(account_id)
        if session is None:
            provider = self.secret_provider_factory(profile) if self.secret_provider_factory else None
            session = PlatformBrowserSession(
                profile, self.allowed_hosts, secret_provider=provider,
                playwright_factory=self.playwright_factory, timeout_ms=self.timeout_ms
            )
            self.sessions[account_id] = session
        if not session.authenticated:
            outcome = await session.start()
            if not session.authenticated:
                status = str(outcome.get("status") or session.last_status)
                raise BrowserSessionError(status)
        return session

    async def close_all(self):
        for session in list(self.sessions.values()):
            await session.close()
        self.sessions.clear()
