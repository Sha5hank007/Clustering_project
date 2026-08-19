"""
Main ingestion loop. Entry point: python -m pipeline.worker

Startup:
  - Load settings from .env
  - Load InsightFace model pack (once, held in memory)
  - Create FrameSource from config
  - Create Tracker instance
  - Connect to database

Loop:
  - Grab frame from source
  - Every DETECT_INTERVAL frames: detect -> quality filter -> tracker.update()
  - Other frames: tracker.predict()
  - For each dead track: embed -> match -> cooldown check -> retention
  - Optional: cv2.imshow for visual debugging (disable in production)
"""
