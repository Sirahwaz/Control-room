"""Isolated, fail-closed Playwright worker for public read-only MIDAD browser jobs."""
from __future__ import annotations
import asyncio, hashlib, ipaddress, json, os, socket, time
from dataclasses import dataclass
from typing import Any, Callable
from urllib.parse import urlsplit, urlunsplit

class BrowserPolicyError(ValueError): pass
@dataclass(frozen=True)
class PolicyDecision:
    allowed: bool
    code: str
    hostname: str | None = None
@dataclass(frozen=True)
class BrowserConfig:
    supabase_url: str
    ingest_key: str
    allowed_hosts: frozenset[str]
    navigation_timeout_ms: int = 15000
    overall_timeout_seconds: float = 45.0
    max_text_chars: int = 30000
    @classmethod
    def from_env(cls):
        hosts=frozenset(x.strip().lower().rstrip(".") for x in os.environ.get("MIDAD_BROWSER_ALLOWED_HOSTS","").split(",") if x.strip())
        if not hosts or any("*" in h or "/" in h or "://" in h for h in hosts): raise ValueError("exact browser hostnames required; wildcards forbidden")
        url=os.environ.get("SUPABASE_URL","").rstrip("/"); key=os.environ.get("MIDAD_INGEST_KEY","")
        if not url.startswith("https://") or not key: raise ValueError("HTTPS Supabase URL and gateway ingest key are required")
        return cls(url,key,hosts,int(os.environ.get("MIDAD_BROWSER_NAV_TIMEOUT_MS","15000")),float(os.environ.get("MIDAD_BROWSER_JOB_TIMEOUT_SECONDS","45")))

def validate_navigation_url(raw_url: str, allowed_hosts) -> str:
    if not isinstance(raw_url,str) or not raw_url.strip(): raise BrowserPolicyError("INVALID_URL")
    try: p=urlsplit(raw_url.strip()); port=p.port
    except ValueError as e: raise BrowserPolicyError("INVALID_URL") from e
    if p.scheme.lower()!="https": raise BrowserPolicyError("HTTPS_REQUIRED")
    if p.username is not None or p.password is not None: raise BrowserPolicyError("URL_CREDENTIALS_FORBIDDEN")
    if not p.hostname or port not in (None,443): raise BrowserPolicyError("INVALID_HOST_OR_PORT")
    host=p.hostname.lower().rstrip(".")
    if host in {"localhost","localhost.localdomain"} or host.endswith((".local",".internal",".localhost")): raise BrowserPolicyError("NON_PUBLIC_HOST")
    normalized=set()
    for item in allowed_hosts:
        if not isinstance(item,str) or not item.strip(): raise BrowserPolicyError("INVALID_ALLOWLIST")
        item=item.strip().lower().rstrip(".")
        if "*" in item or "/" in item or "://" in item: raise BrowserPolicyError("INVALID_ALLOWLIST")
        normalized.add(item)
    if host not in normalized: raise BrowserPolicyError("HOST_NOT_ALLOWLISTED")
    try: addr=ipaddress.ip_address(host)
    except ValueError: addr=None
    if addr is not None and not addr.is_global: raise BrowserPolicyError("NON_PUBLIC_HOST")
    if addr is None:
        try: answers=socket.getaddrinfo(host,443,type=socket.SOCK_STREAM)
        except OSError as e: raise BrowserPolicyError("DNS_RESOLUTION_FAILED") from e
        ips={ipaddress.ip_address(a[4][0].split("%",1)[0]) for a in answers}
        if not ips or any(not ip.is_global for ip in ips): raise BrowserPolicyError("NON_PUBLIC_DNS")
    return urlunsplit(("https",host,p.path or "/",p.query,""))

class GatewayClient:
    def __init__(self,config,opener=None): self.config=config; self._opener=opener
    def _post_sync(self,payload):
        from urllib.request import Request,build_opener
        from urllib.error import HTTPError,URLError
        req=Request(self.config.supabase_url+"/functions/v1/midad_browser_agent_gateway",data=json.dumps(payload).encode(),method="POST",headers={"content-type":"application/json","x-midad-ingest-key":self.config.ingest_key,"accept":"application/json"})
        try:
            with (self._opener or build_opener()).open(req,timeout=10) as response: value=json.loads(response.read(1000000).decode())
        except (HTTPError,URLError,TimeoutError,OSError,ValueError) as e: raise RuntimeError("gateway_request_failed") from e
        if not isinstance(value,dict) or value.get("ok") is not True: raise RuntimeError("gateway_rejected_"+str(value.get("error","invalid_response"))[:80])
        return value
    async def call(self,action,**payload): return await asyncio.to_thread(self._post_sync,{"action":action,**payload})
    async def record_event(self,**payload): return await self.call("record_event",**payload)

