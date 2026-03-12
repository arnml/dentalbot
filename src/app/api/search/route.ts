import { NextRequest, NextResponse } from "next/server";
import { searchKnowledge } from "@/lib/knowledge-base";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const results = await searchKnowledge(query);

  return NextResponse.json({
    query,
    results,
  });
}
