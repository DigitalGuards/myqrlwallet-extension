import { Button } from "@/components/UI/Button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/UI/Form";
import { Input } from "@/components/UI/Input";
import { useUnlockAttemptGate } from "@/hooks/useUnlockAttemptGate";
import { useStore } from "@/stores/store";
import { zodResolver } from "@hookform/resolvers/zod";
import { TFunction } from "i18next";
import { Eye, EyeOff, Loader, LockKeyholeOpen } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

const createFormSchema = (t: TFunction) =>
  z.object({
    password: z.string().min(1, t("validation.passwordRequired")),
  });

export type SessionPasswordPromptProps = {
  /**
   * Called once the typed password has re-armed the service worker (a
   * fresh SET_DECRYPTED_KEYS, exactly like unlock()). The caller is
   * responsible for retrying whatever step ran out of a usable session
   * password - this component only re-arms the session, it does not know
   * what to retry.
   */
  onUnlocked: () => void | Promise<void>;
};

/**
 * Inline re-entry for "the service worker session is gone but this screen
 * still has unsaved progress": Import and Create both dead-ended here
 * before F1. Decrypted keys and the wallet password now vanish together on
 * a service-worker restart (there is no session backup for keys to
 * self-heal from any more - see LockManager's class doc comment), so this
 * no longer narrowly targets a lost password while keys survive; it
 * targets a popup whose cached `lockStore.isLocked` observable has gone
 * stale relative to the SW's real state (e.g. the SW restarted while this
 * screen was already open and mid-flow). The React state driving the
 * pending import/create (the mnemonic, the generated account) lives
 * entirely in this popup document, so it survives that restart untouched.
 * Only the SW-side unlock session needs re-establishing.
 *
 * Reuses the exact unlock path (lockStore.unlock -> the popup's worker
 * pool decrypts the stored keystores and verifies the typed password
 * against them, a wrong password fails the normal way) so re-arming the
 * session here is byte-for-byte the same as a fresh unlock, including the
 * SET_DECRYPTED_KEYS re-arm of the service worker and the F7 attempt
 * limiter shared via useUnlockAttemptGate (N1): this is a password oracle
 * exactly like the lock screen and must be throttled the same way.
 *
 * unlock() returning "failed" here (N2/N8) - an infrastructure hiccup, or
 * the final SW verification not confirming in time - deliberately does not
 * flip lockStore.isLocked to true. Doing so would unmount the in-progress
 * Import/Create screen this component is rendered inside of and discard
 * the user's progress for a problem that was not a wrong password.
 */
const SessionPasswordPrompt = observer(
  ({ onUnlocked }: SessionPasswordPromptProps) => {
    const { lockStore } = useStore();
    const { t } = useTranslation();
    const FormSchema = createFormSchema(t);
    const [showPassword, setShowPassword] = useState(false);
    const { isWaiting, remainingSeconds, recordResult, refreshWait } =
      useUnlockAttemptGate();

    const form = useForm<z.infer<typeof FormSchema>>({
      resolver: zodResolver(FormSchema),
    });
    const {
      handleSubmit,
      control,
      formState: { isSubmitting, isValid },
      setError,
      reset,
    } = form;

    const onSubmit = async (formData: z.infer<typeof FormSchema>) => {
      // R2: re-read the persisted counter first - see LockPasswordCheck's
      // identical guard.
      if (await refreshWait()) return;
      try {
        const result = await lockStore.unlock(formData.password);
        const waitUntil = await recordResult(result);
        if (result === "wrong-password") {
          setError("password", {
            message:
              waitUntil > Date.now()
                ? t("lock.unlock.errorTooManyAttempts")
                : t("lock.unlock.errorIncorrect"),
          });
          return;
        }
        if (result === "failed") {
          setError("password", {
            message: t("lock.unlock.errorCouldNotVerify"),
          });
          return;
        }
      } catch (error) {
        // Surfaces the specific error unlock() throws (e.g. the
        // legacy-address migration guard, or the out-of-memory retry
        // message), each with its own distinct copy (N7).
        const message =
          error instanceof Error ? error.message : t("lock.unlock.errorFailed");
        setError("password", { message });
        return;
      }
      reset();
      await onUnlocked();
    };

    return (
      <Form {...form}>
        <form
          name="sessionPasswordPrompt"
          aria-label="sessionPasswordPrompt"
          className="mt-4 flex w-full flex-col gap-3"
          onSubmit={handleSubmit(onSubmit)}
        >
          <p className="text-sm text-muted-foreground">
            {t("account.reArmPrompt")}
          </p>
          <FormField
            control={control}
            name="password"
            render={({ field }) => (
              <FormItem className="w-full text-left">
                <div className="relative">
                  <FormControl>
                    <Input
                      {...field}
                      aria-label={t("lock.unlock.passwordPlaceholder")}
                      autoComplete="current-password"
                      disabled={isSubmitting || isWaiting}
                      placeholder={t("lock.unlock.passwordPlaceholder")}
                      type={showPassword ? "text" : "password"}
                      className="h-11 rounded-xl pr-12 text-base"
                    />
                  </FormControl>
                  <button
                    type="button"
                    aria-pressed={showPassword}
                    aria-label={t("lock.unlock.togglePasswordVisibility")}
                    disabled={isSubmitting || isWaiting}
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded-lg p-2.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    onClick={() => setShowPassword((show) => !show)}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
          {isWaiting && (
            <p role="alert" className="text-xs text-muted-foreground">
              {t("lock.unlock.waitMessage", { seconds: remainingSeconds })}
            </p>
          )}
          <Button
            disabled={isSubmitting || !isValid || isWaiting}
            className="h-11 w-full"
            type="submit"
          >
            {isSubmitting ? (
              <Loader className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <LockKeyholeOpen className="mr-2 h-4 w-4" />
            )}
            {isSubmitting
              ? t("account.reArmButtonLoading")
              : t("account.reArmButton")}
          </Button>
        </form>
      </Form>
    );
  },
);

export default SessionPasswordPrompt;
