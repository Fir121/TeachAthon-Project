import { useState, type FormEvent } from "react";
import {
  Link,
  NavLink,
  Route,
  Routes,
  useParams,
  useNavigate,
} from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  Plus,
  Upload,
  Folder as FolderIcon,
  FileText,
  ArrowRight,
  Trash2,
} from "lucide-react";
import { api, useAction, type Course, type CourseSettings } from "./api";
import { QuestionFeed } from "./Questions";
import Search from "./Search";
export type Resource = {
  id: string;
  folder_id: string | null;
  original_filename: string;
  kind: string;
  process_status: string;
  error_message: string | null;
  index_status: string;
  index_error: string | null;
  indexing_enabled: boolean;
  page_count: number;
  size_bytes: number;
};
export type Lecture = {
  id: string;
  title: string;
  slide_resource_id: string;
  session?: { id: string; state: string } | null;
};
export type Folder = { id: string; name: string; parent_id: string | null };
export function Status({ status }: { status: string }) {
  return <span className={`status ${status}`}>{status}</span>;
}
export function Failure({ error }: { error: Error | null }) {
  return error ? (
    <p className="error" role="alert">
      {error.message}
    </p>
  ) : null;
}
export function useCourse() {
  const { id } = useParams();
  const q = useQuery({
    queryKey: ["course", id],
    queryFn: () => api<Course>(`/courses/${id}`),
  });
  return {
    id: id!,
    course: q.data,
    query: q,
    teacher: q.data?.membership === "lecturer",
  };
}
export default function CoursePage() {
  const { id, course, query, teacher } = useCourse();
  const discover = useQuery({
    queryKey: ["discover"],
    queryFn: () => api<Course[]>("/courses/discover"),
    enabled: !!query.error,
  });
  const join = useAction(() => api(`/courses/${id}/join-requests`, {}));
  if (query.isPending) return <p role="status">Loading course…</p>;
  if (query.error) {
    const c = discover.data?.find((c) => c.id === id);
    return (
      <>
        <Link className="back" to="/">
          ← All courses
        </Link>
        {c ? (
          <section className="panel">
            <h1>{c.name}</h1>
            <p>{c.description}</p>
            <p className="muted spaced">
              Course content is available to enrolled members.
            </p>
            <button
              className="primary spaced"
              disabled={join.isPending || c.membership_status === "pending"}
              onClick={() => join.mutate()}
            >
              {c.membership_status === "pending"
                ? "Request pending"
                : "Request to join"}
            </button>
            <Failure error={join.error} />
          </section>
        ) : (
          <Failure error={query.error} />
        )}
      </>
    );
  }
  return (
    <>
      <Link className="back" to="/">
        ← All courses
      </Link>
      <div className="course-heading">
        <span className="course-symbol">
          <BookOpen size={28} />
        </span>
        <div>
          <span className="eyebrow">
            {teacher ? "TEACHING WORKSPACE" : "YOUR COURSE"}
          </span>
          <h1>{course!.name}</h1>
          <p className="muted">{course!.description}</p>
        </div>
      </div>
      <nav className="tabs" aria-label="Course navigation">
        {[
          ["", "Overview"],
          ["lectures", "Lectures"],
          ["resources", "Resources"],
          ["discussions", "Discussions"],
          ["search", "Search"],
          ...(teacher
            ? [
                ["members", "Members"],
                ["settings", "Settings"],
              ]
            : []),
        ].map(([path, label]) => (
          <NavLink key={path} end to={`/courses/${id}/${path}`}>
            {label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Overview />} />
        <Route path="resources" element={<Resources />} />
        <Route path="lectures" element={<Lectures />} />
        <Route
          path="discussions"
          element={<QuestionFeed courseId={id} teacher={teacher} />}
        />
        <Route path="search" element={<Search courseId={id} />} />
        <Route path="members" element={<Members />} />
        <Route path="settings" element={<Settings />} />
      </Routes>
    </>
  );
}
function Overview() {
  const { id, teacher } = useCourse();
  return (
    <div className="overview-grid">
      <section className="panel welcome-panel">
        <span className="eyebrow">ROOM FOR UNDERSTANDING</span>
        <h2>Keep the conversation going.</h2>
        <p className="muted">
          Follow your lecture, ask the question on your mind, and return to the
          teaching that made it click.
        </p>
        <Link className="primary spaced" to={`/courses/${id}/lectures`}>
          Go to lectures <ArrowRight size={16} />
        </Link>
      </section>
      <section className="panel">
        <h2>{teacher ? "Prepare your next lecture" : "Your course library"}</h2>
        <p className="muted spaced">
          {teacher
            ? "Upload a PDF or PowerPoint. Once the slides are ready, create your lecture and bring everyone into the room."
            : "Course resources and shared explanations stay in one place."}
        </p>
        <Link
          className="button secondary spaced"
          to={`/courses/${id}/resources`}
        >
          Open resources
        </Link>
      </section>
    </div>
  );
}
function Resources() {
  const { id, teacher } = useCourse(),
    [folder, setFolder] = useState<string | null>(null),
    [addFolder, setAddFolder] = useState(false),
    [preview, setPreview] = useState<Resource | null>(null),
    [page, setPage] = useState(0);
  const resources = useQuery({
    queryKey: ["resources", id],
    queryFn: () => api<Resource[]>(`/courses/${id}/resources`),
    refetchInterval: 3000,
  });
  const folders = useQuery({
    queryKey: ["folders", id],
    queryFn: () => api<Folder[]>(`/courses/${id}/folders`),
  });
  const upload = useAction((files: File[]) =>
    Promise.all(
      files.map((file) => {
        const data = new FormData();
        data.set("file", file);
        if (folder) data.set("folder_id", folder);
        return api(`/courses/${id}/resources`, data);
      }),
    ),
  );
  const createFolder = useAction((name: string) =>
    api(`/courses/${id}/folders`, { name, parent_id: folder }),
  );
  const editFolder = useAction(
    ({
      fid,
      name,
      parent_id,
    }: {
      fid: string;
      name: string;
      parent_id: string | null;
    }) => api(`/folders/${fid}`, { name, parent_id }, "PATCH"),
  );
  const deleteFolder = useAction((fid: string) =>
    api(`/folders/${fid}`, undefined, "DELETE"),
  );
  const retry = useAction((rid: string) =>
    api(`/resources/${rid}/reprocess`, {}),
  );
  const reindex = useAction((rid: string) =>
    api(`/resources/${rid}/reindex`, {}),
  );
  const remove = useAction((rid: string) =>
    api(`/resources/${rid}`, undefined, "DELETE"),
  );
  const edit = useAction((r: Resource) =>
    api(
      `/resources/${r.id}`,
      {
        original_filename: r.original_filename,
        folder_id: r.folder_id,
        indexing_enabled: r.indexing_enabled,
      },
      "PATCH",
    ),
  );
  const current = folders.data?.find((f) => f.id === folder);
  function uploadDrop(e: React.DragEvent) {
    e.preventDefault();
    if (teacher) upload.mutate(Array.from(e.dataTransfer.files));
  }
  return (
    <>
      <div className="row-between">
        <div>
          <h2>Course resources</h2>
          <p className="muted small">A shared library for your learning.</p>
        </div>
        {teacher && (
          <button
            className="secondary"
            onClick={() => setAddFolder(!addFolder)}
          >
            <Plus size={16} />
            New folder
          </button>
        )}
      </div>
      <div className="breadcrumbs">
        <button onClick={() => setFolder(null)}>All resources</button>
        {current && (
          <>
            {" "}
            /{" "}
            <button onClick={() => setFolder(current.parent_id)}>
              Parent folder
            </button>{" "}
            / {current.name}
          </>
        )}
      </div>
      {addFolder && (
        <form
          className="panel inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            createFolder.mutate(
              String(new FormData(e.currentTarget).get("name")),
              { onSuccess: () => setAddFolder(false) },
            );
          }}
        >
          <label>
            Folder name
            <input name="name" required />
          </label>
          <button className="primary" disabled={createFolder.isPending}>
            Create folder
          </button>
        </form>
      )}
      {teacher && (
        <label
          className="dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={uploadDrop}
        >
          <Upload size={25} />
          <strong>
            {upload.isPending
              ? "Uploading…"
              : "Drop files here, or choose files"}
          </strong>
          <span>
            PDF, PowerPoint, Word, text, JSON, MP3 or MP4 · up to 100 MB
          </span>
          <input
            type="file"
            aria-label="Upload resources"
            multiple
            disabled={upload.isPending}
            accept=".pdf,.ppt,.pptx,.doc,.docx,.txt,.json,.mp3,.mp4"
            onChange={(e) => {
              upload.mutate(Array.from(e.target.files || []));
              e.target.value = "";
            }}
          />
        </label>
      )}
      <Failure error={upload.error || resources.error || folders.error} />
      <div className="resource-list">
        {folders.data
          ?.filter((f) => f.parent_id === folder)
          .map((f) => (
            <div className="resource-row" key={f.id}>
              <button className="folder-link" onClick={() => setFolder(f.id)}>
                <FolderIcon size={22} />
                {f.name}
              </button>
              {teacher && (
                <details>
                  <summary>Edit folder</summary>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const d = new FormData(e.currentTarget);
                      editFolder.mutate({
                        fid: f.id,
                        name: String(d.get("name")),
                        parent_id: String(d.get("parent")) || null,
                      });
                    }}
                  >
                    <label>
                      Name
                      <input name="name" defaultValue={f.name} required />
                    </label>
                    <label>
                      Parent
                      <select name="parent" defaultValue={f.parent_id || ""}>
                        <option value="">Root</option>
                        {folders.data
                          ?.filter((p) => p.id !== f.id)
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <button className="secondary">Save</button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => deleteFolder.mutate(f.id)}
                    >
                      Delete empty folder
                    </button>
                  </form>
                </details>
              )}
            </div>
          ))}
        {resources.data
          ?.filter((r) => r.folder_id === folder)
          .map((r) => (
            <article className="resource-row" key={r.id}>
              <FileText size={23} />
              <div className="grow">
                <h3>{r.original_filename}</h3>
                <span className="muted small">
                  {r.kind.toUpperCase()} · {(r.size_bytes / 1024).toFixed(0)} KB{" "}
                  {r.page_count > 0 && `· ${r.page_count} pages`}
                </span>
                <div>
                  <Status status={r.process_status} />
                  {r.indexing_enabled && r.process_status === "ready" && (
                    <span className="small muted">
                      {" "}
                      · search index: {r.index_status}
                    </span>
                  )}
                </div>
                {teacher && r.index_error && (
                  <p className="error">{r.index_error}</p>
                )}
                {r.error_message && <p className="error">{r.error_message}</p>}
              </div>
              <div className="resource-actions">
                {["audio", "video"].includes(r.kind) && (
                  <Link className="button secondary" to={`/resources/${r.id}`}>
                    Play source
                  </Link>
                )}
                {r.page_count > 0 &&
                  ["pdf", "pptx", "docx"].includes(r.kind) && (
                    <button
                      className="secondary"
                      onClick={() => {
                        setPreview(r);
                        setPage(0);
                      }}
                    >
                      Preview
                    </button>
                  )}
                <a
                  className="button secondary"
                  href={`/api/v1/resources/${r.id}/download`}
                >
                  Download
                </a>
                {teacher && (
                  <details>
                    <summary>Manage</summary>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const d = new FormData(e.currentTarget);
                        edit.mutate({
                          ...r,
                          original_filename: String(d.get("name")),
                          folder_id: String(d.get("folder")) || null,
                          indexing_enabled: d.has("indexed"),
                        });
                      }}
                    >
                      <label>
                        Name
                        <input
                          name="name"
                          defaultValue={r.original_filename}
                          required
                        />
                      </label>
                      <label>
                        Folder
                        <select name="folder" defaultValue={r.folder_id || ""}>
                          <option value="">Root</option>
                          {folders.data?.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="check">
                        <input
                          type="checkbox"
                          name="indexed"
                          defaultChecked={r.indexing_enabled}
                        />
                        Include in course search
                      </label>
                      <button className="secondary" disabled={edit.isPending}>
                        Save
                      </button>
                      {r.process_status === "failed" && (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => retry.mutate(r.id)}
                        >
                          Retry processing
                        </button>
                      )}
                      <button
                        type="button"
                        className="secondary"
                        disabled={reindex.isPending}
                        onClick={() => reindex.mutate(r.id)}
                      >
                        Retry search indexing
                      </button>
                      <button
                        className="danger"
                        type="button"
                        onClick={() => remove.mutate(r.id)}
                      >
                        <Trash2 size={15} />
                        Delete resource
                      </button>
                    </form>
                  </details>
                )}
              </div>
            </article>
          ))}
      </div>
      {resources.data?.length === 0 && (
        <div className="empty panel">
          <FileText />
          <p>
            No resources yet. Uploaded files will appear here with their
            processing status.
          </p>
        </div>
      )}
      {preview && (
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-label="Resource preview"
        >
          <section className="panel">
            <div className="row-between">
              <h2>{preview.original_filename}</h2>
              <button className="secondary" onClick={() => setPreview(null)}>
                Close
              </button>
            </div>
            <img
              className="slide"
              alt={`Page ${page + 1}`}
              src={`/api/v1/resources/${preview.id}/pages/${page}`}
            />
            <div className="row-between">
              <button
                className="secondary"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </button>
              <span>
                {page + 1} / {preview.page_count}
              </span>
              <button
                className="secondary"
                disabled={page + 1 >= preview.page_count}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
function Lectures() {
  const { id, teacher } = useCourse(),
    [creating, setCreating] = useState(false);
  const lectures = useQuery({
    queryKey: ["lectures", id],
    queryFn: () => api<Lecture[]>(`/courses/${id}/lectures`),
    refetchInterval: 5000,
  });
  const resources = useQuery({
    queryKey: ["resources", id],
    queryFn: () => api<Resource[]>(`/courses/${id}/resources`),
    enabled: teacher,
  });
  const create = useAction((data: Record<string, FormDataEntryValue>) =>
    api(`/courses/${id}/lectures`, data),
  );
  return (
    <>
      <div className="row-between">
        <div>
          <h2>Lectures</h2>
          <p className="muted small">Learn live. Revisit what matters.</p>
        </div>
        {teacher && (
          <button className="primary" onClick={() => setCreating(!creating)}>
            <Plus size={17} />
            Create lecture
          </button>
        )}
      </div>
      {creating && (
        <form
          className="panel spaced"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(Object.fromEntries(new FormData(e.currentTarget)), {
              onSuccess: () => setCreating(false),
            });
          }}
        >
          <label>
            Lecture title
            <input name="title" required />
          </label>
          <label>
            Prepared slide deck
            <select name="slide_resource_id" required>
              <option value="">Choose a processed deck</option>
              {resources.data
                ?.filter(
                  (r) =>
                    r.process_status === "ready" &&
                    r.page_count > 0 &&
                    ["pdf", "pptx"].includes(r.kind),
                )
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.original_filename}
                  </option>
                ))}
            </select>
          </label>
          <p className="muted small">
            Upload a PDF or PowerPoint in Resources first. Live slides require a
            prepared deck.
          </p>
          <button className="primary" disabled={create.isPending}>
            Create lecture
          </button>
        </form>
      )}
      <Failure error={lectures.error} />
      <div className="spaced">
        {lectures.data?.map((l) => (
          <article className="list-row panel" key={l.id}>
            <div>
              <h3>{l.title}</h3>
              <p className="muted small">
                {l.session?.state || "Prepared slides"}
              </p>
            </div>
            <Link
              className="button secondary"
              to={l.session ? `/sessions/${l.session.id}` : `/lectures/${l.id}`}
            >
              {l.session?.state === "live"
                ? "Join live"
                : l.session?.state === "ended"
                  ? "Replay"
                  : "Open lecture"}
              <ArrowRight size={16} />
            </Link>
          </article>
        ))}
      </div>
      {lectures.data?.length === 0 && (
        <div className="empty panel spaced">
          <BookOpen />
          <p>No lectures yet.</p>
        </div>
      )}
    </>
  );
}
function Members() {
  const { id, teacher } = useCourse(),
    [inviteLink, setInviteLink] = useState("");
  const members = useQuery({
    queryKey: ["members", id],
    queryFn: () =>
      api<{ id: string; name: string; email: string; role: string }[]>(
        `/courses/${id}/members`,
      ),
    enabled: teacher,
  });
  const requests = useQuery({
    queryKey: ["requests", id],
    queryFn: () =>
      api<{ id: string; name: string; email: string }[]>(
        `/courses/${id}/join-requests`,
      ),
    enabled: teacher,
  });
  const add = useAction((d: Record<string, FormDataEntryValue>) =>
    api(`/courses/${id}/members`, d),
  );
  const invite = useAction((d: Record<string, FormDataEntryValue>) =>
    api<{ url: string }>(`/courses/${id}/invitations`, d),
  );
  const review = useAction(
    ({ uid, decision }: { uid: string; decision: string }) =>
      api(`/courses/${id}/join-requests/${uid}/${decision}`, {}),
  );
  const remove = useAction((uid: string) =>
    api(`/courses/${id}/members/${uid}`, undefined, "DELETE"),
  );
  if (!teacher) return <p>Only course lecturers can manage members.</p>;
  return (
    <>
      <h2>People & access</h2>
      <section className="panel spaced">
        <h3>Join requests</h3>
        {requests.data?.length === 0 && (
          <p className="muted">No pending requests.</p>
        )}
        {requests.data?.map((r) => (
          <div className="list-row" key={r.id}>
            <div>
              {r.name}
              <small className="muted"> {r.email}</small>
            </div>
            <div className="actions">
              <button
                className="secondary"
                onClick={() =>
                  review.mutate({ uid: r.id, decision: "approve" })
                }
              >
                Approve
              </button>
              <button
                className="text-button"
                onClick={() => review.mutate({ uid: r.id, decision: "reject" })}
              >
                Reject
              </button>
            </div>
          </div>
        ))}
      </section>
      <div className="overview-grid spaced">
        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate(Object.fromEntries(new FormData(e.currentTarget)));
          }}
        >
          <h3>Add an existing account</h3>
          <label>
            Email
            <input type="email" name="email" required />
          </label>
          <label>
            Course role
            <select name="role">
              <option value="student">Student</option>
              <option value="lecturer">Lecturer</option>
            </select>
          </label>
          <button className="primary" disabled={add.isPending}>
            Add member
          </button>
        </form>
        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            const d = Object.fromEntries(new FormData(e.currentTarget));
            if (!d.email) delete d.email;
            invite.mutate(d, { onSuccess: (r) => setInviteLink(r.url) });
          }}
        >
          <h3>Create an invitation</h3>
          <label>
            Email restriction (optional)
            <input type="email" name="email" />
          </label>
          <label>
            Course role
            <select name="role">
              <option value="student">Student</option>
              <option value="lecturer">Lecturer</option>
            </select>
          </label>
          <button className="primary" disabled={invite.isPending}>
            Create link
          </button>
          {inviteLink && (
            <label>
              Share this one-use link
              <input
                readOnly
                value={inviteLink}
                onFocus={(e) => e.target.select()}
              />
            </label>
          )}
        </form>
      </div>
      <section className="panel spaced">
        <h3>Course members</h3>
        {members.data?.map((m) => (
          <div className="list-row" key={m.id}>
            <div>
              <strong>{m.name}</strong>
              <p className="muted small">
                {m.email} · {m.role}
              </p>
            </div>
            <button className="text-button" onClick={() => remove.mutate(m.id)}>
              Remove
            </button>
          </div>
        ))}
      </section>
    </>
  );
}
function Settings() {
  const { id, course, teacher } = useCourse();
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();
  const metadata = useAction((data: Record<string, FormDataEntryValue>) =>
    api(
      `/courses/${id}`,
      {
        name: data.name,
        description: data.description,
        discoverable: data.discoverable === "on",
      },
      "PATCH",
    ),
  );
  const remove = useAction(() => api(`/courses/${id}`, undefined, "DELETE"));
  const save = useAction((data: CourseSettings) =>
    api(`/courses/${id}/settings`, data, "PATCH"),
  );
  if (!teacher) return <p>Only lecturers can change course settings.</p>;
  return (
    <>
      <form
        className="panel narrow"
        onSubmit={(e) => {
          e.preventDefault();
          metadata.mutate(Object.fromEntries(new FormData(e.currentTarget)));
        }}
      >
        <h2>Course details</h2>
        <label>
          Course name
          <input
            name="name"
            defaultValue={course?.name}
            required
            maxLength={150}
          />
        </label>
        <label>
          Description
          <textarea
            name="description"
            defaultValue={course?.description}
            maxLength={3000}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            name="discoverable"
            defaultChecked={course?.discoverable}
          />
          Allow students to discover and request this course
        </label>
        <button className="primary" disabled={metadata.isPending}>
          Save course details
        </button>
      </form>
      <form
        className="panel narrow spaced"
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          save.mutate({
            poll_mode: String(
              d.get("poll_mode"),
            ) as CourseSettings["poll_mode"],
            poll_cooldown_seconds: Number(d.get("cooldown")),
            generated_answers: d.has("generated"),
          });
        }}
      >
        <h2>Course settings</h2>
        <label>
          Automatic understanding polls
          <select name="poll_mode" defaultValue={course?.settings?.poll_mode}>
            <option value="manual">Manual only</option>
            <option value="auto">At AI topic checkpoints</option>
            <option value="suggested">Suggest checkpoints to lecturer</option>
            <option value="end-only">End of lecture</option>
          </select>
        </label>
        <label>
          Minimum time between automatic polls (seconds)
          <input
            name="cooldown"
            type="number"
            min={60}
            max={3600}
            defaultValue={course?.settings?.poll_cooldown_seconds || 180}
          />
        </label>
        <label className="check">
          <input
            name="generated"
            type="checkbox"
            defaultChecked={course?.settings?.generated_answers}
          />
          Enable short AI answers grounded in course sources
        </label>
        <p className="muted small">
          Source references remain available without generated answers. Poll
          settings are copied when a lecture starts; changes apply to future
          sessions.
        </p>
        <button className="primary" disabled={save.isPending}>
          Save settings
        </button>
        <Failure error={save.error} />
        {save.isSuccess && <p role="status">Settings saved.</p>}
      </form>
      <section className="panel narrow spaced">
        <h3>Delete course</h3>
        <p className="muted small spaced">
          This removes course access, lectures, discussions and database records
          for all members. Media may remain in private storage for recovery.
        </p>
        <button className="danger" onClick={() => setDeleting(!deleting)}>
          Delete this course…
        </button>
        {deleting && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (
                String(new FormData(e.currentTarget).get("confirmation")) ===
                course?.name
              )
                remove.mutate(undefined, { onSuccess: () => navigate("/") });
            }}
          >
            <label>
              Type the course name to confirm
              <input name="confirmation" required />
            </label>
            <button className="primary" disabled={remove.isPending}>
              Permanently delete course records
            </button>
          </form>
        )}
      </section>
    </>
  );
}
