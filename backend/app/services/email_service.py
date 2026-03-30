"""
Email service — sends via SMTP if configured, else logs to console.

Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in .env to enable real delivery.
Works with Gmail app passwords, SendGrid SMTP relay, Mailgun, Postmark, etc.

If SMTP_HOST is not set, emails are logged to console (development mode).

Environment variables:
  SMTP_HOST     — SMTP server hostname (e.g. smtp.gmail.com)
  SMTP_PORT     — SMTP port (default: 587 for STARTTLS, 465 for SSL)
  SMTP_USER     — SMTP username / login email
  SMTP_PASS     — SMTP password or app password
  EMAIL_FROM    — display From address (defaults to SMTP_USER)
  FRONTEND_URL  — base URL for action links (default: http://localhost:3000)
"""
from __future__ import annotations

import asyncio
import logging
import os
import smtplib
import ssl
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

logger = logging.getLogger(__name__)

_FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
_FROM = os.getenv("EMAIL_FROM", "")  # falls back to SMTP_USER if empty


# ── Internal send primitive ───────────────────────────────────────────────────

def _send(to: str, subject: str, body: str) -> None:
    """
    Send a plain-text email.

    Uses SMTP if SMTP_HOST is configured; otherwise logs to console.
    Raises on SMTP failure so callers can catch and log as non-fatal.
    """
    smtp_host = os.getenv("SMTP_HOST", "").strip()

    if smtp_host:
        port = int(os.getenv("SMTP_PORT", "587"))
        user = os.getenv("SMTP_USER", "").strip()
        password = os.getenv("SMTP_PASS", "").strip()
        from_addr = _FROM or user

        msg = MIMEMultipart()
        msg["From"] = from_addr
        msg["To"] = to
        msg["Subject"] = subject
        msg.attach(MIMEText(body, "plain"))

        context = ssl.create_default_context()
        if port == 465:
            # SSL from the start
            with smtplib.SMTP_SSL(smtp_host, port, context=context) as server:
                if user and password:
                    server.login(user, password)
                server.sendmail(from_addr, to, msg.as_string())
        else:
            # STARTTLS (port 587 or 25)
            with smtplib.SMTP(smtp_host, port) as server:
                server.ehlo()
                server.starttls(context=context)
                if user and password:
                    server.login(user, password)
                server.sendmail(from_addr, to, msg.as_string())

        logger.info("Email sent to %s — %s", to, subject)
    else:
        # Console fallback for development
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        from_display = _FROM or "hello@lumidian.ai"
        logger.info(
            "\n"
            "╔══════════════════════════════════════════════════════════════╗\n"
            "║  📧  EMAIL (console mode — set SMTP_HOST to send for real)  ║\n"
            "╠══════════════════════════════════════════════════════════════╣\n"
            "║  To:      %-51s║\n"
            "║  From:    %-51s║\n"
            "║  Subject: %-51s║\n"
            "║  Sent:    %-51s║\n"
            "╠══════════════════════════════════════════════════════════════╣\n"
            "%s\n"
            "╚══════════════════════════════════════════════════════════════╝",
            to[:51], from_display[:51], subject[:51], timestamp[:51],
            "\n".join(f"  {line}" for line in body.splitlines()),
        )


# ── Async fire-and-forget helper ──────────────────────────────────────────────

def send_email_background(fn, *args, **kwargs) -> None:
    """
    Run a synchronous email function in a thread-pool executor so it doesn't
    block the async event loop.  Exceptions are caught and logged non-fatally.
    """
    import functools

    async def _run():
        loop = asyncio.get_running_loop()
        try:
            await loop.run_in_executor(None, functools.partial(fn, *args, **kwargs))
        except Exception as exc:
            logger.warning("Background email failed (%s): %s", fn.__name__, exc)

    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.ensure_future(_run())
        else:
            fn(*args, **kwargs)   # fallback for non-async callers (tests, CLI)
    except Exception as exc:
        logger.warning("send_email_background setup failed (%s): %s", fn.__name__, exc)


# ── Public email functions ────────────────────────────────────────────────────

def send_email_verification(email: str, name: Optional[str], code: str) -> None:
    """Sent immediately after a new user registers — 6-digit code to verify email."""
    display = name or email.split("@")[0]

    body = f"""\
Hi {display},

Thanks for creating a Lumidian account.

Your email verification code is:

  {code}

Enter this code on the verification page to access your account.
This code expires in 24 hours.

If you didn't create a Lumidian account, you can safely ignore this email.

— The Lumidian Team
"""
    _send(
        to=email,
        subject="Verify your Lumidian account",
        body=body,
    )


def send_welcome_email(email: str, name: Optional[str]) -> None:
    """Sent immediately after a new user registers."""
    display = name or email.split("@")[0]
    brand_url = f"{_FRONTEND_URL}/tracker/new"
    login_url = f"{_FRONTEND_URL}/login"

    body = f"""\
Hi {display},

Welcome to Lumidian! 🎉

You're now set up to track how often your brand appears in AI-generated
responses across ChatGPT, Claude, Perplexity, and Gemini.

Here's how to get started:

  1. Add your first brand
     {brand_url}

  2. Configure your tracking prompts — the questions people ask AI
     where you want your brand to appear.

  3. Run your first report and see your current visibility score.

Your free account includes a pitch deck (10 prompts) to get started.
Upgrade to Starter or Pro to unlock full tracking.

Log in any time at:
  {login_url}

If you have questions, just reply to this email.

— The Lumidian Team
"""
    _send(
        to=email,
        subject="Welcome to Lumidian — let's track your AI visibility",
        body=body,
    )


