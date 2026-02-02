import type { SessionManager } from "@mariozechner/pi-coding-agent";
import { getGlobalHookRunner } from "../plugins/hook-runner-global.js";
import type { OpenClawConfig } from "../config/config.js";
import { installSessionToolResultGuard } from "./session-tool-result-guard.js";
import {
  resolveToolResultTruncationConfig,
  truncateToolResultMessage,
} from "./tool-result-truncate.js";

export type GuardedSessionManager = SessionManager & {
  /** Flush any synthetic tool results for pending tool calls. Idempotent. */
  flushPendingToolResults?: () => void;
};

/**
 * Apply the tool-result guard to a SessionManager exactly once and expose
 * a flush method on the instance for easy teardown handling.
 */
export function guardSessionManager(
  sessionManager: SessionManager,
  opts?: {
    agentId?: string;
    sessionKey?: string;
    allowSyntheticToolResults?: boolean;
    config?: OpenClawConfig;
  },
): GuardedSessionManager {
  if (typeof (sessionManager as GuardedSessionManager).flushPendingToolResults === "function") {
    return sessionManager as GuardedSessionManager;
  }

  const hookRunner = getGlobalHookRunner();
  const baseTransform = hookRunner?.hasHooks("tool_result_persist")
    ? (message: any, meta: { toolCallId?: string; toolName?: string; isSynthetic?: boolean }) => {
      const out = hookRunner.runToolResultPersist(
        {
          toolName: meta.toolName,
          toolCallId: meta.toolCallId,
          message,
          isSynthetic: meta.isSynthetic,
        },
        {
          agentId: opts?.agentId,
          sessionKey: opts?.sessionKey,
          toolName: meta.toolName,
          toolCallId: meta.toolCallId,
        },
      );
      return out?.message ?? message;
    }
    : undefined;

  const truncation = resolveToolResultTruncationConfig(opts?.config);
  const transform =
    baseTransform || truncation
      ? (message: any, meta: { toolCallId?: string; toolName?: string; isSynthetic?: boolean }) => {
        const hooked = baseTransform ? baseTransform(message, meta) : message;
        return truncateToolResultMessage(hooked, truncation);
      }
      : undefined;

  const guard = installSessionToolResultGuard(sessionManager, {
    transformToolResultForPersistence: transform,
    allowSyntheticToolResults: opts?.allowSyntheticToolResults,
  });
  (sessionManager as GuardedSessionManager).flushPendingToolResults = guard.flushPendingToolResults;
  return sessionManager as GuardedSessionManager;
}
