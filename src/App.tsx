import { Clapperboard } from "lucide-react";
import { GitHubIcon } from "@/components/github-icon";
import { PrivacyBanner } from "@/components/privacy-banner";
import { ThemeToggle } from "@/components/theme-toggle";

export const REPO_URL = "https://github.com/patsissons/take5";

export default function App() {
  return (
    <div className="flex min-h-dvh flex-col">
      <PrivacyBanner />
      <div className="safe-x mx-auto flex w-full max-w-3xl flex-1 flex-col py-10 sm:py-14">
        <header className="mb-10 flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-3 text-4xl font-bold tracking-tight sm:text-5xl">
              <Clapperboard
                aria-hidden
                className="size-9 text-primary sm:size-11"
                strokeWidth={2.5}
              />
              take5
            </h1>
            <p className="mt-3 max-w-xl text-lg text-muted-foreground">
              Five-second AI videos, straight from your browser.
            </p>
          </div>
          <ThemeToggle />
        </header>

        <main className="flex-1">
          <p className="rounded-xl border bg-card p-6 text-muted-foreground">
            Pick a provider, paste your own API key and describe a clip. The
            setup flow is on its way.
          </p>
        </main>

        <footer className="mt-16 flex items-center gap-4 text-sm text-muted-foreground">
          <a
            href={REPO_URL}
            className="inline-flex items-center gap-1.5 hover:text-foreground"
          >
            <GitHubIcon className="size-4" />
            Source on GitHub
          </a>
        </footer>
      </div>
    </div>
  );
}
