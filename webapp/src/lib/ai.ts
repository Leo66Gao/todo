"use client";

// The AI helper: DeepSeek, with the user's own API key kept on this device
// only (never synced, never in the code). Requests go straight from the
// device to DeepSeek.

import { create } from "zustand";
import { getLocal, setLocal } from "./prefs";

const KEY = "ai.deepseek.key";
const MODEL = "ai.deepseek.model";
export const DEFAULT_MODEL = "deepseek-flash";

export const useAiKey = create<{ key: string; model: string }>(() => ({
  key: typeof window === "undefined" ? "" : getLocal<string>(KEY, ""),
  model: typeof window === "undefined" ? DEFAULT_MODEL : getLocal<string>(MODEL, DEFAULT_MODEL),
}));

export function setAiKey(key: string) {
  setLocal(KEY, key.trim());
  useAiKey.setState({ key: key.trim() });
}

export function setAiModel(model: string) {
  setLocal(MODEL, model);
  useAiKey.setState({ model });
}

export class AiError extends Error {}

/** Text and pictures in one message (pictures only in the student's messages). */
export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

/** The model that can see pictures. */
export const VISION_MODEL = "deepseek-flash";
const hasImage = (messages: ChatMessage[]) => messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image_url"));

/**
 * How much the model thinks first. "fast" answers straight away (rewrites,
 * summaries, reading a task out of a sentence); "think" reasons briefly
 * first, for questions and plans, at the cost of a few seconds.
 */
export type AiMode = "fast" | "think";

function body(messages: ChatMessage[], mode: AiMode, extra: Record<string, unknown>) {
  const { model } = useAiKey.getState();
  return JSON.stringify({
    // Pictures go to the model that can see them, whichever is chosen.
    model: hasImage(messages) ? VISION_MODEL : model || DEFAULT_MODEL,
    messages,
    ...(mode === "think"
      ? { thinking: { type: "enabled" }, reasoning_effort: "low", max_tokens: 8000 }
      : { thinking: { type: "disabled" }, max_tokens: 4000, temperature: 0.3 }),
    ...extra,
  });
}

async function send(messages: ChatMessage[], mode: AiMode, extra: Record<string, unknown>, signal?: AbortSignal) {
  const { key } = useAiKey.getState();
  if (!key) throw new AiError("Add your DeepSeek API key in Settings first.");
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new AiError("You’re offline. Try again when you’re connected.");
  let response: Response;
  try {
    response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: body(messages, mode, extra),
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new AiError("DeepSeek couldn’t be reached. Check your connection.");
  }
  // DeepSeek doesn't say whether reasoning or JSON mode work together (or
  // with pictures): if such a request is refused, ask again plainly.
  if (response.status === 400 && (mode === "think" || "response_format" in extra)) {
    const { response_format: _json, ...plain } = extra;
    void _json;
    return send(messages, "fast", plain, signal);
  }
  if (response.status === 401) throw new AiError("DeepSeek didn’t accept the API key. Check it in Settings.");
  if (response.status === 402) throw new AiError("Your DeepSeek balance has run out. Top it up on the DeepSeek platform.");
  if (response.status === 429) throw new AiError("DeepSeek is busy right now. Try again in a moment.");
  if (!response.ok) throw new AiError(`DeepSeek returned an error (${response.status}).`);
  return response;
}

/** Asks for a JSON answer and parses it. */
export async function chatJson<T>(messages: ChatMessage[], signal?: AbortSignal, mode: AiMode = "fast"): Promise<T> {
  const response = await send(messages, mode, { response_format: { type: "json_object" } }, signal);
  const data = (await response.json().catch(() => null)) as { choices?: { message?: { content?: string }; finish_reason?: string }[] } | null;
  const content = data?.choices?.[0]?.message?.content ?? "";
  if (!content.trim() && data?.choices?.[0]?.finish_reason === "length") {
    throw new AiError("DeepSeek ran out of room before answering. Try again, or switch to Flash in Settings.");
  }
  const json = readJson(content);
  if (json === undefined) throw new AiError("DeepSeek’s answer couldn’t be read. Try again.");
  return json as T;
}

/** The JSON in an answer: bare, in a code fence, or (asked again plainly) with words around it. */
export function readJson(content: string): unknown {
  const text = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  try {
    return JSON.parse(text);
  } catch {
    const from = text.indexOf("{");
    const to = text.lastIndexOf("}");
    if (from < 0 || to <= from) return undefined;
    try {
      return JSON.parse(text.slice(from, to + 1));
    } catch {
      return undefined;
    }
  }
}

/**
 * Asks for a written answer (Markdown) and hands it over as it arrives, so
 * the first words show in a second or two. `onText` gets the whole answer so
 * far; `onThinking` fires while the model is still reasoning. Resolves with
 * the full answer.
 */
export async function chatStream(
  messages: ChatMessage[],
  { signal, mode = "fast", onText, onThinking }: { signal?: AbortSignal; mode?: AiMode; onText: (text: string) => void; onThinking?: () => void },
): Promise<string> {
  const response = await send(messages, mode, { stream: true }, signal);
  const reader = response.body?.getReader();
  if (!reader) throw new AiError("DeepSeek’s answer couldn’t be read. Try again.");
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let finish: string | null = null;
  const take = (lines: string[]) => {
    for (const line of lines) {
      const data = line.startsWith("data:") ? line.slice(5).trim() : "";
      if (!data || data === "[DONE]") continue;
      let chunk: { choices?: { delta?: { content?: string | null; reasoning_content?: string | null }; finish_reason?: string | null }[] };
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      const choice = chunk.choices?.[0];
      if (choice?.delta?.reasoning_content) onThinking?.();
      if (choice?.delta?.content) {
        text += choice.delta.content;
        onText(text);
      }
      if (choice?.finish_reason) finish = choice.finish_reason;
    }
  };
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (error) {
      if ((error as Error).name === "AbortError") throw error;
      throw new AiError("The connection to DeepSeek dropped. Try again.");
    }
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    take(lines);
  }
  // The last line may come without a line break after it.
  take([buffer + decoder.decode()]);
  if (!text.trim()) {
    throw new AiError(finish === "length" ? "DeepSeek ran out of room before answering. Try again." : "Nothing came back. Try again.");
  }
  return text.trim();
}
