const ANTHROPIC_MODEL = "claude-sonnet-4-6";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const NOTION_API_URL = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function slugify(input: string): string {
  return String(input)
    .toLowerCase()
    .trim()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function chunkText(text: string, maxLength = 1800): string[] {
  const chunks: string[] = [];
  let remaining = text || "";

  while (remaining.length > maxLength) {
    let cut = remaining.lastIndexOf("\n", maxLength);
    if (cut < maxLength * 0.5) cut = remaining.lastIndexOf(" ", maxLength);
    if (cut < 1) cut = maxLength;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }

  if (remaining.length) chunks.push(remaining);
  return chunks;
}

type NotionRichText = { type: "text"; text: { content: string } };

export type NotionBlock = {
  object: "block";
  type: string;
  [key: string]: unknown;
};

function makeRichText(content: string): NotionRichText[] {
  return [{ type: "text", text: { content } }];
}

export function markdownToNotionBlocks(markdown: string): NotionBlock[] {
  const lines = String(markdown || "")
    .replace(/\r\n/g, "\n")
    .split("\n");

  const blocks: NotionBlock[] = [];
  let paragraphBuffer: string[] = [];

  const flushParagraph = () => {
    const text = paragraphBuffer.join("\n").trim();
    if (!text) { paragraphBuffer = []; return; }
    for (const chunk of chunkText(text)) {
      blocks.push({ object: "block", type: "paragraph", paragraph: { rich_text: makeRichText(chunk) } });
    }
    paragraphBuffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (!line.trim()) { flushParagraph(); continue; }

    if (line.startsWith("# ")) {
      flushParagraph();
      blocks.push({ object: "block", type: "heading_1", heading_1: { rich_text: makeRichText(line.slice(2).trim()) } });
      continue;
    }
    if (line.startsWith("## ")) {
      flushParagraph();
      blocks.push({ object: "block", type: "heading_2", heading_2: { rich_text: makeRichText(line.slice(3).trim()) } });
      continue;
    }
    if (line.startsWith("### ")) {
      flushParagraph();
      blocks.push({ object: "block", type: "heading_3", heading_3: { rich_text: makeRichText(line.slice(4).trim()) } });
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      flushParagraph();
      for (const chunk of chunkText(line.replace(/^[-*]\s+/, "").trim())) {
        blocks.push({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: makeRichText(chunk) } });
      }
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      flushParagraph();
      for (const chunk of chunkText(line.replace(/^\d+\.\s+/, "").trim())) {
        blocks.push({ object: "block", type: "numbered_list_item", numbered_list_item: { rich_text: makeRichText(chunk) } });
      }
      continue;
    }

    paragraphBuffer.push(line);
  }

  flushParagraph();
  return blocks;
}

export interface ArticleData {
  title: string;
  slug: string;
  meta_title: string;
  meta_description: string;
  short_description: string;
  focus_keyword: string;
  category: string;
  read_time: number;
  body_markdown: string;
  // optional enrichment fields
  title_ideas?: string[];
  tags?: string[];
  related_questions?: string[];
  faq_schema?: string;
}

