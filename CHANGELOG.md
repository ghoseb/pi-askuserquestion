# Changelog

All notable changes to this project are documented in this file.

## [1.0.0] - 2026-11-11

### Features

- Implement src/schema.ts with TypeBox schemas for input and result
- Implement component.ts skeleton — QuestionState, constructor, helpers
- Implement component.ts render() — tab bar, options list, inline editor
- Implement component.ts handleInput() — full keyboard routing and navigation
- Implement src/index.ts — extension entry point with registerTool
- Write full test suite (67 tests) and fix 3 bugs — resolved guard, Submit tab state, Editor mock
- Add /test-ask dev command gated behind --test-ask flag
- Deregister tool via setActiveTools when called without UI
- Add ←→ arrow keys for tab navigation; update help text in question and Submit footers
- Show answer snippet in tab bar and free-text preview below Type something... row
- **validate:** Reject duplicate question texts and option labels

### Bug Fixes

- Move registerTool and registerCommand to top level — session_start was too late
- Register /test-ask command unconditionally — drop flag gate
- Tab/Shift+Tab no-op in single-question mode; defensive render guard for out-of-bounds activeTab
- Add ←→ arrow key navigation in Submit tab block
- Remove Tab/Shift+Tab for tab switching, keep only ←→ arrows; fix multiselect+freetext combining in buildResult and getAnswerText; add missing tests; fix tab bar snippet
- Separate cursor from selection; fix free-text/checkbox interaction; consistent key handling; Enter confirms on filled free-text row
- Tab icons, alignment of Type something... row, tick on item number not preview text
- Submit tab cleanup, un-confirm on empty multi-select, renderCall/renderResult polish, alignment fixes
- Use Text not TruncatedText in renderResult — TruncatedText drops content after first newline
- RenderResult uses Box + TruncatedText per line item — each answer truncated independently
- Return full question text in LLM result instead of truncated header
- Migrate to @earendil-works scope, fix single-select free-text clear
- Harden tool execution and keep saved free-text on Esc

### Refactor

- Extract resolveAnswer, refresh, styleTab, exitEditMode/commitEditMode/clearEditMode, SINGLE/MULTI_INDENT constants
- Use TruncatedText in renderCall/renderResult instead of manual truncateToWidth

### Documentation

- Add README with install, usage, key bindings, behaviour notes, image placeholders
- Add recommended option hint to tool description
- Improve tool description with use cases, Other guidance, label hints

### Tests

- Add 20 fuzz tests for 4-tab view — diverse user behaviours, navigation, state interactions
- Coverage gap-fill — schema.ts 100%, component.ts 97.84%, add schema structure tests and component edge cases
- Typecheck tests and run tsc in pnpm check

### Maintenance

- Add biome, jscpd, knip; fix all lint/format/dupes/dead-code issues
- **coverage:** Enable test coverage check
- Remove TEST_SCENARIOS and /test-ask dev command — ship-ready
- Replace biome with oxlint + oxfmt, target ES2023, bump dev deps
- Add npm publish metadata, MIT license, and git-cliff release flow

