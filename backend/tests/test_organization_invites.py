from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from api.deps import CurrentUser, get_current_scope
from api.organization_invites import hash_invite_token, new_invite_token
from api.routers.auth import AcceptOrganizationInvite, accept_organization_invite
from api.routers import superadmin
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


def test_accept_invite_creates_tenant_admin_and_consumes_token():
    token = new_invite_token()
    db = FakeDB([
        (9, 4, "admin@example.com", datetime.now(timezone.utc) + timedelta(hours=1), True),
        None,
        (21,),
    ])

    result = accept_organization_invite(
        AcceptOrganizationInvite(token=token, password="longpa1!"),
        db=db,
    )

    assert result == {"created": True, "email": "admin@example.com"}
    assert db.commits == 1
    assert hash_invite_token(token) in str(db.fake_cursor.executed[0][1])
    assert "'admin'" in db.fake_cursor.executed[2][0]
    assert "accepted_at = now()" in db.fake_cursor.executed[3][0]


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
        if query.lstrip().startswith("UPDATE organization_admin_invites")
    )
    assert result["admin_email"] == "first-admin@example.com"
    assert "is_first_admin = TRUE" in revoke_query
