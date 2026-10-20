from conftest import signup


def test_auth_and_course_isolation(clients):
    teacher, student, outsider, _ = clients
    signup(teacher)
    signup(student, "student", "student@example.com")
    assert student.post("/api/v1/courses", json={"name": "Denied"}).status_code == 403
    created = teacher.post("/api/v1/courses", json={"name": "Physics"})
    assert created.status_code == 201
    cid = created.json()["id"]
    assert teacher.get(f"/api/v1/courses/{cid}").status_code == 200
    assert student.get(f"/api/v1/courses/{cid}").status_code == 404
    assert outsider.get(f"/api/v1/courses/{cid}").status_code == 401
    assert student.get("/api/v1/courses/discover").json()[0]["name"] == "Physics"
    assert teacher.post("/api/v1/auth/logout").status_code == 204
    assert teacher.get("/api/v1/auth/me").status_code == 401
    assert (
        teacher.post("/api/v1/auth/login", json={"email": "teacher@example.com", "password": "incorrect"}).status_code
        == 401
    )
    assert (
        teacher.post(
            "/api/v1/auth/login", json={"email": "teacher@example.com", "password": "correct-horse-123"}
        ).status_code
        == 200
    )


def test_cross_origin_mutation_denied(clients):
    teacher, *_ = clients
    assert (
        teacher.post("/api/v1/auth/login", headers={"Origin": "https://attacker.example"}, json={}).status_code == 403
    )
