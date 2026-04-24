import { NextRequest } from "next/server";
import { callClaudeForArticle, sleep, slugify } from "@/lib/article-generator";

export async function POST(request: NextRequest) {
  const {
    batch_name,
    site_brand = "Mantle Lab",
    audience = "AI builders, indie app founders, early-stage SaaS teams",
    voice = "clear, practical, operator-style, concise, no fluff",
    category = "define",
    topics = [],
    brain_dump = "",
    word_count = 800,
    format = "explainer",
    existing_slugs = [],
    next_sort_order = 1,
  } = await request.json();

  if (!Array.isArray(topics) || topics.length === 0) {
    return new Response(JSON.stringify({ error: "topics must be a non-empty array" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();

  const send = async (data: object) => {
    await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  };

  (async () => {
    try {
      for (let i = 0; i < topics.length; i++) {
        const topic = topics[i];
        try {
          const article = await callClaudeForArticle({
            topic,
            category,
            audience,
            voice,
            siteBrand: site_brand,
            brainDump: brain_dump,
            wordCount: word_count,
            format,
            existingSlugs: existing_slugs,
          });

          await send({
            type: "article",
            topic,
            ok: true,
            article,
            sort_order: next_sort_order + i,
          });
        } catch (error) {
          await send({
            type: "article",
            topic,
            ok: false,
            error: (error as Error).message,
          });
        }

        if (i < topics.length - 1) await sleep(500);
      }

      await send({
        type: "done",
        batch_name: batch_name || `batch-${slugify(site_brand)}-${Date.now()}`,
      });
    } finally {
      try { await writer.close(); } catch { /* client disconnected */ }
    }
  })();

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
