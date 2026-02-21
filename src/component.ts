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

  // Guard: prevent done() being called more than once
  private _resolved: boolean = false;

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

  // ── render() ────────────────────────────────────────────────────────────────

  render(width: number): string[] {
    if (this.cachedWidth === width && this.cachedLines) {
      return this.cachedLines;
    }

    if (this.questions.length === 0) {
      return [];
    }

    const t = this.theme;
    const lines: string[] = [];
    const add = (s: string) => lines.push(truncateToWidth(s, width));

    // ── Top separator ──
    add(t.fg("accent", "─".repeat(width)));

    // ── Tab bar (multi-question only) ──
    if (!this.isSingle) {
      this.renderTabBar(width, add);
      lines.push("");
    }

    // ── Question body or Submit tab ──
    const q = this.questions[this.activeTab];
    if (!q) {
      // activeTab is on Submit tab (or out of bounds) — render Submit view
      this.renderSubmitTab(width, add);
    } else {
      const state = this.states[this.activeTab];
      this.renderQuestionBody(q, state, width, add);
    }

    // ── Bottom separator ──
    add(t.fg("accent", "─".repeat(width)));

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  private renderTabBar(width: number, add: (s: string) => void): void {
    const t = this.theme;
    const parts: string[] = [" "];

    for (let i = 0; i < this.questions.length; i++) {
      const q = this.questions[i];
      const s = this.states[i];
      const isActive = i === this.activeTab;
      // Truncate header to 12 chars
      const header = truncateToWidth(q.header, 12);
      const label = ` ${header} `;

      let styled: string;
      if (isActive) {
        styled = t.bg("selectedBg", t.fg("text", label));
      } else if (s.confirmed) {
        styled = t.fg("success", ` ■${header} `);
      } else {
        styled = t.fg("muted", ` □${header} `);
      }
      parts.push(styled);
    }

    // Submit tab
    const isSubmitActive = this.activeTab === this.questions.length;
    const submitLabel = " ✓ Submit ";
    let submitStyled: string;
    if (isSubmitActive) {
      submitStyled = t.bg("selectedBg", t.fg("text", submitLabel));
    } else if (this.allConfirmed()) {
      submitStyled = t.fg("success", submitLabel);
    } else {
      submitStyled = t.fg("dim", submitLabel);
    }
    parts.push(submitStyled);

    add(parts.join(""));
  }

  private renderQuestionBody(
    q: Question,
    state: QuestionState,
    width: number,
    add: (s: string) => void,
  ): void {
    const t = this.theme;
    const opts = this.allOptions(q);

    // Question text (word-wrapped)
    lines_block: {
      const wrapped = wrapTextWithAnsi(t.fg("text", ` ${q.question}`), width - 2);
      for (const line of wrapped) {
        add(line);
      }
    }
    add("");

    // Options list
    for (let i = 0; i < opts.length; i++) {
      const opt = opts[i];
      const isSelected = i === state.cursorIndex;
      const isOther = opt.isOther === true;
      const prefix = isSelected ? t.fg("accent", ">") : " ";

      if (q.multiSelect && !isOther) {
        // Checkbox style
        const checked = state.selectedIndices.has(i);
        const box = checked ? t.fg("accent", "[✓]") : t.fg("dim", "[ ]");
        const labelColor = isSelected ? "accent" : "text";
        add(`${prefix} ${box} ${t.fg(labelColor, `${i + 1}. ${opt.label}`)}`);
      } else if (isOther) {
        // "Type something..." row
        const suffix = state.inEditMode ? t.fg("accent", " ✎") : "";
        const labelColor = isSelected ? "accent" : "muted";
        add(`${prefix}  ${t.fg(labelColor, `${i + 1}. ${opt.label}`)}${suffix}`);
      } else {
        // Single-select
        const labelColor = isSelected ? "accent" : "text";
        add(`${prefix}  ${t.fg(labelColor, `${i + 1}. ${opt.label}`)}`);
      }

      // Description (if present, not for "Type something...")
      if (!isOther && opt.description) {
        const indent = q.multiSelect ? "       " : "     ";
        const wrapped = wrapTextWithAnsi(t.fg("muted", opt.description), width - indent.length);
        for (const line of wrapped) {
          add(`${indent}${line}`);
        }
      }
    }

    // Inline editor (when in edit mode)
    if (state.inEditMode) {
      add("");
      add(t.fg("muted", " Your answer:"));
      const editorLines = this.editor.render(width - 4);
      for (const line of editorLines) {
        add(` ${line}`);
      }
    }

    add("");

    // Footer help
    if (state.inEditMode) {
      add(t.fg("dim", " Enter to submit · Esc to go back"));
    } else if (this.isSingle) {
      add(t.fg("dim", " ↑↓ navigate · Enter select · Esc cancel"));
    } else {
      add(t.fg("dim", " ←→/Tab switch tabs · ↑↓ navigate · Space toggle · Enter confirm · Esc cancel"));
    }
  }

  private renderSubmitTab(width: number, add: (s: string) => void): void {
    const t = this.theme;
    add(t.fg("accent", t.bold(" Ready to submit")));
    add("");

    for (const q of this.questions) {
      const state = this.states[this.questions.indexOf(q)];
      const answer = this.getAnswerText(q, state);
      if (answer !== null) {
        add(
          t.fg("muted", ` ${truncateToWidth(q.header, 12)}: `) +
            t.fg("text", answer),
        );
      } else {
        add(t.fg("warning", ` ${truncateToWidth(q.header, 12)}: (unanswered)`));
      }
    }

    add("");
    if (this.allConfirmed()) {
      add(t.fg("success", " Press Enter to submit"));
    } else {
      const missing = this.questions
        .filter((_, i) => !this.states[i].confirmed)
        .map((q) => truncateToWidth(q.header, 12))
        .join(", ");
      add(t.fg("warning", ` Unanswered: ${missing}`));
    }
    add("");
    add(t.fg("dim", " ←→/Tab switch tabs · Esc cancel"));
  }

  private getAnswerText(q: Question, state: QuestionState): string | null {
    if (!state.confirmed) return null;
    if (state.freeTextValue !== null) return state.freeTextValue;
    if (q.multiSelect) {
      const labels = [...state.selectedIndices]
        .sort((a, b) => a - b)
        .map((idx) => q.options[idx].label);
      return labels.join(", ");
    }
    return q.options[state.cursorIndex]?.label ?? null;
  }

  // ── Private navigation helpers ───────────────────────────────────────────────

  private moveCursor(delta: -1 | 1): void {
    const q = this.questions[this.activeTab];
    const state = this.states[this.activeTab];
    const max = this.allOptions(q).length - 1;
    state.cursorIndex = Math.max(0, Math.min(max, state.cursorIndex + delta));
    this.invalidate();
    this.tui.requestRender();
  }

  private toggleSelected(index: number): void {
    const state = this.states[this.activeTab];
    if (state.selectedIndices.has(index)) {
      state.selectedIndices.delete(index);
    } else {
      state.selectedIndices.add(index);
    }
    this.invalidate();
    this.tui.requestRender();
  }

  private enterEditMode(): void {
    const state = this.states[this.activeTab];
    state.inEditMode = true;
    // Restore previous free-text value if any
    if (state.freeTextValue !== null) {
      this.editor.setText(state.freeTextValue);
    } else {
      this.editor.setText("");
    }
    this.invalidate();
    this.tui.requestRender();
  }

  private exitEditMode(save: boolean): void {
    const state = this.states[this.activeTab];
    if (save) {
      state.freeTextValue = this.editor.getText().trim();
    } else {
      // Discard typed text — clear freeTextValue only if it was never confirmed
      // (if confirmed, freeTextValue holds the answer — don't touch it)
      if (!state.confirmed) {
        state.freeTextValue = null;
      }
    }
    this.editor.setText("");
    state.inEditMode = false;
    this.invalidate();
  }

  private confirmAndAdvance(): void {
    const state = this.states[this.activeTab];
    state.confirmed = true;
    this.advance();
  }

  private advance(): void {
    if (this.isSingle) {
      this.submit();
      return;
    }
    if (this.activeTab < this.questions.length - 1) {
      this.activeTab++;
    } else {
      this.activeTab = this.questions.length; // Submit tab
    }
    this.invalidate();
    this.tui.requestRender();
  }

  private submit(): void {
    this._resolved = true;
    this.done(this.buildResult());
  }

  private cancel(): void {
    this._resolved = true;
    this.done(null);
  }

  private buildResult(): Result {
    const answers: Record<string, string> = {};
    for (let i = 0; i < this.questions.length; i++) {
      const q = this.questions[i];
      const s = this.states[i];
      if (!s.confirmed) continue;
      if (s.freeTextValue !== null) {
        answers[q.question] = s.freeTextValue;
      } else if (q.multiSelect) {
        const labels = [...s.selectedIndices]
          .sort((a, b) => a - b)
          .map((idx) => q.options[idx].label);
        answers[q.question] = labels.join(", ");
      } else {
        answers[q.question] = q.options[s.cursorIndex].label;
      }
    }
    return { questions: this.questions, answers, cancelled: false };
  }

  // ── handleInput() ────────────────────────────────────────────────────────────

  handleInput(data: string): void {
    // Guard: once done has been called, ignore all further input
    if (this._resolved) return;

    // ── Submit tab ─────────────────────────────────────────────────────────────
    // Check Submit tab FIRST — states[activeTab] is undefined when on Submit tab
    if (!this.isSingle && this.activeTab === this.questions.length) {
      if (matchesKey(data, Key.enter)) {
        if (this.allConfirmed()) this.submit();
        return;
      }
      if (matchesKey(data, Key.escape)) {
        this.cancel();
        return;
      }
      if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
        this.activeTab = 0;
        this.invalidate();
        this.tui.requestRender();
        return;
      }
      if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
        this.activeTab = this.questions.length - 1;
        this.invalidate();
        this.tui.requestRender();
        return;
      }
      return;
    }

    const state = this.states[this.activeTab];

    // ── Edit mode: route to inline editor ──────────────────────────────────────
    if (state.inEditMode) {
      if (matchesKey(data, Key.escape)) {
        this.exitEditMode(false);
        this.tui.requestRender();
        return;
      }
      if (matchesKey(data, Key.enter)) {
        const text = this.editor.getText().trim();
        if (text) {
          this.exitEditMode(true);
          this.confirmAndAdvance();
        } else {
          this.exitEditMode(false);
          this.tui.requestRender();
        }
        return;
      }
      this.editor.handleInput(data);
      this.invalidate();
      this.tui.requestRender();
      return;
    }

    // ── Question tab ───────────────────────────────────────────────────────────
    if (matchesKey(data, Key.escape)) {
      this.cancel();
      return;
    }

    if (matchesKey(data, Key.tab) || (!this.isSingle && matchesKey(data, Key.right))) {
      if (!this.isSingle) {
        this.activeTab = (this.activeTab + 1) % this.totalTabs;
        this.invalidate();
        this.tui.requestRender();
      }
      return;
    }

    if (matchesKey(data, Key.shift("tab")) || (!this.isSingle && matchesKey(data, Key.left))) {
      if (!this.isSingle) {
        this.activeTab = (this.activeTab - 1 + this.totalTabs) % this.totalTabs;
        this.invalidate();
        this.tui.requestRender();
      }
      return;
    }

    if (matchesKey(data, Key.up)) {
      this.moveCursor(-1);
      return;
    }

    if (matchesKey(data, Key.down)) {
      this.moveCursor(1);
      return;
    }

    const q = this.questions[this.activeTab];
    const opts = this.allOptions(q);
    const onOther = state.cursorIndex === opts.length - 1;

    // "Type something..." — Enter or Space enters edit mode
    if (onOther) {
      if (matchesKey(data, Key.enter) || matchesKey(data, Key.space)) {
        this.enterEditMode();
        return;
      }
    }

    if (q.multiSelect) {
      if (matchesKey(data, Key.space) && !onOther) {
        this.toggleSelected(state.cursorIndex);
        return;
      }
      if (matchesKey(data, Key.enter) && !onOther) {
        if (state.selectedIndices.size > 0) {
          this.confirmAndAdvance();
        }
        return;
      }
    } else {
      if (matchesKey(data, Key.enter) && !onOther) {
        this.confirmAndAdvance();
        return;
      }
    }
  }
}
