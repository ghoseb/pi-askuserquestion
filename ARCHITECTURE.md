# AskUserQuestion — Architecture

## Goal

A pi coding agent extension that registers an `ask_user_question` tool. When the LLM calls it,
execution pauses and an interactive TUI is shown to the user. The user answers the questions and
the answers are returned to the LLM as a structured object heavily, inspired by the Claude Code
`AskUserQuestion` tool.

---

## Project Structure

```
pi-askuserquestion/
├── package.json
├── package-lock.json
├── node_modules/
├── src/
│   ├── index.ts          # Extension entry point — pi-specific code only
│   ├── schema.ts         # TypeBox schemas + derived types (no pi/tui imports)
│   └── component.ts      # AskUserQuestionComponent class (pi-tui only, no pi-coding-agent)
└── tests/
    └── component.test.ts # Vitest unit tests — component logic only
```

### Separation rationale

| File | Imports | Reason |
|------|---------|--------|
| `schema.ts` | `@sinclair/typebox` only | Shared by all layers, zero coupling |
| `component.ts` | `@mariozechner/pi-tui`, `schema.ts` | Pure component, testable without pi runtime |
| `index.ts` | `@mariozechner/pi-coding-agent`, `component.ts`, `schema.ts` | Extension wiring only |
| `tests/component.test.ts` | `component.ts`, `schema.ts`, `vitest` | Never imports `index.ts` |

---

## package.json

```json
{
  "name": "pi-askuserquestion",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "pi": {
    "extensions": ["./src/index.ts"]
  },
  "devDependencies": {
    "vitest": "^3.0.0",
    "@types/node": "^22.0.0"
  },
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": "*",
    "@mariozechner/pi-tui": "*",
    "@sinclair/typebox": "*"
  }
}
```

`@mariozechner/pi-coding-agent`, `@mariozechner/pi-tui`, and `@sinclair/typebox` are all bundled
with pi and declared as `peerDependencies` — they must not appear in `dependencies`.

---

## src/schema.ts

Single source of truth for all data shapes. No pi or tui imports.

```typescript
import { Type, type Static } from "@sinclair/typebox";

// ── Input (what the LLM sends) ────────────────────────────────────────────────

export const OptionSchema = Type.Object({
  label: Type.String({
    description: "Display label shown to the user and returned as the answer value",
  }),
  description: Type.Optional(Type.String({
    description: "Optional clarifying text shown below the label",
  })),
});

export const QuestionSchema = Type.Object({
  question: Type.String({
    description: "Full question text displayed to the user",
  }),
  header: Type.String({
    description: "Short label used in the tab bar when multiple questions are shown. Max 12 characters.",
  }),
  options: Type.Array(OptionSchema, {
    minItems: 2,
    maxItems: 4,
    description: "Between 2 and 4 choices for the user to select from",
  }),
  multiSelect: Type.Boolean({
    description: "When true the user may select multiple options. Answers are joined with ', '.",
  }),
});

export const InputSchema = Type.Object({
  questions: Type.Array(QuestionSchema, {
    minItems: 1,
    maxItems: 4,
    description: "1 to 4 questions to ask the user",
  }),
});

export type Option   = Static<typeof OptionSchema>;
export type Question = Static<typeof QuestionSchema>;
export type Input    = Static<typeof InputSchema>;

// ── Output (details returned to the LLM and used in renderResult) ─────────────

export const ResultSchema = Type.Object({
  // Pass-through so renderResult has headers + option descriptions
  questions: Type.Array(QuestionSchema),

  // Maps question text → selected label(s).
  // Multi-select: labels joined with ", " e.g. "Option A, Option C"
  // Free-text: the user's typed string verbatim
  // Cancelled question: key absent (see cancelled flag)
  answers: Type.Record(Type.String(), Type.String()),

  // True when the user pressed Esc before submitting
  cancelled: Type.Boolean(),
});

export type Result = Static<typeof ResultSchema>;
```

### Answer encoding rules

| Scenario | `answers` entry |
|----------|----------------|
| Single-select | `{ [question]: "Label" }` |
| Multi-select, one chosen | `{ [question]: "Label A" }` |
| Multi-select, many chosen | `{ [question]: "Label A, Label C" }` |
| Free-text typed | `{ [question]: "user typed text" }` |
| Cancelled (Esc) | key absent; `cancelled: true` |

---

## src/component.ts

### Imports

