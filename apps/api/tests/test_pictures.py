import io
from PIL import Image
from test_classroom import room


def picture(format="PNG", size=(320, 180), exif=None):
    output = io.BytesIO()
    Image.new("RGB", size, (30, 105, 80)).save(output, format, **({"exif": exif} if exif else {}))
    return output.getvalue()


def test_course_and_lecture_banners_are_validated_and_course_scoped(room):
    teacher, student, outsider, _, cid, lid, _, _ = room
    for endpoint, metadata, field in [
        (f"/api/v1/courses/{cid}/banner", f"/api/v1/courses/{cid}", "banner_url"),
        (f"/api/v1/lectures/{lid}/banner", f"/api/v1/lectures/{lid}", "banner_url"),
    ]:
        assert student.post(endpoint, files={"file": ("image.png", picture(), "image/png")}).status_code == 403
        assert outsider.get(endpoint).status_code == 404
        invalid = teacher.post(endpoint, files={"file": ("image.png", b'<svg onload="alert(1)"/>', "image/png")})
        assert invalid.status_code == 415
        uploaded = teacher.post(endpoint, files={"file": ("image.png", picture(), "image/png")})
        assert uploaded.status_code == 200, uploaded.text
        url = uploaded.json()["url"]
        assert teacher.get(metadata).json()[field] == url
        result = student.get(url)
        assert result.status_code == 200 and result.headers["content-type"] == "image/webp"
        assert "private" in result.headers["cache-control"]
        with Image.open(io.BytesIO(result.content)) as normalized:
            assert normalized.format == "WEBP"
        assert outsider.get(url).status_code == 404
        assert student.delete(endpoint).status_code == 403
        assert teacher.delete(endpoint).status_code == 204
        assert student.get(url).status_code == 404
        assert teacher.get(metadata).json()[field] is None


def test_profile_picture_is_owned_oriented_resized_and_metadata_stripped(room):
    teacher, student, _, _, _, _, _, _ = room
    exif = Image.Exif()
    exif[274] = 6
    exif[315] = "Private fixture author"
    source = picture("JPEG", (1200, 600), exif)
    result = teacher.post("/api/v1/auth/me/avatar", files={"file": ("photo.jpg", source, "image/jpeg")})
    assert result.status_code == 200, result.text
    url = result.json()["url"]
    assert teacher.get("/api/v1/auth/me").json()["avatar_url"] == url
    assert student.get(url).status_code == 404  # This endpoint always means the requesting account.
    with Image.open(io.BytesIO(teacher.get(url).content)) as normalized:
        assert normalized.size == (256, 512)  # EXIF rotation applied before bounded resize.
        assert len(normalized.getexif()) == 0
        assert not normalized.info.get("xmp")
    assert (
        teacher.post("/api/v1/auth/me/avatar", files={"file": ("bad.png", b"broken", "image/png")}).status_code == 415
    )
    assert teacher.get("/api/v1/auth/me").json()["avatar_url"] == url
    too_big = teacher.post(
        "/api/v1/auth/me/avatar", files={"file": ("big.png", b"x" * (5 * 1024 * 1024 + 1), "image/png")}
    )
    assert too_big.status_code == 413
    replacement = teacher.post("/api/v1/auth/me/avatar", files={"file": ("new.png", picture(), "image/png")})
    assert replacement.status_code == 200 and replacement.json()["url"] != url
    assert teacher.delete("/api/v1/auth/me/avatar").status_code == 204
    assert teacher.get("/api/v1/auth/me/avatar").status_code == 404
    assert teacher.get("/api/v1/auth/me").json()["avatar_url"] is None
