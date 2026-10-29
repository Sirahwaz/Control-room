"""Deterministic structural planner and safety policy for MIDAD browser tasks."""
from __future__ import annotations
from dataclasses import dataclass
from enum import Enum
from urllib.parse import urlsplit

from runner import BrowserPolicyError, validate_navigation_url


class Action(str, Enum):
    INSPECT = "inspect"
    LOGIN = "login"
    NAVIGATE = "navigate"
    READ = "read"
    FILL = "fill"
    CLICK = "click"
    SUBMIT = "submit"
    DOWNLOAD = "download"
    DELETE = "delete"
    PAYMENT = "payment"
    WITHDRAWAL = "withdrawal"
    SIGN = "sign"


@dataclass(frozen=True)
class PlanStep:
    action: Action
    target: str
    rationale: str


@dataclass(frozen=True)
class PlanDecision:
    allowed: bool
    code: str
    requires_human_approval: bool = False


HIGH_IMPACT = {Action.SUBMIT, Action.DOWNLOAD, Action.DELETE, Action.PAYMENT,
               Action.WITHDRAWAL, Action.SIGN}
READ_ONLY = {Action.INSPECT, Action.NAVIGATE, Action.READ}


def validate_profile(profile: dict, allowed_hosts: set[str]) -> dict:
    """Validate non-secret account metadata; secrets are referenced by env alias only."""
    if not isinstance(profile, dict):
        raise ValueError("PROFILE_OBJECT_REQUIRED")
    host = str(profile.get("host", "")).strip().lower().rstrip(".")
    if host not in {h.lower().rstrip(".") for h in allowed_hosts}:
        raise ValueError("PROFILE_HOST_NOT_ALLOWLISTED")
    account_id = str(profile.get("account_id", "")).strip()
    username = str(profile.get("username", "")).strip()
    secret_ref = str(profile.get("password_secret_ref", "")).strip()
    if not account_id or not username:
        raise ValueError("PROFILE_IDENTITY_REQUIRED")
    import re
    if not re.fullmatch(r"MIDAD_[A-Z0-9_]{2,96}", secret_ref):
        raise ValueError("INVALID_SECRET_REFERENCE")
    return {"host": host, "account_id": account_id, "username": username,
            "password_secret_ref": secret_ref}


def decide_action(action: Action, url: str, allowed_hosts: set[str],
                  *, authenticated: bool = False) -> PlanDecision:
    try:
        normalized = validate_navigation_url(url, allowed_hosts)
    except (BrowserPolicyError, TypeError):
        return PlanDecision(False, "TARGET_NOT_ALLOWED")
    if action in {Action.PAYMENT, Action.WITHDRAWAL, Action.SIGN, Action.DELETE, Action.SUBMIT}:
        return PlanDecision(False, "HIGH_IMPACT_ACTION_DISABLED", True)
    if action == Action.LOGIN and not authenticated:
        return PlanDecision(True, "LOGIN_ALLOWED_FOR_APPROVED_ACCOUNT")
    if action in {Action.FILL, Action.CLICK}:
        return PlanDecision(False, "INTERACTIVE_ACTION_REQUIRES_TASK_POLICY", True)
    if action == Action.DOWNLOAD:
        return PlanDecision(False, "DOWNLOAD_DISABLED", True)
    if action in READ_ONLY:
        return PlanDecision(True, "READ_ONLY_ALLOWED")
    return PlanDecision(False, "ACTION_NOT_RECOGNIZED")


def make_plan(goal: str, current_state: str = "unknown") -> list[PlanStep]:
    """Small deterministic baseline; pages are observations, never instructions."""
    normalized = " ".join(str(goal).lower().split())
    if not normalized:
        raise ValueError("GOAL_REQUIRED")
    steps = [PlanStep(Action.INSPECT, "current_page",
                      "Observe the page and current session state before acting")]
    if any(word in normalized for word in ("login", "log in", "sign in", "تسجيل الدخول")):
        steps.append(PlanStep(Action.LOGIN, "approved_account_profile",
                              "Use only the explicitly mapped account and secret reference"))
    steps.append(PlanStep(Action.READ, "task_success_condition",
                          "Verify a visible postcondition before marking the task complete"))
    return steps
