from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from api.deps import CurrentUser, get_current_scope
from api import organization_invites
from api.organization_invites import hash_invite_token, new_invite_token
from api.routers import admin
from api.routers.auth import (
    AcceptOrganizationInvite,
    ForgotPasswordRequest,
    ResetPasswordRequest,
    accept_organization_invite,
    forgot_password,
    reset_password,
)
from api.routers import superadmin
from api.routers.admin import InviteUser, invite_user
from api.routers.superadmin import CreateOrganization, create_organization


def test_invite_token_is_random_and_only_hash_is_stored():
    first = new_invite_token()
    second = new_invite_token()

    assert first != second
    assert len(first) >= 40
    assert hash_invite_token(first) != first
    assert hash_invite_token(first) == hash_invite_token(first)


def test_superadmin_cannot_get_an_organization_data_scope():
    user = CurrentUser(user_id=1, tenant_id=None, shop_id=None, role="superadmin")

    with pytest.raises(HTTPException) as error:
        get_current_scope(user=user)

    assert error.value.status_code == 403


class FakeCursor:
    def __init__(self, rows):
        self.rows = list(rows)
        self.executed = []

    def execute(self, query, params):
        self.executed.append((query, params))

    def fetchone(self):
        return self.rows.pop(0) if self.rows else None


class FakeDB:
    def __init__(self, rows):
        self.fake_cursor = FakeCursor(rows)
        self.commits = 0

    def cursor(self):
        return self.fake_cursor

    def commit(self):
        self.commits += 1

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        if exc_type is None:
            self.commit()
        return False


def test_accept_invite_creates_assigned_role_and_consumes_token():
    token = new_invite_token()
    db = FakeDB([
        (9, 4, "guard@example.com", "guard", 12, False,
         datetime.now(timezone.utc) + timedelta(hours=1), True, 12),
        None,
        (21,),
    ])

    result = accept_organization_invite(
        AcceptOrganizationInvite(token=token, password="longpa1!"),
        db=db,
    )

    assert result == {"created": True, "email": "guard@example.com", "role": "guard", "shop_id": 12}
    assert db.commits == 1
    assert hash_invite_token(token) in str(db.fake_cursor.executed[0][1])
    assert "VALUES (%s, %s, %s, %s, %s)" in db.fake_cursor.executed[2][0]
    assert "consumed_at = now()" in db.fake_cursor.executed[3][0]


def test_forgot_password_returns_generic_response_for_unknown_email():
    db = FakeDB([None])

    result = forgot_password(ForgotPasswordRequest(email="unknown@example.com"), db=db)

    assert result == {"message": "If an eligible account exists for that email, a reset link will be sent."}
    assert len(db.fake_cursor.executed) == 1
    assert "INSERT INTO account_tokens" not in str(db.fake_cursor.executed)


def test_reset_password_updates_hash_and_consumes_token():
    token = new_invite_token()
    db = FakeDB([(
        13, 22, datetime.now(timezone.utc) + timedelta(hours=1),
        "guard@example.com", True, 4,
    )])

    result = reset_password(
        ResetPasswordRequest(token=token, password="newpass123"),
        db=db,
    )

    assert result == {"reset": True, "email": "guard@example.com"}
    assert db.commits == 1
    assert hash_invite_token(token) in str(db.fake_cursor.executed[0][1])
    assert "UPDATE users SET password_hash" in db.fake_cursor.executed[1][0]
    assert "consumed_at = now()" in db.fake_cursor.executed[2][0]


def test_admin_invite_persists_role_scope_and_emails_invitee(monkeypatch):
    db = FakeDB([(12,), None, None, ("Front Shop",), (31,), ("Example Org",)])
    delivered = []
    monkeypatch.setattr(admin, "require_mail_configuration", lambda: None)
    monkeypatch.setattr(admin, "send_account_invite", lambda *args: delivered.append(args))

    result = invite_user(
        InviteUser(email="Guard@Example.com", role="guard", shop_id=12),
        user=CurrentUser(user_id=5, tenant_id=4, shop_id=None, role="admin"),
        db=db,
    )

    assert result == {"id": 31, "email": "guard@example.com", "role": "guard", "shop_id": 12, "status": "pending"}
    insert = next((query, params) for query, params in db.fake_cursor.executed if "INSERT INTO account_tokens" in query)
    assert "'invite'" in insert[0]
    assert insert[1][0:4] == (4, "guard@example.com", "guard", 12)
    assert delivered[0][0:4] == ("guard@example.com", "Example Org", "guard", "Front Shop")
    assert hash_invite_token(delivered[0][4]) == insert[1][4]
    assert db.commits == 1


def test_account_invite_email_identifies_assigned_role(monkeypatch):
    delivered = []
    monkeypatch.setattr(organization_invites, "require_mail_configuration", lambda *args: None)
    monkeypatch.setattr(organization_invites, "_deliver", lambda message, *args: delivered.append(message))

    organization_invites.send_account_invite(
        "guard@example.com", "Example Org", "guard", "Front Shop", new_invite_token()
    )

    assert "Guard for Front Shop" in delivered[0].get_body(preferencelist=("plain",)).get_content()
    assert delivered[0]["Subject"] == "Your FaceTrack guard invitation"


def test_invite_password_must_be_at_least_eight_characters():
    with pytest.raises(ValueError):
        AcceptOrganizationInvite(token=new_invite_token(), password="short1!")


def test_duplicate_organization_name_is_rejected_before_invite_creation():
    db = FakeDB([(3,)])

    with pytest.raises(HTTPException) as error:
        create_organization(
            CreateOrganization(name="  Example Org  ", admin_email="new-admin@example.com"),
            user=CurrentUser(user_id=1, tenant_id=None, shop_id=None, role="superadmin"),
            db=db,
        )

    assert error.value.status_code == 409
    assert "already exists" in error.value.detail
    assert "LOWER(BTRIM(name))" in db.fake_cursor.executed[0][0]
    assert db.commits == 0


def test_resending_first_admin_invite_does_not_revoke_other_admin_invites(monkeypatch):
    db = FakeDB([
        ("Example Org", True),
        ("first-admin@example.com",),
        None,
        None,
    ])
    monkeypatch.setattr(superadmin, "require_mail_configuration", lambda: None)
    monkeypatch.setattr(superadmin, "send_admin_invite", lambda *args: None)
    monkeypatch.setattr(superadmin, "_record_audit", lambda *args: None)

    result = superadmin.resend_admin_invite(
        tenant_id=4,
        user=CurrentUser(user_id=1, tenant_id=None, shop_id=None, role="superadmin"),
        db=db,
    )

    revoke_query = next(
        query for query, _ in db.fake_cursor.executed
        if query.lstrip().startswith("UPDATE account_tokens")
    )
    assert result["admin_email"] == "first-admin@example.com"
    assert "is_first_admin = TRUE" in revoke_query
