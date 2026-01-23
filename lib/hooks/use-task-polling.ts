import { useEffect, useRef, useCallback } from "react";

type TaskStatus = {
  state: string;
  message?: string;
};

type TaskData = {
  id: string;
  contextId?: string;
  status?: TaskStatus;
  history?: Array<{
    role: string;
    parts: Array<{ kind: string; text?: string }>;
  }>;
};

type UseTaskPollingOptions = {
  cardUrl: string;
  taskId: string | undefined;
  enabled?: boolean;
  interval?: number;
  onUpdate?: (task: TaskData) => void;
  onComplete?: (task: TaskData) => void;
  onError?: (error: string) => void;
};

const TERMINAL_STATES = ["completed", "failed", "canceled", "rejected"];

export function useTaskPolling({
  cardUrl,
  taskId,
  enabled = true,
  interval = 3000,
  onUpdate,
  onComplete,
  onError,
}: UseTaskPollingOptions) {
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isPollingRef = useRef(false);

  const pollTask = useCallback(async () => {
    if (!taskId || !cardUrl || isPollingRef.current) return;

    isPollingRef.current = true;

    try {
      const response = await fetch("/api/agents/task", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          cardUrl,
          taskId,
          historyLength: 10,
        }),
      });

      const data = await response.json();

      if (!data.ok) {
        onError?.(data.error || "Failed to fetch task");
        return;
      }

      const task = data.data as TaskData;
      onUpdate?.(task);

      const taskState = task.status?.state;
      if (taskState && TERMINAL_STATES.includes(taskState)) {
        onComplete?.(task);
        // Stop polling on terminal state
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "Polling failed");
    } finally {
      isPollingRef.current = false;
    }
  }, [cardUrl, taskId, onUpdate, onComplete, onError]);

  useEffect(() => {
    if (!enabled || !taskId || !cardUrl) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Initial poll
    pollTask();

    // Set up interval
    intervalRef.current = setInterval(pollTask, interval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, taskId, cardUrl, interval, pollTask]);

  return { pollTask };
}
