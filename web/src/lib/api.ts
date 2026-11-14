import type { AskResponse } from "./contract";
import { findSample } from "./samples";
import { API_URL } from "./site";

export type AskResult =
  | { ok: true; response: AskResponse; ms: number }
  | { ok: false; kind: "preview-miss" | "network" | "server" | "timeout"; message: string };

/** Sent by the answer service before the model call: the evidence it is using. */
export type StreamMeta = {
  evidence?: { id: string; status: string; why: string }[];
  contact_date?: string;
};

export type StreamHandlers = {
  /** What the answer will be built from, before any text arrives. */
  onMeta?: (meta: StreamMeta) => void;
  /** Answer text as it arrives. */
  onToken?: (text: string) => void;
};

/** One id per browser tab, so the answer service can keep this customer's facts. */
export function sessionId(): string {
  if (typeof window === "undefined") return "";
  const key = "policy-desk-session";
  let id = window.sessionStorage.getItem(key);
  if (!id) {
    id = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`).replace(/[^A-Za-z0-9-]/g, "");
    window.sessionStorage.setItem(key, id);
  }
  return id;
}

/**
 * Asks the answer service and streams the reply (POST /chat/stream, Server-Sent
 * Events: meta, token..., done). Without NEXT_PUBLIC_API_URL the desk runs in preview
 * mode and only the hand-checked sample questions return answers.
 */
export async function ask(question: string, handlers: StreamHandlers = {}, timeoutMs = 60_000): Promise<AskResult> {
  if (!API_URL) {
    const sample = findSample(question);
    if (sample) return { ok: true, response: sample.response, ms: 0 };
    return {
      ok: false,
      kind: "preview-miss",
      message:
        "The answer service is not connected in this preview, so only the sample questions have answers. Pick one from the list.",
    };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = performance.now();
  try {
    const res = await fetch(`${API_URL}/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: question, session_id: sessionId() }),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) {
      return { ok: false, kind: "server", message: `The answer service returned an error (${res.status}).` };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let final: AskResponse | null = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut: number;
      while ((cut = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const event = block.match(/^event: (.*)$/m)?.[1];
        const data = block
          .split("\n")
          .filter((l) => l.startsWith("data: "))
          .map((l) => l.slice(6))
          .join("\n");
        if (!event || !data) continue;
        const parsed = JSON.parse(data);
        if (event === "meta") handlers.onMeta?.(parsed as StreamMeta);
        else if (event === "token") handlers.onToken?.(parsed as string);
        else if (event === "done") final = parsed as AskResponse;
      }
    }
    if (!final) return { ok: false, kind: "server", message: "The answer ended before it was complete. Please send it again." };
    return { ok: true, response: final, ms: Math.round(performance.now() - t0) };
  } catch (e) {
    if ((e as Error).name === "AbortError")
      return { ok: false, kind: "timeout", message: `No reply within ${timeoutMs / 1000} seconds.` };
    return { ok: false, kind: "network", message: "Could not reach the answer service." };
  } finally {
    clearTimeout(timer);
  }
}
