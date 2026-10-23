import { useEffect, useId, useRef, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { X } from "lucide-react";

// Each opening adds one browser-history entry. Direct links close in place.
export function useDialog() {
  const triggerPrefix = useId();
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const active = params.get("dialog");
  return {
    active,
    open(name: string, trigger?: HTMLElement) {
      const triggerId = trigger?.id || `${triggerPrefix}-${name}`;
      if (trigger) {
        trigger.id = triggerId;
        trigger.focus({ preventScroll: true });
      }
      params.set("dialog", name);
      void navigate(
        { ...location, search: params.toString() },
        {
          state: {
            ...location.state,
            dialogFrom: location.pathname + location.search,
            dialogTrigger: triggerId,
          },
        },
      );
    },
    close() {
      if (location.state?.dialogFrom) {
        void navigate(-1);
      } else {
        params.delete("dialog");
        void navigate(
          { ...location, search: params.toString() },
          { replace: true },
        );
      }
    },
  };
}

export function Dialog({
  title,
  description,
  onClose,
  children,
  className = "",
  initialFocusSelector,
}: {
  className?: string;
  initialFocusSelector?: string;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const location = useLocation();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const previous = (document.getElementById(
      location.state?.dialogTrigger || "",
    ) || document.activeElement) as HTMLElement | null;
    const overflow = document.body.style.overflow;
    dialog.showModal();
    // React autoFocus runs before a closed dialog is visible. Move focus after opening.
    dialog
      .querySelector<HTMLElement>(
        initialFocusSelector ||
          "input:not([type=checkbox]):not([type=hidden]), textarea, select",
      )
      ?.focus();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`app-dialog ${className}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const box = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            onClose();
        }
      }}
    >
      <div className="dialog-header">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description && (
            <p id={descriptionId} className="muted small">
              {description}
            </p>
          )}
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}

export function FormActions({
  onCancel,
  children,
}: {
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <div className="form-actions">
      <button type="button" className="secondary" onClick={onCancel}>
        Cancel
      </button>
      {children}
    </div>
  );
}