```typescript
import {
  type Component,
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  truncateToWidth,
  type TUI,
  visibleWidth,
  wrapTextWithAnsi,
} from "@mariozechner/pi-tui";
import type { Question, Result } from "./schema.ts";
```

No `@mariozechner/pi-coding-agent` import. The `Theme` type is passed in at construction time.

### TUI stub interface

For testing, a minimal TUI stub is sufficient:

```typescript
// Satisfied by the real TUI and by { requestRender: () => {} } in tests
interface TUILike {
  requestRender(): void;
}
```

`Editor` constructor takes a `TUI` — pass the stub cast as `TUI`.

### Component state

```typescript
interface QuestionState {
  // Single-select: the currently highlighted option index (cursor)
  cursorIndex: number;

  // Multi-select: the set of selected option indices
  selectedIndices: Set<number>;

  // Whether this question has been confirmed (Enter pressed)
  confirmed: boolean;

  // If the user chose "Type something..." — the text they typed
  // null means free-text mode is not active for this question
  freeTextValue: string | null;

  // Whether the inline Editor is currently active for this question
  inEditMode: boolean;
}
```

### Constructor

```typescript
class AskUserQuestionComponent implements Component {
  private questions:   Question[];
  private theme:       Theme;
  private tui:         TUILike;
  private done:        (result: Result | null) => void;

  private states:      QuestionState[];   // one per question
  private activeTab:   number;            // index into questions[], or questions.length = Submit tab
  private editor:      Editor;

  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(questions: Question[], tui: TUILike, theme: Theme, done: (result: Result | null) => void)
```

`Editor` is created once and its text swapped when navigating between questions:

```typescript
this.editor = new Editor(tui as TUI, editorTheme);
this.editor.disableSubmit = true;
this.editor.onChange = () => { this.invalidate(); this.tui.requestRender(); };
```

### Derived state helpers

```typescript
// "Type something..." is always the last option regardless of actual options array
private allOptions(q: Question): Array<Option & { isOther?: true }> {
  return [...q.options, { label: "Type something...", isOther: true }];
}

// True when every question has been confirmed
private allConfirmed(): boolean {
  return this.states.every(s => s.confirmed);
}

// True when single question (no tab bar rendered)
private get isSingle(): boolean {
  return this.questions.length === 1;
}

// Total tabs including Submit (only relevant when !isSingle)
private get totalTabs(): number {
  return this.questions.length + 1;
}
```

### Input routing — `handleInput(data: string)`

```
handleInput(data)
  │
  ├─ if in edit mode (inline editor active):
  │    Esc          → exit edit mode, clear editor, invalidate
  │    Enter        → saveFreetextAnswer(), confirmQuestion(), advance(), exit edit mode
  │    anything else → editor.handleInput(data)
  │
  ├─ if on Submit tab (!isSingle only):
  │    Enter        → if allConfirmed() → submit()
  │    Esc          → cancel()
  │    Tab          → wrap to tab 0
  │    Shift+Tab    → go to questions.length - 1
  │
  ├─ else (on a question tab):
  │    Esc          → cancel()
  │    Tab          → advance tab (wrap around, skip no-op)
  │    Shift+Tab    → retreat tab (wrap around)
  │    ↑            → moveCursor(-1)
  │    ↓            → moveCursor(+1)
  │    Space (multiSelect) → toggleSelected(cursorIndex)
  │    Space (!multiSelect) → no-op (Enter is the confirm key)
  │    Enter (multiSelect)  → if any selected → confirmAndAdvance()
  │    Enter (!multiSelect) → confirmCurrentOption(), advance()
  │    Enter on "Type something..." → enterEditMode()
  │    Space on "Type something..." → enterEditMode()
```

### Navigation — `advance()`

```
advance()
  if isSingle → submit() immediately (no tab bar needed)
  else if activeTab < questions.length - 1 → activeTab++
  else → activeTab = questions.length  (Submit tab)
  reset optionIndex to 0 for the new tab
  load saved answer text into editor if question was previously answered
  invalidate()
```

### Answer collection — `buildResult(): Result`

