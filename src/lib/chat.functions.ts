import Anthropic from "@anthropic-ai/sdk";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(8000),
});

export type ChatMessage = z.infer<typeof messageSchema>;

const inputSchema = z.object({
  analysis: z.unknown(),
  messages: z.array(messageSchema).min(1).max(40),
});

const SYSTEM_PROMPT_BASE = `You are a helpful UK property expert. The user is considering buying the following property. Answer their questions honestly and specifically, using the analysis data provided. Be concise. Never give legal or financial advice — flag anything that needs a solicitor or surveyor.`;

export const chatAboutProperty = createServerFn({ method: "POST" })
  .inputValidator(inputSchema)
  .handler(async ({ data }): Promise<{ reply: string }> => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

    const system = `${SYSTEM_PROMPT_BASE}\n\nProperty analysis JSON:\n${JSON.stringify(data.analysis, null, 2)}`;

    try {
      const client = new Anthropic({ apiKey });
      const message = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system,
        messages: data.messages.map((m) => ({ role: m.role, content: m.content })),
      });
      const reply =
        message.content[0]?.type === "text" ? message.content[0].text : "";
      return { reply: reply || "Sorry, I couldn't generate a response. Try again." };
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      if (e?.status === 429) throw new Error("RATE_LIMIT: Claude is busy. Try again shortly.");
      if (e?.status === 401 || e?.status === 403) throw new Error("AUTH: Invalid ANTHROPIC_API_KEY.");
      throw new Error(e?.message || "Chat failed");
    }
  });
