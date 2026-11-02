# Tauri 2 with a Rust core, Windows first

The application is a Tauri 2 app: a React + TypeScript UI over a Rust core that owns all Git work. We chose it over Electron (memory and startup cost), a fully native Rust UI (the design is web-native and the toolkits are immature) and .NET Avalonia (thinner Git ecosystem). Alpha targets Windows only; the beta adds Linux (see ADR-0004), and macOS is later.

## Consequences

Tauri renders through WebView2 on Windows and WebKitGTK on Linux. WebKitGTK is the weaker engine for large virtualised lists and diffs, so the Linux performance spike (100k-row commit graph, 5,000-file diff) is a gate for the first Linux beta build. If it misses the thresholds, the fallback order is canvas rendering for the graph and diff, then revisiting the stack.

Platform-specific code (file watching, paths, process spawning, credential storage) stays behind a thin platform layer so Linux does not require reworking the core.
