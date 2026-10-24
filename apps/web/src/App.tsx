import { useEffect, useState, type FormEvent } from "react";
import {
  Link,
  Route,
  Routes,
  useNavigate,
  useLocation,
  useParams,
} from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  ArrowRight,
  Plus,
  LogOut,
  GraduationCap,
} from "lucide-react";
import {
  api,
  ApiError,
  queryClient,
  useAction,
  useUI,
  type User,
  type Course,
} from "./api";
import { Dialog, FormActions, useDialog } from "./Dialog";
import CoursePage from "./CoursePage";
import Live, { LectureSetup, Join, Invite } from "./Live";
import Replay from "./Replay";
import ResourcePlayer from "./ResourcePlayer";
import ImageUpload from "./ImageUpload";
import Brand from "./Brand";
export function ErrorBox({ error }: { error: Error | null }) {
  return error ? (
    <p role="alert" className="error">
      {error.message}
    </p>
  ) : null;
}
export function Loading() {
  return (
    <p role="status" className="muted">
      Loading your workspace…
    </p>
  );
}
export function Auth() {
  const [signup, setSignup] = useState(false);
  const action = useAction((data: Record<string, FormDataEntryValue>) =>
    api<User>(`/auth/${signup ? "register" : "login"}`, data),
  );
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    action.mutate(Object.fromEntries(new FormData(e.currentTarget)));
  }
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <Brand />
        <div>
          <span className="eyebrow">A LITTLE MORE CONNECTION</span>
          <h1>
            Great teaching.
            <br />A lasting conversation.
          </h1>
          <p>
            Bring questions into the room. Keep the explanation long after the
            lecture.
          </p>
        </div>
        <p className="small">Built around the people who teach and learn.</p>
      </section>
      <section className="auth-form">
        <span className="eyebrow">YOUR CLASSROOM, CONNECTED</span>
        <h2>{signup ? "Make yourself at home" : "Welcome back"}</h2>
        <p className="muted">
          {signup
            ? "Create an account to join the conversation."
            : "Sign in to pick up where you left off."}
        </p>
        <form onSubmit={submit}>
          {signup && (
            <label>
              Your name
              <input name="name" required maxLength={100} autoComplete="name" />
            </label>
          )}
          <label>
            Email address
            <input name="email" type="email" required autoComplete="email" />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              required
              minLength={signup ? 10 : 1}
              autoComplete={signup ? "new-password" : "current-password"}
            />
          </label>
          {signup && (
            <label>
              I am a
              <select name="role">
                <option value="student">Student</option>
                <option value="lecturer">Lecturer</option>
              </select>
            </label>
          )}
          <ErrorBox error={action.error} />
          <button className="primary" disabled={action.isPending}>
            {action.isPending
              ? "Please wait…"
              : signup
                ? "Create account"
                : "Sign in"}
            <ArrowRight size={17} />
          </button>
        </form>
        <button
          className="text-button"
          onClick={() => {
            setSignup(!signup);
            action.reset();
          }}
        >
          {signup
            ? "Already have an account? Sign in"
            : "New here? Create an account"}
        </button>
      </section>
    </main>
  );
}
export function Dashboard({ user }: { user: User }) {
  const courses = useQuery({
    queryKey: ["courses"],
    queryFn: () => api<Course[]>("/courses"),
  });
  const dialog = useDialog();
  const create = useAction((data: Record<string, FormDataEntryValue>) =>
    api<Course>("/courses", data),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR WORKSPACE</span>
          <h1>Hello, {user.name.split(" ")[0]}.</h1>
          <p className="muted">A good question can change the whole lecture.</p>
        </div>
        {user.role === "lecturer" && (
          <button
            className="primary"
            onClick={(e) => {
              create.reset();
              dialog.open("create-course", e.currentTarget);
            }}
          >
            <Plus size={17} />
            Create course
          </button>
        )}
      </div>
      {user.role === "lecturer" && dialog.active === "create-course" && (
        <Dialog
          title="Create a course"
          description="A shared space for your lectures, resources and class discussions."
          onClose={dialog.close}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate(Object.fromEntries(new FormData(e.currentTarget)), {
                onSuccess: dialog.close,
              });
            }}
          >
            <label>
              Course name
              <input
                name="name"
                required
                maxLength={150}
                autoFocus
                placeholder="e.g. Introduction to Computer Science"
              />
            </label>
            <label>
              Description
              <textarea
                name="description"
                maxLength={3000}
                placeholder="What will your students learn?"
              />
            </label>
            <ErrorBox error={create.error} />
            <FormActions onCancel={dialog.close}>
              <button className="primary" disabled={create.isPending}>
                {create.isPending ? "Creating…" : "Create"}
              </button>
            </FormActions>
          </form>
        </Dialog>
      )}
      <h2 className="section-title">
        <GraduationCap size={22} />
        Your courses
      </h2>
      {courses.isPending ? <Loading /> : <ErrorBox error={courses.error} />}
      <div className="course-grid">
        {courses.data
          ?.filter((c) => c.membership)
          .map((c, i) => (
            <Link className="course-card" key={c.id} to={`/courses/${c.id}`}>
              <div className={`course-art tint-${i % 3}`}>
                {c.banner_url ? (
                  <img src={c.banner_url} alt="" />
                ) : (
                  <BookOpen size={40} />
                )}
                <span>
                  {c.membership === "lecturer" ? "Teaching" : "Learning"}
                </span>
              </div>
              <div className="course-info">
                <h3>{c.name}</h3>
                <p className="muted">
                  {c.description || "A space for shared understanding."}
                </p>
                <span className="card-link">
                  Open course <ArrowRight size={16} />
                </span>
              </div>
            </Link>
          ))}
      </div>
      {courses.data?.length === 0 && (
        <div className="empty panel">
          <BookOpen />
          <h3>Your next conversation starts here</h3>
          <p>
            {user.role === "lecturer"
              ? "Create your first course, or ask a colleague for a lecturer invitation."
              : "Discover a course and request access from its teaching team."}
          </p>
        </div>
      )}
      <Link className="button secondary spaced" to="/join">
        Join a live lecture by code
      </Link>
      {user.role === "student" && <Discover />}
    </>
  );
}
function Discover() {
  const q = useQuery({
    queryKey: ["discover"],
    queryFn: () => api<Course[]>("/courses/discover"),
  });
  return (
    <section className="panel spaced">
      <h2>Discover courses</h2>
      <p className="muted">
        Find a course and request access from its teaching team.
      </p>
      {q.data
        ?.filter((c) => !c.membership)
        .map((c) => (
          <div className="list-row" key={c.id}>
            <div>
              <h3>{c.name}</h3>
              <p className="muted">{c.description}</p>
            </div>
            <Link className="button secondary" to={`/courses/${c.id}`}>
              View course
            </Link>
          </div>
        ))}
    </section>
  );
}
export default function App() {
  const profileDialog = useDialog();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<User>("/auth/me"),
  });
  const notice = useUI((s) => s.notice),
    setNotice = useUI((s) => s.setNotice);
  const navigate = useNavigate();
  const location = useLocation();
  const dialogOpen = new URLSearchParams(location.search).has("dialog");
  useEffect(() => {
    setNotice("");
  }, [location.key, setNotice]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 8000);
    return () => window.clearTimeout(timer);
  }, [notice, setNotice]);
  const logout = useAction(async () => {
    await api("/auth/logout", {}, "POST");
    queryClient.clear();
    navigate("/");
  });
  if (me.isPending)
    return (
      <main className="shell">
        <Loading />
      </main>
    );
  if (me.error && (!(me.error instanceof ApiError) || me.error.status !== 401))
    return (
      <main className="shell">
        <h1>Unable to reach your workspace</h1>
        <ErrorBox error={me.error} />
        <button className="primary spaced" onClick={() => void me.refetch()}>
          Retry connection
        </button>
      </main>
    );
  if (!me.data) return <Auth />;
  return (
    <>
      <header className="topbar">
        <Brand />
        <div className="account">
          <button
            className="avatar avatar-button"
            aria-label="Your profile"
            onClick={(event) =>
              profileDialog.open("profile", event.currentTarget)
            }
          >
            {me.data.avatar_url ? (
              <img src={me.data.avatar_url} alt="Your profile picture" />
            ) : (
              me.data.name.slice(0, 1)
            )}
          </button>
          <span>
            {me.data.name}
            <small>{me.data.role}</small>
          </span>
          <button
            className="icon-button"
            aria-label="Sign out"
            onClick={() => logout.mutate()}
          >
            <LogOut size={19} />
          </button>
        </div>
      </header>
      {profileDialog.active === "profile" && (
        <Dialog title="Your profile" onClose={profileDialog.close}>
          <p className="muted">
            {me.data.name} · {me.data.email}
          </p>
          <ImageUpload
            label="Profile picture"
            endpoint="/auth/me/avatar"
            url={me.data.avatar_url}
            avatar
          />
        </Dialog>
      )}
      {notice && !dialogOpen && (
        <div className="notice" role="alert">
          {notice}
          <button
            onClick={() => setNotice("")}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      )}
      <main className="shell">
        <Routes>
          <Route path="/" element={<Dashboard user={me.data} />} />
          <Route path="/courses/:id/*" element={<CoursePage />} />
          <Route path="/lectures/:id" element={<LectureSetup />} />
          <Route path="/sessions/:id" element={<Live />} />
          <Route path="/recordings/:id" element={<Replay />} />
          <Route path="/resources/:id" element={<ResourcePlayer />} />
          <Route path="/join/:code?" element={<Join />} />
          <Route path="/invite/:token" element={<Invite />} />
          <Route
            path="*"
            element={
              <p>
                Page not found. <Link to="/">Go to your courses</Link>
              </p>
            }
          />
        </Routes>
      </main>
    </>
  );
}
