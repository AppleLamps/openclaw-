import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { OpenClawConfig } from "../config/config.js";

export const DEFAULT_TOOL_RESULT_MAX_CHARS = 20000;
const DEFAULT_TRUNCATE_PLACEHOLDER = "\n...[tool result truncated]...\n";

export type ToolResultTruncationConfig = {
    maxChars: number;
    headChars?: number;
    tailChars?: number;
    placeholder?: string;
};

function normalizeMaxChars(raw: unknown): number | null {
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
        return null;
    }
    return Math.max(0, Math.floor(raw));
}

export function resolveToolResultTruncationConfig(
    cfg?: OpenClawConfig,
): ToolResultTruncationConfig | null {
    const raw = cfg?.agents?.defaults?.contextPruning?.toolResults ?? {};
    const configured = normalizeMaxChars(raw.maxChars);
    const maxChars = configured ?? DEFAULT_TOOL_RESULT_MAX_CHARS;
    if (maxChars <= 0) {
        return null;
    }
    const headChars = normalizeMaxChars(raw.headChars ?? undefined) ?? undefined;
    const tailChars = normalizeMaxChars(raw.tailChars ?? undefined) ?? undefined;
    const placeholder = typeof raw.placeholder === "string" ? raw.placeholder : undefined;
    return {
        maxChars,
        headChars,
        tailChars,
        placeholder: placeholder?.trim() ? placeholder : undefined,
    };
}

function resolveSplit(params: {
    maxChars: number;
    headChars?: number;
    tailChars?: number;
    placeholder: string;
}): { head: number; tail: number } {
    const { maxChars, placeholder } = params;
    const maxContent = Math.max(0, maxChars - placeholder.length);
    const rawHead = params.headChars ?? Math.floor(maxContent * 0.7);
    const rawTail = params.tailChars ?? maxContent - rawHead;
    const head = Math.max(0, Math.min(maxContent, rawHead));
    const tail = Math.max(0, Math.min(maxContent - head, rawTail));
    return { head, tail };
}

function truncateText(text: string, opts: ToolResultTruncationConfig): string {
    if (text.length <= opts.maxChars) {
        return text;
    }
    const placeholder = opts.placeholder ?? DEFAULT_TRUNCATE_PLACEHOLDER;
    if (opts.maxChars <= placeholder.length) {
        return text.slice(0, opts.maxChars);
    }
    const { head, tail } = resolveSplit({
        maxChars: opts.maxChars,
        headChars: opts.headChars,
        tailChars: opts.tailChars,
        placeholder,
    });
    const headText = head > 0 ? text.slice(0, head) : "";
    const tailText = tail > 0 ? text.slice(text.length - tail) : "";
    return `${headText}${placeholder}${tailText}`;
}

function truncateToolResultContent(
    content: Extract<AgentMessage, { role: "toolResult" }>["content"],
    opts: ToolResultTruncationConfig,
): Extract<AgentMessage, { role: "toolResult" }>["content"] {
    if (typeof content === "string") {
        return [{ type: "text", text: truncateText(content, opts) }];
    }
    if (!Array.isArray(content)) {
        return content;
    }
    let combined = "";
    let hasText = false;
    for (const block of content) {
        if (!block || typeof block !== "object") {
            continue;
        }
        const text = (block as { text?: unknown }).text;
        if (typeof text === "string") {
            combined += text;
            hasText = true;
        }
    }
    if (!hasText) {
        return content;
    }
    const truncated = truncateText(combined, opts);
    let replaced = false;
    const out = content.map((block) => {
        if (replaced || !block || typeof block !== "object") {
            return block;
        }
        const rec = block as { text?: unknown };
        if (typeof rec.text !== "string") {
            return block;
        }
        replaced = true;
        const base = block as unknown as Record<string, unknown>;
        return { ...base, text: truncated } as typeof block;
    });
    if (!replaced) {
        return content;
    }
    return out.filter((block) => {
        if (!block || typeof block !== "object") {
            return true;
        }
        const rec = block as { text?: unknown };
        return typeof rec.text !== "string" || rec.text.length > 0;
    });
}

export function truncateToolResultMessage(
    message: AgentMessage,
    opts: ToolResultTruncationConfig | null,
): AgentMessage {
    if (!opts) {
        return message;
    }
    if (!message || typeof message !== "object") {
        return message;
    }
    if ((message as { role?: unknown }).role !== "toolResult") {
        return message;
    }
    const toolResult = message as Extract<AgentMessage, { role: "toolResult" }>;
    const nextContent = truncateToolResultContent(toolResult.content, opts);
    if (nextContent === toolResult.content) {
        return message;
    }
    return {
        ...toolResult,
        content: nextContent,
    } as AgentMessage;
}

export function truncateToolResultMessages(
    messages: AgentMessage[],
    opts: ToolResultTruncationConfig | null,
): AgentMessage[] {
    if (!opts || messages.length === 0) {
        return messages;
    }
    let changed = false;
    const next = messages.map((message) => {
        const out = truncateToolResultMessage(message, opts);
        if (out !== message) {
            changed = true;
        }
        return out;
    });
    return changed ? next : messages;
}
