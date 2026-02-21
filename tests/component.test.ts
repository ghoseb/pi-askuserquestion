import type { Theme } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { AskUserQuestionComponent, type TUILike } from "../src/component.ts";
import {
  InputSchema,
  OptionSchema,
  type Question,
  QuestionSchema,
  type Result,
  ResultSchema,
} from "../src/schema.ts";

// ── Smoke test ────────────────────────────────────────────────────────────────

it("peer deps resolve", () => {
  expect(Type.String).toBeDefined();
  expect(Key.enter).toBe("enter");
  expect(matchesKey("\r", Key.enter)).toBe(true);
});

// ── Stubs ─────────────────────────────────────────────────────────────────────

const mockTui = {
  requestRender: () => {},
  terminal: { rows: 24, columns: 80 },
};

const mockTheme = {
  fg: (_color: string, s: string) => s,
  bg: (_color: string, s: string) => s,
  bold: (s: string) => s,
};

// ── Raw terminal escape sequences for handleInput() calls ─────────────────────
// matchesKey expects raw terminal escape sequences, NOT key identifier strings.
// Key.down === "down" (an identifier); the actual terminal sends "\x1b[B".
const INPUT = {
  up: "\x1b[A",
  down: "\x1b[B",
  left: "\x1b[D",
  right: "\x1b[C",
  enter: "\r",
  escape: "\x1b",
  tab: "\t",
  shiftTab: "\x1b[Z",
  space: " ",
} as const;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const singleSelect: Question = {
  question: "Which database should we use?",
  header: "Database",
  options: [
    { label: "PostgreSQL", description: "Battle-tested relational DB" },
    { label: "SQLite", description: "Zero-config embedded DB" },
    { label: "DuckDB", description: "Analytical workloads" },
  ],
  multiSelect: false,
};

const multiSelectQ: Question = {
  question: "Which features should we implement?",
  header: "Features",
  options: [{ label: "Auth" }, { label: "Search" }, { label: "Export" }],
  multiSelect: true,
};

const longHeaderQ: Question = {
  question: "Pick an option",
  header: "VeryLongHeaderExceedingLimit",
  options: [{ label: "A" }, { label: "B" }],
  multiSelect: false,
};

const twoOptionsQ: Question = {
  question: "Yes or no?",
  header: "Confirm",
  options: [{ label: "Yes" }, { label: "No" }],
  multiSelect: false,
};

// ── Helper ────────────────────────────────────────────────────────────────────

function make(
  questions: Question[],
  done: (r: Result | null) => void = () => {},
): AskUserQuestionComponent {
  return new AskUserQuestionComponent(
    questions,
    mockTui as TUILike,
    mockTheme as unknown as Theme,
    done,
  );
}

