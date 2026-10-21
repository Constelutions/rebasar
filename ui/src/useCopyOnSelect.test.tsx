import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import { type Settings, defaultSettings } from "./core/api";
import { SettingsProvider } from "./settings/SettingsContext";
import { COPY_DEBOUNCE_MS, COPIED_TOOLTIP_MS, useCopyOnSelect } from "./useCopyOnSelect";

const writeText = vi.fn(async (_text: string) => {});

beforeEach(() => {
  vi.useFakeTimers();
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
});

function Surface() {
  const { ref, tooltip } = useCopyOnSelect<HTMLParagraphElement>();
  return (
    <>
      <p ref={ref}>Copy this text please</p>
      <p>Never copied</p>
      {tooltip}
    </>
  );
}

function CopyButton() {
  const { copy, tooltip } = useCopyOnSelect();
  return (
    <>
      <button type="button" onClick={(event) => copy("0123456789abcdef", event.currentTarget)}>
        Copy hash
      </button>
      {tooltip}
    </>
  );
}

function withSettings(children: ReactNode, copyOnSelect = true) {
  const settings: Settings = { ...defaultSettings, copy: { onSelect: copyOnSelect, hashLength: null } };
  return (
    <SettingsProvider value={{ settings, ready: true, error: null, update: () => {} }}>
      {children}
    </SettingsProvider>
  );
}

function select(text: string, start: number, end: number) {
  const paragraph = screen.getByText(text);
  const range = document.createRange();
  range.setStart(paragraph.firstChild!, start);
  range.setEnd(paragraph.firstChild!, end);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  act(() => {
    document.dispatchEvent(new Event("selectionchange"));
  });
}

async function wait(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

describe("copy on select", () => {
  it("copies exactly the selected text once the debounce has passed and says so in a tooltip", async () => {
    render(withSettings(<Surface />));

    select("Copy this text please", 5, 9);
    expect(writeText).not.toHaveBeenCalled();
    await wait(COPY_DEBOUNCE_MS);

    expect(writeText).toHaveBeenCalledExactlyOnceWith("this");
    expect(screen.getByRole("tooltip")).toHaveTextContent("Copied");
  });

  it("copies only the final selection when the selection keeps changing", async () => {
    render(withSettings(<Surface />));

    select("Copy this text please", 0, 4);
    await wait(COPY_DEBOUNCE_MS / 2);
    select("Copy this text please", 0, 9);
    await wait(COPY_DEBOUNCE_MS / 2);
    select("Copy this text please", 5, 14);
    await wait(COPY_DEBOUNCE_MS);

    expect(writeText).toHaveBeenCalledExactlyOnceWith("this text");
  });

  it("hides the tooltip after a moment", async () => {
    render(withSettings(<Surface />));
    select("Copy this text please", 0, 4);
    await wait(COPY_DEBOUNCE_MS);

    await wait(COPIED_TOOLTIP_MS);

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("ignores a selection made outside its element", async () => {
    render(withSettings(<Surface />));

    select("Never copied", 0, 5);
    await wait(COPY_DEBOUNCE_MS);

    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("ignores a selection that starts inside its element and ends outside it", async () => {
    render(withSettings(<Surface />));
    const inside = screen.getByText("Copy this text please");
    const outside = screen.getByText("Never copied");
    const range = document.createRange();
    range.setStart(inside.firstChild!, 5);
    range.setEnd(outside.firstChild!, 5);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
    });
    await wait(COPY_DEBOUNCE_MS);

    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("copies nothing once the selection is cleared", async () => {
    render(withSettings(<Surface />));
    select("Copy this text please", 0, 4);

    document.getSelection()!.removeAllRanges();
    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
    });
    await wait(COPY_DEBOUNCE_MS);

    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies nothing while copy on select is turned off", async () => {
    render(withSettings(<Surface />, false));

    select("Copy this text please", 0, 4);
    await wait(COPY_DEBOUNCE_MS);

    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("copies given text on request and shows the same tooltip", async () => {
    render(withSettings(<CopyButton />));

    await act(async () => {
      screen.getByRole("button", { name: "Copy hash" }).click();
    });

    expect(writeText).toHaveBeenCalledExactlyOnceWith("0123456789abcdef");
    expect(screen.getByRole("tooltip")).toHaveTextContent("Copied");
  });
});
