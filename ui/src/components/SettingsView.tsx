import { type FormEvent, useEffect, useId, useState } from "react";

import type {
  ConfirmTabClose,
  CoreApi,
  DiffMode,
  GitIdentity,
  Settings,
  Tab,
  WhitespaceMode,
} from "../core/api";
import { describeError } from "../core/describeError";
import { useSettings } from "../settings/SettingsContext";
import { Button } from "./Button";
import { SegmentedControl } from "./SegmentedControl";

const codeFontSizes = [11, 12, 13, 14];

type SettingsScope = "global" | "repository";

interface SettingsViewProps {
  api: CoreApi;
  /** The Tab in front; the Repository Scope is its Repository, shared by all its Worktrees. */
  tab: Tab | undefined;
}

export function SettingsView({ api, tab }: SettingsViewProps) {
  const [scope, setScope] = useState<SettingsScope>("global");
  const showing = scope === "repository" && tab ? "repository" : "global";

  return (
    <div className="settings">
      <SegmentedControl
        label="Scope"
        options={[
          { value: "global", label: "Global" },
          { value: "repository", label: "Repository", disabled: !tab },
        ]}
        value={showing}
        onChange={setScope}
      />
      {showing === "repository" && tab ? (
        <RepositorySettings api={api} tab={tab} />
      ) : (
        <GlobalSettings api={api} />
      )}
    </div>
  );
}

/** Each Scope is a list of sections; a new setting adds its section or row to the Scope it belongs to. */
function GlobalSettings({ api }: { api: CoreApi }) {
  const { settings, error, update } = useSettings();

  return (
    <>
      <IdentitySection api={api} />
      <DiffSection settings={settings} update={update} />
      <SyncSection settings={settings} update={update} />
      <TabsSection settings={settings} update={update} />
      <HistorySection settings={settings} update={update} />
      <CopySection settings={settings} update={update} />
      <AppearanceSection settings={settings} update={update} />
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </>
  );
}

function RepositorySettings({ api, tab }: { api: CoreApi; tab: Tab }) {
  return (
    <>
      <p className="settings-hint">
        These settings belong to {tab.repositoryName} and apply to all of its Worktrees.
      </p>
      <IdentitySection key={tab.worktreePath} api={api} worktreePath={tab.worktreePath} />
    </>
  );
}

type SectionProps = { settings: Settings; update: (settings: Settings) => void };

const noIdentity: GitIdentity = { name: null, email: null };

