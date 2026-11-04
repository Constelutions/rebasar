import type { Group, RepositoryEntry } from "../core/api";
import { Button } from "./Button";
import { TruncatedText } from "./TruncatedText";
import { Select } from "./FormControls";

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
        <TruncatedText className="repository-name" text={repository.name} />
        {repository.missing && <span className="missing-badge">missing</span>}
        <TruncatedText path className="repository-path" text={repository.path} />
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
          <Select
            aria-label={`Move ${repository.name} to group`}
            value={repository.groupId ?? UNGROUPED}
            onChange={(event) => onMove(repository, event.target.value || null)}
          >
            <option value={UNGROUPED}>Ungrouped</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </li>
  );
}
