import { QueryClient, useMutation } from "@tanstack/react-query";
import { create } from "zustand";
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 10_000 } },
});
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T = unknown>(
  path: string,
  data?: unknown,
  method?: string,
): Promise<T> {
  const form = data instanceof FormData;
  const r = await fetch(`/api/v1${path}`, {
    credentials: "same-origin",
    method: method ?? (data === undefined ? "GET" : "POST"),
    headers: data && !form ? { "Content-Type": "application/json" } : undefined,
    body: data === undefined ? undefined : form ? data : JSON.stringify(data),
  });
  if (!r.ok) {
    const e = await r
      .json()
      .catch(() => ({ message: "The server is unavailable. Please retry." }));
    throw new ApiError(r.status, e.message || "Request failed.");
  }
  return r.status === 204 ? (undefined as T) : r.json();
}
export type User = {
  id: string;
  name: string;
  email: string;
  role: "lecturer" | "student";
};
export type Course = {
  id: string;
  name: string;
  description: string;
  discoverable: boolean;
  membership: "lecturer" | "student" | null;
  membership_status: string | null;
  settings: CourseSettings | null;
};
export type CourseSettings = {
  poll_mode: "manual" | "auto" | "suggested" | "end-only";
  poll_cooldown_seconds: number;
  generated_answers: boolean;
};
export const useUI = create<{
  notice: string;
  setNotice: (notice: string) => void;
}>()((set) => ({ notice: "", setNotice: (notice) => set({ notice }) }));
export function useAction<T, V>(fn: (variables: V) => Promise<T>) {
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries();
    },
    onError: (e) => useUI.getState().setNotice(e.message),
  });
}