export async function callClaudeForArticle({
  topic,
  category,
  audience,
  voice,
  siteBrand,
  brainDump = "",
  wordCount = 800,
  format = "explainer",
  existingSlugs = [],
}: {
  topic: string;
  category: string;
  audience: string;
  voice: string;
  siteBrand: string;
  brainDump?: string;
  wordCount?: number;
  format?: string;
  existingSlugs?: string[];
}): Promise<ArticleData> {
  const formatGuide: Record<string, string> = {
    explainer: "Write a clear explainer. Use H2 sections. Short paragraphs. Prioritize the 'what' and 'why'.",
    tutorial: "Write a step-by-step tutorial. Number each step. Be precise. Show what to do, not just what to think.",
    checklist: "Write a practical checklist article. Use numbered or bulleted items under each H2. Each item should be actionable.",
    opinion: "Write a direct opinion piece. Take a clear stance. Back it up with reasoning and examples. No hedging.",
  };

  const internalLinksSection = existingSlugs.length > 0
    ? `\n\nAvailable slugs for internal links (use real ones only, relative paths like /category/slug):\n${existingSlugs.map(s => `- ${s}`).join("\n")}`
    : "";

  const systemPrompt = `You are a senior content strategist writing practical articles for ${siteBrand}.

Audience: ${audience}
Voice: ${voice}
Format: ${format} — ${formatGuide[format] || formatGuide.explainer}
Target length: ~${wordCount} words in body_markdown

Writing rules:
- No fluff intro — state the value in the first 2 sentences
- Use H2s for sections, H3s for sub-points
- Short paragraphs (2-4 lines max)
- No hype, no buzzwords, no emojis
- Be specific — use numbers, examples, named tools where relevant
- Prioritize actionability over theory
- End with a strong takeaway, not a summary

Return valid JSON only. No markdown fences.

Required JSON shape:
{
  "title": "string — outcome-driven title, no site name",
  "slug": "string — lowercase hyphenated",
  "meta_title": "string — SEO title under 60 chars, include site brand at end",
  "meta_description": "string — under 155 chars, benefit-focused",
  "short_description": "string — 1 plain sentence describing the article",
  "focus_keyword": "string — 2-4 word primary keyword",
  "category": "string — must be one of: validate, define, build, launch, grow, operate",
  "read_time": number,
  "body_markdown": "string — full article in markdown, ~${wordCount} words"
}

Article structure inside body_markdown:
# [Title]

[2-sentence intro — state what this is and why it matters. No 'In this article'.]

## [Section 1]

## [Section 2]

## [Section 3]

## [Section 4 — Common mistakes or pitfalls]

## Final takeaway

---

## FAQ

### [Question]?
[Answer — 2-3 sentences]

### [Question]?
[Answer — 2-3 sentences]
${internalLinksSection}`;

  const userPrompt = `Write one article for ${siteBrand}.

Topic: ${topic}
Category: ${category}${brainDump.trim() ? `\n\nResearch notes, sources, and examples to incorporate:\n${brainDump.trim()}` : ""}`;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY!,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: ANTHROPIC_MODEL,
          max_tokens: 4000,
          temperature: 0.7,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(`Anthropic error (${response.status}): ${JSON.stringify(data)}`);
      }

      const text: string = data?.content?.find((item: { type: string }) => item.type === "text")?.text ?? "";
      if (!text) throw new Error("Anthropic returned no text content.");

      let parsed: ArticleData;
      try {
        const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
        parsed = JSON.parse(cleaned);
      } catch {
        throw new Error(`Claude returned non-JSON output:\n${text}`);
      }

      parsed.slug = parsed.slug ? slugify(parsed.slug) : slugify(parsed.title);
      return parsed;
    } catch (error) {
      lastError = error as Error;
      if (attempt < 3) await sleep(1000 * attempt);
    }
  }

  throw lastError;
}

export async function createNotionPage(article: ArticleData, published = false, sortOrder?: number) {
  const today = new Date().toISOString().split("T")[0];

  const res = await fetch(`${NOTION_API_URL}/pages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
    },
    body: JSON.stringify({
      parent: { database_id: process.env.NOTION_DATABASE_ID },
      properties: {
        title: { title: [{ text: { content: article.title } }] },
        slug: { rich_text: [{ text: { content: article.slug } }] },
        stage: { select: { name: article.category } },
        meta_title: { rich_text: [{ text: { content: article.meta_title } }] },
        meta_description: { rich_text: [{ text: { content: article.meta_description } }] },
        "short description": { rich_text: [{ text: { content: article.short_description } }] },
        focus_keyword: { rich_text: [{ text: { content: article.focus_keyword } }] },
        read_time: { number: Number(article.read_time) || null },
        generated: { select: { name: "TRUE" } },
        edited: { select: { name: "FALSE" } },
        published: { select: { name: published ? "TRUE" : "FALSE" } },
        date: { date: { start: today } },
        thumbnail_index: { number: 0 },
        ...(article.tags?.length ? { tags: { rich_text: [{ text: { content: article.tags.join(", ") } }] } } : {}),
        ...(article.title_ideas?.length ? { "Chart ideas": { rich_text: [{ text: { content: article.title_ideas.join("\n") } }] } } : {}),
        ...(article.related_questions?.length ? { related_articles: { rich_text: [{ text: { content: article.related_questions.join("\n") } }] } } : {}),
        ...(article.faq_schema ? { schema: { rich_text: [{ text: { content: article.faq_schema.slice(0, 2000) } }] } } : {}),
        ...(sortOrder != null ? { sort_order: { number: sortOrder } } : {}),
      },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Notion create page failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return data as { id: string; url: string };
}

export async function appendBlocksToPage(pageId: string, blocks: NotionBlock[]) {
  const batchSize = 50;
  for (let i = 0; i < blocks.length; i += batchSize) {
    const batch = blocks.slice(i, i + batchSize);
    const res = await fetch(`${NOTION_API_URL}/blocks/${pageId}/children`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
        "Content-Type": "application/json",
        "Notion-Version": NOTION_VERSION,
      },
      body: JSON.stringify({ children: batch }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(`Notion append blocks failed (${res.status}): ${JSON.stringify(data)}`);
    }
  }
}
