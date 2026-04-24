import { NextRequest, NextResponse } from "next/server";
import {
  createNotionPage,
  appendBlocksToPage,
  markdownToNotionBlocks,
  ArticleData,
} from "@/lib/article-generator";

export async function POST(request: NextRequest) {
  const { article, published = false, sort_order } = await request.json() as {
    article: ArticleData;
    published: boolean;
    sort_order?: number;
  };

  try {
    const page = await createNotionPage(article, published, sort_order);
    const blocks = markdownToNotionBlocks(article.body_markdown);
    if (blocks.length) await appendBlocksToPage(page.id, blocks);

    return NextResponse.json({ ok: true, page_id: page.id, notion_url: page.url });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
