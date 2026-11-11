import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, TruncatedText } from "@earendil-works/pi-tui";
import { AskUserQuestionComponent } from "./component.ts";
import { InputSchema, type Question, type Result } from "./schema.ts";
import { validateUniqueness } from "./validate.ts";

const TOOL_NAME = "ask_user_question";

function cancelledResult(questions: Question[]) {
  return {
    content: [{ type: "text" as const, text: "User cancelled" }],
    details: { questions, answers: {}, cancelled: true } satisfies Result,
  };
}

export default function (pi: ExtensionAPI) {
  // Deactivate the tool for this session so the LLM won't retry, then fail.
  function disableTool(): never {
    pi.setActiveTools(pi.getActiveTools().filter((name) => name !== TOOL_NAME));
    throw new Error(
      `${TOOL_NAME} requires an interactive terminal session. The tool has been disabled for this session.`,
    );
  }

  pi.registerTool({
    name: TOOL_NAME,
    label: "Ask User",
    description: `Ask the user 1–4 clarifying questions before proceeding.
Use this tool to:
1. Clarify ambiguous instructions
2. Get the user's preference between valid approaches
3. Make decisions on implementation choices
4. Offer choices about what direction to take
Each question must have 2–4 options. Users can always select "Other" to type a free-text answer, so do not include an "Other" option yourself.
Option labels should be concise (1–5 words).
Set multiSelect: true when more than one option can validly apply at the same time.
The header field is a short label (max 12 characters) used in the tab bar when showing multiple questions.
If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label.
Always use this tool instead of asking questions in plain text — it provides a structured, interactive UI.`,

    parameters: InputSchema,

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      // Reject duplicate question texts or duplicate option labels.
      // Throwing marks the tool result as an error for the LLM.
      const validationError = validateUniqueness(params.questions);
      if (validationError) {
        throw new Error(validationError);
      }

      if (!ctx.hasUI) {
        disableTool();
      }

      if (signal?.aborted) {
        return cancelledResult(params.questions);
      }

      // custom() returns undefined when no terminal is available (e.g. RPC mode,
      // where hasUI is true but component factories are ignored).
      const result: Result | null | undefined =
        await ctx.ui.custom<Result | null>((tui, theme, _kb, done) => {
          // Close the dialog if the agent run is aborted while it is open.
          let finished = false;
          const finish = (r: Result | null) => {
            if (finished) return;
            finished = true;
            signal?.removeEventListener("abort", onAbort);
            done(r);
          };
          const onAbort = () => finish(null);
          signal?.addEventListener("abort", onAbort, { once: true });
          return new AskUserQuestionComponent(
            params.questions,
            tui,
            theme,
            finish,
          );
        });

      if (result === undefined) {
        disableTool();
      }

      if (result === null || result.cancelled) {
        return cancelledResult(params.questions);
      }

      const summaryLines = result.questions.map(
        (q) =>
          `"${q.question}" = "${result.answers[q.question] ?? "(no answer)"}"`,
      );

      return {
        content: [{ type: "text", text: summaryLines.join("\n") }],
        details: result satisfies Result,
      };
    },

    renderCall(args, theme) {
      // Args may be partial while the tool call is streaming.
      const questions = (args.questions ?? []) as Partial<Question>[];
      const topics = questions
        .map((q) => q?.header)
        .filter((h): h is string => typeof h === "string" && h.length > 0)
        .join(", ");
      return new TruncatedText(
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
        return new TruncatedText(t?.type === "text" ? t.text : "", 0, 0);
      }

      if (details.cancelled) {
        return new TruncatedText(theme.fg("warning", "Cancelled"), 0, 0);
      }

      // One TruncatedText per question — each line item truncated independently
      const box = new Box(0, 0);
      for (const q of details.questions) {
        const answer = details.answers[q.question] ?? "(no answer)";
        box.addChild(
          new TruncatedText(
            theme.fg("success", "✓ ") +
              theme.fg("accent", `${q.header}: `) +
              theme.fg("text", answer),
            0,
            0,
          ),
        );
      }
      return box;
    },
  });
}
