"""Token creation and email delivery for first organization-admin invites."""
import hashlib
import html
import logging
import secrets
import smtplib
from email.message import EmailMessage

from fastapi import HTTPException

from config import settings

logger = logging.getLogger(__name__)


def new_invite_token() -> str:
    return secrets.token_urlsafe(32)


def hash_invite_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def require_mail_configuration() -> None:
    if settings.organization_invite_expiry_hours < 1:
        raise HTTPException(500, "Organization invitation expiry must be at least one hour")
    if not settings.smtp_host or not settings.smtp_from_email:
        raise HTTPException(503, "Organization invitation email is not configured")
    if settings.smtp_use_ssl and settings.smtp_use_tls:
        raise HTTPException(500, "Configure SMTP with either SSL or STARTTLS, not both")
    if settings.smtp_username and not (settings.smtp_use_ssl or settings.smtp_use_tls):
        raise HTTPException(500, "SMTP authentication requires SSL or STARTTLS")


def send_admin_invite(email: str, organization_name: str, token: str) -> None:
    require_mail_configuration()
    setup_url = "%s/accept-invite?token=%s" % (
        settings.frontend_url.rstrip("/"),
        token,
    )
    safe_name = html.escape(organization_name)
    message = EmailMessage()
    message["Subject"] = "Set up your FaceTrack organization admin account"
    message["From"] = settings.smtp_from_email
    message["To"] = email
    message.set_content(
        "You have been invited to administer %s in FaceTrack.\n\n"
        "Set your password using this one-time link within %d hours:\n%s\n"
        % (organization_name, settings.organization_invite_expiry_hours, setup_url)
    )
    message.add_alternative(
        "<p>You have been invited to administer <strong>%s</strong> in FaceTrack.</p>"
        "<p><a href=\"%s\">Set up your account</a>. This one-time link expires in %d hours.</p>"
        % (safe_name, html.escape(setup_url, quote=True), settings.organization_invite_expiry_hours),
        subtype="html",
    )
    try:
        if settings.smtp_use_ssl:
            with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
                _send(smtp, message)
        else:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
                if settings.smtp_use_tls:
                    smtp.starttls()
                _send(smtp, message)
    except (OSError, smtplib.SMTPException) as exc:
        logger.exception("Unable to deliver organization admin invite to %s", email)
        raise HTTPException(502, "Invite was saved, but email delivery failed; retry sending the invite") from exc


def _send(smtp: smtplib.SMTP, message: EmailMessage) -> None:
    if settings.smtp_username:
        smtp.login(settings.smtp_username, settings.smtp_password)
    smtp.send_message(message)