```typescript
private buildResult(): Result {
  const answers: Record<string, string> = {};

  for (let i = 0; i < this.questions.length; i++) {
    const q = this.questions[i];
    const s = this.states[i];

    if (!s.confirmed) continue; // should not happen on submit, but guard

    if (s.freeTextValue !== null) {
      answers[q.question] = s.freeTextValue;
    } else if (q.multiSelect) {
      const labels = [...s.selectedIndices]
        .sort((a, b) => a - b)
        .map(idx => q.options[idx].label);
      answers[q.question] = labels.join(", ");
    } else {
      answers[q.question] = q.options[s.cursorIndex].label;
    }
  }

  return { questions: this.questions, answers, cancelled: false };
}
```

### Render — `render(width: number): string[]`

Cache: if `cachedWidth === width && cachedLines` return cached lines immediately.

Layout (single question, no tab bar):

```
─────────────────────────────────────── (accent separator)
 <question text, word-wrapped>

  > 1. Option A
    2. Option B
    3. Option C
    4. Type something...

  [inline Editor — only when inEditMode]

 ↑↓ navigate · Enter select · Esc cancel
─────────────────────────────────────── (accent separator)
```

Layout (multi-question, with tab bar):

```
─────────────────────────────────────────────────────────
 [ Scope ] [ Priority ] [ Backend ] [ ✓ Submit ]
                                       ^ tab labels from header field

 <current question text>

  [x] 1. Option A          ← multiSelect: checkboxes
  [ ] 2. Option B
  [x] 3. Option C
      4. Type something...

 Tab/←→ navigate · Space toggle · Enter confirm · Esc cancel
─────────────────────────────────────────────────────────
```

#### Tab bar rendering detail

- Each tab label is the `header` field of the question (≤12 chars, not enforced but LLM instructed)
- Active tab: `theme.bg("selectedBg", theme.fg("text", ` ${header} `))`
- Confirmed tab: `theme.fg("success", ` ■ ${header} `)`
- Unconfirmed tab: `theme.fg("muted", ` □ ${header} `)`
- Submit tab: only enabled (green) when `allConfirmed()`; dimmed otherwise
- Submit tab active: `theme.bg("selectedBg", theme.fg("text", " ✓ Submit "))`

#### Options list rendering detail

Single-select:
```
> 1. Option A          ← cursor row: accent color, ">" prefix
  2. Option B          ← other rows: text color, "  " prefix
     Optional description text in muted
```

Multi-select:
```
  [✓] 1. Option A      ← selected: accent "✓"
  [ ] 2. Option B      ← unselected: dim "□" inside brackets
> [✓] 3. Option C      ← cursor + selected
      Optional description text in muted
```

"Type something..." row (always last):
- Normal: `  N. Type something...` in muted
- Cursor on it: `> N. Type something...` in accent
- Edit mode active: `> N. Type something... ✎` in accent, then inline editor below

#### Inline editor rendering

When `inEditMode` is true for the active question:
- Render `editor.render(width - 4)` lines between options and help line
- Prefix with `theme.fg("muted", " Your answer:")`
- Help text changes to `Enter to submit · Esc to go back`

#### Render cache invalidation

`invalidate()` sets `cachedWidth = undefined; cachedLines = undefined`.
Called from:
- `handleInput` after any state change
- `editor.onChange` callback
- Component constructor

---