def send_password_reset_email(email: str, name: Optional[str], reset_link: str) -> None:
    """Sent when a user requests a password reset."""
    display = name or email.split("@")[0]

    body = f"""\
Hi {display},

We received a request to reset your Lumidian password.

Click the link below to set a new password. This link expires in 1 hour.

  {reset_link}

If you didn't request a password reset, you can safely ignore this email.
Your password will not change.

— The Lumidian Team
"""
    _send(
        to=email,
        subject="Reset your Lumidian password",
        body=body,
    )


def send_team_invite_email(
    invited_email: str,
    invite_link: str,
    inviter_name: Optional[str],
) -> None:
    """Sent when a user is invited to join a team workspace."""
    inviter = inviter_name or "A Lumidian user"
    login_url = f"{_FRONTEND_URL}/login"

    body = f"""\
Hi,

{inviter} has invited you to access their Lumidian workspace.

As a team member you'll have read-only access to their brand tracking
data, reports, and content drafts.

Accept your invitation here (link expires in 48 hours):

  {invite_link}

You'll need a Lumidian account to accept. If you don't have one,
you can register for free at:
  {login_url}

— The Lumidian Team
"""
    _send(
        to=invited_email,
        subject=f"{inviter} invited you to Lumidian",
        body=body,
    )


def send_pitch_expiry_warning_email(
    email: str,
    name: Optional[str],
    brand_name: str,
    expires_at: datetime,
) -> None:
    """Sent ~24 hours before a pitch brand expires."""
    display = name or email.split("@")[0]
    dashboard_url = f"{_FRONTEND_URL}/dashboard"
    upgrade_url = f"{_FRONTEND_URL}/account"
    expiry_str = expires_at.strftime("%A, %B %-d at %-I:%M %p UTC")

    body = f"""\
Hi {display},

Your pitch deck brand "{brand_name}" on Lumidian expires in about 24 hours.

  Expires: {expiry_str}

After expiry, the brand and all its tracking data will be automatically
deleted. Any drafts or reports you want to keep should be saved now.

To keep this brand permanently, upgrade to a Starter or Pro plan:
  {upgrade_url}

View your dashboard:
  {dashboard_url}

If you have questions, just reply to this email.

— The Lumidian Team
"""
    _send(
        to=email,
        subject=f'Your Lumidian pitch deck "{brand_name}" expires tomorrow',
        body=body,
    )


def send_report_ready_email(
    email: str,
    name: Optional[str],
    brand_name: str,
    overall_score: float,
    run_id: int,
) -> None:
    """Sent when a tracking run completes successfully."""
    display = name or email.split("@")[0]
    report_url = f"{_FRONTEND_URL}/reports"

    direction = "📈" if overall_score >= 50 else "📊"

    body = f"""\
Hi {display},

Your latest AI visibility report for {brand_name} is ready. {direction}

  Overall visibility score: {overall_score:.1f}%

This score represents how often {brand_name} is mentioned across
ChatGPT, Claude, Perplexity, and Gemini for your tracked prompts.

View the full breakdown — per-model scores, prompt-level analysis,
and sentiment data — in your dashboard:
  {report_url}

Run ID: #{run_id}

— The Lumidian Team
"""
    _send(
        to=email,
        subject=f"Your Lumidian report for {brand_name} is ready ({overall_score:.1f}%)",
        body=body,
    )


def send_support_request_email(
    from_name: Optional[str],
    from_email: str,
    subject: str,
    message: str,
) -> None:
    """Forward a user support request to the support inbox."""
    support_inbox = os.getenv("SUPPORT_EMAIL", "ken@lumidian.ai")
    display = from_name or from_email

    body = f"""\
New support request received via Lumidian.

From:    {display}
Email:   {from_email}
Subject: {subject}

────────────────────────────────────────

{message}

────────────────────────────────────────
Reply directly to {from_email} to respond.
"""
    _send(
        to=support_inbox,
        subject=f"[Support] {subject}",
        body=body,
    )


def send_visibility_alert_email(
    email: str,
    name: Optional[str],
    brand_name: str,
    current_score: float,
    previous_score: float,
    drop_pct: float,
) -> None:
    """Sent when a brand's visibility drops significantly between consecutive runs."""
    display = name or email.split("@")[0]
    report_url = f"{_FRONTEND_URL}/reports"

    body = f"""\
Hi {display},

Your AI visibility score for {brand_name} has dropped significantly since the last report.

  Previous score: {previous_score:.1f}%
  Current score:  {current_score:.1f}%
  Drop:           -{drop_pct:.1f} percentage points

This may indicate a shift in how AI models are responding to your tracked prompts.
It's worth reviewing your recent conversations to understand what changed.

View the full breakdown here:
  {report_url}

— The Lumidian Team
"""
    _send(
        to=email,
        subject=f"Visibility alert: {brand_name} dropped {drop_pct:.1f}% ({current_score:.1f}%)",
        body=body,
    )
