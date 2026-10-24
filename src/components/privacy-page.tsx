import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { REPO_URL } from "@/lib/links";
import { providers } from "@/providers";

interface Props {
  onDeleteEverything: () => void;
}

/**
 * Everything the app can contact and everything it stores, in one place.
 * The host list is the same one the Content-Security-Policy is built from.
 */
export function PrivacyPage({ onDeleteEverything }: Props) {
  return (
    <article aria-labelledby="privacy-title" className="flex flex-col gap-6">
      <a
        href="#"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> Back
      </a>
      <h2 id="privacy-title" className="text-2xl font-semibold tracking-tight">
        What leaves this browser, and what stays
      </h2>

      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">The only hosts this page can contact</h3>
        <p className="text-sm text-muted-foreground">
          A Content-Security-Policy served with every page lists exactly these
          hosts. The browser refuses any other request, whatever the code tries.
          The app only talks to the provider you picked; the other providers'
          hosts are never contacted.
        </p>
        <ul
          aria-label="Hosts by provider"
          className="grid gap-2 sm:grid-cols-2"
        >
          {providers.map((provider) => (
            <li
              key={provider.id}
              className="rounded-lg border bg-card p-3 text-sm"
            >
              <p className="font-medium">{provider.label}</p>
              <ul className="mt-1 text-muted-foreground">
                {provider.hosts.map((host) => (
                  <li key={host}>
                    <code>{host}</code>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">
          No analytics, no cookies, no third-party scripts or fonts, and no
          referrer is sent to the provider.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">What is stored on this device</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">Your API key</strong>, per
            provider, in this browser's localStorage, or in sessionStorage (gone
            when the tab closes) when "Remember on this device" is off.
          </li>
          <li>
            <strong className="text-foreground">Settings</strong>: the chosen
            provider, whether you are making videos or images, the last model
            per provider for each, a cached copy of each provider's model lists,
            and the theme.
          </li>
          <li>
            <strong className="text-foreground">Runs</strong>: each prompt, its
            settings and images, the provider's job reference while it is in
            flight, the finished video or image and a thumbnail, in IndexedDB.
          </li>
        </ul>
        <p className="text-sm text-muted-foreground">
          Nothing is sent anywhere else, so nothing can be recovered if you
          delete it.
        </p>
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">Use on phone</strong> moves your
          settings and keys inside the QR code's link, encrypted with a code you
          type on the phone, and your history as a file you send across yourself
          (it holds no keys). Neither goes through a server.
        </p>
        <div>
          <Button
            type="button"
            variant="destructive"
            onClick={onDeleteEverything}
          >
            Delete everything
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">Check for yourself</h3>
        <p className="text-sm text-muted-foreground">
          The source is public at{" "}
          <a href={REPO_URL} className="underline hover:text-foreground">
            {REPO_URL.replace("https://", "")}
          </a>
          . Open your browser's network tab while generating a clip: every
          request goes to the provider you picked.
        </p>
      </section>
    </article>
  );
}
