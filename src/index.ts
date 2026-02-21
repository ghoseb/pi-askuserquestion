import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { InputSchema, type Question, type Result } from "./schema.ts";
import { AskUserQuestionComponent } from "./component.ts";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    // Only register when there's an interactive UI — this tool requires user input
    if (!ctx.hasUI) return;

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
        const headers = questions.map((q) => q.header).join(", ");
        return new Text(
          theme.fg("toolTitle", theme.bold("ask_user_question ")) +
            theme.fg("muted", headers),
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

        const lines = details.questions.map((q) => {
          const answer = details.answers[q.question] ?? "(no answer)";
          return (
            theme.fg("success", "✓ ") +
            theme.fg("accent", q.header + ": ") +
            theme.fg("text", answer)
          );
        });

        return new Text(lines.join("\n"), 0, 0);
      },
    });
  });
}
