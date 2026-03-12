"use client";

import { useState, useTransition } from "react";
import { KnowledgeSearchResult } from "@/lib/types";

interface KnowledgeSearchProps {
  documentCount: number;
  prompts: string[];
}

export function KnowledgeSearch({
  documentCount,
  prompts,
}: KnowledgeSearchProps) {
  const [query, setQuery] = useState(prompts[0] ?? "");
  const [results, setResults] = useState<KnowledgeSearchResult[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function runSearch(nextQuery: string) {
    setErrorMessage(null);

    startTransition(() => {
      void fetch(`/api/search?q=${encodeURIComponent(nextQuery)}`, {
        method: "GET",
      })
        .then(async (response) => {
          const payload = (await response.json()) as
            | { results: KnowledgeSearchResult[] }
            | { error?: string };

          if (!response.ok) {
            const message = "error" in payload ? payload.error : undefined;
            throw new Error(message ?? "Unable to search clinic content.");
          }

          if ("results" in payload) {
            setResults(payload.results);
          }
        })
        .catch((error: Error) => {
          setErrorMessage(error.message);
          setResults([]);
        });
    });
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    runSearch(query);
  }

  return (
    <section className="panel p-6 md:p-8">
      <div className="relative z-10">
        <div className="flex flex-wrap gap-2">
          <span className="pill">Markdown knowledge base</span>
          <span className="pill">{documentCount} local docs</span>
        </div>

        <h2 className="mt-5 max-w-2xl font-display text-3xl leading-tight text-white md:text-4xl">
          Search clinic context like a lightweight RAG layer
        </h2>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
          Content lives in a directory of markdown files, which keeps the demo
          easy to evolve. You can later ingest documents from MCP search and
          keep this interface exactly as it is.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          {prompts.map((prompt) => (
            <button
              key={prompt}
              className="secondary-button px-4 py-2 text-xs"
              onClick={() => {
                setQuery(prompt);
                runSearch(prompt);
              }}
              type="button"
            >
              {prompt}
            </button>
          ))}
        </div>

        <form className="mt-6 flex flex-col gap-3" onSubmit={handleSubmit}>
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-200">
              Search query
            </span>
            <input
              className="input-shell"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ask about first visits, whitening, financing, or emergencies..."
              value={query}
            />
          </label>

          <div className="flex flex-wrap gap-3">
            <button className="primary-button" disabled={isPending} type="submit">
              {isPending ? "Searching..." : "Search clinic content"}
            </button>
            <p className="self-center text-sm text-slate-400">
              Results are ranked from local `.md` files and returned with short excerpts.
            </p>
          </div>
        </form>

        {errorMessage ? (
          <div className="mt-6 rounded-[24px] border border-rose-400/20 bg-rose-500/10 px-5 py-4 text-sm text-rose-200">
            {errorMessage}
          </div>
        ) : null}

        <div className="mt-6 grid gap-4">
          {results.map((result) => (
            <article
              key={result.slug}
              className="rounded-[24px] border border-white/10 bg-white/[0.05] p-5 transition duration-200 hover:-translate-y-1 hover:border-white/20 hover:bg-white/[0.07]"
            >
              <div className="flex flex-wrap gap-2">
                <span className="pill">{result.category}</span>
                {result.tags.map((tag) => (
                  <span key={tag} className="pill">
                    {tag}
                  </span>
                ))}
              </div>
              <h3 className="mt-4 text-xl font-semibold text-white">
                {result.title}
              </h3>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                {result.excerpt}
              </p>
            </article>
          ))}

          {!isPending && !errorMessage && results.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-white/12 px-5 py-6 text-sm leading-7 text-slate-400">
              Run a search to preview the local knowledge layer.
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
