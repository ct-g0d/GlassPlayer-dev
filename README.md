# GlassPlayer (Desktop Audio Suite)

A high-fidelity desktop audio player featuring progressive liquid-glass UI aesthetics, low-latency playback engine, local history persistence, and comprehensive architectural test validation.

## Architecture
- **Renderer & Layout**: Pure ES module architecture with modular adapters, state stores, and responsive liquid-glass theme overlays.
- **Persistence & Recovery**: Dual-layer history cache with corruption recovery and playback checkpointing.
- **Testing & Governance**: Strict regression harnesses, state ownership audits, and architecture validation suites.

## Development & Testing
```powershell
# Run architecture validation
.\validate-architecture.ps1

# Run build pipeline
.\build.ps1

# Local dev server
node serve.mjs
```
