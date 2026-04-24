import { NextRequest, NextResponse } from "next/server";

const NOTION_API_URL = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

export async function GET(request: NextRequest) {
  const category = request.nextUrl.searchParams.get("category") || "";

  try {
    const res = await fetch(
      `${NOTION_API_URL}/databases/${process.env.NOTION_DATABASE_ID}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
          "Content-Type": "application/json",
          "Notion-Version": NOTION_VERSION,
        },
        body: JSON.stringify({
          filter: category
            ? { property: "category", select: { equals: category } }
            : undefined,
          sorts: [{ property: "sort_order", direction: "descending" }],
          page_size: 100,
        }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json({ slugs: [], max_sort_order: 0 });
    }

    const slugs: string[] = [];
    let maxSortOrder = 0;

    for (const page of data.results ?? []) {
      const slug = page.properties?.slug?.rich_text?.[0]?.text?.content;
      if (slug) slugs.push(slug);
      const sortOrder = page.properties?.sort_order?.number ?? 0;
      if (sortOrder > maxSortOrder) maxSortOrder = sortOrder;
    }

    return NextResponse.json({ slugs, max_sort_order: maxSortOrder });
  } catch {
    return NextResponse.json({ slugs: [], max_sort_order: 0 });
  }
}
