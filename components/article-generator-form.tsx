"use client";

import { useState, useRef } from "react";
import { ArticleData } from "@/lib/article-generator";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GeneratedArticle {
  id: string;
  topic: string;
  ok: boolean;
  article?: ArticleData;
  sort_order?: number;
  error?: string;
  saveState: "idle" | "saving" | "saved" | "error";
  saveError?: string;
  notion_url?: string;
  // editable overrides
  editTitle: string;
  editSlug: string;
  editMetaTitle: string;
  editMetaDescription: string;
  editShortDescription: string;
  bodyExpanded: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(input: string): string {
  return String(input)
    .toLowerCase()
    .trim()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ArticleGeneratorForm() {
  // Form fields
  const [siteBrand, setSiteBrand] = useState("Mantle Lab");
  const [category, setCategory] = useState("define");
  const [audience, setAudience] = useState(
    "AI builders, indie app founders, early-stage SaaS teams"
  );
  const [voice, setVoice] = useState(
    "clear, practical, operator-style, concise, no fluff"
  );
  const [format, setFormat] = useState("explainer");
  const [wordCount, setWordCount] = useState(800);
  const [topics, setTopics] = useState("");
  const [brainDump, setBrainDump] = useState("");
  const [published, setPublished] = useState(false);

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [articles, setArticles] = useState<GeneratedArticle[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── Generate ────────────────────────────────────────────────────────────────

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const topicList = topics.split("\n").map((t) => t.trim()).filter(Boolean);
    if (topicList.length === 0) {
      setFormError("Enter at least one topic.");
      return;
    }

    setGenerating(true);
    setArticles([]);

    // Fetch Notion context (existing slugs + max sort_order)
    let existingSlugs: string[] = [];
    let nextSortOrder = 1;
    try {
      const ctx = await fetch(`/api/notion-context?category=${category}`);
      const ctxData = await ctx.json();
      existingSlugs = ctxData.slugs ?? [];
      nextSortOrder = (ctxData.max_sort_order ?? 0) + 1;
    } catch {
      // non-fatal — continue without context
    }

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch("/api/generate-articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify({
          site_brand: siteBrand,
          category,
          audience,
          voice,
          format,
          word_count: wordCount,
          topics: topicList,
          brain_dump: brainDump,
          existing_slugs: existingSlugs,
          next_sort_order: nextSortOrder,
          batch_name: `${slugify(siteBrand)}-${Date.now()}`,
        }),
      });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));

            if (event.type === "article") {
              const a = event.article as ArticleData | undefined;
              setArticles((prev) => [
                ...prev,
                {
                  id: crypto.randomUUID(),
                  topic: event.topic,
                  ok: event.ok,
                  article: a,
                  sort_order: event.sort_order,
                  error: event.error,
                  saveState: "idle",
                  editTitle: a?.title ?? "",
                  editSlug: a?.slug ?? "",
                  editMetaTitle: a?.meta_title ?? "",
                  editMetaDescription: a?.meta_description ?? "",
                  editShortDescription: a?.short_description ?? "",
                  bodyExpanded: false,
                },
              ]);
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setFormError(err instanceof Error ? err.message : "Generation failed");
      }
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  };

  // ── Save single article ──────────────────────────────────────────────────────

  const handleSave = async (id: string) => {
    const entry = articles.find((a) => a.id === id);
    if (!entry?.article) return;

    setArticles((prev) =>
      prev.map((a) => (a.id === id ? { ...a, saveState: "saving" } : a))
    );

    const articleToSave: ArticleData = {
      ...entry.article,
      title: entry.editTitle,
      slug: entry.editSlug,
      meta_title: entry.editMetaTitle,
      meta_description: entry.editMetaDescription,
      short_description: entry.editShortDescription,
    };

    try {
      const res = await fetch("/api/save-article", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          article: articleToSave,
          published,
          sort_order: entry.sort_order,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) throw new Error(data.error || "Save failed");

      setArticles((prev) =>
        prev.map((a) =>
          a.id === id
            ? { ...a, saveState: "saved", notion_url: data.notion_url }
            : a
        )
      );
    } catch (err) {
      setArticles((prev) =>
        prev.map((a) =>
          a.id === id
            ? {
                ...a,
                saveState: "error",
                saveError: err instanceof Error ? err.message : "Save failed",
              }
            : a
        )
      );
    }
  };

  // ── Save all ─────────────────────────────────────────────────────────────────

  const handleSaveAll = () => {
    articles
      .filter((a) => a.ok && a.saveState === "idle")
      .forEach((a) => handleSave(a.id));
  };

  const pendingCount = articles.filter(
    (a) => a.ok && a.saveState === "idle"
  ).length;
  const savedCount = articles.filter((a) => a.saveState === "saved").length;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">
      {/* Form */}
      <form onSubmit={handleGenerate} className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Site Brand">
            <input
              type="text"
              value={siteBrand}
              onChange={(e) => setSiteBrand(e.target.value)}
              required
              className={inputClass}
            />
          </Field>
          <Field label="Category">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={inputClass}
            >
              <option value="validate">Validate</option>
              <option value="define">Define</option>
              <option value="build">Build</option>
              <option value="launch">Launch</option>
              <option value="grow">Grow</option>
              <option value="operate">Operate</option>
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Format">
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              className={inputClass}
            >
              <option value="explainer">Explainer</option>
              <option value="tutorial">Tutorial</option>
              <option value="checklist">Checklist</option>
              <option value="opinion">Opinion</option>
            </select>
          </Field>
          <Field label="Word Count">
            <select
              value={wordCount}
              onChange={(e) => setWordCount(Number(e.target.value))}
              className={inputClass}
            >
              <option value={600}>~600 words</option>
              <option value={800}>~800 words</option>
              <option value={1000}>~1000 words</option>
              <option value={1200}>~1200 words</option>
              <option value={1500}>~1500 words</option>
            </select>
          </Field>
        </div>

        <Field label="Audience">
          <input
            type="text"
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Voice">
          <input
            type="text"
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Topics" hint="One per line">
          <textarea
            value={topics}
            onChange={(e) => setTopics(e.target.value)}
            rows={4}
            placeholder={
              "How to write a product one-liner\nHow to define your product scope\nHow to choose your first pricing model"
            }
            required
            className={`${inputClass} resize-none font-mono text-sm`}
          />
        </Field>

        <Field
          label="Research notes"
          hint="Optional — brain dump, sources, examples, angles to include"
        >
          <textarea
            value={brainDump}
            onChange={(e) => setBrainDump(e.target.value)}
            rows={5}
            placeholder={
              "Paste anything here — rough notes, stats, quotes, competitor examples, your own opinions, specific frameworks you want referenced, things to avoid, links..."
            }
            className={`${inputClass} resize-y font-mono text-sm`}
          />
        </Field>

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={published}
              onChange={(e) => setPublished(e.target.checked)}
              className="w-4 h-4 rounded border-input accent-primary cursor-pointer"
            />
            <span className="text-muted-foreground">Mark as published</span>
          </label>

          <div className="flex items-center gap-2">
            {generating && (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="px-4 py-2 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={generating}
              className="px-5 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity cursor-pointer"
            >
              {generating
                ? `Generating… (${articles.length} done)`
                : "Generate Articles"}
            </button>
          </div>
        </div>
      </form>

      {/* Form error */}
      {formError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {formError}
        </div>
      )}

      {/* Results header */}
      {articles.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            <span className="text-foreground font-medium">{articles.length}</span>{" "}
            article{articles.length !== 1 ? "s" : ""} generated
            {savedCount > 0 && (
              <span className="text-green-500 ml-2">· {savedCount} saved</span>
            )}
          </p>
          {pendingCount > 0 && (
            <button
              onClick={handleSaveAll}
              className="px-4 py-1.5 rounded-md border border-border text-sm hover:bg-muted transition-colors cursor-pointer"
            >
              Save all to Notion ({pendingCount})
            </button>
          )}
        </div>
      )}

      {/* Article cards */}
      <div className="space-y-4">
        {articles.map((entry) => (
          <ArticleCard
            key={entry.id}
            entry={entry}
            onSave={() => handleSave(entry.id)}
            onDiscard={() =>
              setArticles((prev) => prev.filter((a) => a.id !== entry.id))
            }
            onChange={(patch) =>
              setArticles((prev) =>
                prev.map((a) => (a.id === entry.id ? { ...a, ...patch } : a))
              )
            }
          />
        ))}
      </div>
    </div>
  );
}

