"""
Nightly retention sweep.

- Delete orphaned crop files (crop_path in DB but file missing, or vice versa)
- Enforce max retention age if configured
- Flag persons with < 3 total sightings as probable noise
"""
