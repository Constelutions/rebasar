import type { GitSetup } from "../core/api";

export function SetupScreen({ setup }: { setup: Exclude<GitSetup, { kind: "ready" }> }) {
  return (
    <main className="setup-screen">
      <h1>Git needs to be installed</h1>
      {setup.kind === "missing" ? (
        <p>Rebasar could not find Git on this computer.</p>
      ) : (
        <p>
          Rebasar found Git {setup.version}, which is too old.
        </p>
      )}
      <p>
        Install Git {setup.minimum} or newer from{" "}
        <a href="https://git-scm.com/downloads/win" target="_blank" rel="noreferrer">
          git-scm.com
        </a>
        , then restart Rebasar. Rebasar runs your own Git, so hooks, signing and credential
        helpers behave as they do in your terminal.
      </p>
    </main>
  );
}
