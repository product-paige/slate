import Firecrawl from "@mendable/firecrawl-js";
import { NextRequest, NextResponse } from "next/server";

const firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY! });

// POST: Start a session (scrape a URL) or interact with an existing session
export async function POST(req: NextRequest) {
  const { url, scrapeId, prompt, code, language, timeout } = await req.json();

  try {
    // If no scrapeId provided, start a new session by scraping the URL
    if (!scrapeId) {
      if (!url) {
        return NextResponse.json(
          { error: "Provide either a url (to start) or scrapeId (to continue)" },
          { status: 400 }
        );
      }

      const scrapeResult = await firecrawl.scrapeUrl(url, {
        formats: ["markdown"],
      });

      if (!scrapeResult.success) {
        return NextResponse.json(
          { error: "Scrape failed", details: scrapeResult },
          { status: 500 }
        );
      }

      const newScrapeId = scrapeResult.scrapeId;
      if (!newScrapeId) {
        return NextResponse.json(
          { error: "No scrapeId returned — interact not supported for this scrape" },
          { status: 500 }
        );
      }

      // If no prompt/code, just return the session info
      if (!prompt && !code) {
        return NextResponse.json({
          success: true,
          scrapeId: newScrapeId,
          markdown: scrapeResult.markdown,
        });
      }

      // Otherwise, scrape + interact in one call
      const interactResult = await interact(newScrapeId, { prompt, code, language, timeout });
      return NextResponse.json({
        success: true,
        scrapeId: newScrapeId,
        markdown: scrapeResult.markdown,
        ...interactResult,
      });
    }

    // Continue an existing session
    if (!prompt && !code) {
      return NextResponse.json(
        { error: "Provide a prompt or code to interact with the session" },
        { status: 400 }
      );
    }

    const interactResult = await interact(scrapeId, { prompt, code, language, timeout });
    return NextResponse.json({
      success: true,
      scrapeId,
      ...interactResult,
    });
  } catch (error) {
    console.error("Firecrawl interact error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: String(error) },
      { status: 500 }
    );
  }
}

// DELETE: Stop an interaction session
export async function DELETE(req: NextRequest) {
  const { scrapeId } = await req.json();

  if (!scrapeId) {
    return NextResponse.json({ error: "scrapeId is required" }, { status: 400 });
  }

  try {
    await fetch(
      `https://api.firecrawl.dev/v2/scrape/${scrapeId}/interact`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
        },
      }
    );

    return NextResponse.json({ success: true, stopped: scrapeId });
  } catch (error) {
    console.error("Firecrawl stop error:", error);
    return NextResponse.json(
      { error: "Failed to stop session", details: String(error) },
      { status: 500 }
    );
  }
}

async function interact(
  scrapeId: string,
  opts: { prompt?: string; code?: string; language?: string; timeout?: number }
) {
  const body: Record<string, unknown> = {};
  if (opts.prompt) body.prompt = opts.prompt;
  if (opts.code) {
    body.code = opts.code;
    if (opts.language) body.language = opts.language;
  }
  if (opts.timeout) body.timeout = opts.timeout;

  const res = await fetch(
    `https://api.firecrawl.dev/v2/scrape/${scrapeId}/interact`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
      },
      body: JSON.stringify(body),
    }
  );

  return res.json();
}
