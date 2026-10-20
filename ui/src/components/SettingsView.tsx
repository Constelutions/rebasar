import { type FormEvent, useEffect, useId, useState } from "react";

import type { CoreApi, DiffMode, Settings, WhitespaceMode } from "../core/api";
import { describeError } from "../core/describeError";
import { useSettings } from "../settings/SettingsContext";

const codeFontSizes = [11, 12, 13, 14];

export function SettingsView({ api }: { api: CoreApi }) {
  const { settings, error, update } = useSettings();

  return (
    <div className="settings">
      <IdentitySection api={api} />
      <DiffSection settings={settings} update={update} />
      <SyncSection settings={settings} update={update} />
      <AppearanceSection settings={settings} update={update} />
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}

type SectionProps = { settings: Settings; update: (settings: Settings) => void };

function IdentitySection({ api }: { api: CoreApi }) {
  const nameId = useId();
  const emailId = useId();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    api
      .gitIdentity()
      .then((identity) => {
        if (!current) return;
        setName(identity.name ?? "");
        setEmail(identity.email ?? "");
      })
      .catch((failure) => current && setError(describeError(failure)));
    return () => {
      current = false;
    };
  }, [api]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    setError(null);
    try {
      const stored = await api.setGitIdentity({ name, email });
      setName(stored.name ?? "");
      setEmail(stored.email ?? "");
      setSaved(true);
    } catch (failure) {
      setError(describeError(failure));
    }
  }

  function edit(change: () => void) {
    change();
    setSaved(false);
  }

  return (
    <form className="settings-section" aria-label="Git identity" onSubmit={save}>
      <h2>Git identity</h2>
      <p className="settings-hint">Written to your global Git configuration.</p>
      <div className="settings-field">
        <label htmlFor={nameId}>Name</label>
        <input
          id={nameId}
          className="text-input"
          value={name}
          onChange={(event) => edit(() => setName(event.target.value))}
        />
      </div>
      <div className="settings-field">
        <label htmlFor={emailId}>Email</label>
        <input
          id={emailId}
          type="email"
          className="text-input"
          value={email}
          onChange={(event) => edit(() => setEmail(event.target.value))}
        />
      </div>
      <div className="settings-actions">
        <button type="submit" className="button">
          Save identity
        </button>
        {saved && <span role="status">Saved</span>}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  );
}

function DiffSection({ settings, update }: SectionProps) {
  const whitespaceId = useId();
  const modeId = useId();
  const { diff } = settings;

  return (
    <section className="settings-section" aria-labelledby={`${whitespaceId}-title`}>
      <h2 id={`${whitespaceId}-title`}>Diff</h2>
      <div className="settings-field">
        <label htmlFor={whitespaceId}>Whitespace</label>
        <select
          id={whitespaceId}
          className="select"
          value={diff.whitespace}
          onChange={(event) =>
            update({
              ...settings,
              diff: { ...diff, whitespace: event.target.value as WhitespaceMode },
            })
          }
        >
          <option value="show">Show whitespace changes</option>
          <option value="ignoreAll">Ignore all whitespace</option>
        </select>
      </div>
      <div className="settings-field">
        <label htmlFor={modeId}>Default diff mode</label>
        <select
          id={modeId}
          className="select"
          value={diff.defaultMode}
          onChange={(event) =>
            update({
              ...settings,
              diff: { ...diff, defaultMode: event.target.value as DiffMode },
            })
          }
        >
          <option value="unified">Unified</option>
          <option value="sideBySide">Side by side</option>
        </select>
      </div>
    </section>
  );
}

function SyncSection({ settings, update }: SectionProps) {
  const autoId = useId();
  const intervalId = useId();
  const { sync } = settings;

  return (
    <section className="settings-section" aria-labelledby={`${autoId}-title`}>
      <h2 id={`${autoId}-title`}>Sync</h2>
      <div className="settings-field">
        <label htmlFor={autoId}>Fetch the open Tab automatically</label>
        <input
          id={autoId}
          type="checkbox"
          checked={sync.autoFetch}
          onChange={(event) => update({ ...settings, sync: { ...sync, autoFetch: event.target.checked } })}
        />
      </div>
      <div className="settings-field">
        <label htmlFor={intervalId}>Fetch every (minutes)</label>
        <input
          id={intervalId}
          type="number"
          min={1}
          max={120}
          className="text-input"
          disabled={!sync.autoFetch}
          value={sync.fetchIntervalMinutes}
          onChange={(event) => {
            const minutes = Number(event.target.value);
            if (Number.isInteger(minutes) && minutes >= 1) {
              update({ ...settings, sync: { ...sync, fetchIntervalMinutes: minutes } });
            }
          }}
        />
      </div>
    </section>
  );
}

function AppearanceSection({ settings, update }: SectionProps) {
  const fontSizeId = useId();

  return (
    <section className="settings-section" aria-labelledby={`${fontSizeId}-title`}>
      <h2 id={`${fontSizeId}-title`}>Appearance</h2>
      <div className="settings-field">
        <label htmlFor={fontSizeId}>Code font size</label>
        <select
          id={fontSizeId}
          className="select"
          value={settings.appearance.codeFontSize}
          onChange={(event) =>
            update({
              ...settings,
              appearance: { ...settings.appearance, codeFontSize: Number(event.target.value) },
            })
          }
        >
          {codeFontSizes.map((size) => (
            <option key={size} value={size}>
              {size} px
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}
