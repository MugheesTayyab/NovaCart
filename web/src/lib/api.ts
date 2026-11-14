import type { AskRequest, AskResponse } from "./contract";
import { findSample } from "./samples";
import { API_URL } from "./site";

export type AskResult =
  | { ok: true; response: AskResponse; ms: number }
  | { ok: false; kind: "preview-miss" | "network" | "server" | "timeout"; message: string };

/**
 * Sends a question to the answer API. Without NEXT_PUBLIC_API_URL the desk runs in
 * preview mode and only the hand-checked sample questions return answers.
 */
export async function ask(req: AskRequest, timeoutMs = 45_000): Promise<AskResult> {
  if (!API_URL) {
    const sample = findSample(req.question);
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
    const res = await fetch(`${API_URL}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const busy = res.status === 429 || res.status === 503;
      return {
        ok: false,
        kind: "server",
        message: busy
          ? "Every model provider is at its rate limit right now. Try again in a minute."
          : `The answer service returned an error (${res.status}).`,
      };
    }
    const response = (await res.json()) as AskResponse;
    return { ok: true, response, ms: Math.round(performance.now() - t0) };
  } catch (e) {
    if ((e as Error).name === "AbortError")
      return { ok: false, kind: "timeout", message: `No reply within ${timeoutMs / 1000} seconds.` };
    return { ok: false, kind: "network", message: "Could not reach the answer service." };
  } finally {
    clearTimeout(timer);
  }
}
