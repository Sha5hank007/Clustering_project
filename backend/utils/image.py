"""
Image I/O helpers.

- save_crop(frame, bbox, person_id, timestamp) -> path
- load_crop(path) -> np.ndarray
- crop_dir(person_id, date_bucket) -> pathlib.Path
- cleanup_orphans(crop_storage_dir) -> list of deleted paths
"""