## src/index.ts

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { InputSchema, ResultSchema, type Result } from "./schema.ts";
import { AskUserQuestionComponent } from "./component.ts";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    pi.registerTool({
      name:        "ask_user_question",
      label:       "Ask User",
      description: `Ask the user 1–4 clarifying questions before proceeding.
Use when multiple valid approaches exist and you need the user's preference.
Each question has 2–4 options. Set multiSelect: true when multiple choices are valid.
The header field is a short label (max 12 chars) shown in the tab bar.`,

      parameters: InputSchema,

      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const result = await ctx.ui.custom<Result | null>(
          (tui, theme, _kb, done) =>
            new AskUserQuestionComponent(params.questions, tui, theme, done)
        );

        if (result === null || result.cancelled) {
          return {
            content: [{ type: "text", text: "User cancelled" }],
            details: {
              questions:  params.questions,
              answers:    {},
              cancelled:  true,
            } satisfies Result,
          };
        }

        const summaryLines = result.questions.map(q => {
          const answer = result.answers[q.question] ?? "(no answer)";
          return `${q.header}: ${answer}`;
        });

        return {
          content: [{ type: "text", text: summaryLines.join("\n") }],
          details: result satisfies Result,
        };
      },

      renderCall(args, theme) {
        const headers = (args.questions as Question[])
          .map(q => q.header)
          .join(", ");
        return new Text(
          theme.fg("toolTitle", theme.bold("ask_user_question ")) +
          theme.fg("muted", headers),
          0, 0
        );
      },

      renderResult(result, _options, theme) {
        const details = result.details as Result | undefined;

        if (!details) {
          const t = result.content[0];
          return new Text(t?.type === "text" ? t.text : "", 0, 0);
        }

        if (details.cancelled) {
          return new Text(theme.fg("warning", "Cancelled"), 0, 0);
        }

        const lines = details.questions.map(q => {
          const answer = details.answers[q.question] ?? "(no answer)";
          return theme.fg("success", "✓ ") +
                 theme.fg("accent",  q.header + ": ") +
                 theme.fg("text",    answer);
        });

        return new Text(lines.join("\n"), 0, 0);
      },
    });
  });
}
```

---

## tests/component.test.ts

### Setup

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { AskUserQuestionComponent } from "../src/component.ts";
import type { Question, Result } from "../src/schema.ts";

// Minimal TUI stub — satisfies the TUILike interface
const mockTui = { requestRender: () => {} };

// Minimal theme stub — satisfies theme.fg(), theme.bg(), theme.bold()
const mockTheme = {
  fg:   (_color: string, s: string) => s,
  bg:   (_color: string, s: string) => s,
  bold: (s: string) => s,
};

// Test fixtures
const singleSelect: Question = {
  question:    "Which database should we use?",
  header:      "Database",
  options:     [
    { label: "PostgreSQL", description: "Battle-tested relational DB" },
    { label: "SQLite",     description: "Zero-config embedded DB" },
    { label: "DuckDB",     description: "Analytical workloads" },
  ],
  multiSelect: false,
};

const multiSelect: Question = {
  question:    "Which features should we implement?",
  header:      "Features",
  options:     [
    { label: "Auth" },
    { label: "Search" },
    { label: "Export" },
  ],
  multiSelect: true,
};
```

### Test cases

#### Render — structure

```typescript
describe("render — single question", () => {
  it("renders separator lines at top and bottom", () => {
    const c = make([singleSelect]);
    const lines = c.render(80);
    expect(lines[0]).toContain("─");
    expect(lines[lines.length - 1]).toContain("─");
  });

  it("renders the question text", () => {
    const lines = make([singleSelect]).render(80);
    expect(lines.some(l => l.includes("Which database"))).toBe(true);
  });

  it("renders all options plus Type something...", () => {
    const lines = make([singleSelect]).render(80);
    expect(lines.some(l => l.includes("PostgreSQL"))).toBe(true);
    expect(lines.some(l => l.includes("SQLite"))).toBe(true);
    expect(lines.some(l => l.includes("DuckDB"))).toBe(true);
    expect(lines.some(l => l.includes("Type something"))).toBe(true);
  });

  it("does not render a tab bar", () => {
    const lines = make([singleSelect]).render(80);
    // Tab bar would contain the header label between brackets/spaces
    expect(lines.some(l => l.includes("[ Database ]") || l.includes("Database")
      && l.includes("Submit"))).toBe(false);
  });

  it("renders cursor > on first option", () => {
    const lines = make([singleSelect]).render(80);
    expect(lines.some(l => l.match(/^>\s+1\.\s+PostgreSQL/))).toBe(true);
  });

  it("does not exceed width on any line", () => {
    const c = make([singleSelect]);
    for (const line of c.render(40)) {
      // visibleWidth(line) <= 40 — import and check
      expect(line.replace(/\x1b\[[^m]*m/g, "").length).toBeLessThanOrEqual(40);
    }
  });

  it("renders option descriptions in muted position", () => {
    const lines = make([singleSelect]).render(80);
    expect(lines.some(l => l.includes("Battle-tested relational DB"))).toBe(true);
  });
});

describe("render — multi-question tab bar", () => {
  it("renders tab bar with both headers", () => {
    const lines = make([singleSelect, multiSelect]).render(80);
    expect(lines.some(l => l.includes("Database"))).toBe(true);
    expect(lines.some(l => l.includes("Features"))).toBe(true);
  });

  it("renders Submit tab", () => {
    const lines = make([singleSelect, multiSelect]).render(80);
    expect(lines.some(l => l.includes("Submit"))).toBe(true);
  });
});

describe("render — multi-select checkboxes", () => {
  it("renders [ ] unchecked boxes", () => {
    const lines = make([multiSelect]).render(80);
    expect(lines.some(l => l.includes("[ ]") || l.includes("□"))).toBe(true);
  });
});

describe("render — cache", () => {
  it("returns same array reference on repeated call with same width", () => {
    const c = make([singleSelect]);
    const a = c.render(80);
    const b = c.render(80);
    expect(a).toBe(b);
  });

  it("returns new array after invalidate()", () => {
    const c = make([singleSelect]);
    const a = c.render(80);
    c.invalidate();
    const b = c.render(80);
    expect(a).not.toBe(b);
  });

  it("returns new array when width changes", () => {
    const c = make([singleSelect]);
    const a = c.render(80);
    const b = c.render(60);
    expect(a).not.toBe(b);
  });
});
```

