import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search as SearchIcon } from "lucide-react";
import { api } from "./api";
import { MatchCards, type Match } from "./Questions";
import { Failure } from "./CoursePage";
export default function Search({ courseId }: { courseId: string }) {
  const [value, setValue] = useState(""),
    [query, setQuery] = useState("");
  const results = useQuery({
    queryKey: ["search", courseId, query],
    queryFn: () =>
      api<{ matches: Match[]; warnings: string[] }>(
        `/courses/${courseId}/search?q=${encodeURIComponent(query)}`,
      ),
    enabled: query.trim().length >= 1,
  });
  return (
    <section className="panel">
      <span className="eyebrow">RETURN TO THE EXPLANATION</span>
      <h2 className="spaced">Search your course</h2>
      <p className="muted">
        Find resources, recorded teaching, and public discussions.
      </p>
      <p className="muted small spaced">
        Find sources that explain these concepts, including equivalent wording.
      </p>
      <form
        className="search-form spaced"
        onSubmit={(e) => {
          e.preventDefault();
          if (query === value.trim()) void results.refetch();
          else setQuery(value.trim());
        }}
      >
        <label className="grow">
          Search words
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            minLength={1}
            maxLength={200}
            required
            placeholder="e.g. binary search"
          />
        </label>
        <button className="primary" disabled={results.isFetching}>
          <SearchIcon size={16} />
          {results.isFetching ? "Searching…" : "Search"}
        </button>
      </form>
      <Failure error={results.error} />
      {results.isError && (
        <button className="secondary spaced" onClick={() => results.refetch()}>
          Retry search
        </button>
      )}
      {results.isFetching && (
        <p role="status" className="muted spaced">
          Checking course sources. This can take up to 20 seconds.
        </p>
      )}
      {results.data?.warnings.map((w, i) => (
        <p className="error spaced" key={i}>
          {w}
        </p>
      ))}
      {results.data && results.data.matches.length === 0 && (
        <p className="muted spaced">
          No suitable source found. Try a more specific term or ask your course
          lecturers.
        </p>
      )}
      <MatchCards matches={results.data?.matches || []} />
    </section>
  );
}
