import { promises as fs } from "fs";
import path from "path";
import {
  KnowledgeDocument,
  KnowledgeSearchResult,
} from "@/lib/types";

const knowledgeDirectory = path.join(process.cwd(), "content", "knowledge");

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/^>\s+/gm, "")
    .replace(/`/g, "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readField(markdown: string, field: string): string | undefined {
  const expression = new RegExp(`^${field}:\\s*(.+)$`, "mi");
  return expression.exec(markdown)?.[1]?.trim();
}

function readSummary(markdown: string): string {
  const blocks = markdown.split(/\r?\n\r?\n/);
  const paragraph = blocks.find((block) => {
    const normalized = block.trim();
    return (
      normalized.length > 0 &&
      !normalized.startsWith("#") &&
      !normalized.startsWith("Category:") &&
      !normalized.startsWith("Tags:")
    );
  });

  return stripMarkdown(paragraph ?? markdown).slice(0, 220);
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function buildExcerpt(body: string, queryTokens: string[]): string {
  if (queryTokens.length === 0) {
    return body.slice(0, 180);
  }

  const lowerBody = body.toLowerCase();
  const matchIndex =
    queryTokens
      .map((token) => lowerBody.indexOf(token))
      .filter((index) => index >= 0)
      .sort((first, second) => first - second)[0] ?? 0;

  const start = Math.max(0, matchIndex - 48);
  const end = Math.min(body.length, matchIndex + 140);
  const snippet = body.slice(start, end).trim();
  return start > 0 ? `...${snippet}` : snippet;
}

export async function loadKnowledgeDocuments(): Promise<KnowledgeDocument[]> {
  const entries = await fs.readdir(knowledgeDirectory, {
    withFileTypes: true,
  });

  const files = entries.filter(
    (entry) => entry.isFile() && entry.name.endsWith(".md"),
  );

  const documents = await Promise.all(
    files.map(async (file) => {
      const slug = file.name.replace(/\.md$/, "");
      const fullPath = path.join(knowledgeDirectory, file.name);
      const markdown = await fs.readFile(fullPath, "utf8");
      const title =
        markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ??
        slug.replace(/-/g, " ");
      const category = readField(markdown, "Category") ?? "Clinic";
      const tags = (readField(markdown, "Tags") ?? "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);

      return {
        slug,
        title,
        category,
        summary: readSummary(markdown),
        body: stripMarkdown(markdown),
        tags,
      };
    }),
  );

  return documents.sort((first, second) =>
    first.title.localeCompare(second.title),
  );
}

export async function searchKnowledge(
  query: string,
  limit = 4,
): Promise<KnowledgeSearchResult[]> {
  const normalizedQuery = query.trim();
  const documents = await loadKnowledgeDocuments();
  const queryTokens = tokenize(normalizedQuery);

  if (normalizedQuery.length === 0) {
    return documents.slice(0, limit).map((document) => ({
      ...document,
      score: 0,
      excerpt: document.summary,
    }));
  }

  const scored = documents
    .map((document) => {
      const haystack =
        `${document.title} ${document.category} ${document.summary} ${document.tags.join(" ")} ${document.body}`.toLowerCase();

      let score = 0;
      for (const token of queryTokens) {
        if (document.title.toLowerCase().includes(token)) {
          score += 6;
        }
        if (document.category.toLowerCase().includes(token)) {
          score += 4;
        }
        if (document.tags.some((tag) => tag.toLowerCase().includes(token))) {
          score += 5;
        }
        if (document.summary.toLowerCase().includes(token)) {
          score += 3;
        }
        if (haystack.includes(token)) {
          score += 1;
        }
      }

      if (haystack.includes(normalizedQuery.toLowerCase())) {
        score += 8;
      }

      return {
        ...document,
        score,
        excerpt: buildExcerpt(document.body, queryTokens),
      };
    })
    .filter((document) => document.score > 0)
    .sort((first, second) => second.score - first.score);

  return scored.slice(0, limit);
}
