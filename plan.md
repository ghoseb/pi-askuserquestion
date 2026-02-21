## Summary

I verified the project plan against the actual pi APIs and found **one critical issue** plus several minor refinements:

### 🔴 Critical Finding
**`matchesKey` requires raw terminal escape sequences, NOT `Key.*` identifiers as input data.** `Key.down` is just `"down"` (an identifier), not `"\x1b[B"` (the escape sequence). The ARCHITECTURE.md test examples that pass `Key.down` to `handleInput()` would silently fail — no keys would match. All 6 test todos have been updated with an `INPUT` constant map using correct escape sequences.

### Refinements Made to Todos
- **TODO-ebce08fd** (setup): Use `pnpm` not `npm`, add `vitest.config.ts` with resolve aliases for peer deps, add smoke test
- **TODO-f0705cca** (handleInput): Added critical key matching documentation
- **TODO-b17cbd60 through TODO-37719af2** (all test todos): Updated to use `INPUT.*` escape sequence constants

### No New Todos Needed
The 14 existing todos comprehensively cover setup → schema → component → extension → tests → visual testing → e2e. Coverage is complete.

### Plan written to
`/Users/bg/Code/src/pi-askuserquestion/plan.md`