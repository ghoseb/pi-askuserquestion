import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text, truncateToWidth } from "@mariozechner/pi-tui";
import { InputSchema, type Question, type Result } from "./schema.ts";
import { AskUserQuestionComponent } from "./component.ts";

// ── Dev test fixtures ─────────────────────────────────────────────────────────

const TEST_SCENARIOS: Record<string, Question[]> = {
  single: [
    {
      question: "Which database should we use?",
      header: "Database",
      options: [
        { label: "PostgreSQL" },
        { label: "SQLite" },
        { label: "DuckDB" },
      ],
      multiSelect: false,
    },
  ],
  multi: [
    {
      question: "Which features should we implement?",
      header: "Features",
      options: [{ label: "Auth" }, { label: "Search" }, { label: "Export" }],
      multiSelect: true,
    },
  ],
  tabs: [
    {
      question: "Which database should we use?",
      header: "Database",
      options: [{ label: "PostgreSQL" }, { label: "SQLite" }],
      multiSelect: false,
    },
    {
      question: "Which features should we implement?",
      header: "Features",
      options: [{ label: "Auth" }, { label: "Search" }, { label: "Export" }],
      multiSelect: true,
    },
    {
      question: "What deployment target?",
      header: "Deploy",
      options: [{ label: "Docker" }, { label: "Bare metal" }, { label: "Serverless" }],
      multiSelect: false,
    },
    {
      question: "Which testing framework?",
      header: "Testing",
      options: [{ label: "Vitest" }, { label: "Jest" }, { label: "None" }],
      multiSelect: false,
    },
  ],
  desc: [
    {
      question: "Pick an approach",
      header: "Approach",
      options: [
        {
          label: "Microservices",
          description:
            "Decompose the application into small, independently deployable services that communicate over a network. Best for large teams and complex domains.",
        },
        {
          label: "Monolith",
          description:
            "A single deployable unit containing all application logic. Simpler to develop and deploy, easier to debug and test.",
        },
        {
          label: "Modular monolith",
          description:
            "A monolith with clear internal module boundaries. Combines operational simplicity with architectural clarity.",
        },
      ],
      multiSelect: false,
    },
  ],
};

export default function (pi: ExtensionAPI) {
  // ── /test-ask dev command ─────────────────────────────────────────────────────
  pi.registerCommand("test-ask", {
    description:
      "Visual test for ask_user_question UI. Args: single | multi | tabs | desc",
    handler: async (args, ctx) => {
      const scenario = (args?.trim() || "single") as keyof typeof TEST_SCENARIOS;
      const questions = TEST_SCENARIOS[scenario];
      if (!questions) {
        ctx.ui.notify(
          `Unknown scenario "${scenario}". Use: single | multi | tabs | desc`,
          "warning",
        );
        return;
      }

      const result = await ctx.ui.custom<Result | null>(
        (tui, theme, _kb, done) =>
          new AskUserQuestionComponent(questions, tui, theme, done),
      );

      if (result === null || result.cancelled) {
        ctx.ui.notify("Cancelled", "info");
        return;
      }

      const summary = result.questions
        .map((q) => `${q.header}: ${result.answers[q.question] ?? "(no answer)"}`)
        .join(" | ");
      ctx.ui.notify(`Result: ${summary}`, "success");
    },
  });

  // ── ask_user_question tool — registered at load time ─────────────────────────
  pi.registerTool({
    name: "ask_user_question",
    label: "Ask User",
    description: `Ask the user 1–4 clarifying questions before proceeding.
Use this tool when multiple valid approaches exist and you need the user's preference to continue.
Each question must have 2–4 options for the user to choose from.
Set multiSelect: true when more than one option can validly apply at the same time.
The header field is a short label (max 12 characters) used in the tab bar when showing multiple questions.
Always use this tool instead of asking questions in plain text — it provides a structured, interactive UI.`,

    parameters: InputSchema,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!ctx.hasUI) {
        // Non-interactive session — deregister the tool so the LLM won't try again
        pi.setActiveTools(
          pi.getActiveTools().filter((name) => name !== "ask_user_question"),
        );
        return {
          content: [{ type: "text", text: "Error: ask_user_question requires an interactive session. The tool has been disabled for this session." }],
          details: {
            questions: params.questions,
            answers: {},
            cancelled: true,
          } satisfies Result,
        };
      }

      const result = await ctx.ui.custom<Result | null>(
        (tui, theme, _kb, done) =>
          new AskUserQuestionComponent(params.questions, tui, theme, done),
      );

      if (result === null || result.cancelled) {
        return {
          content: [{ type: "text", text: "User cancelled" }],
          details: {
            questions: params.questions,
            answers: {},
            cancelled: true,
          } satisfies Result,
        };
      }

      const summaryLines = result.questions.map(
        (q) => `${q.header}: ${result.answers[q.question] ?? "(no answer)"}`,
      );

      return {
        content: [{ type: "text", text: summaryLines.join("\n") }],
        details: result satisfies Result,
      };
    },

    renderCall(args, theme) {
      const questions = (args.questions ?? []) as Question[];
      const topics = questions.map((q) => q.header).join(", ");
      return new Text(
        theme.fg("toolTitle", theme.bold("ask user ")) +
          theme.fg("muted", topics),
        0,
        0,
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

      const maxWidth = 80;

      const lines = details.questions.map((q) => {
        const answer = details.answers[q.question] ?? "(no answer)";
        // "✓ " (2) + header + ": " (2)
        const prefixLen = 2 + q.header.length + 2;
        const available = maxWidth - prefixLen;
        const display =
          available > 3 && answer.length > available
            ? truncateToWidth(answer, available - 1) + "…"
            : answer;
        return (
          theme.fg("success", "✓ ") +
          theme.fg("accent", q.header + ": ") +
          theme.fg("text", display)
        );
      });

      return new Text(lines.join("\n"), 0, 0);
    },
  });
}
