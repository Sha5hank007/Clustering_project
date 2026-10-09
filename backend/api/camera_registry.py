from fastapi import HTTPException


def validate_active_camera(db, shop_id: int, camera_id: str) -> None:
    cur = db.cursor()
    cur.execute(
        "SELECT id FROM cameras WHERE shop_id = %s AND camera_id = %s AND is_active = TRUE",
        (shop_id, camera_id),
    )
    if not cur.fetchone():
        raise HTTPException(400, "Select an active camera registered to this shop")
