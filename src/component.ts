import {
  type Component,
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  truncateToWidth,
  type TUI,
  wrapTextWithAnsi,
} from "@mariozechner/pi-tui";
import { Theme } from "@mariozechner/pi-coding-agent";
import type { Question, Option, Result } from "./schema.ts";

// ── TUILike ───────────────────────────────────────────────────────────────────
// Minimal interface satisfied by both the real TUI and a test stub.
export interface TUILike {
  requestRender(): void;
}

// ── QuestionState ─────────────────────────────────────────────────────────────
interface QuestionState {
  /** Currently highlighted option index (cursor row) */
  cursorIndex: number;
  /** For multiSelect: set of selected option indices */
  selectedIndices: Set<number>;
  /** Whether the user has confirmed this question */
  confirmed: boolean;
  /** Free-text answer typed by the user; null = free-text not chosen */
  freeTextValue: string | null;
  /** Whether the inline Editor is currently active */
  inEditMode: boolean;
}

type DisplayOption = Option & { isOther?: true };

// ── AskUserQuestionComponent ──────────────────────────────────────────────────
export class AskUserQuestionComponent implements Component {
  private questions: Question[];
  private theme: Theme;
  private tui: TUILike;
  private done: (result: Result | null) => void;

  private states: QuestionState[];
  private activeTab: number = 0;
  private editor: Editor;

  // Render cache
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(
    questions: Question[],
    tui: TUILike,
    theme: Theme,
    done: (result: Result | null) => void,
  ) {
    this.questions = questions;
    this.tui = tui;
    this.theme = theme;
    this.done = done;

    this.states = questions.map(() => ({
      cursorIndex: 0,
      selectedIndices: new Set<number>(),
      confirmed: false,
      freeTextValue: null,
      inEditMode: false,
    }));

    const editorTheme: EditorTheme = {
      borderColor: (s) => theme.fg("muted", s),
      selectList: {
        selectedPrefix: (s) => theme.fg("accent", s),
        selectedText: (s) => theme.fg("accent", s),
        description: (s) => theme.fg("muted", s),
        scrollInfo: (s) => theme.fg("dim", s),
        noMatch: (s) => theme.fg("warning", s),
      },
    };

    this.editor = new Editor(tui as TUI, editorTheme);
    this.editor.disableSubmit = true;
    this.editor.onChange = () => {
      this.invalidate();
      this.tui.requestRender();
    };

    this.invalidate();
  }

  // ── Derived helpers ─────────────────────────────────────────────────────────

  private allOptions(q: Question): DisplayOption[] {
    return [...q.options, { label: "Type something...", isOther: true as const }];
  }

  private allConfirmed(): boolean {
    return this.states.every((s) => s.confirmed);
  }

  private get isSingle(): boolean {
    return this.questions.length === 1;
  }

  private get totalTabs(): number {
    return this.questions.length + 1; // questions + Submit
  }

  // ── Public interface ────────────────────────────────────────────────────────

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  // ── Private navigation helpers (implemented in next TODO) ───────────────────
  // Stubs so the constructor compiles cleanly.

  render(_width: number): string[] {
    // Implemented in TODO-1ce2b5e9
    return [];
  }

  handleInput(_data: string): void {
    // Implemented in TODO-f0705cca
  }
}
