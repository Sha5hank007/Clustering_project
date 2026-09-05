"""
Loop a short video into a 15-minute test video at 720p.
Uses XVID codec (fast decode, always available on Windows).
Usage: python make_test_video.py input.mp4 output.avi
"""
import sys
import os
import cv2

if len(sys.argv) < 3:
    print("Usage: python make_test_video.py input.mp4 output.avi")
    sys.exit(1)

input_path = sys.argv[1]
output_path = sys.argv[2]
target_minutes = 15
target_width = 1280

cap = cv2.VideoCapture(input_path)
if not cap.isOpened():
    print("Cannot open:", input_path)
    sys.exit(1)

fps = cap.get(cv2.CAP_PROP_FPS) or 25
w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
total_src = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

if w > target_width:
    scale = target_width / w
    out_w = target_width
    out_h = int(h * scale)
    out_h = out_h if out_h % 2 == 0 else out_h + 1
    print("Downscaling %dx%d -> %dx%d" % (w, h, out_w, out_h))
else:
    out_w = w
    out_h = h

print("Source: %d frames (%.1f sec) at %.1f fps" % (total_src, total_src / fps, fps))

fourcc = cv2.VideoWriter_fourcc(*"XVID")
out = cv2.VideoWriter(output_path, fourcc, fps, (out_w, out_h))

if not out.isOpened():
    print("ERROR: Cannot create video writer with XVID codec")
    sys.exit(1)

print("Using XVID codec -> %s" % output_path)

target_frames = int(target_minutes * 60 * fps)
written = 0

while written < target_frames:
    ok, frame = cap.read()
    if not ok:
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        continue
    if w > target_width:
        frame = cv2.resize(frame, (out_w, out_h))
    out.write(frame)
    written += 1
    if written % 5000 == 0:
        print("Written %d / %d frames (%.0f%%)" % (written, target_frames, written / target_frames * 100))

cap.release()
out.release()

size_mb = os.path.getsize(output_path) / (1024 * 1024)
print("Done: %s (%d frames, %.1f min, %dx%d, %.1f MB)" % (
    output_path, written, written / fps / 60, out_w, out_h, size_mb))