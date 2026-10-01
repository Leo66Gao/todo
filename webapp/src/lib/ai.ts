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

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Asks for a JSON answer and parses it. */
export async function chatJson<T>(messages: ChatMessage[], signal?: AbortSignal): Promise<T> {
  const { key, model } = useAiKey.getState();
  if (!key) throw new AiError("Add your DeepSeek API key in Settings first.");
  if (typeof navigator !== "undefined" && !navigator.onLine) throw new AiError("You’re offline. Try again when you’re connected.");
  let response: Response;
  try {
    response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        messages,
        response_format: { type: "json_object" },
        reasoning_effort: "low",
        // Room for the model's reasoning as well as the answer.
        max_tokens: 8000,
        temperature: 0.4,
      }),
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new AiError("DeepSeek couldn’t be reached. Check your connection.");
  }
  if (response.status === 401) throw new AiError("DeepSeek didn’t accept the API key. Check it in Settings.");
  if (response.status === 402) throw new AiError("Your DeepSeek balance has run out. Top it up on the DeepSeek platform.");
  if (response.status === 429) throw new AiError("DeepSeek is busy right now. Try again in a moment.");
  if (!response.ok) throw new AiError(`DeepSeek returned an error (${response.status}).`);
  const data = (await response.json()) as { choices?: { message?: { content?: string }; finish_reason?: string }[] };
  const content = data.choices?.[0]?.message?.content ?? "";
  if (!content.trim() && data.choices?.[0]?.finish_reason === "length") {
    throw new AiError("DeepSeek ran out of room before answering. Try again, or switch to Flash in Settings.");
  }
  try {
    return JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, "")) as T;
  } catch {
    throw new AiError("DeepSeek’s answer couldn’t be read. Try again.");
  }
}
