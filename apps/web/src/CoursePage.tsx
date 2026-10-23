import { useEffect, useState, type FormEvent } from "react";
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
import {
  api,
  useAction,
  type Course,
  type CourseSettings,
  type User,
} from "./api";
import { QuestionFeed } from "./Questions";
import Search from "./Search";
import ImageUpload from "./ImageUpload";
import { Dialog, FormActions, useDialog } from "./Dialog";
export type Resource = {
  id: string;
  folder_id: string | null;
  original_filename: string;
  kind: string;
  process_status: string;
  error_message: string | null;
  index_status: string;
  extraction_status: string;
  extraction_completed_pages: number;
  extraction_total_pages: number;
  extraction_error: string | null;
  index_error: string | null;
  indexing_enabled: boolean;
  page_count: number;
  size_bytes: number;
};
export type Lecture = {
  banner_url?: string | null;
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
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<User>("/auth/me"),
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
            {me.data?.role === "student" ? (
              <button
                className="primary spaced"
                disabled={join.isPending || c.membership_status === "pending"}
                onClick={() => join.mutate()}
              >
                {c.membership_status === "pending"
                  ? "Request pending"
                  : "Request to join"}
              </button>
            ) : (
              <p className="muted spaced">
                Ask a course lecturer for a lecturer invitation to teach in this
                course.
              </p>
            )}
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
      {course?.banner_url && (
        <img
          className="course-banner"
          src={course.banner_url}
          alt={`${course.name} banner`}
        />
      )}
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
  const { id, teacher } = useCourse();
  const dialog = useDialog();
  const [folder, setFolder] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
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
    (data: { fid: string; name: string; parent_id: string | null }) =>
      api(`/folders/${data.fid}`, data, "PATCH"),
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
  const editingFolder = folders.data?.find(
    (f) => dialog.active === `folder:${f.id}`,
  );
  const managing = resources.data?.find(
    (r) => dialog.active === `resource:${r.id}`,
  );
  const busy =
    edit.isPending || retry.isPending || reindex.isPending || remove.isPending;
  function open(name: string, trigger: HTMLElement) {
    setConfirmDelete(false);
    edit.reset();
    remove.reset();
    retry.reset();
    reindex.reset();
    editFolder.reset();
    deleteFolder.reset();
    createFolder.reset();
    dialog.open(name, trigger);
  }
  return (
    <>
      <div className="row-between section-heading">
        <div>
          <h2>Course resources</h2>
          <p className="muted small">
            Your course library, ready to explore and teach from.
          </p>
        </div>
        {teacher && (
          <button
            className="secondary"
            onClick={(e) => open("create-folder", e.currentTarget)}
          >
            <Plus size={16} />
            New folder
          </button>
        )}
      </div>
      <nav className="breadcrumbs" aria-label="Resource folders">
        <button onClick={() => setFolder(null)}>All resources</button>
        {current && (
          <>
            <span>/</span>
            <button onClick={() => setFolder(current.parent_id)}>
              Parent folder
            </button>
            <span>/ {current.name}</span>
          </>
        )}
      </nav>
      {teacher && (
        <label
          className="dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            upload.mutate(Array.from(e.dataTransfer.files));
          }}
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
      {resources.isPending && (
        <p className="muted spaced" role="status">
          Loading resources…
        </p>
      )}
      <div className="resource-list">
        {folders.data
          ?.filter((f) => f.parent_id === folder)
          .map((f) => (
            <div className="resource-row folder-row" key={f.id}>
              <button className="folder-link" onClick={() => setFolder(f.id)}>
                <FolderIcon size={22} />
                <span>{f.name}</span>
              </button>
              {teacher && (
                <button
                  className="secondary"
                  onClick={(e) => open(`folder:${f.id}`, e.currentTarget)}
                >
                  Edit folder
                </button>
              )}
            </div>
          ))}
        {resources.data
          ?.filter((r) => r.folder_id === folder)
          .map((r) => (
            <article className="resource-row" key={r.id}>
              <span className="resource-icon">
                <FileText size={23} />
              </span>
              <div className="grow">
                <h3>
                  <Link to={`/resources/${r.id}`}>{r.original_filename}</Link>
                </h3>
                <p className="muted small">
                  {r.kind.toUpperCase()} · {(r.size_bytes / 1024).toFixed(0)} KB
                  {r.page_count > 0 && ["pdf", "pptx", "docx"].includes(r.kind)
                    ? ` · ${r.page_count} pages`
                    : ""}
                </p>
                <div className="resource-status">
                  <Status status={r.process_status} />
                  {r.indexing_enabled && r.process_status === "ready" && (
                    <span className="small muted">
                      Search:{" "}
                      {r.extraction_status &&
                      !["ready", "pending"].includes(r.extraction_status)
                        ? `reading pages ${r.extraction_completed_pages}/${r.extraction_total_pages} (${r.extraction_status})`
                        : r.index_status}
                    </span>
                  )}
                  {!r.indexing_enabled && (
                    <span className="small muted">Excluded from search</span>
                  )}
                </div>
                {teacher && r.index_error && (
                  <p className="error">{r.index_error}</p>
                )}
                {r.error_message && <p className="error">{r.error_message}</p>}
                {teacher && r.extraction_error && (
                  <p className="error">{r.extraction_error}</p>
                )}
              </div>
              <div className="resource-actions">
                <Link className="button secondary" to={`/resources/${r.id}`}>
                  {["audio", "video"].includes(r.kind) ? "Play source" : "Open"}
                </Link>
                {teacher && (
                  <button
                    className="secondary"
                    aria-label={`Manage ${r.original_filename}`}
                    onClick={(e) => open(`resource:${r.id}`, e.currentTarget)}
                  >
                    Manage
                  </button>
                )}
              </div>
            </article>
          ))}
      </div>
      {resources.data &&
        !resources.data.some((r) => r.folder_id === folder) &&
        !folders.data?.some((f) => f.parent_id === folder) && (
          <div className="empty panel">
            <FileText />
            <p>
              {teacher
                ? "This folder is empty. Upload files or create a folder to get started."
                : "There are no resources in this folder yet."}
            </p>
          </div>
        )}
      {teacher && dialog.active === "create-folder" && (
        <Dialog
          title="New folder"
          description={`Create a folder in ${current?.name || "All resources"}.`}
          onClose={dialog.close}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createFolder.mutate(
                String(new FormData(e.currentTarget).get("name")),
                { onSuccess: dialog.close },
              );
            }}
          >
            <label>
              Folder name
              <input autoFocus name="name" required maxLength={100} />
            </label>
            <Failure error={createFolder.error} />
            <FormActions onCancel={dialog.close}>
              <button className="primary" disabled={createFolder.isPending}>
                {createFolder.isPending ? "Creating…" : "Create folder"}
              </button>
            </FormActions>
          </form>
        </Dialog>
      )}
      {teacher && editingFolder && (
        <Dialog title="Edit folder" onClose={dialog.close}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              editFolder.mutate(
                {
                  fid: editingFolder.id,
                  name: String(d.get("name")),
                  parent_id: String(d.get("parent")) || null,
                },
                { onSuccess: dialog.close },
              );
            }}
          >
            <label>
              Name
              <input
                autoFocus
                name="name"
                defaultValue={editingFolder.name}
                required
              />
            </label>
            <label>
              Parent folder
              <select
                name="parent"
                defaultValue={editingFolder.parent_id || ""}
              >
                <option value="">All resources</option>
                {folders.data
                  ?.filter((f) => f.id !== editingFolder.id)
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
              </select>
            </label>
            <Failure error={editFolder.error || deleteFolder.error} />
            <FormActions onCancel={dialog.close}>
              <button
                className="primary"
                disabled={editFolder.isPending || deleteFolder.isPending}
              >
                Save changes
              </button>
            </FormActions>
            <div className="dialog-section">
              <p className="muted small">
                Only empty folders can be deleted. Files in other folders are
                unaffected.
              </p>
              <button
                type="button"
                className="danger"
                disabled={deleteFolder.isPending}
                onClick={() =>
                  deleteFolder.mutate(editingFolder.id, {
                    onSuccess: dialog.close,
                  })
                }
              >
                Delete empty folder
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {teacher && managing && (
        <Dialog
          title="Manage resource"
          description={managing.original_filename}
          onClose={dialog.close}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              edit.mutate(
                {
                  ...managing,
                  original_filename: String(d.get("name")),
                  folder_id: String(d.get("folder")) || null,
                  indexing_enabled: d.has("indexed"),
                },
                { onSuccess: dialog.close },
              );
            }}
          >
            <label>
              File name
              <input
                autoFocus
                name="name"
                defaultValue={managing.original_filename}
                required
                maxLength={200}
              />
            </label>
            <label>
              Folder
              <select name="folder" defaultValue={managing.folder_id || ""}>
                <option value="">All resources</option>
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
                defaultChecked={managing.indexing_enabled}
              />
              Include in course search
            </label>
            <Failure
              error={edit.error || retry.error || reindex.error || remove.error}
            />
            <FormActions onCancel={dialog.close}>
              <button className="primary" disabled={busy}>
                {edit.isPending ? "Saving…" : "Save changes"}
              </button>
            </FormActions>
            <div className="dialog-section">
              <h3>Processing & access</h3>
              <p className="muted small">
                Slides/file: {managing.process_status} · Text:{" "}
                {managing.extraction_status} · Search: {managing.index_status}
              </p>
              <div className="actions">
                <a
                  className="button secondary"
                  href={`/api/v1/resources/${managing.id}/download`}
                >
                  Download original
                </a>
                {(managing.process_status === "failed" ||
                  managing.extraction_status === "failed") && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => retry.mutate(managing.id)}
                  >
                    Retry processing
                  </button>
                )}
                <button
                  type="button"
                  className="secondary"
                  disabled={
                    busy ||
                    !managing.indexing_enabled ||
                    managing.process_status !== "ready"
                  }
                  onClick={() => reindex.mutate(managing.id)}
                >
                  {reindex.isPending ? "Requesting…" : "Rebuild search index"}
                </button>
              </div>
              {reindex.isSuccess && (
                <p role="status" className="muted small">
                  Index rebuild queued.
                </p>
              )}
              {retry.isSuccess && (
                <p role="status" className="muted small">
                  Processing retry queued.
                </p>
              )}
            </div>
            <div className="dialog-section">
              <h3>Remove resource</h3>
              <p className="muted small">
                Removes this file from the course library and search. Lectures
                using this deck may prevent deletion.
              </p>
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() => {
                  if (confirmDelete)
                    remove.mutate(managing.id, { onSuccess: dialog.close });
                  else setConfirmDelete(true);
                }}
              >
                <Trash2 size={16} />
                {confirmDelete ? "Confirm delete resource" : "Delete resource…"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
function Lectures() {
  const { id, teacher } = useCourse();
  const [selectedDeck, setSelectedDeck] = useState("");
  const [uploadedId, setUploadedId] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const dialog = useDialog();
  const lectures = useQuery({
    queryKey: ["lectures", id],
    queryFn: () => api<Lecture[]>(`/courses/${id}/lectures`),
    refetchInterval: 5000,
  });
  const resources = useQuery({
    queryKey: ["resources", id],
    queryFn: () => api<Resource[]>(`/courses/${id}/resources`),
    enabled: teacher,
    refetchInterval: uploadedId ? 2000 : false,
  });
  const uploaded = resources.data?.find((r) => r.id === uploadedId);
  useEffect(() => {
    if (uploaded?.process_status === "ready" && uploaded.page_count > 0)
      setSelectedDeck(uploaded.id);
  }, [uploaded?.id, uploaded?.process_status, uploaded?.page_count]);
  const upload = useAction((file: File) => {
    const data = new FormData();
    data.set("file", file);
    return api<Resource>(`/courses/${id}/resources`, data);
  });
  const retry = useAction(() => api(`/resources/${uploadedId}/reprocess`, {}));
  function uploadSlides(file: File) {
    setUploadFile(file);
    upload.mutate(file, {
      onSuccess: (resource) => {
        setUploadedId(resource.id);
        setSelectedDeck("");
      },
    });
  }
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
          <button
            className="primary"
            onClick={(e) => {
              create.reset();
              upload.reset();
              retry.reset();
              setUploadedId(null);
              setUploadFile(null);
              setSelectedDeck("");
              dialog.open("create-lecture", e.currentTarget);
            }}
          >
            <Plus size={17} />
            Create lecture
          </button>
        )}
      </div>
      {teacher && dialog.active === "create-lecture" && (
        <Dialog
          title="Create a lecture"
          description="Choose the slides you will present to your class."
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
              Lecture title
              <input autoFocus name="title" required maxLength={180} />
            </label>
            <label>
              Prepared slide deck
              <select
                name="slide_resource_id"
                required
                value={selectedDeck}
                onChange={(e) => setSelectedDeck(e.target.value)}
              >
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
            <div className="slide-upload spaced">
              <label>
                Upload slides
                <input
                  type="file"
                  accept=".pdf,.ppt,.pptx,application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                  disabled={upload.isPending}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadSlides(file);
                    e.target.value = "";
                  }}
                />
              </label>
              <p className="muted small">
                PDF or PowerPoint. Your file is also saved in Resources. You can
                create the lecture as soon as slides are prepared; search
                indexing can finish later.
              </p>
              {!resources.isPending &&
                !resources.data?.some(
                  (r) =>
                    r.process_status === "ready" &&
                    r.page_count > 0 &&
                    ["pdf", "pptx"].includes(r.kind),
                ) &&
                !uploadedId &&
                !upload.isPending && (
                  <p className="muted small spaced">
                    No prepared slide decks yet. Upload your slides here to get
                    started.
                  </p>
                )}
              {upload.isPending && (
                <p role="status" className="spaced">
                  Uploading slides…
                </p>
              )}
              {uploaded && (
                <p role="status" className="spaced">
                  {uploaded.original_filename} ·{" "}
                  {uploaded.process_status === "ready"
                    ? "Slides ready"
                    : uploaded.process_status === "failed"
                      ? "Slide preparation failed"
                      : "Preparing slides…"}
                </p>
              )}
              {uploaded?.error_message && (
                <p className="error">{uploaded.error_message}</p>
              )}
              {uploaded?.process_status === "failed" && (
                <button
                  type="button"
                  className="secondary spaced"
                  disabled={retry.isPending}
                  onClick={() => retry.mutate()}
                >
                  Retry slide preparation
                </button>
              )}
              {upload.error && uploadFile && (
                <button
                  type="button"
                  className="secondary spaced"
                  disabled={upload.isPending}
                  onClick={() => uploadSlides(uploadFile)}
                >
                  Retry upload
                </button>
              )}
            </div>
            <Failure
              error={
                create.error || resources.error || upload.error || retry.error
              }
            />
            <FormActions onCancel={dialog.close}>
              <button
                className="primary"
                disabled={create.isPending || upload.isPending || !selectedDeck}
              >
                {create.isPending ? "Creating…" : "Create lecture"}
              </button>
            </FormActions>
          </form>
        </Dialog>
      )}
      <Failure error={lectures.error} />
      <div className="spaced">
        {lectures.data?.map((l) => (
          <article className="list-row panel lecture-card" key={l.id}>
            {l.banner_url && (
              <img
                className="lecture-thumbnail"
                src={l.banner_url}
                alt={`${l.title} banner`}
              />
            )}
            <div className="grow">
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
      <Failure
        error={members.error || requests.error || review.error || remove.error}
      />
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
          <Failure error={add.error} />
          {add.isSuccess && (
            <p className="muted small" role="status">
              Member added.
            </p>
          )}
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
          <Failure error={invite.error} />
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
  const dialog = useDialog();
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
      <section className="panel narrow spaced-bottom">
        <ImageUpload
          label="Course banner"
          endpoint={`/courses/${id}/banner`}
          url={course?.banner_url}
        />
      </section>
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
        <Failure error={metadata.error} />
        {metadata.isSuccess && (
          <p className="muted small" role="status">
            Course details saved.
          </p>
        )}
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
        <button
          className="danger"
          onClick={(e) => {
            remove.reset();
            dialog.open("delete-course", e.currentTarget);
          }}
        >
          Delete this course…
        </button>
        {dialog.active === "delete-course" && (
          <Dialog
            title="Delete course"
            description="This permanently removes course records for every member. Type the course name to confirm."
            onClose={dialog.close}
          >
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
                <input
                  autoFocus
                  name="confirmation"
                  required
                  placeholder={course?.name}
                  onChange={(e) =>
                    e.currentTarget.setCustomValidity(
                      e.currentTarget.value === course?.name
                        ? ""
                        : "Enter the exact course name to confirm deletion.",
                    )
                  }
                />
              </label>
              <Failure error={remove.error} />
              <FormActions onCancel={dialog.close}>
                <button className="primary" disabled={remove.isPending}>
                  Permanently delete course records
                </button>
              </FormActions>
            </form>
          </Dialog>
        )}
      </section>
    </>
  );
}
