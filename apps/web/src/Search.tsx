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
    enabled: query.length >= 3,
  });
  return (
    <section className="panel">
      <span className="eyebrow">RETURN TO THE EXPLANATION</span>
      <h2 className="spaced">Search your course</h2>
      <p className="muted">
        Find passages from resources, recorded teaching, and public discussions.
      </p>
      <form
        className="search-form spaced"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(value);
        }}
      >
        <label className="grow">
          Search words or a question
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            minLength={3}
            maxLength={8000}
            required
            placeholder="e.g. Why is binary search logarithmic?"
          />
        </label>
        <button className="primary" disabled={results.isFetching}>
          <SearchIcon size={16} />
          {results.isFetching ? "Searching…" : "Search"}
        </button>
      </form>
      <Failure error={results.error} />
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
