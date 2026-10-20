import { useEffect, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import { api, useAction } from "./api";
import { Failure } from "./CoursePage";

export default function ImageUpload({
  label,
  endpoint,
  url,
  avatar = false,
  showTitle = true,
}: {
  label: string;
  endpoint: string;
  url?: string | null;
  avatar?: boolean;
  showTitle?: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saved, setSaved] = useState(url || null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setSaved(url || null), [url]);
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const image = URL.createObjectURL(file);
    setPreview(image);
    return () => URL.revokeObjectURL(image);
  }, [file]);
  const upload = useAction(async (selected: File) => {
    const data = new FormData();
    data.set("file", selected);
    return api<{ url: string }>(endpoint, data);
  });
  const remove = useAction(() => api(endpoint, undefined, "DELETE"));
  const busy = upload.isPending || remove.isPending;
  function clear() {
    setFile(null);
    if (input.current) input.current.value = "";
  }
  return (
    <section className="image-editor" aria-label={label}>
      {showTitle && <h3>{label}</h3>}
      <div className={`image-preview ${avatar ? "image-preview-avatar" : ""}`}>
        {preview || saved ? (
          <img src={preview || saved!} alt={`${label} preview`} />
        ) : (
          <span>
            <ImagePlus size={28} />
            <span>No image uploaded</span>
          </span>
        )}
      </div>
      <label className="spaced">
        Choose {label.toLowerCase()}
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={(event) => {
            setFile(event.target.files?.[0] || null);
            upload.reset();
            remove.reset();
          }}
        />
      </label>
      <p className="muted small">
        JPEG, PNG or WebP · up to 5 MB.{" "}
        {avatar
          ? "Displayed as a circle."
          : "Displayed cropped to fit the banner."}
      </p>
      <div className="actions spaced">
        <button
          className="primary"
          type="button"
          disabled={!file || busy}
          onClick={() =>
            file &&
            upload.mutate(file, {
              onSuccess: (result) => {
                setSaved(result.url);
                clear();
              },
            })
          }
        >
          {upload.isPending ? "Uploading…" : "Upload image"}
        </button>
        {saved && (
          <button
            className="secondary"
            type="button"
            disabled={busy}
            onClick={() =>
              remove.mutate(undefined, {
                onSuccess: () => {
                  setSaved(null);
                  clear();
                  upload.reset();
                },
              })
            }
          >
            {remove.isPending ? "Removing…" : "Remove image"}
          </button>
        )}
      </div>
      <Failure error={upload.error || remove.error} />
      {(upload.isSuccess || remove.isSuccess) && (
        <p role="status" className="muted small spaced">
          {remove.isSuccess ? "Image removed." : "Image updated."}
        </p>
      )}
    </section>
  );
}
