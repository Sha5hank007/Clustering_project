"""Token creation and email delivery for account invitations and password resets."""
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


def require_mail_configuration(purpose: str = "invite") -> None:
    expiry_hours = (
        settings.password_reset_expiry_hours
        if purpose == "password_reset"
        else settings.account_invite_expiry_hours
    )
    if expiry_hours < 1:
        raise HTTPException(500, "Token expiry must be at least one hour")
    if not settings.smtp_host or not settings.smtp_from_email:
        raise HTTPException(503, "Organization invitation email is not configured")
    if settings.smtp_use_ssl and settings.smtp_use_tls:
        raise HTTPException(500, "Configure SMTP with either SSL or STARTTLS, not both")
    if settings.smtp_username and not (settings.smtp_use_ssl or settings.smtp_use_tls):
        raise HTTPException(500, "SMTP authentication requires SSL or STARTTLS")


def _deliver(message: EmailMessage, purpose: str = "invite") -> None:
    require_mail_configuration(purpose)
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
        logger.exception("Unable to deliver account email to %s", message["To"])
        raise HTTPException(502, "Token was saved, but email delivery failed; retry sending the email") from exc


def send_account_invite(email: str, organization_name: str, role: str, shop_name: str | None, token: str) -> None:
    require_mail_configuration()
    setup_url = "%s/accept-invite?token=%s" % (settings.frontend_url.rstrip("/"), token)
    role_description = role.capitalize()
    if shop_name:
        role_description += " for " + shop_name
    safe_name = html.escape(organization_name)
    safe_role = html.escape(role_description)
    message = EmailMessage()
    message["Subject"] = "Your FaceTrack %s invitation" % role
    message["From"] = settings.smtp_from_email
    message["To"] = email
    message.set_content(
        "You have been invited to FaceTrack as a %s in %s.\n\n"
        "Set your password using this one-time link within %d hours:\n%s\n"
        % (role_description, organization_name, settings.account_invite_expiry_hours, setup_url)
    )
    message.add_alternative(
        "<p>You have been invited to FaceTrack as <strong>%s</strong> in <strong>%s</strong>.</p>"
        "<p><a href=\"%s\">Set up your account</a>. This one-time link expires in %d hours.</p>"
        % (safe_role, safe_name, html.escape(setup_url, quote=True), settings.account_invite_expiry_hours),
        subtype="html",
    )
    _deliver(message)


def send_admin_invite(email: str, organization_name: str, token: str) -> None:
    """Compatibility wrapper for first-admin invitations."""
    send_account_invite(email, organization_name, "admin", None, token)


def send_password_reset(email: str, token: str) -> None:
    require_mail_configuration()
    reset_url = "%s/reset-password?token=%s" % (settings.frontend_url.rstrip("/"), token)
    message = EmailMessage()
    message["Subject"] = "Reset your FaceTrack password"
    message["From"] = settings.smtp_from_email
    message["To"] = email
    message.set_content(
        "Use this one-time link to reset your FaceTrack password within %d hours:\n%s\n\n"
        "If you did not request a password reset, you can ignore this email.\n"
        % (settings.password_reset_expiry_hours, reset_url)
    )
    message.add_alternative(
        "<p>Use the link below to reset your FaceTrack password. It expires in %d hours.</p>"
        "<p><a href=\"%s\">Reset password</a></p>"
        "<p>If you did not request this, you can ignore this email.</p>"
        % (settings.password_reset_expiry_hours, html.escape(reset_url, quote=True)),
        subtype="html",
    )
    _deliver(message, "password_reset")


def _send(smtp: smtplib.SMTP, message: EmailMessage) -> None:
    if settings.smtp_username:
        smtp.login(settings.smtp_username, settings.smtp_password)
    smtp.send_message(message)
