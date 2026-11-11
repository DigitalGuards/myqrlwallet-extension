import { Button } from "@/components/UI/Button";
import { useStore } from "@/stores/store";
import { observer } from "mobx-react-lite";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

// Input right after the prompt appears, the document becomes visible or the
// window gains focus is ignored: it was meant for whatever sat in front.
export const APPROVE_PROTECTION_MS = 600;
// The keyboard approves only as press-and-hold.
export const APPROVE_HOLD_MS = 700;

const isActivationKey = (key: string) => key === "Enter" || key === " ";

type DeliberateApproveButtonProps = {
  onApprove: () => void;
  disabled?: boolean;
  children: ReactNode;
};

/**
 * The affirmative button of a dApp request prompt.
 *
 * Usage: <DeliberateApproveButton onApprove={...} disabled={...}>Yes</...>
 * Reject, No, Cancel and Close buttons stay plain buttons.
 */
const DeliberateApproveButton = observer(
  ({ onApprove, disabled = false, children }: DeliberateApproveButtonProps) => {
    const { t } = useTranslation();
    const { dAppRequestStore } = useStore();
    const requestId = dAppRequestStore.dAppRequestData?.requestId;

    const protectedUntil = useRef(Date.now() + APPROVE_PROTECTION_MS);
    const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
      undefined,
    );
    const onApproveRef = useRef(onApprove);
    onApproveRef.current = onApprove;
    const [hasFocus, setHasFocus] = useState(false);
    const [tapIgnored, setTapIgnored] = useState(false);

    const restartProtection = useCallback(() => {
      protectedUntil.current = Date.now() + APPROVE_PROTECTION_MS;
    }, []);

    const cancelHold = useCallback(() => {
      if (holdTimer.current !== undefined) {
        clearTimeout(holdTimer.current);
        holdTimer.current = undefined;
      }
    }, []);

    // A new request, or the button turning enabled, starts a new window.
    useEffect(() => {
      restartProtection();
      cancelHold();
    }, [requestId, disabled, restartProtection, cancelHold]);

    useEffect(() => {
      const onVisibility = () => {
        if (document.visibilityState === "visible") restartProtection();
        else cancelHold();
      };
      const onWindowBlur = () => {
        cancelHold();
      };
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("focus", restartProtection);
      window.addEventListener("blur", onWindowBlur);
      return () => {
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("focus", restartProtection);
        window.removeEventListener("blur", onWindowBlur);
        cancelHold();
      };
    }, [restartProtection, cancelHold]);

    const isProtected = () => Date.now() < protectedUntil.current;

    const onClick = (event: MouseEvent<HTMLButtonElement>) => {
      // Keyboard activation arrives as a click without a pointer
      // (detail 0). The keyboard path is the hold below.
      if (event.detail === 0 || isProtected()) {
        if (event.detail === 0) setTapIgnored(true);
        return;
      }
      onApprove();
    };

    const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
      if (!isActivationKey(event.key)) return;
      // Stops the browser's own Enter click and Space click.
      event.preventDefault();
      if (event.repeat || holdTimer.current !== undefined) return;
      setTapIgnored(false);
      if (isProtected()) {
        setTapIgnored(true);
        return;
      }
      holdTimer.current = setTimeout(() => {
        holdTimer.current = undefined;
        if (!isProtected()) onApproveRef.current();
      }, APPROVE_HOLD_MS);
    };

    const onKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
      if (!isActivationKey(event.key)) return;
      event.preventDefault();
      if (holdTimer.current !== undefined) {
        cancelHold();
        setTapIgnored(true);
      }
    };

    return (
      <div className="flex w-full flex-col gap-1">
        <Button
          className="w-full"
          type="button"
          disabled={disabled}
          aria-label="Yes"
          onClick={onClick}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onFocus={() => {
            setHasFocus(true);
          }}
          onBlur={() => {
            setHasFocus(false);
            setTapIgnored(false);
            cancelHold();
          }}
        >
          {children}
        </Button>
        <div
          aria-live="polite"
          className="min-h-4 text-center text-xs text-muted-foreground"
        >
          {tapIgnored
            ? t("dapp.holdToApproveIgnored")
            : hasFocus
              ? t("dapp.holdToApprove")
              : ""}
        </div>
      </div>
    );
  },
);

export default DeliberateApproveButton;
