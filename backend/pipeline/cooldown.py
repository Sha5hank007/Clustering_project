"""
Duplicate sighting suppression.

After identity match resolves a person_id:
  - Check: was this person_id seen on this camera_id within COOLDOWN_HOURS?
  - YES -> UPDATE persons SET last_seen = now, sighting_count += 1
           No new sighting row. Return should_insert=False.
  - NO  -> Return should_insert=True. Caller proceeds to insert sighting.

This prevents row spam: person at desk for 8 hours
doesn't generate hundreds of sighting rows.
"""