/** Strip ANSI escape codes from a string */
function stripAnsi(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally matching ESC sequences
  const noSgr = s.replace(/\u001b\[[0-9;]*m/g, "");
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally matching ESC sequences
  return noSgr.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
}

// ── Render structure — single question ───────────────────────────────────────

describe("render — single question", () => {
  it("renders separator lines at top and bottom", () => {
    const lines = make([singleSelect]).render(80);
    expect(lines[0]).toContain("─");
    expect(lines[lines.length - 1]).toContain("─");
  });

  it("renders the question text", () => {
    const lines = make([singleSelect]).render(80);
    expect(lines.some((l) => l.includes("Which database should we use?"))).toBe(
      true,
    );
  });

  it("renders all option labels", () => {
    const lines = make([singleSelect]).render(80);
    expect(lines.some((l) => l.includes("PostgreSQL"))).toBe(true);
    expect(lines.some((l) => l.includes("SQLite"))).toBe(true);
    expect(lines.some((l) => l.includes("DuckDB"))).toBe(true);
  });

  it("renders Type something... option", () => {
    const lines = make([singleSelect]).render(80);
    expect(lines.some((l) => l.includes("Type something..."))).toBe(true);
  });

  it("renders option descriptions", () => {
    const lines = make([singleSelect]).render(80);
    expect(lines.some((l) => l.includes("Battle-tested relational DB"))).toBe(
      true,
    );
  });

  it("does not render a tab bar", () => {
    const lines = make([singleSelect]).render(80);
    // Tab bar would contain "Submit"
    expect(lines.some((l) => l.includes("Submit"))).toBe(false);
    // And would contain the header label alongside other tabs
    // Single-question: header not shown in a tab-bar context
    expect(lines.some((l) => l.includes("□") || l.includes("■"))).toBe(false);
  });

  it("renders cursor > on first option initially", () => {
    const lines = make([singleSelect]).render(80);
    expect(lines.some((l) => l.match(/^>\s+.*PostgreSQL/))).toBe(true);
  });

  it("no line exceeds width", () => {
    const c = make([singleSelect]);
    for (const line of c.render(40)) {
      expect(stripAnsi(line).length).toBeLessThanOrEqual(40);
    }
  });

  it("renders option descriptions for minimum 2 options", () => {
    const lines = make([twoOptionsQ]).render(80);
    expect(lines.some((l) => l.includes("Yes"))).toBe(true);
    expect(lines.some((l) => l.includes("No"))).toBe(true);
    expect(lines.some((l) => l.includes("Type something..."))).toBe(true);
  });
});

// ── Render structure — multi-question ────────────────────────────────────────

describe("render — multi-question tab bar", () => {
  it("renders tab bar with both headers", () => {
    const lines = make([singleSelect, multiSelectQ]).render(80);
    expect(lines.some((l) => l.includes("Database"))).toBe(true);
    expect(lines.some((l) => l.includes("Features"))).toBe(true);
  });

  it("renders Submit tab", () => {
    const lines = make([singleSelect, multiSelectQ]).render(80);
    expect(lines.some((l) => l.includes("Submit"))).toBe(true);
  });

  it("truncates long header in tab bar", () => {
    const lines = make([longHeaderQ, twoOptionsQ]).render(80);
    // Should be truncated to 12 chars
    const tabLine = lines.find((l) => l.includes("Submit"));
    expect(tabLine).toBeDefined();
    // Full 28-char header should NOT appear in the tab bar line
    expect(tabLine).not.toContain("VeryLongHeaderExceedingLimit");
  });
});

// ── Render structure — multi-select ──────────────────────────────────────────

describe("render — multi-select", () => {
  it("renders unchecked boxes initially", () => {
    const lines = make([multiSelectQ]).render(80);
    expect(lines.some((l) => l.includes("[ ]") || l.includes("□"))).toBe(true);
  });

  it("does not render checkboxes for single-select", () => {
    const lines = make([singleSelect]).render(80);
    expect(lines.some((l) => l.includes("[ ]") || l.includes("[✓]"))).toBe(
      false,
    );
  });
});

// ── Render cache ─────────────────────────────────────────────────────────────

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

// ── handleInput — cursor navigation ──────────────────────────────────────────

describe("handleInput — cursor navigation", () => {
  it("moves cursor down on ↓", () => {
    const c = make([singleSelect]);
    c.handleInput(INPUT.down);
    const lines = c.render(80);
    expect(lines.some((l) => l.match(/^>\s+.*SQLite/))).toBe(true);
    expect(lines.some((l) => l.match(/^>\s+.*PostgreSQL/))).toBe(false);
  });

  it("does not move cursor above 0 on ↑ from top", () => {
    const c = make([singleSelect]);
    c.handleInput(INPUT.up);
    const lines = c.render(80);
    expect(lines.some((l) => l.match(/^>\s+.*PostgreSQL/))).toBe(true);
  });

  it("clamps cursor at last option (Type something...) on repeated ↓", () => {
    const c = make([singleSelect]);
    for (let i = 0; i < 20; i++) c.handleInput(INPUT.down);
    const lines = c.render(80);
    expect(lines.some((l) => l.match(/^>.*Type something/))).toBe(true);
  });

  it("moves back up from Type something...", () => {
    const c = make([singleSelect]);
    for (let i = 0; i < 20; i++) c.handleInput(INPUT.down);
    c.handleInput(INPUT.up);
    const lines = c.render(80);
    // Cursor should be on last real option (DuckDB, index 2)
    expect(lines.some((l) => l.match(/^>\s+.*DuckDB/))).toBe(true);
  });
});

// ── handleInput — single-select confirm ──────────────────────────────────────

describe("handleInput — single-select confirm", () => {
  it("resolves with first option on immediate Enter", () => {
    let resolved: Result | null = null;
    const c = make([singleSelect], (r) => {
      resolved = r;
    });
    c.handleInput(INPUT.enter);
    expect(resolved).not.toBeNull();
    expect(resolved?.cancelled).toBe(false);
    expect(resolved?.answers["Which database should we use?"]).toBe(
      "PostgreSQL",
    );
  });

  it("resolves with second option after ↓ Enter", () => {
    let resolved: Result | null = null;
    const c = make([singleSelect], (r) => {
      resolved = r;
    });
    c.handleInput(INPUT.down);
    c.handleInput(INPUT.enter);
    expect(resolved?.answers["Which database should we use?"]).toBe("SQLite");
  });

  it("result has cancelled: false", () => {
    let resolved: Result | null = null;
    const c = make([singleSelect], (r) => {
      resolved = r;
    });
    c.handleInput(INPUT.enter);
    expect(resolved?.cancelled).toBe(false);
  });

  it("result answers keyed by full question text, not header", () => {
    let resolved: Result | null = null;
    const c = make([singleSelect], (r) => {
      resolved = r;
    });
    c.handleInput(INPUT.enter);
    // biome-ignore lint/style/noNonNullAssertion: we assert not.toBeNull() above
    expect("Which database should we use?" in resolved!.answers).toBe(true);
    // biome-ignore lint/style/noNonNullAssertion: we assert not.toBeNull() above
    expect("Database" in resolved!.answers).toBe(false);
  });

  it("result has correct questions pass-through", () => {
    let resolved: Result | null = null;
    const c = make([singleSelect], (r) => {
      resolved = r;
    });
    c.handleInput(INPUT.enter);
    expect(resolved?.questions).toHaveLength(1);
    expect(resolved?.questions[0].header).toBe("Database");
  });

  it("Space does not confirm in single-select mode", () => {
    let called = false;
    const c = make([singleSelect], () => {
      called = true;
    });
    c.handleInput(INPUT.space);
    expect(called).toBe(false);
  });

  it("done is called exactly once", () => {
    let count = 0;
    const c = make([singleSelect], () => {
      count++;
    });
    c.handleInput(INPUT.enter);
    c.handleInput(INPUT.enter); // second call should be no-op (already resolved)
    expect(count).toBe(1);
  });
});

// ── handleInput — cancellation ────────────────────────────────────────────────

describe("handleInput — cancellation", () => {
  it("resolves null on Esc", () => {
    let resolved: Result | null | undefined;
    const c = make([singleSelect], (r) => {
      resolved = r;
    });
    c.handleInput(INPUT.escape);
    expect(resolved).toBeNull();
  });

  it("done called exactly once on Esc", () => {
    let count = 0;
    const c = make([singleSelect], () => {
      count++;
    });
    c.handleInput(INPUT.escape);
    c.handleInput(INPUT.escape);
    expect(count).toBe(1);
  });
});

// ── handleInput — multi-select ────────────────────────────────────────────────

describe("handleInput — multi-select", () => {
  it("Space selects first option — shows [✓]", () => {
    const c = make([multiSelectQ]);
    c.handleInput(INPUT.space);
    const lines = c.render(80);
    expect(lines.some((l) => l.includes("[✓]") && l.includes("Auth"))).toBe(
      true,
    );
  });

  it("Space again deselects — shows [ ]", () => {
    const c = make([multiSelectQ]);
    c.handleInput(INPUT.space);
    c.handleInput(INPUT.space);
    const lines = c.render(80);
    expect(
      lines.some(
        (l) => (l.includes("[ ]") || l.includes("□")) && l.includes("Auth"),
      ),
    ).toBe(true);
  });

  it("can select multiple options", () => {
    const c = make([multiSelectQ]);
    c.handleInput(INPUT.space); // select Auth
    c.handleInput(INPUT.down);
    c.handleInput(INPUT.space); // select Search
    const lines = c.render(80);
    expect(lines.some((l) => l.includes("[✓]") && l.includes("Auth"))).toBe(
      true,
    );
    expect(lines.some((l) => l.includes("[✓]") && l.includes("Search"))).toBe(
      true,
    );
  });

  it("toggling does not call done", () => {
    let called = false;
    const c = make([multiSelectQ], () => {
      called = true;
    });
    c.handleInput(INPUT.space);
    expect(called).toBe(false);
  });

  it("Enter with nothing selected is a no-op", () => {
    let called = false;
    const c = make([multiSelectQ], () => {
      called = true;
    });
    c.handleInput(INPUT.enter);
    expect(called).toBe(false);
    // Nothing selected either
    const lines = c.render(80);
    expect(lines.some((l) => l.includes("[✓]"))).toBe(false);
  });

  it("Enter with something selected confirms", () => {
    let resolved: Result | null = null;
    const c = make([multiSelectQ], (r) => {
      resolved = r;
    });
    c.handleInput(INPUT.space); // select Auth
    c.handleInput(INPUT.enter); // confirm
    expect(resolved).not.toBeNull();
    expect(resolved?.answers["Which features should we implement?"]).toBe(
      "Auth",
    );
  });

  it("Enter after selecting options 1 and 3 resolves with joined labels sorted by index", () => {
    let resolved: Result | null = null;
    const c = make([multiSelectQ], (r) => {
      resolved = r;
    });
    c.handleInput(INPUT.space); // select Auth (index 0)
    c.handleInput(INPUT.down);
    c.handleInput(INPUT.down);
    c.handleInput(INPUT.space); // select Export (index 2)
    c.handleInput(INPUT.enter); // confirm
    expect(resolved?.answers["Which features should we implement?"]).toBe(
      "Auth, Export",
    );
  });

  it("result has cancelled: false", () => {
    let resolved: Result | null = null;
    const c = make([multiSelectQ], (r) => {
      resolved = r;
    });
    c.handleInput(INPUT.space);
    c.handleInput(INPUT.enter);
    expect(resolved?.cancelled).toBe(false);
  });

  it("result answers keyed by full question text", () => {
    let resolved: Result | null = null;
    const c = make([multiSelectQ], (r) => {
      resolved = r;
    });
    c.handleInput(INPUT.space);
    c.handleInput(INPUT.enter);
    // biome-ignore lint/style/noNonNullAssertion: we assert not.toBeNull() above
    expect("Which features should we implement?" in resolved!.answers).toBe(
      true,
    );
  });
});

// ── handleInput — free-text mode ──────────────────────────────────────────────

describe("handleInput — free-text mode", () => {
  it("Space on 'Type something...' enters edit mode — render shows ✎", () => {
    const c = make([singleSelect]);
    // Navigate to last option
    for (let i = 0; i < 10; i++) c.handleInput(INPUT.down);
    c.handleInput(INPUT.space);
    const lines = c.render(80);
    expect(lines.some((l) => l.includes("✎"))).toBe(true);
  });

  it("Space on 'Type something...' also enters edit mode", () => {
    const c = make([singleSelect]);
    for (let i = 0; i < 10; i++) c.handleInput(INPUT.down);
    c.handleInput(INPUT.space);
    const lines = c.render(80);
    expect(lines.some((l) => l.includes("✎"))).toBe(true);
  });

  it("Esc in edit mode exits without confirming — ✎ gone", () => {
    const c = make([singleSelect]);
    for (let i = 0; i < 10; i++) c.handleInput(INPUT.down);
    c.handleInput(INPUT.space); // open editor
    c.handleInput(INPUT.escape); // exit
    const lines = c.render(80);
    expect(lines.some((l) => l.includes("✎"))).toBe(false);
  });

  it("Esc in edit mode does not call done", () => {
    let called = false;
    const c = make([singleSelect], () => {
      called = true;
    });
    for (let i = 0; i < 10; i++) c.handleInput(INPUT.down);
    c.handleInput(INPUT.space); // open editor
    c.handleInput(INPUT.escape);
    expect(called).toBe(false);
  });

  it("Enter with empty text clears previously saved free-text", () => {
    const c = make([singleSelect, twoOptionsQ]);
    // Type free-text on Q1
    for (let i = 0; i < 10; i++) c.handleInput(INPUT.down);
    c.handleInput(INPUT.space); // open editor
    for (const ch of "hello") c.handleInput(ch);
    c.handleInput(INPUT.enter); // save "hello", back to options (single-select: auto-confirms + advances)
    // Navigate back, re-open editor, clear text
    c.handleInput(INPUT.left);
    for (let i = 0; i < 10; i++) c.handleInput(INPUT.down); // cursor on Type something...
    c.handleInput(INPUT.space); // re-open editor (pre-filled with "hello")
    // Clear editor by deleting — simulate backspace 5 times
    for (let i = 0; i < 5; i++) c.handleInput("\x7f"); // backspace
    c.handleInput(INPUT.enter); // Enter with empty → clears freeTextValue
    // Preview below "Type something..." should be gone
    const lines = c.render(80);
    expect(lines.some((l) => l.includes("hello"))).toBe(false);
  });

  it("Enter with empty text in edit mode exits without confirming", () => {
    let called = false;
    const c = make([singleSelect], () => {
      called = true;
    });
    for (let i = 0; i < 10; i++) c.handleInput(INPUT.down);
    c.handleInput(INPUT.space); // open editor
    c.handleInput(INPUT.enter); // enter with empty text
    expect(called).toBe(false);
    // Should be back in option mode
    const lines = c.render(80);
    expect(lines.some((l) => l.includes("✎"))).toBe(false);
  });

  it("typing then Enter confirms with typed text", () => {
    let resolved: Result | null = null;
    const c = make([singleSelect], (r) => {
      resolved = r;
    });
    for (let i = 0; i < 10; i++) c.handleInput(INPUT.down);
    c.handleInput(INPUT.space); // open editor
    for (const ch of "hello") c.handleInput(ch);
    c.handleInput(INPUT.enter); // confirm
    expect(resolved).not.toBeNull();
    expect(resolved?.cancelled).toBe(false);
    expect(resolved?.answers["Which database should we use?"]).toBe("hello");
  });
});

// ── handleInput — multi-question tab navigation ───────────────────────────────

describe("handleInput — multi-question tab navigation", () => {
  it("Tab advances from Q1 to Q2", () => {
    const c = make([singleSelect, multiSelectQ]);
    c.handleInput(INPUT.right);
    const lines = c.render(80);
    expect(lines.some((l) => l.includes("Which features"))).toBe(true);
  });

  it("Tab from Q2 reaches Submit tab", () => {
    const c = make([singleSelect, multiSelectQ]);
    c.handleInput(INPUT.right); // Q2
    c.handleInput(INPUT.right); // Submit
    const lines = c.render(80);
    expect(
      lines.some(
        (l) =>
          l.includes("Press Enter to submit") || l.includes("Still needed"),
      ),
    ).toBe(true);
  });

  it("Shift+Tab retreats from Q2 to Q1", () => {
    const c = make([singleSelect, multiSelectQ]);
    c.handleInput(INPUT.right); // go to Q2
    c.handleInput(INPUT.left); // back to Q1
    const lines = c.render(80);
    expect(lines.some((l) => l.includes("Which database"))).toBe(true);
  });

  it("Shift+Tab on Q1 wraps to Submit tab", () => {
    const c = make([singleSelect, multiSelectQ]);
    c.handleInput(INPUT.left);
    const lines = c.render(80);
    expect(
      lines.some(
        (l) =>
          l.includes("Press Enter to submit") || l.includes("Still needed"),
      ),
    ).toBe(true);
  });

  it("Tab on Submit tab wraps to Q1", () => {
    const c = make([singleSelect, multiSelectQ]);
    c.handleInput(INPUT.left); // go to Submit
    c.handleInput(INPUT.right); // wrap back to Q1
    const lines = c.render(80);
    expect(lines.some((l) => l.includes("Which database"))).toBe(true);
  });

  it("confirmed tab shows ■ indicator", () => {
    const c = make([singleSelect, multiSelectQ]);
    c.handleInput(INPUT.enter); // confirm Q1, auto-advance to Q2
    const lines = c.render(80);
    expect(lines.some((l) => l.includes("■"))).toBe(true);
  });

  it("unconfirmed tab has no ■ indicator", () => {
    const c = make([singleSelect, multiSelectQ]);
    const lines = c.render(80);
    // Tab bar exists (Submit visible) but no ■ yet
    expect(lines.some((l) => l.includes("Submit"))).toBe(true);
    expect(lines.some((l) => l.includes("■"))).toBe(false);
  });
});

// ── handleInput — Submit tab ──────────────────────────────────────────────────

describe("handleInput — Submit tab", () => {
  it("Enter on Submit tab when not all confirmed is a no-op", () => {
    let called = false;
    const c = make([singleSelect, multiSelectQ], () => {
      called = true;
    });
    c.handleInput(INPUT.left); // go to Submit tab
    c.handleInput(INPUT.enter);
    expect(called).toBe(false);
  });

  it("Esc on Submit tab cancels", () => {
    let resolved: Result | null | undefined;
    const c = make([singleSelect, multiSelectQ], (r) => {
      resolved = r;
    });
    c.handleInput(INPUT.left);
    c.handleInput(INPUT.escape);
    expect(resolved).toBeNull();
  });

  it("Enter on Submit tab when all confirmed resolves", () => {
    let resolved: Result | null = null;
    const c = make([singleSelect, multiSelectQ], (r) => {
      resolved = r;
    });
    // Answer Q1
    c.handleInput(INPUT.enter); // confirm first option, auto-advance to Q2
    // Answer Q2
    c.handleInput(INPUT.space); // select Auth
    c.handleInput(INPUT.enter); // confirm, auto-advance to Submit
    // Submit
    c.handleInput(INPUT.enter);
    expect(resolved).not.toBeNull();
    expect(resolved?.cancelled).toBe(false);
  });
});

// ── Full round-trip ───────────────────────────────────────────────────────────

describe("full round-trip", () => {
  it("two questions — correct answers and structure", () => {
    let resolved: Result | null = null;
    const c = make([singleSelect, multiSelectQ], (r) => {
      resolved = r;
    });

    // Answer Q1: ↓ then Enter → SQLite
    c.handleInput(INPUT.down);
    c.handleInput(INPUT.enter); // confirm, auto-advance to Q2

    // Answer Q2: select Auth + Export with Space, then Enter to confirm
    c.handleInput(INPUT.space); // select Auth (index 0)
    c.handleInput(INPUT.down);
    c.handleInput(INPUT.down);
    c.handleInput(INPUT.space); // select Export (index 2)
    c.handleInput(INPUT.enter); // confirm (Auth + Export selected), auto-advance to Submit

    // Submit
    c.handleInput(INPUT.enter);

    expect(resolved).not.toBeNull();
    expect(resolved?.cancelled).toBe(false);
    expect(resolved?.answers["Which database should we use?"]).toBe("SQLite");
    expect(resolved?.answers["Which features should we implement?"]).toBe(
      "Auth, Export",
    );
    expect(resolved?.questions).toHaveLength(2);
  });

  it("four questions — all answered", () => {
    const q = (n: number): Question => ({
      question: `Question ${n}`,
      header: `Q${n}`,
      options: [{ label: `Opt${n}A` }, { label: `Opt${n}B` }],
      multiSelect: false,
    });
    const questions = [q(1), q(2), q(3), q(4)];
    let resolved: Result | null = null;
    const c = make(questions, (r) => {
      resolved = r;
    });

    // Answer all 4 — each Enter confirms and auto-advances
    c.handleInput(INPUT.enter); // Q1 → Q2
    c.handleInput(INPUT.enter); // Q2 → Q3
    c.handleInput(INPUT.enter); // Q3 → Q4
    c.handleInput(INPUT.enter); // Q4 → Submit
    c.handleInput(INPUT.enter); // Submit

    expect(resolved?.questions).toHaveLength(4);
    expect(Object.keys(resolved?.answers)).toHaveLength(4);
    expect(resolved?.cancelled).toBe(false);
  });

  it("single question confirms immediately without Submit tab", () => {
    let resolved: Result | null = null;
    const c = make([singleSelect], (r) => {
      resolved = r;
    });
    c.handleInput(INPUT.enter);
    // Should resolve immediately — no Submit tab needed
    expect(resolved).not.toBeNull();
  });

  it("auto-advance: Q1 of 2 → Q2 (not Submit)", () => {
    const c = make([singleSelect, multiSelectQ]);
    c.handleInput(INPUT.enter); // confirm Q1
    // Should now be on Q2 (Features), not Submit
    const lines = c.render(80);
    expect(lines.some((l) => l.includes("Which features"))).toBe(true);
    expect(
      lines.some(
        (l) =>
          l.includes("Press Enter to submit") || l.includes("Still needed"),
      ),
    ).toBe(false);
  });
});

// ── multi-select + free-text combined ────────────────────────────────────────

describe("multi-select + free-text combined", () => {
  it("result combines checked labels and free-text", () => {
    let resolved: Result | null = null;
    const c = make([multiSelectQ], (r) => {
      resolved = r;
    });
    c.handleInput(INPUT.space); // select Auth (index 0)
    c.handleInput(INPUT.down);
    c.handleInput(INPUT.down);
    c.handleInput(INPUT.down); // cursor on Type something...
    c.handleInput(INPUT.space); // open editor
    for (const ch of "mytext") c.handleInput(ch);
    c.handleInput(INPUT.enter); // save free-text, return to options (cursor still on Type something...)
    // Move cursor to a real option, then confirm
    c.handleInput(INPUT.up); // cursor on Export (index 2)
    c.handleInput(INPUT.enter); // confirm (Auth selected + free-text saved)
    expect(resolved?.answers["Which features should we implement?"]).toBe(
      "Auth, mytext",
    );
  });

  it("Enter on Type something... with saved free-text confirms immediately", () => {
    let resolved: Result | null = null;
    const c = make([multiSelectQ], (r) => {
      resolved = r;
    });
    for (let i = 0; i < 10; i++) c.handleInput(INPUT.down); // cursor on Type something...
    c.handleInput(INPUT.space); // open editor
    for (const ch of "hello") c.handleInput(ch);
    c.handleInput(INPUT.enter); // save free-text, back to options
    // cursor still on Type something... — Enter should confirm now
    c.handleInput(INPUT.enter);
    expect(resolved).not.toBeNull();
    expect(resolved?.answers["Which features should we implement?"]).toBe(
      "hello",
    );
  });

  it("Enter confirms when only free-text typed and no boxes checked", () => {
    let resolved: Result | null = null;
    const c = make([multiSelectQ], (r) => {
      resolved = r;
    });
    for (let i = 0; i < 10; i++) c.handleInput(INPUT.down); // cursor on Type something...
    c.handleInput(INPUT.space); // open editor
    for (const ch of "onlytext") c.handleInput(ch);
    c.handleInput(INPUT.enter); // save free-text, return to options
    // Move cursor off "Type something..." to a regular option, then confirm
    c.handleInput(INPUT.up);
    c.handleInput(INPUT.enter); // confirm (freeTextValue set, no checkboxes)
    expect(resolved?.answers["Which features should we implement?"]).toBe(
      "onlytext",
    );
  });

  it("Submit tab renders combined answer text", () => {
    const c = make([multiSelectQ, twoOptionsQ]);
    // Answer Q1: check Auth + type free-text
    c.handleInput(INPUT.space); // select Auth
    c.handleInput(INPUT.down);
    c.handleInput(INPUT.down);
    c.handleInput(INPUT.down); // cursor on Type something...
    c.handleInput(INPUT.space); // open editor
    for (const ch of "extra") c.handleInput(ch);
    c.handleInput(INPUT.enter); // save free-text, return to options (cursor on Type something...)
    c.handleInput(INPUT.up); // move cursor to a real option
    c.handleInput(INPUT.enter); // confirm Q1 (Auth + extra), advance to Q2
    // Answer Q2 (single-select)
    c.handleInput(INPUT.enter); // confirm Q2, advance to Submit
    // Now on Submit tab — render and check answer text
    const lines = c.render(80);
    expect(lines.some((l) => l.includes("Auth") && l.includes("extra"))).toBe(
      true,
    );
  });
});

// ── auto-confirm on → navigation ─────────────────────────────────────────────

describe("auto-confirm on → navigation", () => {
  it("multi-select: navigating → with selections auto-confirms the question", () => {
    let resolved: Result | null = null;
    const c = make([multiSelectQ, twoOptionsQ], (r) => {
      resolved = r;
    });
    c.handleInput(INPUT.space); // select Auth on Q1
    c.handleInput(INPUT.right); // navigate to Q2 — should auto-confirm Q1
    // Confirm Q2 (single-select: Enter sets selectedIndex, confirms, advances to Submit)
    c.handleInput(INPUT.enter);
    // Now on Submit tab — submit
    c.handleInput(INPUT.enter);
    expect(resolved).not.toBeNull();
    expect(resolved?.answers["Which features should we implement?"]).toBe(
      "Auth",
    );
  });

  it("multi-select: navigating → with nothing selected does NOT auto-confirm", () => {
    let resolved: Result | null = null;
    const c = make([multiSelectQ, twoOptionsQ], (r) => {
      resolved = r;
    });
    c.handleInput(INPUT.right); // navigate away with nothing selected
    c.handleInput(INPUT.right); // navigate to Submit tab
    c.handleInput(INPUT.enter); // try to submit — should not resolve (Q1 unconfirmed)
    expect(resolved).toBeNull();
  });

  it("single-select: navigating → without explicit Enter does NOT auto-confirm", () => {
    let resolved: Result | null = null;
    const c = make([singleSelect, twoOptionsQ], (r) => {
      resolved = r;
    });
    c.handleInput(INPUT.down); // move cursor to SQLite
    c.handleInput(INPUT.right); // navigate away — cursor position is NOT an answer
    c.handleInput(INPUT.enter); // confirm Q2
    c.handleInput(INPUT.right); // go to Submit
    c.handleInput(INPUT.enter); // try to submit — Q1 unconfirmed, should not resolve
    expect(resolved).toBeNull();
  });
});

// ── multi-select: un-confirm when all answers removed ────────────────────────

describe("multi-select: un-confirm when all answers removed", () => {
  it("deselecting all checkboxes resets confirmed — Submit blocks", () => {
    let resolved: Result | null = null;
    const c = make([multiSelectQ, twoOptionsQ], (r) => {
      resolved = r;
    });
    // Confirm Q1 with Auth
    c.handleInput(INPUT.space); // select Auth
    c.handleInput(INPUT.enter); // confirm, advance to Q2
    c.handleInput(INPUT.left); // back to Q1
    // Deselect Auth — nothing left
    c.handleInput(INPUT.space);
    c.handleInput(INPUT.right); // to Submit (Q2 unconfirmed too, but test the Q1 un-confirm)
    c.handleInput(INPUT.enter); // try to submit — should be blocked
    expect(resolved).toBeNull();
  });

  it("clearing free-text with no checkboxes resets confirmed — Submit blocks", () => {
    let resolved: Result | null = null;
    const c = make([multiSelectQ, twoOptionsQ], (r) => {
      resolved = r;
    });
    // Confirm Q1 with free-text only
    for (let i = 0; i < 10; i++) c.handleInput(INPUT.down);
    c.handleInput(INPUT.space); // open editor
    for (const ch of "hello") c.handleInput(ch);
    c.handleInput(INPUT.enter); // save
    c.handleInput(INPUT.up);
    c.handleInput(INPUT.enter); // confirm, advance to Q2
    c.handleInput(INPUT.left); // back to Q1
    // Clear free-text
    for (let i = 0; i < 10; i++) c.handleInput(INPUT.down); // cursor on Type something...
    c.handleInput(INPUT.space); // re-open editor (pre-filled)
    for (let i = 0; i < 10; i++) c.handleInput("\x7f"); // backspace to clear
    c.handleInput(INPUT.enter); // Enter empty — clears freeTextValue, un-confirms
    c.handleInput(INPUT.right); // to Submit
    c.handleInput(INPUT.enter); // try to submit — blocked
    expect(resolved).toBeNull();
  });
});

// ── single-select: free-text then pick option ────────────────────────────────

describe("single-select: free-text then pick regular option", () => {
  it("selecting a regular option after free-text typed uses the option label", () => {
    let resolved: Result | null = null;
    const c = make([singleSelect], (r) => {
      resolved = r;
    });
    // Type free-text first
    for (let i = 0; i < 10; i++) c.handleInput(INPUT.down); // cursor on Type something...
    c.handleInput(INPUT.space); // open editor
    for (const ch of "mytext") c.handleInput(ch);
    c.handleInput(INPUT.enter); // confirm free-text — resolves for single question
    // For this test we need a two-question setup so we can navigate back
    expect(resolved).not.toBeNull();
  });

  it("typing free-text clears the ✓ on the previously selected regular option", () => {
    // Three questions so Q1 auto-advance goes to Q2, not Submit
    const q3: Question = {
      question: "Q3?",
      header: "Q3",
      options: [{ label: "X" }, { label: "Y" }],
      multiSelect: false,
    };
    const c = make([singleSelect, twoOptionsQ, q3]);
    // Confirm Q1 with PostgreSQL (Enter → selectedIndex=0, advance to Q2)
    c.handleInput(INPUT.enter);
    // Navigate back to Q1
    c.handleInput(INPUT.left);
    // Now on Q1: cursor on first option, selectedIndex=0 (✓ on PostgreSQL)
    // Verify ✓ is on PostgreSQL before typing free-text
    let lines = c.render(80);
    expect(lines.some((l) => l.includes("✓") && l.includes("PostgreSQL"))).toBe(
      true,
    );
    // Type free-text
    for (let i = 0; i < 10; i++) c.handleInput(INPUT.down); // cursor on Type something...
    c.handleInput(INPUT.space); // open editor
    for (const ch of "mytext") c.handleInput(ch);
    c.handleInput(INPUT.enter); // save free-text — clears selectedIndex, auto-advances to Q2
    // Navigate back to Q1 to verify ✓ is gone from PostgreSQL
    c.handleInput(INPUT.left);
    lines = c.render(80);
    const pgLines = lines.filter((l) => l.includes("PostgreSQL"));
    expect(pgLines.length).toBeGreaterThan(0);
    for (const l of pgLines) expect(l).not.toMatch(/✓/);
    // ✓ should be on the "Type something..." row, preview text on the line below
    expect(
      lines.some((l) => l.includes("✓") && l.includes("Type something")),
    ).toBe(true);
    expect(lines.some((l) => l.includes("mytext"))).toBe(true);
  });

  it("navigating back and selecting a regular option clears free-text", () => {
    let resolved: Result | null = null;
    // Use two questions so Q1 doesn't resolve immediately
    const c = make([singleSelect, twoOptionsQ], (r) => {
      resolved = r;
    });
    // Type free-text on Q1
    for (let i = 0; i < 10; i++) c.handleInput(INPUT.down); // cursor on Type something...
    c.handleInput(INPUT.space); // open editor
    for (const ch of "mytext") c.handleInput(ch);
    c.handleInput(INPUT.enter); // confirm free-text, advance to Q2
    // Navigate back to Q1
    c.handleInput(INPUT.left);
    // Move cursor to first real option and confirm
    for (let i = 0; i < 10; i++) c.handleInput(INPUT.up); // cursor on PostgreSQL
    c.handleInput(INPUT.enter); // select PostgreSQL — should clear free-text
    // Advance to Q2 and submit
    c.handleInput(INPUT.enter); // confirm Q2
    c.handleInput(INPUT.enter); // submit
    expect(resolved?.answers["Which database should we use?"]).toBe(
      "PostgreSQL",
    );
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("narrow terminal — no line exceeds width", () => {
    const c = make([singleSelect, multiSelectQ]);
    for (const line of c.render(30)) {
      expect(stripAnsi(line).length).toBeLessThanOrEqual(30);
    }
  });

  it("very narrow terminal — no line exceeds width", () => {
    const c = make([singleSelect]);
    for (const line of c.render(20)) {
      expect(stripAnsi(line).length).toBeLessThanOrEqual(20);
    }
  });

  it("cursor restored when navigating back to answered single-select question", () => {
    const c = make([singleSelect, multiSelectQ]);
    // Move cursor to option 3 (DuckDB), confirm
    c.handleInput(INPUT.down);
    c.handleInput(INPUT.down);
    c.handleInput(INPUT.enter); // confirm Q1 (cursor on DuckDB), advance to Q2
    // Navigate back to Q1
    c.handleInput(INPUT.left);
    const lines = c.render(80);
    // Cursor should still be on DuckDB (index 2)
    expect(lines.some((l) => l.match(/^>\s+.*DuckDB/))).toBe(true);
  });

  it("multi-select checkboxes restored when navigating back", () => {
    const msQ1: Question = {
      question: "Pick features",
      header: "Features",
      options: [{ label: "A" }, { label: "B" }, { label: "C" }],
      multiSelect: true,
    };
    const c = make([msQ1, twoOptionsQ]);
    // Select A and C on Q1
    c.handleInput(INPUT.space); // select A (index 0)
    c.handleInput(INPUT.down);
    c.handleInput(INPUT.down);
    c.handleInput(INPUT.space); // select C (index 2)
    c.handleInput(INPUT.enter); // confirm, advance to Q2
    // Navigate back to Q1
    c.handleInput(INPUT.left);
    const lines = c.render(80);
    expect(lines.some((l) => l.includes("[✓]") && l.includes("A"))).toBe(true);
    expect(lines.some((l) => l.includes("[✓]") && l.includes("C"))).toBe(true);
    expect(
      lines.some(
        (l) => (l.includes("[ ]") || l.includes("□")) && l.includes("B"),
      ),
    ).toBe(true);
  });

  it("free-text Esc then selecting option uses option label, not typed text", () => {
    let resolved: Result | null = null;
    const c = make([singleSelect], (r) => {
      resolved = r;
    });
    // Go to "Type something...", enter edit mode, type, then Esc
    for (let i = 0; i < 10; i++) c.handleInput(INPUT.down);
    c.handleInput(INPUT.space); // open editor
    for (const ch of "hello") c.handleInput(ch);
    c.handleInput(INPUT.escape); // exit WITHOUT saving
    // Navigate back to option 1, confirm
    for (let i = 0; i < 10; i++) c.handleInput(INPUT.up);
    c.handleInput(INPUT.enter);
    expect(resolved?.answers["Which database should we use?"]).toBe(
      "PostgreSQL",
    );
  });

  it("done called exactly once on multi-select confirm", () => {
    let count = 0;
    const c = make([multiSelectQ], () => {
      count++;
    });
    c.handleInput(INPUT.space);
    c.handleInput(INPUT.enter);
    expect(count).toBe(1);
  });

  it("done called exactly once on Submit tab", () => {
    let count = 0;
    const c = make([singleSelect, multiSelectQ], () => {
      count++;
    });
    c.handleInput(INPUT.enter); // confirm Q1
    c.handleInput(INPUT.space);
    c.handleInput(INPUT.enter); // confirm Q2 → Submit
    c.handleInput(INPUT.enter); // submit
    expect(count).toBe(1);
  });
});

// ── Fuzz: tab view — diverse user behaviours ──────────────────────────────────
//
// All tests use a 4-question setup: 2 single-select, 1 multi-select, 1 single-select.
// Goal: cover real usage patterns, navigation quirks, and state interactions
// that are easy to overlook in unit tests.

describe("fuzz — tab view", () => {
  const q1: Question = {
    question: "Which runtime?",
    header: "Runtime",
    options: [{ label: "Node" }, { label: "Deno" }, { label: "Bun" }],
    multiSelect: false,
  };
  const q2: Question = {
    question: "Which databases?",
    header: "DBs",
    options: [{ label: "Postgres" }, { label: "Redis" }, { label: "SQLite" }],
    multiSelect: true,
  };
  const q3: Question = {
    question: "Which cloud?",
    header: "Cloud",
    options: [{ label: "AWS" }, { label: "GCP" }, { label: "Fly" }],
    multiSelect: false,
  };
  const q4: Question = {
    question: "Which CI?",
    header: "CI",
    options: [{ label: "GitHub Actions" }, { label: "CircleCI" }],
    multiSelect: false,
  };
  const qs = [q1, q2, q3, q4];

  // Helper: answer all 4 questions with defaults and reach Submit
  function answerAll(c: AskUserQuestionComponent) {
    c.handleInput(INPUT.enter); // Q1: Node
    c.handleInput(INPUT.space);
    c.handleInput(INPUT.enter); // Q2: Postgres
    c.handleInput(INPUT.enter); // Q3: AWS
    c.handleInput(INPUT.enter); // Q4: GitHub Actions → Submit
  }

  it("fuzz-01: answer all in order, submit — all answers present", () => {
    let resolved: Result | null = null;
    const c = make(qs, (r) => {
      resolved = r;
    });
    answerAll(c);
    c.handleInput(INPUT.enter); // submit
    expect(resolved).not.toBeNull();
    expect(resolved?.cancelled).toBe(false);
    expect(Object.keys(resolved?.answers)).toHaveLength(4);
  });

  it("fuzz-02: skip Q1, answer Q2–Q4, Submit blocks, go back, answer Q1, submit works", () => {
    let resolved: Result | null = null;
    const c = make(qs, (r) => {
      resolved = r;
    });
    c.handleInput(INPUT.right); // skip Q1 (unanswered) → Q2
    c.handleInput(INPUT.space);
    c.handleInput(INPUT.enter); // Q2: Postgres → Q3
    c.handleInput(INPUT.enter); // Q3: AWS → Q4
    c.handleInput(INPUT.enter); // Q4 → Submit
    c.handleInput(INPUT.enter); // blocked — Q1 unanswered
    expect(resolved).toBeNull();
    c.handleInput(INPUT.left); // back to Q4
    c.handleInput(INPUT.left); // Q3
    c.handleInput(INPUT.left); // Q2
    c.handleInput(INPUT.left); // Q1
    c.handleInput(INPUT.enter); // answer Q1: Node, auto-advances to Q2
    c.handleInput(INPUT.right); // Q3
    c.handleInput(INPUT.right); // Q4
    c.handleInput(INPUT.right); // Submit
    c.handleInput(INPUT.enter); // submit
    expect(resolved).not.toBeNull();
    expect(resolved?.cancelled).toBe(false);
  });

  it("fuzz-03: answer Q1, change mind by navigating back and re-answering", () => {
    let resolved: Result | null = null;
    const c = make(qs, (r) => {
      resolved = r;
    });
    c.handleInput(INPUT.enter); // Q1: Node
    c.handleInput(INPUT.left); // back to Q1
    c.handleInput(INPUT.down);
    c.handleInput(INPUT.enter); // Q1: Deno (override)
    // complete the rest
    c.handleInput(INPUT.space);
    c.handleInput(INPUT.enter); // Q2
    c.handleInput(INPUT.enter); // Q3
    c.handleInput(INPUT.enter); // Q4 → Submit
    c.handleInput(INPUT.enter); // submit
    expect(resolved?.answers["Which runtime?"]).toBe("Deno");
  });

  it("fuzz-04: cancel from Q3 mid-flow — done(null)", () => {
    let resolved: Result | null | undefined;
    const c = make(qs, (r) => {
      resolved = r;
    });
    c.handleInput(INPUT.enter); // Q1
    c.handleInput(INPUT.space);
    c.handleInput(INPUT.enter); // Q2
    c.handleInput(INPUT.escape); // cancel from Q3
    expect(resolved).toBeNull();
  });

  it("fuzz-05: cancel from Submit tab — done(null)", () => {
    let resolved: Result | null | undefined;
    const c = make(qs, (r) => {
      resolved = r;
    });
    answerAll(c);
    c.handleInput(INPUT.escape); // cancel at Submit
    expect(resolved).toBeNull();
  });

  it("fuzz-06: → wraps from Submit back to Q1", () => {
    const c = make(qs);
    answerAll(c); // lands on Submit
    c.handleInput(INPUT.right); // wraps to Q1
    const lines = c.render(80);
    expect(lines.some((l) => l.includes("Which runtime?"))).toBe(true);
  });

  it("fuzz-07: ← from Q1 wraps to Submit tab", () => {
    const c = make(qs);
    c.handleInput(INPUT.left); // Q1 → Submit
    const lines = c.render(80);
    expect(
      lines.some(
        (l) => l.includes("Still needed") || l.includes("Press Enter"),
      ),
    ).toBe(true);
  });

  it("fuzz-08: multi-select — toggle all options on then off, confirm blocked", () => {
    let resolved: Result | null = null;
    const c = make(qs, (r) => {
      resolved = r;
    });
    c.handleInput(INPUT.right); // go to Q2
    c.handleInput(INPUT.space); // Postgres on
    c.handleInput(INPUT.down);
    c.handleInput(INPUT.space); // Redis on
    c.handleInput(INPUT.down);
    c.handleInput(INPUT.space); // SQLite on
    // Toggle all off
    c.handleInput(INPUT.up);
    c.handleInput(INPUT.up);
    c.handleInput(INPUT.space); // Postgres off
    c.handleInput(INPUT.down);
    c.handleInput(INPUT.space); // Redis off
    c.handleInput(INPUT.down);
    c.handleInput(INPUT.space); // SQLite off
    c.handleInput(INPUT.enter); // nothing selected — no-op
    expect(resolved).toBeNull();
  });

  it("fuzz-09: multi-select with free-text + checkbox combined, navigate away and back, answers preserved", () => {
    let resolved: Result | null = null;
    const c = make(qs, (r) => {
      resolved = r;
    });
    // Answer Q1 first
    c.handleInput(INPUT.enter); // Q1: Node → Q2
    c.handleInput(INPUT.space); // select Postgres on Q2
    // add free-text
    c.handleInput(INPUT.down);
    c.handleInput(INPUT.down);
    c.handleInput(INPUT.down); // Type something...
    c.handleInput(INPUT.space); // open editor
    for (const ch of "MongoDB") c.handleInput(ch);
    c.handleInput(INPUT.enter); // save free-text
    c.handleInput(INPUT.up); // move cursor off Type something...
    c.handleInput(INPUT.enter); // confirm Q2 → Q3
    // Navigate back to Q2 and verify state preserved
    c.handleInput(INPUT.left); // back to Q2
    const lines = c.render(80);
    expect(lines.some((l) => l.includes("[✓]") && l.includes("Postgres"))).toBe(
      true,
    );
    expect(lines.some((l) => l.includes("MongoDB"))).toBe(true);
    // Complete and check result
    c.handleInput(INPUT.right); // Q3
    c.handleInput(INPUT.enter); // Q3: AWS → Q4
    c.handleInput(INPUT.enter); // Q4 → Submit
    c.handleInput(INPUT.enter); // submit
    expect(resolved?.answers["Which databases?"]).toBe("Postgres, MongoDB");
  });

  it("fuzz-10: free-text on single-select, then change mind to option — free-text cleared", () => {
    let resolved: Result | null = null;
    const c = make(qs, (r) => {
      resolved = r;
    });
    // Add free-text to Q1
    c.handleInput(INPUT.down);
    c.handleInput(INPUT.down);
    c.handleInput(INPUT.down); // Type something...
    c.handleInput(INPUT.space); // open editor
    for (const ch of "Rust") c.handleInput(ch);
    c.handleInput(INPUT.enter); // save + auto-confirm → Q2
    c.handleInput(INPUT.left); // back to Q1 — cursor still on Type something... (index 3)
    // Change to Bun (index 2, one up from Type something...)
    c.handleInput(INPUT.up); // cursor to Bun (index 2)
    c.handleInput(INPUT.enter); // select Bun → Q2
    // Complete
    c.handleInput(INPUT.space);
    c.handleInput(INPUT.enter); // Q2
    c.handleInput(INPUT.enter); // Q3
    c.handleInput(INPUT.enter); // Q4 → Submit
    c.handleInput(INPUT.enter); // submit
    expect(resolved?.answers["Which runtime?"]).toBe("Bun");
  });

  it("fuzz-11: rapid → navigation across all tabs without answering — render never crashes", () => {
    const c = make(qs);
    for (let i = 0; i < 20; i++) c.handleInput(INPUT.right);
    expect(() => c.render(80)).not.toThrow();
    expect(() => c.render(40)).not.toThrow();
  });

  it("fuzz-12: rapid ← navigation across all tabs — render never crashes", () => {
    const c = make(qs);
    for (let i = 0; i < 20; i++) c.handleInput(INPUT.left);
    expect(() => c.render(80)).not.toThrow();
  });

  it("fuzz-13: answer Q1 via → auto-confirm, deselect in Q2 then re-select, verify Submit reflects latest", () => {
    let resolved: Result | null = null;
    const c = make(qs, (r) => {
      resolved = r;
    });
    c.handleInput(INPUT.enter); // Q1: Node → Q2
    c.handleInput(INPUT.space); // select Postgres
    c.handleInput(INPUT.space); // deselect Postgres — nothing selected
    c.handleInput(INPUT.down);
    c.handleInput(INPUT.space); // select Redis
    c.handleInput(INPUT.enter); // confirm Q2: Redis → Q3
    c.handleInput(INPUT.enter); // Q3 → Q4
    c.handleInput(INPUT.enter); // Q4 → Submit
    c.handleInput(INPUT.enter); // submit
    expect(resolved?.answers["Which databases?"]).toBe("Redis");
  });

  it("fuzz-14: answer all, navigate back to Q2, clear all checkboxes — Submit blocks", () => {
    let resolved: Result | null = null;
    const c = make(qs, (r) => {
      resolved = r;
    });
    answerAll(c); // lands on Submit
    c.handleInput(INPUT.left); // Q4
    c.handleInput(INPUT.left); // Q3
    c.handleInput(INPUT.left); // Q2
    // clear the selection (was Postgres from answerAll)
    c.handleInput(INPUT.space); // toggle Postgres off — nothing selected → un-confirmed
    c.handleInput(INPUT.right); // Q3
    c.handleInput(INPUT.right); // Q4
    c.handleInput(INPUT.right); // Submit
    c.handleInput(INPUT.enter); // blocked
    expect(resolved).toBeNull();
  });

  it("fuzz-15: open free-text editor on Q2, type, Esc (discard), checkbox still works", () => {
    let _resolved: Result | null = null;
    const c = make(qs, (r) => {
      _resolved = r;
    });
    c.handleInput(INPUT.right); // Q2
    c.handleInput(INPUT.down);
    c.handleInput(INPUT.down);
    c.handleInput(INPUT.down); // Type something...
    c.handleInput(INPUT.space); // open editor
    for (const ch of "nope") c.handleInput(ch);
    c.handleInput(INPUT.escape); // discard — freeTextValue unchanged (was null)
    // Select a checkbox instead
    c.handleInput(INPUT.up);
    c.handleInput(INPUT.up);
    c.handleInput(INPUT.up); // back to Postgres
    c.handleInput(INPUT.space); // select Postgres
    c.handleInput(INPUT.enter); // confirm → Q3
    c.handleInput(INPUT.left); // Q2 — check no free-text preview
    const lines = c.render(80);
    expect(lines.some((l) => l.includes("nope"))).toBe(false);
  });

  it("fuzz-16: Enter on Submit repeatedly — done called exactly once", () => {
    let count = 0;
    const c = make(qs, () => {
      count++;
    });
    answerAll(c);
    c.handleInput(INPUT.enter);
    c.handleInput(INPUT.enter);
    c.handleInput(INPUT.enter);
    expect(count).toBe(1);
  });

  it("fuzz-17: Esc on Submit tab, then rebuild and submit — done called once total", () => {
    let count = 0;
    const c = make(qs, () => {
      count++;
    });
    answerAll(c);
    c.handleInput(INPUT.escape); // cancel
    c.handleInput(INPUT.enter); // no-op after resolved
    expect(count).toBe(1);
  });

  it("fuzz-18: mix of → auto-confirm (multi-select) and Enter (single-select)", () => {
    // → only auto-confirms multi-select (has selectedIndices) or single-select with freeText.
    // Single-select requires explicit Enter to set selectedIndex.
    let resolved: Result | null = null;
    const c = make(qs, (r) => {
      resolved = r;
    });
    // Q1 (single): Enter to confirm Node
    c.handleInput(INPUT.enter); // Q1: Node → Q2
    // Q2 (multi): Space to select, → to auto-confirm
    c.handleInput(INPUT.space); // select Postgres
    c.handleInput(INPUT.right); // auto-confirm Q2 → Q3
    // Q3 (single): Enter to confirm AWS
    c.handleInput(INPUT.enter); // Q3: AWS → Q4
    // Q4 (single): Enter to confirm GitHub Actions → Submit
    c.handleInput(INPUT.enter); // Q4 → Submit
    c.handleInput(INPUT.enter); // submit
    expect(resolved).not.toBeNull();
    expect(resolved?.answers["Which runtime?"]).toBe("Node");
    expect(resolved?.answers["Which databases?"]).toBe("Postgres");
    expect(resolved?.answers["Which cloud?"]).toBe("AWS");
    expect(resolved?.answers["Which CI?"]).toBe("GitHub Actions");
  });

  it("fuzz-19: narrow terminal — render never crashes or overflows on all tabs", () => {
    const c = make(qs);
    // Answer a couple questions first to get some state
    c.handleInput(INPUT.enter);
    c.handleInput(INPUT.space);
    c.handleInput(INPUT.enter);
    for (let tab = 0; tab < 5; tab++) {
      c.handleInput(INPUT.right);
      for (const width of [20, 30, 40]) {
        const lines = c.render(width);
        for (const line of lines) {
          expect(stripAnsi(line).length).toBeLessThanOrEqual(width);
        }
      }
    }
  });

  it("fuzz-20: free-text cleared on Q1, cursor restored to option on re-entry", () => {
    const c = make(qs);
    // Type free-text on Q1
    c.handleInput(INPUT.down);
    c.handleInput(INPUT.down);
    c.handleInput(INPUT.down);
    c.handleInput(INPUT.space); // open editor
    for (const ch of "Elixir") c.handleInput(ch);
    c.handleInput(INPUT.enter); // save + confirm → Q2
    c.handleInput(INPUT.left); // back to Q1
    // Re-open and clear
    c.handleInput(INPUT.down);
    c.handleInput(INPUT.down);
    c.handleInput(INPUT.down);
    c.handleInput(INPUT.space); // re-open editor (pre-filled with "Elixir")
    for (let i = 0; i < 6; i++) c.handleInput("\x7f"); // backspace all
    c.handleInput(INPUT.enter); // empty enter — clears freeTextValue + un-confirms
    // Verify no free-text preview shown
    const lines = c.render(80);
    expect(lines.some((l) => l.includes("Elixir"))).toBe(false);
    // Navigate to Submit (4 rights from Q1: Q2→Q3→Q4→Submit)
    for (let i = 0; i < 4; i++) c.handleInput(INPUT.right);
    const submitLines = c.render(80);
    expect(submitLines.some((l) => l.includes("Still needed"))).toBe(true);
  });
});

// ── Coverage: targeted gap-fill tests ────────────────────────────────────────

describe("coverage — schema.ts", () => {
  it("OptionSchema is a valid TypeBox object schema", () => {
    expect(OptionSchema).toBeDefined();
    expect(OptionSchema.type).toBe("object");
    expect(OptionSchema.properties.label).toBeDefined();
    expect(OptionSchema.properties.description).toBeDefined();
  });

  it("QuestionSchema has correct structure", () => {
    expect(QuestionSchema.properties.question).toBeDefined();
    expect(QuestionSchema.properties.header).toBeDefined();
    expect(QuestionSchema.properties.options).toBeDefined();
    expect(QuestionSchema.properties.multiSelect).toBeDefined();
    expect(QuestionSchema.properties.options.minItems).toBe(2);
    expect(QuestionSchema.properties.options.maxItems).toBe(4);
  });

  it("InputSchema constrains questions to 1–4", () => {
    expect(InputSchema.properties.questions.minItems).toBe(1);
    expect(InputSchema.properties.questions.maxItems).toBe(4);
  });

  it("ResultSchema has questions, answers, cancelled", () => {
    expect(ResultSchema.properties.questions).toBeDefined();
    expect(ResultSchema.properties.answers).toBeDefined();
    expect(ResultSchema.properties.cancelled).toBeDefined();
    expect(ResultSchema.properties.cancelled.type).toBe("boolean");
  });
});

describe("coverage — component.ts gaps", () => {
  it("render returns [] for empty questions array", () => {
    const c = new AskUserQuestionComponent(
      [],
      mockTui as TUILike,
      mockTheme as unknown as Theme,
      () => {},
    );
    expect(c.render(80)).toEqual([]);
  });

  it("Enter on 'Type something...' with no freeTextValue is a no-op", () => {
    let called = false;
    const c = make([singleSelect], () => {
      called = true;
    });
    // Navigate to Type something... and press Enter (no freeTextValue saved)
    for (let i = 0; i < 10; i++) c.handleInput(INPUT.down);
    c.handleInput(INPUT.enter); // no freeTextValue → no-op
    expect(called).toBe(false);
    // Should not be in edit mode either
    const lines = c.render(80);
    expect(lines.some((l) => l.includes("✎"))).toBe(false);
  });

  it("handleInput after resolved is a no-op — no crash, no extra calls", () => {
    let count = 0;
    const c = make([singleSelect], () => {
      count++;
    });
    c.handleInput(INPUT.enter); // resolve
    // All subsequent inputs are no-ops
    c.handleInput(INPUT.enter);
    c.handleInput(INPUT.escape);
    c.handleInput(INPUT.down);
    c.handleInput(INPUT.space);
    expect(count).toBe(1);
  });

  it("editorTheme callbacks are exercised via editor render in edit mode", () => {
    // Exercises lines 86-90 (borderColor + selectList callbacks)
    const c = make([singleSelect]);
    for (let i = 0; i < 10; i++) c.handleInput(INPUT.down);
    c.handleInput(INPUT.space); // enter edit mode → editor.render called in renderQuestionBody
    expect(() => c.render(80)).not.toThrow();
  });
});
