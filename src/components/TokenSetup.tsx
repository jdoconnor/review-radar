import { useState } from "react";
import { GithubError, fetchGraphQL } from "../lib/github";
import { VIEWER_QUERY } from "../lib/queries";
import type { ResolvedTheme } from "../lib/theme";
import type { ViewerPayload } from "../lib/types";
import { ThemeToggle } from "./ThemeToggle";

interface Props {
  onSave: (token: string) => void;
  theme: ResolvedTheme;
  onToggleTheme: () => void;
}

export function TokenSetup({ onSave, theme, onToggleTheme }: Props) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) {
      setError("Paste a GitHub token first.");
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const result = await fetchGraphQL<ViewerPayload>(trimmed, VIEWER_QUERY, {});
      onSave(trimmed);
      sessionStorage.setItem("review-radar.viewer", result.data.viewer.login);
    } catch (caught) {
      const message =
        caught instanceof GithubError
          ? caught.kind === "auth"
            ? "GitHub rejected that token. A fine-grained token needs read access to the repositories you want to watch."
            : caught.kind === "forbidden"
              ? "That token is valid but is missing a permission. Check its repository access and the read-only permissions listed above."
              : caught.message
          : "Could not validate the token. Check your connection and try again.";
      setError(message);
    } finally {
      setChecking(false);
    }
  };

  return (
    <main className="setup-shell">
      <div className="setup-theme">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>
      <section className="setup-card" aria-labelledby="setup-title">
        <p className="eyebrow">Review Radar</p>
        <h1 id="setup-title">Your review desk, cached locally.</h1>
        <p className="lede">
          Find pull requests waiting on your review, and keep an eye on your own open PRs: approvals,
          CI, conflicts and comments since you last looked.
        </p>

        <form onSubmit={(event) => void submit(event)} className="setup-form">
          <label htmlFor="token">GitHub token</label>
          <input
            id="token"
            name="token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="github_pat_…"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            aria-describedby="token-help token-storage-note"
          />
          <p id="token-help" className="hint">
            Fine-grained token: Pull requests, Issues, Contents, Checks, Commit statuses and Metadata
            (read-only). Add Members (read-only) for team review requests. Classic token:{" "}
            <code>repo</code> and <code>read:org</code>.
          </p>
          <p id="token-storage-note" className="hint" data-testid="token-storage-note">
            The token is stored in this browser, never sent to us, and cleared when you sign out.
            Responses stay in a local cache on this device.
          </p>
          {error ? (
            <p className="error-text" role="alert" data-testid="setup-error">
              {error}
            </p>
          ) : null}
          <button className="button primary" type="submit" disabled={checking}>
            {checking ? "Checking…" : "Start reviewing"}
          </button>
        </form>

        <ul className="setup-points">
          <li>Responses are cached in IndexedDB, so the dashboard opens instantly next time.</li>
          <li>Refresh is rate-limit aware: it backs off instead of burning your quota.</li>
          <li>Nothing is sent anywhere except the GitHub API.</li>
        </ul>
      </section>
    </main>
  );
}
