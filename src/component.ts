import type { Theme } from "@mariozechner/pi-coding-agent";
import {
  type Component,
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  type TUI,
  truncateToWidth,
  wrapTextWithAnsi,
} from "@mariozechner/pi-tui";
import type { Option, Question, Result } from "./schema.ts";

// ── TUILike ───────────────────────────────────────────────────────────────────
// Minimal interface satisfied by both the real TUI and a test stub.
export interface TUILike {
  requestRender(): void;
}

// ── QuestionState ─────────────────────────────────────────────────────────────
interface QuestionState {
  /** Visual cursor position — where the highlight is, NOT the answer */
  cursorIndex: number;
  /** Single-select: explicitly chosen option index; null = nothing chosen yet */
  selectedIndex: number | null;
  /** For multiSelect: set of explicitly selected option indices */
  selectedIndices: Set<number>;
  /** Whether the user has confirmed this question */
  confirmed: boolean;
  /** Free-text answer typed by the user; null = free-text not chosen */
  freeTextValue: string | null;
  /** Whether the inline Editor is currently active */
  inEditMode: boolean;
}

// Column offsets for indenting descriptions and free-text previews,
// kept in sync with the actual rendered prefix widths:
//   single-select: prefix(1) + ' '(1) + check(1) + ' '(1) = 4 → indent = 5 (+ leading space)
//   multi-select:  prefix(1) + ' '(1) + box(3)   + ' '(1) = 6 → indent = 7 (+ leading space)
const SINGLE_INDENT = "     "; // 5 spaces
const MULTI_INDENT = "       "; // 7 spaces

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
      selectedIndex: null,
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
    return [
      ...q.options,
      { label: "Type something...", isOther: true as const },
    ];
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

  // Invalidate and request a re-render — used after every state mutation.
  private refresh(): void {
    this.invalidate();
    this.tui.requestRender();
  }

  // ── Canonical answer resolver ───────────────────────────────────────────────
  // Single source of truth for (question, state) → answer string.
  // Used by renderSubmitTab, buildResult, and autoConfirmIfAnswered.
  private resolveAnswer(q: Question, state: QuestionState): string | null {
    if (!state.confirmed) return null;
    if (q.multiSelect) {
      const labels = [...state.selectedIndices]
        .sort((a, b) => a - b)
        .map((i) => q.options[i].label);
      if (state.freeTextValue !== null) labels.push(state.freeTextValue);
      return labels.length > 0 ? labels.join(", ") : null;
    }
    if (state.freeTextValue !== null) return state.freeTextValue;
    if (state.selectedIndex !== null)
      return q.options[state.selectedIndex].label;
    return null;
  }

  // ── Tab styling helper ──────────────────────────────────────────────────────
  private styleTab(label: string, isActive: boolean, isReady: boolean): string {
    const t = this.theme;
    if (isActive) return t.bg("selectedBg", t.fg("text", label));
    if (isReady) return t.fg("success", label);
    return t.fg("dim", label);
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

    add(t.fg("accent", "─".repeat(width)));

    if (!this.isSingle) {
      this.renderTabBar(width, add);
      lines.push("");
    }

    const q = this.questions[this.activeTab];
    if (!q) {
      this.renderSubmitTab(width, add);
    } else {
      this.renderQuestionBody(q, this.states[this.activeTab], width, add);
    }

    add(t.fg("accent", "─".repeat(width)));

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  private renderTabBar(_width: number, add: (s: string) => void): void {
    const parts: string[] = [" "];

    for (let i = 0; i < this.questions.length; i++) {
      const q = this.questions[i];
      const s = this.states[i];
      const isActive = i === this.activeTab;
      const header = truncateToWidth(q.header, 12);
      // Active tab uses plain label; confirmed gets ■ prefix; unconfirmed gets blank prefix
      // (blank = same width as ■ — no layout shift)
      const label = isActive
        ? ` ${header} `
        : s.confirmed
          ? ` ■${header} `
          : `  ${header} `;
      parts.push(this.styleTab(label, isActive, s.confirmed));
    }

    const isSubmitActive = this.activeTab === this.questions.length;
    const submitLabel = " ✓ Submit ";
    parts.push(this.styleTab(submitLabel, isSubmitActive, this.allConfirmed()));

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
    const indent = q.multiSelect ? MULTI_INDENT : SINGLE_INDENT;

    // Question text
    for (const line of wrapTextWithAnsi(
      t.fg("text", ` ${q.question}`),
      width - 2,
    )) {
      add(line);
    }
    add("");

    // Options list
    for (let i = 0; i < opts.length; i++) {
      const opt = opts[i];
      const isSelected = i === state.cursorIndex;
      const isOther = opt.isOther === true;
      const prefix = isSelected ? t.fg("accent", ">") : " ";
      const labelColor = isSelected ? "accent" : isOther ? "muted" : "text";

      if (isOther) {
        // "Type something..." — check/box indicator matches sibling rows
        const hasFreeText = state.freeTextValue !== null && !state.inEditMode;
        const suffix = state.inEditMode ? t.fg("accent", " ✎") : "";
        if (q.multiSelect) {
          const box = hasFreeText ? t.fg("success", "[✓]") : t.fg("dim", "[ ]");
          add(
            `${prefix} ${box} ${t.fg(labelColor, `${i + 1}. ${opt.label}`)}${suffix}`,
          );
        } else {
          const check = hasFreeText ? t.fg("success", "✓") : " ";
          add(
            `${prefix} ${check} ${t.fg(labelColor, `${i + 1}. ${opt.label}`)}${suffix}`,
          );
        }
        if (hasFreeText) {
          const preview = truncateToWidth(
            state.freeTextValue ?? "",
            width - indent.length,
          );
          add(`${indent}${t.fg("dim", `"${preview}"`)}`);
        }
      } else if (q.multiSelect) {
        const box = state.selectedIndices.has(i)
          ? t.fg("accent", "[✓]")
          : t.fg("dim", "[ ]");
        add(`${prefix} ${box} ${t.fg(labelColor, `${i + 1}. ${opt.label}`)}`);
      } else {
        const check = state.selectedIndex === i ? t.fg("success", "✓") : " ";
        add(`${prefix} ${check} ${t.fg(labelColor, `${i + 1}. ${opt.label}`)}`);
      }

      if (!isOther && opt.description) {
        for (const line of wrapTextWithAnsi(
          t.fg("muted", opt.description),
          width - indent.length,
        )) {
          add(`${indent}${line}`);
        }
      }
    }

    // Inline editor
    if (state.inEditMode) {
      add("");
      add(t.fg("muted", " Your answer:"));
      for (const line of this.editor.render(width - 4)) {
        add(` ${line}`);
      }
    }

    add("");

    // Context-sensitive footer
    if (state.inEditMode) {
      add(t.fg("dim", " Enter submit · Esc back"));
    } else {
      const onOther = state.cursorIndex === opts.length - 1;
      const tabHint = this.isSingle ? "" : " · ←→ switch tabs";
      const actionHint = onOther
        ? "Space/Tab open editor"
        : q.multiSelect
          ? "Space toggle · Enter confirm"
          : "Enter select";
      add(t.fg("dim", ` ↑↓ navigate · ${actionHint}${tabHint} · Esc cancel`));
    }
  }

  private renderSubmitTab(_width: number, add: (s: string) => void): void {
    const t = this.theme;

    for (let i = 0; i < this.questions.length; i++) {
      const q = this.questions[i];
      const answer = this.resolveAnswer(q, this.states[i]);
      const header = t.fg("muted", ` ${truncateToWidth(q.header, 12)}: `);
      add(
        header +
          (answer !== null ? t.fg("text", answer) : t.fg("warning", "—")),
      );
    }

    add("");
    if (this.allConfirmed()) {
      add(t.fg("success", " Press Enter to submit"));
    } else {
      const missing = this.questions
        .filter((_, i) => !this.states[i].confirmed)
        .map((q) => truncateToWidth(q.header, 12))
        .join(", ");
      add(t.fg("warning", ` Still needed: ${missing}`));
    }
    add("");
    add(t.fg("dim", " ←→ switch tabs · Esc cancel"));
  }

  // ── Navigation helpers ──────────────────────────────────────────────────────

  private moveCursor(delta: -1 | 1): void {
    const q = this.questions[this.activeTab];
    const state = this.states[this.activeTab];
    const max = this.allOptions(q).length - 1;
    state.cursorIndex = Math.max(0, Math.min(max, state.cursorIndex + delta));
    this.refresh();
  }

  private toggleSelected(index: number): void {
    const state = this.states[this.activeTab];
    if (state.selectedIndices.has(index)) {
      state.selectedIndices.delete(index);
    } else {
      state.selectedIndices.add(index);
    }
    // Un-confirm if all answers removed
    if (state.selectedIndices.size === 0 && state.freeTextValue === null) {
      state.confirmed = false;
    }
    this.refresh();
  }

  private enterEditMode(): void {
    const state = this.states[this.activeTab];
    state.inEditMode = true;
    this.editor.setText(state.freeTextValue ?? "");
    this.refresh();
  }

  // Esc path — discard typed text, restore prior confirmed state untouched.
  private exitEditMode(): void {
    const state = this.states[this.activeTab];
    this.editor.setText("");
    state.inEditMode = false;
    this.refresh();
  }

  // Enter-with-text path — commit typed text as the free-text answer.
  private commitEditMode(): void {
    const state = this.states[this.activeTab];
    state.freeTextValue = this.editor.getText().trim();
    state.selectedIndex = null; // free-text replaces any prior regular-option selection
    this.editor.setText("");
    state.inEditMode = false;
    this.refresh();
  }

  // Enter-with-empty path — clear any saved free-text, un-confirm if nothing left.
  private clearEditMode(): void {
    const state = this.states[this.activeTab];
    const q = this.questions[this.activeTab];
    state.freeTextValue = null;
    if (q.multiSelect && state.selectedIndices.size === 0) {
      state.confirmed = false;
    }
    this.editor.setText("");
    state.inEditMode = false;
    this.refresh();
  }

  private autoConfirmIfAnswered(): void {
    const q = this.questions[this.activeTab];
    const state = this.states[this.activeTab];
    if (!q || !state || state.confirmed) return;
    // Temporarily set confirmed=true so resolveAnswer returns a value, then check
    state.confirmed = true;
    if (this.resolveAnswer(q, state) === null) {
      state.confirmed = false;
    }
  }

  private confirmAndAdvance(): void {
    this.states[this.activeTab].confirmed = true;
    this.advance();
  }

  private advance(): void {
    if (this.isSingle) {
      this.submit();
      return;
    }
    this.activeTab =
      this.activeTab < this.questions.length - 1
        ? this.activeTab + 1
        : this.questions.length; // Submit tab
    this.refresh();
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
      const answer = this.resolveAnswer(this.questions[i], this.states[i]);
      if (answer !== null) answers[this.questions[i].question] = answer;
    }
    return { questions: this.questions, answers, cancelled: false };
  }

  // ── handleInput() ────────────────────────────────────────────────────────────

  handleInput(data: string): void {
    if (this._resolved) return;

    // ── Submit tab ─────────────────────────────────────────────────────────────
    // Must be checked before accessing states[activeTab] — it's out of bounds here.
    if (!this.isSingle && this.activeTab === this.questions.length) {
      if (matchesKey(data, Key.enter)) {
        if (this.allConfirmed()) this.submit();
        return;
      }
      if (matchesKey(data, Key.escape)) {
        this.cancel();
        return;
      }
      // → wraps to Q1, ← wraps to last question tab (not back to Submit)
      if (matchesKey(data, Key.right)) {
        this.activeTab = 0;
        this.refresh();
        return;
      }
      if (matchesKey(data, Key.left)) {
        this.activeTab = this.questions.length - 1;
        this.refresh();
        return;
      }
      return;
    }

    const state = this.states[this.activeTab];
    const q = this.questions[this.activeTab];

    // ── Edit mode ──────────────────────────────────────────────────────────────
    if (state.inEditMode) {
      if (matchesKey(data, Key.escape)) {
        this.exitEditMode();
        return;
      }
      if (matchesKey(data, Key.enter)) {
        const text = this.editor.getText().trim();
        if (text) {
          this.commitEditMode();
          if (!q.multiSelect) this.confirmAndAdvance();
        } else {
          this.clearEditMode();
        }
        return;
      }
      this.editor.handleInput(data);
      this.refresh();
      return;
    }

    // ── Question tab ───────────────────────────────────────────────────────────
    if (matchesKey(data, Key.escape)) {
      this.cancel();
      return;
    }

    if (!this.isSingle && matchesKey(data, Key.right)) {
      this.autoConfirmIfAnswered();
      this.activeTab = (this.activeTab + 1) % this.totalTabs;
      this.refresh();
      return;
    }
    if (!this.isSingle && matchesKey(data, Key.left)) {
      this.autoConfirmIfAnswered();
      this.activeTab = (this.activeTab - 1 + this.totalTabs) % this.totalTabs;
      this.refresh();
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

    const opts = this.allOptions(q);
    const onOther = state.cursorIndex === opts.length - 1;

    // "Type something..." row
    if (onOther) {
      if (matchesKey(data, Key.space) || matchesKey(data, Key.tab)) {
        this.enterEditMode();
        return;
      }
      if (matchesKey(data, Key.enter) && state.freeTextValue !== null) {
        this.confirmAndAdvance();
        return;
      }
      return;
    }

    // Regular option rows
    if (q.multiSelect) {
      if (matchesKey(data, Key.space)) {
        this.toggleSelected(state.cursorIndex);
        return;
      }
      if (
        matchesKey(data, Key.enter) &&
        (state.selectedIndices.size > 0 || state.freeTextValue !== null)
      ) {
        this.confirmAndAdvance();
      }
    } else {
      if (matchesKey(data, Key.enter)) {
        state.selectedIndex = state.cursorIndex;
        state.freeTextValue = null;
        this.confirmAndAdvance();
      }
    }
  }
}