#### handleInput — single-select navigation

```typescript
describe("handleInput — single-select cursor movement", () => {
  it("moves cursor down on ↓", () => {
    const c = make([singleSelect]);
    c.handleInput(Key.down);
    const lines = c.render(80);
    expect(lines.some(l => l.match(/^>\s+2\.\s+SQLite/))).toBe(true);
  });

  it("does not move cursor above 0", () => {
    const c = make([singleSelect]);
    c.handleInput(Key.up);
    const lines = c.render(80);
    expect(lines.some(l => l.match(/^>\s+1\.\s+PostgreSQL/))).toBe(true);
  });

  it("does not move cursor past last option (Type something...)", () => {
    const c = make([singleSelect]);
    // 3 options + Type something... = 4 total, press down 10 times
    for (let i = 0; i < 10; i++) c.handleInput(Key.down);
    const lines = c.render(80);
    expect(lines.some(l => l.match(/^>\s+4\.\s+Type something/))).toBe(true);
  });
});
```

#### handleInput — single-select confirm + result

```typescript
describe("handleInput — single-select confirm", () => {
  it("resolves with correct answer on Enter", () => {
    let resolved: Result | null = null;
    const c = make([singleSelect], r => { resolved = r; });
    c.handleInput(Key.down);     // cursor on SQLite
    c.handleInput(Key.enter);
    expect(resolved).not.toBeNull();
    expect(resolved!.cancelled).toBe(false);
    expect(resolved!.answers["Which database should we use?"]).toBe("SQLite");
  });

  it("resolves first option when Enter pressed immediately", () => {
    let resolved: Result | null = null;
    const c = make([singleSelect], r => { resolved = r; });
    c.handleInput(Key.enter);
    expect(resolved!.answers["Which database should we use?"]).toBe("PostgreSQL");
  });
});
```

#### handleInput — multi-select

```typescript
describe("handleInput — multi-select", () => {
  it("toggles selection on Space", () => {
    const c = make([multiSelect]);
    c.handleInput(" ");           // Space selects Auth
    let lines = c.render(80);
    expect(lines.some(l => l.includes("[✓]") && l.includes("Auth"))).toBe(true);

    c.handleInput(" ");           // Space again deselects
    lines = c.render(80);
    expect(lines.some(l => l.includes("[ ]") && l.includes("Auth") ||
                           l.includes("□")   && l.includes("Auth"))).toBe(true);
  });

  it("resolves joined labels on Enter after selection", () => {
    let resolved: Result | null = null;
    const c = make([multiSelect], r => { resolved = r; });
    c.handleInput(" ");           // select Auth
    c.handleInput(Key.down);
    c.handleInput(" ");           // select Search
    c.handleInput(Key.enter);
    expect(resolved!.answers["Which features should we implement?"]).toBe("Auth, Search");
  });

  it("does not confirm on Enter when nothing selected", () => {
    let resolved: Result | null = null;
    const c = make([multiSelect], r => { resolved = r; });
    c.handleInput(Key.enter);
    expect(resolved).toBeNull();
  });
});
```

#### handleInput — cancellation

```typescript
describe("handleInput — cancellation", () => {
  it("resolves null on Esc", () => {
    let resolved: Result | null | undefined = undefined;
    const c = make([singleSelect], r => { resolved = r; });
    c.handleInput(Key.escape);
    expect(resolved).toBeNull();
  });
});
```

#### handleInput — free-text

