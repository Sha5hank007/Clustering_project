            # ── FPS calculation ──
            elapsed = time.time() - fps_timer
            if elapsed >= 1.0:
                fps = frame_count / elapsed
                frame_count = 0
                fps_timer = time.time()

            # ── Debug display ──
            if settings.debug_display:
                display = draw_debug(frame, tracker, fps, detections_this_frame)
                cv2.imshow("Face Track — press q to quit", display)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    logger.info("Quit signal received.")
                    break

    except KeyboardInterrupt:
        logger.info("Interrupted by user.")
    finally:
        # ── Flush surviving tracks — don't lose data on shutdown ──
        surviving = [t for t in tracker.active_tracks if len(t.crops) > 0]
        if surviving:
            logger.info(f"Processing {len(surviving)} surviving tracks before exit...")
            for track in surviving:
                process_dead_track(track, embedder)
                total_tracks_processed += 1

        source.release()
        if settings.debug_display:
            cv2.destroyAllWindows()
        logger.info(f"Worker stopped. Total tracks processed: {total_tracks_processed}")


if __name__ == "__main__":
    run()