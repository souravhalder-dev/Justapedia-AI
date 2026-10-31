import type { ChatRequest, Conversation, FeedbackPayload, Message } from "./types";

// In browser on Vercel, if no external backend URL is specified, default to relative path ""
// which seamlessly calls the built-in Next.js Edge/Serverless Route Handlers on Vercel.
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ??
  (typeof window !== "undefined" ? "" : "http://localhost:8000");

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const fallback = "Request failed.";
    let detail = fallback;
    try {
      const data = (await response.json()) as { detail?: string };
      detail = typeof data.detail === "string" ? data.detail : fallback;
    } catch {
      detail = fallback;
    }
    throw new Error(detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function listConversations(): Promise<Conversation[]> {
  return apiFetch<Conversation[]>("/api/v1/conversations");
}

export function createConversation(title?: string): Promise<Conversation> {
  return apiFetch<Conversation>("/api/v1/conversations", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export function renameConversation(conversationId: string, title: string): Promise<Conversation> {
  return apiFetch<Conversation>(`/api/v1/conversations/${conversationId}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export function deleteConversation(conversationId: string): Promise<void> {
  return apiFetch<void>(`/api/v1/conversations/${conversationId}`, {
    method: "DELETE",
  });
}

export function deleteMessage(conversationId: string, messageId: string): Promise<void> {
  return apiFetch<void>(`/api/v1/conversations/${conversationId}/messages/${messageId}`, {
    method: "DELETE",
  });
}

export function listMessages(conversationId: string): Promise<Message[]> {
  return apiFetch<Message[]>(`/api/v1/conversations/${conversationId}/messages`);
}

export function submitFeedback(payload: FeedbackPayload) {
  return apiFetch("/api/v1/feedback", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function streamChat(
  payload: ChatRequest,
  signal: AbortSignal,
  onEvent: (event: string, data: unknown) => void,
) {
  const response = await fetch(`${API_BASE_URL}/api/v1/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error("Streaming request failed.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const parsed = parseSseChunk(part);
      if (parsed) {
        onEvent(parsed.event, parsed.data);
      }
    }
  }
}

function parseSseChunk(chunk: string): { event: string; data: unknown } | null {
  const lines = chunk.split("\n");
  const event = lines.find((line) => line.startsWith("event: "))?.replace("event: ", "").trim();
  const dataLine = lines.find((line) => line.startsWith("data: "))?.replace("data: ", "");

  if (!event || !dataLine) {
    return null;
  }

  return {
    event,
    data: JSON.parse(dataLine),
  };
}
