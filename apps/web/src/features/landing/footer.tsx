export function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl items-center justify-center px-6 py-8">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-foreground text-background text-xs font-bold">
            V
          </div>
          <span className="text-sm text-muted-foreground">
            OneQuery - Autonomous Data Workspace
          </span>
        </div>
      </div>
    </footer>
  );
}