```typescript
describe("handleInput — free-text", () => {
  it("enters edit mode when Enter pressed on Type something...", () => {
    const c = make([singleSelect]);
    // Navigate to last option (Type something...)
    for (let i = 0; i < 4; i++) c.handleInput(Key.down);
    c.handleInput(Key.enter);
    const lines = c.render(80);
    expect(lines.some(l => l.includes("✎"))).toBe(true);
  });

  it("exits edit mode on Esc, returns to options", () => {
    const c = make([singleSelect]);
    for (let i = 0; i < 4; i++) c.handleInput(Key.down);
    c.handleInput(Key.enter);     // enter edit mode
    c.handleInput(Key.escape);    // exit edit mode
    const lines = c.render(80);
    expect(lines.some(l => l.includes("✎"))).toBe(false);
  });
});
```

#### handleInput — multi-question tab navigation

```typescript
describe("handleInput — multi-question tab navigation", () => {
  it("Tab advances to next question tab", () => {
    const c = make([singleSelect, multiSelect]);
    c.handleInput(Key.tab);
    const lines = c.render(80);
    // Features tab should now be active (selectedBg styling)
    // We test indirectly: question text changes
    expect(lines.some(l => l.includes("Which features"))).toBe(true);
  });

  it("Shift+Tab retreats to previous tab", () => {
    const c = make([singleSelect, multiSelect]);
    c.handleInput(Key.tab);       // go to tab 1
    c.handleInput(Key.shift("tab")); // go back to tab 0
    const lines = c.render(80);
    expect(lines.some(l => l.includes("Which database"))).toBe(true);
  });

  it("Tab from last question reaches Submit tab", () => {
    const c = make([singleSelect, multiSelect]);
    c.handleInput(Key.tab);       // tab 1
    c.handleInput(Key.tab);       // Submit tab
    const lines = c.render(80);
    expect(lines.some(l => l.includes("Submit") || l.includes("Press Enter"))).toBe(true);
  });
});
```

#### Full round-trip — multi-question result shape

```typescript
describe("full round-trip", () => {
  it("produces correct Result for two questions", () => {
    let resolved: Result | null = null;
    const c = make([singleSelect, multiSelect], r => { resolved = r; });

    // Answer Q1
    c.handleInput(Key.down);      // cursor on SQLite
    c.handleInput(Key.enter);     // confirm, auto-advance to Q2

    // Answer Q2
    c.handleInput(" ");           // select Auth
    c.handleInput(Key.down);
    c.handleInput(Key.down);
    c.handleInput(" ");           // select Export
    c.handleInput(Key.enter);     // confirm, auto-advance to Submit

    // Submit
    c.handleInput(Key.enter);

    expect(resolved).not.toBeNull();
    expect(resolved!.cancelled).toBe(false);
    expect(resolved!.answers["Which database should we use?"]).toBe("SQLite");
    expect(resolved!.answers["Which features should we implement?"]).toBe("Auth, Export");
    expect(resolved!.questions).toHaveLength(2);
  });
});
```

### Helper

```typescript
function make(
  questions: Question[],
  done: (r: Result | null) => void = () => {},
): AskUserQuestionComponent {
  return new AskUserQuestionComponent(questions, mockTui as any, mockTheme as any, done);
}
```

---

## Edge cases and constraints

| Case | Handling |
|------|----------|
| LLM sends `multiSelect: true` with 0 indices selected and user presses Enter | No-op — do not confirm |
| LLM sends `options` with 2 items (minimum) | Works, "Type something..." is always appended |
| LLM sends `options` with 4 items (maximum) | 5 rows total including "Type something..." |
| LLM sends `questions` with 1 item | No tab bar rendered — submit immediately on answer |
| `header` longer than 12 chars | Truncated via `truncateToWidth` before rendering in tab bar |
| `description` is very long | Wrapped via `wrapTextWithAnsi` to content width |
| Terminal very narrow (<40 cols) | Each line truncated to width by `truncateToWidth` guarantee |
| User navigates back to answered question | Previous answer pre-populated as cursor position or selection state |
| Free-text answer, then Esc back, then selects option | `freeTextValue` cleared, option selected normally |

---

## What is NOT tested

| Thing | Why |
|-------|-----|
| `ctx.ui.custom()` integration | Requires live pi runtime |
| `Editor` keystroke fidelity | `editor.disableSubmit = true` and onChange tested indirectly via state |
| Tab bar visual styling (colors) | mockTheme strips colors — structural correctness tested, not aesthetics |
| `renderCall` / `renderResult` | Requires `Text` from `@mariozechner/pi-tui` and real theme — tested visually |
| LLM tool call round-trip | Tested via end-to-end `pi -e ./src/index.ts` |
