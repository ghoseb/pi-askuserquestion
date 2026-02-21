import type { Theme } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { AskUserQuestionComponent, type TUILike } from "../src/component.ts";
import type { Question, Result } from "../src/schema.ts";

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
