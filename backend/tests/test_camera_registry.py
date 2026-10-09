import pytest
from fastapi import HTTPException

from api.deps import CurrentUser
from api.routers.cameras import CreateCamera, _resolve_shop_id, create_camera
from api.camera_registry import validate_active_camera


class FakeCursor:
    def __init__(self, rows=()):
        self.rows = list(rows)
        self.executed = []

    def execute(self, query, params):
        self.executed.append((query, params))

    def fetchone(self):
        return self.rows.pop(0) if self.rows else None

    def fetchall(self):
        return self.rows


class FakeDB:
    def __init__(self, rows=()):
        self.fake_cursor = FakeCursor(rows)
        self.commits = 0

    def cursor(self):
        return self.fake_cursor

    def commit(self):
        self.commits += 1


def test_manager_camera_is_forced_to_assigned_shop():
    user = CurrentUser(user_id=4, tenant_id=2, shop_id=11, role="manager")
    db = FakeDB([(7, "entry-1", "Entrance", 11, True)])

    camera = create_camera(
        CreateCamera(camera_id="entry-1", name="Entrance", shop_id=99),
        user=user,
        db=db,
    )

    assert camera["shop_id"] == 11
    assert db.fake_cursor.executed[-1][1] == (11, "entry-1", "Entrance")
    assert db.commits == 1


def test_admin_cannot_register_camera_outside_tenant():
    user = CurrentUser(user_id=1, tenant_id=2, shop_id=None, role="admin")
    db = FakeDB([None])

    with pytest.raises(HTTPException) as error:
        create_camera(
            CreateCamera(camera_id="entry-1", name="Entrance", shop_id=99),
            user=user,
            db=db,
        )

    assert error.value.status_code == 404
    assert db.commits == 0


def test_active_camera_validation_rejects_unregistered_camera():
    with pytest.raises(HTTPException) as error:
        validate_active_camera(FakeDB(), shop_id=11, camera_id="unknown")

    assert error.value.status_code == 400
