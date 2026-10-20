import type { Group, RepositoryEntry } from "../core/api";
import { Button } from "./Button";
import { describeHead } from "./TabStrip";

interface RepositoryRowProps {
  repository: RepositoryEntry;
  groups: Group[];
  onMove: (repository: RepositoryEntry, groupId: string | null) => void;
  onLocate: (repository: RepositoryEntry) => void;
  onRemove: (repository: RepositoryEntry) => void;
}

const UNGROUPED = "";

export function RepositoryRow({
  repository,
  groups,
  onMove,
  onLocate,
  onRemove,
}: RepositoryRowProps) {
  return (
    <li aria-label={repository.name} className="repository">
      <div className="repository-header">
        <span className="repository-name">{repository.name}</span>
        {repository.missing && <span className="missing-badge">missing</span>}
        <span className="repository-path">{repository.path}</span>
        <div className="repository-actions">
          {repository.missing && (
            <>
              <Button
                type="button" size="sm"
                aria-label={`Locate ${repository.name}`}
                onClick={() => onLocate(repository)}
              >
                Locate…
              </Button>
              <Button
                type="button" size="sm"
                aria-label={`Remove ${repository.name}`}
                onClick={() => onRemove(repository)}
              >
                Remove
              </Button>
            </>
          )}
          <select
            aria-label={`Move ${repository.name} to group`}
            value={repository.groupId ?? UNGROUPED}
            className="group-select"
            onChange={(event) => onMove(repository, event.target.value || null)}
          >
            <option value={UNGROUPED}>Ungrouped</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {repository.worktrees.length > 0 && (
        <ul className="worktree-list">
          {repository.worktrees.map((worktree) => (
            <li
              key={worktree.path}
              aria-label={`Worktree ${describeHead(worktree.head)}`}
              className="worktree"
            >
              <span className="tab-head">{describeHead(worktree.head)}</span>
              <span className="repository-path">{worktree.path}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
