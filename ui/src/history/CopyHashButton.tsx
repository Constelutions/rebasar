import { Button } from "../components/Button";

interface CopyHashButtonProps {
  commitId: string;
  shortId: string;
  onCopy: (commitId: string, near: Element) => void;
}

/** The highlighted commit id; the row and the detail share it so they copy alike. */
export function CopyHashButton({ commitId, shortId, onCopy }: CopyHashButtonProps) {
  return (
    <Button
      variant="plain"
      className="commit-hash"
      aria-label={`Copy hash ${shortId}`}
      onClick={(event) => {
        event.stopPropagation();
        onCopy(commitId, event.currentTarget);
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {shortId}
    </Button>
  );
}
