import numpy as np

from pipeline import retention
from pipeline.tracker import CropInfo


class FakeCursor:
    def __init__(self):
        self.executed = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, query, params):
        self.executed.append((query, params))


class FakeConnection:
    def __init__(self):
        self.fake_cursor = FakeCursor()
        self.commits = 0

    def cursor(self):
        return self.fake_cursor

    def commit(self):
        self.commits += 1


def test_each_inserted_sighting_saves_crop_and_increments_person_count(monkeypatch):
    saved_crops = []

    def save_crop(person_id, crop, timestamp):
        path = f"/crops/person_{person_id}/{timestamp}.jpg"
        saved_crops.append(path)
        return path

    monkeypatch.setattr(retention, "_save_crop", save_crop)

    conn = FakeConnection()
    crop_info = CropInfo(
        crop=np.zeros((112, 112, 3), dtype=np.uint8),
        bbox=np.array([1, 2, 3, 4]),
        landmarks=np.zeros((5, 2)),
        quality_score=0.9,
        timestamp=1_800_000_000,
    )

    for timestamp in (1_800_000_000, 1_800_000_001):
        crop_info.timestamp = timestamp
        retention.handle(
            person_id=7,
            embedding=np.zeros(512),
            crop_info=crop_info,
            camera_id="cam-01",
            timestamp=timestamp,
            conn=conn,
            shop_id=3,
        )

    sighting_inserts = [
        (query, params)
        for query, params in conn.fake_cursor.executed
        if "INSERT INTO sightings" in query
    ]
    count_updates = [
        (query, params)
        for query, params in conn.fake_cursor.executed
        if "UPDATE persons SET sighting_count" in query
    ]

    assert len(saved_crops) == len(sighting_inserts) == len(count_updates) == 2
    assert [params[6] for _, params in sighting_inserts] == saved_crops
    assert [params for _, params in count_updates] == [(7,), (7,)]
    assert conn.commits == 2
