import { useCallback, useEffect, useRef, useState } from "react";

type UseCopyOptions = {
  /** How long the copied/failed state stays visible, in milliseconds. */
  resetAfterMs?: number;
};

type UseCopyResult = {
  /** True while the last copy is being reported as successful. */
  copied: boolean;
  /** True while the last copy is being reported as failed. */
  failed: boolean;
  /** Copies `text` and resolves to whether the clipboard accepted it. */
  copy: (text: string) => Promise<boolean>;
};

/**
 * The wallet's single copy-to-clipboard hook.
 *
 * navigator.clipboard.writeText() is asynchronous and rejects whenever the
 * document has lost focus, the permission is denied, or the surface has no
 * Clipboard API at all. Call sites used to flip a "Copied!" state next to a
 * bare, unawaited call, so a rejected write still told the user their address
 * or signing payload was on the clipboard. This awaits the write, reports
 * success only when it resolves, surfaces the failure otherwise, and clears
 * its reset timer on unmount so an unmounted surface never gets a state
 * update.
 */
export const useCopy = ({
  resetAfterMs = 1500,
}: UseCopyOptions = {}): UseCopyResult => {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearTimeout(resetTimerRef.current);
    };
  }, []);

  const scheduleReset = useCallback(() => {
    clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, resetAfterMs);
  }, [resetAfterMs]);

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        if (!isMountedRef.current) return true;
        setCopied(true);
        setFailed(false);
        scheduleReset();
        return true;
      } catch {
        if (!isMountedRef.current) return false;
        setCopied(false);
        setFailed(true);
        scheduleReset();
        return false;
      }
    },
    [scheduleReset],
  );

  return { copied, failed, copy };
};

export default useCopy;
