from datetime import datetime, timezone

from api.deps import Scope
from api.routers.ingest import get_job_status


class FakeCursor:
    def __init__(self, job_row, crop_rows):
        self.job_row = job_row
        self.crop_rows = crop_rows

    def execute(self, *args, **kwargs):
        pass

    def fetchone(self):
        return self.job_row

    def fetchall(self):
        return self.crop_rows


class FakeDB:
    def __init__(self, job_row, crop_rows):
        self.job_row = job_row
        self.crop_rows = crop_rows

    def cursor(self):
        return FakeCursor(self.job_row, self.crop_rows)


def test_get_job_status_includes_paginated_crops():
    job_row = (
        "job_123",
        "clip.webm",
        "Frontdoor",
        datetime(2026, 8, 27, 16, 5, 0, tzinfo=timezone.utc),
        30,
        150,
        150,
        "complete",
        None,
        5,
        11,
        datetime(2026, 8, 27, 16, 5, 0, tzinfo=timezone.utc),
        9,
    )
    crop_rows = [
        (11, 7, "Alice", "Frontdoor", datetime(2026, 8, 27, 16, 5, 1, tzinfo=timezone.utc), 0.93, "/data/crops/person_7/crop_1.jpg"),
        (12, 5, "Bob", "Frontdoor", datetime(2026, 8, 27, 16, 5, 2, tzinfo=timezone.utc), 0.89, "/data/crops/person_5/crop_2.jpg"),
    ]

    result = get_job_status(
        "job_123",
        scope=Scope(tenant_id=3, shop_id=9),
        db=FakeDB(job_row, crop_rows),
        page=1,
        limit=2,
    )

    assert result["job_id"] == "job_123"
    assert result["crops_total"] == 2
    assert result["crops_total_pages"] == 1
    assert result["crops"][0]["person_label"] == "Alice"
    assert result["crops"][0]["crop_url"] == "/api/crops/person_7/crop_1.jpg"
    assert result["crops"][1]["crop_url"] == "/api/crops/person_5/crop_2.jpg"
