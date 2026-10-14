from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from api.deps import CurrentUser, get_current_scope
from api.organization_invites import hash_invite_token, new_invite_token
from api.routers.auth import AcceptOrganizationInvite, accept_organization_invite


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
