import secrets
from datetime import timedelta
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, InvalidHashError
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError, DataError
from .config import settings
from .models import User, LoginSession, Course, Membership, now
from .security import DB, Actor, member, digest

app = FastAPI(title="LectureLoop", version="0.1.0", docs_url="/api/docs", openapi_url="/api/openapi.json")
passwords = PasswordHasher()


@app.middleware("http")
async def request_boundary(request: Request, call_next):
    request.state.request_id = secrets.token_hex(8)
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        origin = request.headers.get("origin")
        if (origin and origin != settings().app_origin) or request.headers.get("sec-fetch-site") == "cross-site":
            return JSONResponse(
                {
                    "code": "origin_denied",
                    "message": "Request origin is not allowed.",
                    "request_id": request.state.request_id,
                },
                status_code=403,
            )
    response = await call_next(request)
    response.headers["X-Request-ID"] = request.state.request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.exception_handler(HTTPException)
async def http_error(request, exc):
    return JSONResponse(
        {
            "code": f"http_{exc.status_code}",
            **(exc.detail if isinstance(exc.detail, dict) else {"message": exc.detail}),
            "request_id": request.state.request_id,
        },
        status_code=exc.status_code,
    )


@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    return JSONResponse(
        {
            "code": "invalid_input",
            "message": "Check the form fields and try again.",
            "details": [{"field": e["loc"], "message": e["msg"]} for e in exc.errors()],
            "request_id": request.state.request_id,
        },
        status_code=422,
    )


@app.exception_handler(IntegrityError)
async def integrity_error(request, exc):
    return JSONResponse(
        {
            "code": "conflict",
            "message": "This change conflicts with an existing item. Refresh and try again.",
            "request_id": request.state.request_id,
        },
        status_code=409,
    )


@app.exception_handler(DataError)
async def data_error(request, exc):
    return JSONResponse(
        {
            "code": "invalid_identifier",
            "message": "Item not found or invalid input.",
            "request_id": request.state.request_id,
        },
        status_code=404,
    )


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/ready")
def ready(db: DB):
    db.execute(text("SELECT 1"))
    return {"status": "ready"}


class Register(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    password: str = Field(min_length=10, max_length=200)
    role: str = Field(pattern="^(lecturer|student)$")


class Login(BaseModel):
    email: EmailStr
    password: str = Field(max_length=200)


def user_json(user):
    from .pictures import image_url

    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "avatar_url": image_url("/auth/me/avatar", user.avatar_key),
    }


def sign_in(db, user, response):
    token = secrets.token_urlsafe(48)
    db.add(LoginSession(token_hash=digest(token), user_id=user.id, expires_at=now() + timedelta(days=7)))
    db.commit()
    response.set_cookie(
        "lectureloop_session",
        token,
        httponly=True,
        secure=settings().cookie_secure,
        samesite="lax",
        max_age=604800,
        path="/",
    )
    return user_json(user)


@app.post("/api/v1/auth/register", status_code=201)
def register(data: Register, response: Response, db: DB):
    user = User(
        name=data.name.strip(),
        email=str(data.email).lower(),
        password_hash=passwords.hash(data.password),
        role=data.role,
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "An account with this email already exists.")
    return sign_in(db, user, response)


@app.post("/api/v1/auth/login")
def login(data: Login, response: Response, db: DB):
    user = db.scalar(select(User).where(User.email == str(data.email).lower()))
    try:
        passwords.verify(user.password_hash if user else passwords.hash(secrets.token_hex(16)), data.password)
    except (VerificationError, InvalidHashError):
        raise HTTPException(401, "Email or password is incorrect.")
    if not user:
        raise HTTPException(401, "Email or password is incorrect.")
    return sign_in(db, user, response)


@app.get("/api/v1/auth/me")
def me(user: Actor):
    return user_json(user)


@app.post("/api/v1/auth/logout", status_code=204)
def logout(request: Request, response: Response, db: DB):
    session = db.get(LoginSession, digest(request.cookies.get("lectureloop_session", "")))
    if session:
        db.delete(session)
        db.commit()
    response.delete_cookie("lectureloop_session", path="/")


class CourseInput(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    description: str = Field(default="", max_length=3000)
    discoverable: bool = True


def course_json(course, membership=None):
    from .pictures import image_url

    return {
        "banner_url": image_url(f"/courses/{course.id}/banner", course.banner_key)
        if membership and membership.status == "active"
        else None,
        "id": course.id,
        "name": course.name,
        "description": course.description,
        "discoverable": course.discoverable,
        "membership": membership.role if membership and membership.status == "active" else None,
        "membership_status": membership.status if membership else None,
        "settings": course.settings_json if membership and membership.role == "lecturer" else None,
    }


@app.get("/api/v1/courses")
def courses(db: DB, user: Actor):
    rows = db.execute(
        select(Course, Membership)
        .join(Membership)
        .where(Membership.user_id == user.id)
        .order_by(Course.name)
        .limit(100)
    ).all()
    return [course_json(c, m) for c, m in rows]


@app.get("/api/v1/courses/discover")
def discover(db: DB, user: Actor, q: str = ""):
    return [
        course_json(c, db.get(Membership, (c.id, user.id)))
        for c in db.scalars(
            select(Course).where(Course.discoverable.is_(True), Course.name.ilike(f"%{q[:100]}%")).limit(100)
        )
    ]


@app.post("/api/v1/courses", status_code=201)
def create_course(data: CourseInput, db: DB, user: Actor):
    if user.role != "lecturer":
        raise HTTPException(403, "Create courses using a lecturer account.")
    course = Course(**data.model_dump())
    db.add(course)
    db.flush()
    membership = Membership(course_id=course.id, user_id=user.id, role="lecturer")
    db.add(membership)
    db.commit()
    return course_json(course, membership)


@app.get("/api/v1/courses/{cid}")
def get_course(cid: str, db: DB, user: Actor):
    membership = member(db, cid, user)
    return course_json(db.get(Course, cid), membership)


@app.patch("/api/v1/courses/{cid}")
def update_course(cid: str, data: CourseInput, db: DB, user: Actor):
    membership = member(db, cid, user, True)
    course = db.get(Course, cid)
    for key, value in data.model_dump().items():
        setattr(course, key, value)
    db.commit()
    return course_json(course, membership)


@app.delete("/api/v1/courses/{cid}", status_code=204)
def delete_course(cid: str, db: DB, user: Actor):
    member(db, cid, user, True)
    db.delete(db.get(Course, cid))
    db.commit()


from .materials import router as materials_router  # noqa: E402

app.include_router(materials_router)
from .classroom import router as classroom_router  # noqa: E402
from .questions import router as questions_router  # noqa: E402

app.include_router(classroom_router)
app.include_router(questions_router)

from .audio import router as audio_router  # noqa: E402

app.include_router(audio_router)

from .intelligence import router as intelligence_router  # noqa: E402

app.include_router(intelligence_router)

from .pictures import router as pictures_router

app.include_router(pictures_router)

from .diagrams import router as diagrams_router

app.include_router(diagrams_router)

from .bsl import router as bsl_router

app.include_router(bsl_router)