class BrowserJobRunner:
    def __init__(self,config,gateway=None,playwright_factory:Callable|None=None):
        self.config=config; self.gateway=gateway or GatewayClient(config); self.playwright_factory=playwright_factory
    def request_decision(self,url,method="GET"):
        try:
            normalized=validate_navigation_url(url,self.config.allowed_hosts)
            if method.upper() not in {"GET","HEAD"}: return PolicyDecision(False,"READ_ONLY_METHOD_REQUIRED",urlsplit(normalized).hostname)
            return PolicyDecision(True,"READ_ONLY_ALLOWED",urlsplit(normalized).hostname)
        except BrowserPolicyError as e: return PolicyDecision(False,str(e),urlsplit(url).hostname if isinstance(url,str) else None)
    async def _open_browser(self):
        if self.playwright_factory is None:
            from playwright.async_api import async_playwright
            factory=async_playwright
        else: factory=self.playwright_factory
        pw=await factory().__aenter__()
        browser=await pw.chromium.launch(headless=True,args=["--disable-background-networking","--disable-sync","--no-first-run"])
        context=await browser.new_context(accept_downloads=False,service_workers="block",ignore_https_errors=False,java_script_enabled=True)
        page=await context.new_page(); page.set_default_navigation_timeout(self.config.navigation_timeout_ms)
        return pw,browser,context,page
    async def _navigate_and_capture(self,page,target_url,cancel):
        async def guard(route):
            req=route.request; decision=self.request_decision(req.url,req.method)
            if not decision.allowed or cancel.is_set(): await route.abort("blockedbyclient"); return
            await route.continue_()
        await page.route("**/*",guard)
        response=await page.goto(target_url,wait_until="domcontentloaded",timeout=self.config.navigation_timeout_ms)
        final=validate_navigation_url(page.url,self.config.allowed_hosts)
        title=(await page.title())[:500]
        text=(await page.locator("body").inner_text(timeout=self.config.navigation_timeout_ms))[:self.config.max_text_chars]
        return {"url":final,"title":title,"text":text,"http_status":response.status if response else None}
    async def _record(self,job_id,event_type,state,current_url,evidence,next_action):
        try: safe_url=validate_navigation_url(current_url,self.config.allowed_hosts)
        except BrowserPolicyError: safe_url=None
        return await self.gateway.record_event(job_id=job_id,event_type=event_type,state=state,current_url=safe_url,next_action=next_action,evidence={"source_kind":"isolated_playwright",**evidence})
    async def run(self,job,cancel=None):
        cancel=cancel or asyncio.Event(); job_id=str(job.get("id") or job.get("job_id") or "")
        if not job_id: raise ValueError("job_id_required")
        target=validate_navigation_url(str(job.get("current_url") or ""),self.config.allowed_hosts)
        started=time.monotonic(); pw=browser=context=page=None; result={"job_id":job_id,"status":"FAILED"}
        work = cancel_wait = None
        try:
            async def execute():
                nonlocal pw,browser,context,page
                pw,browser,context,page=await self._open_browser()
                captured=await self._navigate_and_capture(page,target,cancel)
                digest=hashlib.sha256(captured["text"].encode()).hexdigest()
                result.update({"job_id":job_id,"status":"CAPTURED","url":captured["url"],"title":captured["title"],"http_status":captured["http_status"],"content_sha256":digest,"text_chars":len(captured["text"]),"elapsed_ms":int((time.monotonic()-started)*1000)})
                await self._record(job_id,"navigation","RUNNING",captured["url"],{"http_status":captured["http_status"],"title":captured["title"],"content_sha256":digest,"text_chars":len(captured["text"]),"elapsed_ms":result["elapsed_ms"]},"review_public_evidence")
            work = asyncio.create_task(execute())
            cancel_wait = asyncio.create_task(cancel.wait())
            done, pending = await asyncio.wait(
                {work, cancel_wait},
                timeout=self.config.overall_timeout_seconds,
                return_when=asyncio.FIRST_COMPLETED,
            )
            if cancel_wait in done and cancel.is_set():
                work.cancel()
                try:
                    await work
                except asyncio.CancelledError:
                    pass
                raise asyncio.CancelledError()
            if work in done:
                await work
            else:
                work.cancel()
                try:
                    await work
                except asyncio.CancelledError:
                    pass
                raise asyncio.TimeoutError()
            cancel_wait.cancel()
            try:
                await cancel_wait
            except asyncio.CancelledError:
                pass
        except asyncio.TimeoutError:
            result.update({"status":"TIMEOUT","error":"overall_timeout"})
            await self._record(job_id,"error","FAILED",target,{"error_code":"browser_timeout"},"review_or_retry")
        except asyncio.CancelledError:
            result.update({"status":"CANCELLED","error":"cancelled"})
            try: await asyncio.shield(self._record(job_id,"error","FAILED",target,{"error_code":"browser_cancelled"},"resume_or_review"))
            finally: raise
        except Exception:
            result.update({"status":"FAILED","error":"browser_runtime_failed"})
            try: await self._record(job_id,"error","FAILED",target,{"error_code":"browser_runtime_failed"},"review_or_retry")
            except Exception: pass
        finally:
            for pending_task in (work, cancel_wait):
                if pending_task is not None and not pending_task.done():
                    pending_task.cancel()
            for resource in (context,browser):
                if resource is not None:
                    try: await asyncio.shield(resource.close())
                    except Exception: pass
            if pw is not None:
                try: await asyncio.shield(pw.__aexit__(None,None,None))
                except Exception: pass
        return result

async def run_job(job,cancel=None): return await BrowserJobRunner(BrowserConfig.from_env()).run(job,cancel)
if __name__=="__main__":
    import argparse
    parser=argparse.ArgumentParser(description=__doc__); parser.add_argument("--job-json",required=True); args=parser.parse_args()
    output=asyncio.run(run_job(json.loads(args.job_json))); print(json.dumps(output,sort_keys=True))
    if output["status"]!="CAPTURED": raise SystemExit(1)
