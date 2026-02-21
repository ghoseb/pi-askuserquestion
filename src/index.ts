import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text, truncateToWidth } from "@mariozechner/pi-tui";
import { AskUserQuestionComponent } from "./component.ts";
import { InputSchema, type Question, type Result } from "./schema.ts";

export default function (pi: ExtensionAPI) {
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
        // Non-interactive session — deregister so the LLM won't try again
        pi.setActiveTools(
          pi.getActiveTools().filter((name) => name !== "ask_user_question"),
        );
        return {
          content: [
            {
              type: "text",
              text: "Error: ask_user_question requires an interactive session. The tool has been disabled for this session.",
            },
          ],
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
        // prefix visible length: "✓ " (2) + header + ": " (2)
        const prefixLen = 2 + q.header.length + 2;
        const available = maxWidth - prefixLen;
        const display =
          available > 3 && answer.length > available
            ? `${truncateToWidth(answer, available - 1)}…`
            : answer;
        return (
          theme.fg("success", "✓ ") +
          theme.fg("accent", `${q.header}: `) +
          theme.fg("text", display)
        );
      });

      return new Text(lines.join("\n"), 0, 0);
    },
  });
}
