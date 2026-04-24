import { ThemeToggle } from "@/components/theme-toggle";
import { ArticleGeneratorForm } from "@/components/article-generator-form";

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <ThemeToggle />
      <main className="max-w-2xl mx-auto px-6 py-16">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight mb-1">Article Generator</h1>
          <p className="text-muted-foreground text-sm">
            Generate articles with Claude and save them directly to Notion.
          </p>
        </div>
        <ArticleGeneratorForm />
      </main>
    </div>
  );
}
