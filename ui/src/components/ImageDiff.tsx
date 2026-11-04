import { useState } from "react";

import type { ImageSide } from "../core/api";
import { Button } from "./Button";
import { formatBytes } from "./formatBytes";

interface ImageDiffProps {
  before: ImageSide | null;
  after: ImageSide | null;
  onLoad: () => void;
}

export function ImageDiff({ before, after, onLoad }: ImageDiffProps) {
  const sides = [
    { label: "Before", side: before },
    { label: "After", side: after },
  ];
  const hasUnloaded = sides.some(({ side }) => side !== null && side.data === null);

  return (
    <div className="image-diff">
      <div className="image-sides">
        {sides.map(({ label, side }) => side && <ImagePane key={label} label={label} side={side} />)}
      </div>
      {hasUnloaded && (
        <Button type="button" onClick={onLoad}>
          Load image
        </Button>
      )}
    </div>
  );
}

function ImagePane({ label, side }: { label: string; side: ImageSide }) {
  const [pixels, setPixels] = useState<{ width: number; height: number } | null>(null);

  return (
    <figure className="image-side" aria-label={label}>
      <figcaption>
        <strong>{label}</strong>
        <span>{formatBytes(side.bytes)}</span>
        {pixels && (
          <span>
            {pixels.width} × {pixels.height} px
          </span>
        )}
      </figcaption>
      {side.data !== null ? (
        <div className="image-frame">
          <img
            alt={`${label} image`}
            src={`data:${side.mime};base64,${side.data}`}
            onLoad={(event) =>
              setPixels({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
          />
        </div>
      ) : (
        <p className="placeholder">This image is large, so it is not loaded automatically.</p>
      )}
    </figure>
  );
}