// ─── Article Card ─────────────────────────────────────────────────────────────

function ArticleCard({
  entry,
  onSave,
  onDiscard,
  onChange,
}: {
  entry: GeneratedArticle;
  onSave: () => void;
  onDiscard: () => void;
  onChange: (patch: Partial<GeneratedArticle>) => void;
}) {
  if (!entry.ok) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
        <div className="font-medium text-muted-foreground">{entry.topic}</div>
        <div className="text-destructive text-xs mt-1">{entry.error}</div>
      </div>
    );
  }

  const isSaved = entry.saveState === "saved";
  const isSaving = entry.saveState === "saving";

  return (
    <div
      className={`rounded-md border px-4 py-4 space-y-3 text-sm transition-colors ${
        isSaved ? "border-green-500/30 bg-green-500/5" : "border-border"
      }`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {isSaved ? (
            <span className="text-green-500 font-mono text-xs shrink-0">✓</span>
          ) : (
            <span className="text-muted-foreground font-mono text-xs shrink-0">◦</span>
          )}
          <span className="font-medium truncate">{entry.editTitle || entry.topic}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isSaved && entry.notion_url && (
            <a
              href={entry.notion_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Open in Notion →
            </a>
          )}
          {!isSaved && (
            <>
              <button
                onClick={onDiscard}
                disabled={isSaving}
                className="text-xs text-muted-foreground hover:text-destructive transition-colors cursor-pointer disabled:opacity-40"
              >
                Discard
              </button>
              <button
                onClick={onSave}
                disabled={isSaving}
                className="px-3 py-1 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50 hover:opacity-90 transition-opacity cursor-pointer"
              >
                {isSaving ? "Saving…" : "Save to Notion"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Save error */}
      {entry.saveState === "error" && (
        <div className="text-destructive text-xs">{entry.saveError}</div>
      )}

      {/* Editable fields */}
      {!isSaved && (
        <div className="space-y-2 pt-1">
          <div className="grid grid-cols-2 gap-2">
            <EditField
              label="Title"
              value={entry.editTitle}
              onChange={(v) => onChange({ editTitle: v })}
            />
            <EditField
              label="Slug"
              value={entry.editSlug}
              mono
              onChange={(v) => onChange({ editSlug: v })}
            />
          </div>
          <EditField
            label="Meta title"
            value={entry.editMetaTitle}
            onChange={(v) => onChange({ editMetaTitle: v })}
          />
          <EditField
            label="Meta description"
            value={entry.editMetaDescription}
            onChange={(v) => onChange({ editMetaDescription: v })}
          />
          <EditField
            label="Short description"
            value={entry.editShortDescription}
            onChange={(v) => onChange({ editShortDescription: v })}
          />
        </div>
      )}

      {/* Meta row */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
        <span className="font-mono">{entry.article?.category}</span>
        <span>·</span>
        <span>{entry.article?.read_time} min read</span>
        <span>·</span>
        <span className="font-mono">{entry.article?.focus_keyword}</span>
        {entry.sort_order != null && (
          <>
            <span>·</span>
            <span>order #{entry.sort_order}</span>
          </>
        )}
      </div>

      {/* Body toggle */}
      {entry.article?.body_markdown && (
        <button
          type="button"
          onClick={() => onChange({ bodyExpanded: !entry.bodyExpanded })}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          {entry.bodyExpanded ? "Hide preview ↑" : "Show body preview ↓"}
        </button>
      )}

      {entry.bodyExpanded && entry.article?.body_markdown && (
        <pre className="text-xs text-muted-foreground bg-muted/50 rounded p-3 overflow-auto max-h-64 whitespace-pre-wrap font-mono leading-relaxed">
          {entry.article.body_markdown}
        </pre>
      )}
    </div>
  );
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function EditField({
  label,
  value,
  mono = false,
  onChange,
}: {
  label: string;
  value: string;
  mono?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded border border-input bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring ${
          mono ? "font-mono" : ""
        }`}
      />
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-2">
        <label className="text-sm font-medium">{label}</label>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