/** The Git identity at the Global Scope, or at the Repository Scope when given a Worktree of it. */
function IdentitySection({ api, worktreePath }: { api: CoreApi; worktreePath?: string }) {
  const nameId = useId();
  const emailId = useId();
  const [stored, setStored] = useState<GitIdentity>(noIdentity);
  const [global, setGlobal] = useState<GitIdentity>(noIdentity);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function show(identity: GitIdentity) {
    setStored(identity);
    setName(identity.name ?? "");
    setEmail(identity.email ?? "");
  }

  useEffect(() => {
    let current = true;
    const loading = worktreePath
      ? Promise.all([api.repositoryGitIdentity(worktreePath), api.gitIdentity()])
      : api.gitIdentity().then((identity) => [identity, noIdentity] as const);
    loading
      .then(([identity, inherited]) => {
        if (!current) return;
        show(identity);
        setGlobal(inherited);
      })
      .catch((failure) => current && setError(describeError(failure)));
    return () => {
      current = false;
    };
  }, [api, worktreePath]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    setError(null);
    try {
      show(
        worktreePath
          ? await api.setRepositoryGitIdentity(worktreePath, { name, email })
          : await api.setGitIdentity({ name, email }),
      );
      setSaved(true);
    } catch (failure) {
      setError(describeError(failure));
    }
  }

  function edit(change: () => void) {
    change();
    setSaved(false);
  }

  function inheritance(field: "name" | "email") {
    if (!worktreePath) return null;
    const applies = global[field] ?? "not set";
    return (
      <p className="settings-hint">
        {stored[field] === null
          ? `Inherits the global ${field}: ${applies}`
          : `Overrides the global ${field}: ${applies}`}
      </p>
    );
  }

  return (
    <form className="settings-section" aria-label="Git identity" onSubmit={save}>
      <h2>Git identity</h2>
      <p className="settings-hint">
        {worktreePath
          ? "Written to this Repository's Git configuration. Leave a value empty to use the global one."
          : "Written to your global Git configuration."}
      </p>
      <div className="settings-field">
        <label htmlFor={nameId}>Name</label>
        <input
          id={nameId}
          className="text-input"
          value={name}
          placeholder={worktreePath ? (global.name ?? "") : undefined}
          onChange={(event) => edit(() => setName(event.target.value))}
        />
        {inheritance("name")}
      </div>
      <div className="settings-field">
        <label htmlFor={emailId}>Email</label>
        <input
          id={emailId}
          type="email"
          className="text-input"
          value={email}
          placeholder={worktreePath ? (global.email ?? "") : undefined}
          onChange={(event) => edit(() => setEmail(event.target.value))}
        />
        {inheritance("email")}
      </div>
      <div className="settings-actions">
        <Button variant="primary" type="submit">
          Save identity
        </Button>
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

const confirmCloseOptions: { value: ConfirmTabClose; label: string }[] = [
  { value: "always", label: "Always" },
  { value: "whenLost", label: "When something would be lost" },
  { value: "never", label: "Never" },
];

function TabsSection({ settings, update }: SectionProps) {
  const confirmId = useId();
  const restoreId = useId();
  const { tabs } = settings;

  return (
    <section className="settings-section" aria-labelledby={`${confirmId}-title`}>
      <h2 id={`${confirmId}-title`}>Tabs</h2>
      <div className="settings-field">
        <label htmlFor={confirmId}>Confirm before closing a Tab</label>
        <select
          id={confirmId}
          className="select"
          value={tabs.confirmClose}
          onChange={(event) =>
            update({
              ...settings,
              tabs: { ...tabs, confirmClose: event.target.value as ConfirmTabClose },
            })
          }
        >
          {confirmCloseOptions.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="settings-field">
        <label htmlFor={restoreId}>Restore Tabs on launch</label>
        <input
          id={restoreId}
          type="checkbox"
          checked={tabs.restoreOnLaunch}
          onChange={(event) =>
            update({ ...settings, tabs: { ...tabs, restoreOnLaunch: event.target.checked } })
          }
        />
      </div>
    </section>
  );
}

function HistorySection({ settings, update }: SectionProps) {
  const mineId = useId();
  const mergesId = useId();
  const branchesId = useId();
  const { history } = settings;

  return (
    <section className="settings-section" aria-labelledby={`${mineId}-title`}>
      <h2 id={`${mineId}-title`}>History filters</h2>
      <p className="settings-hint">What History shows when you open it.</p>
      <div className="settings-field">
        <label htmlFor={mineId}>Show only my commits</label>
        <input
          id={mineId}
          type="checkbox"
          checked={history.mine}
          onChange={(event) => update({ ...settings, history: { ...history, mine: event.target.checked } })}
        />
      </div>
      <div className="settings-field">
        <label htmlFor={mergesId}>Show only merge commits</label>
        <input
          id={mergesId}
          type="checkbox"
          checked={history.merges}
          onChange={(event) => update({ ...settings, history: { ...history, merges: event.target.checked } })}
        />
      </div>
      <div className="settings-field">
        <label htmlFor={branchesId}>Branches</label>
        <select
          id={branchesId}
          className="select"
          value={history.allBranches ? "all" : "current"}
          onChange={(event) =>
            update({ ...settings, history: { ...history, allBranches: event.target.value === "all" } })
          }
        >
          <option value="all">All branches</option>
          <option value="current">Current branch</option>
        </select>
      </div>
    </section>
  );
}

function CopySection({ settings, update }: SectionProps) {
  const onSelectId = useId();
  const { copy } = settings;

  return (
    <section className="settings-section" aria-labelledby={`${onSelectId}-title`}>
      <h2 id={`${onSelectId}-title`}>Copy</h2>
      <div className="settings-field">
        <label htmlFor={onSelectId}>Copy selected text automatically</label>
        <input
          id={onSelectId}
          type="checkbox"
          checked={copy.onSelect}
          onChange={(event) => update({ ...settings, copy: { ...copy, onSelect: event.target.checked } })}
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
