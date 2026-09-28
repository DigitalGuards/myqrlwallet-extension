import { Button } from "@/components/UI/Button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/UI/Form";
import { Input } from "@/components/UI/Input";
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
 * Inline re-entry for the "wallet reads unlocked but the memory-only
 * password is gone" gap: after a service-worker restart, decrypted keys
 * self-heal from the session backup (so the wallet shows as unlocked and no
 * lock screen appears), but the wallet password does not, since it is held
 * in memory only. Import and Create both dead-ended here before F1.
 *
 * Reuses the exact unlock path (lockStore.unlock -> the popup's worker
 * pool decrypts the stored keystores and verifies the typed password
 * against them, a wrong password fails the normal way) so re-arming the
 * session here is byte-for-byte the same as a fresh unlock, including the
 * SET_DECRYPTED_KEYS re-arm of the service worker.
 */
const SessionPasswordPrompt = observer(
  ({ onUnlocked }: SessionPasswordPromptProps) => {
    const { lockStore } = useStore();
    const { t } = useTranslation();
    const FormSchema = createFormSchema(t);
    const [showPassword, setShowPassword] = useState(false);

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
      let unlocked: boolean;
      try {
        unlocked = await lockStore.unlock(formData.password);
      } catch {
        setError("password", { message: t("lock.unlock.errorFailed") });
        return;
      }
      if (!unlocked) {
        setError("password", { message: t("lock.unlock.errorIncorrect") });
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
                      disabled={isSubmitting}
                      placeholder={t("lock.unlock.passwordPlaceholder")}
                      type={showPassword ? "text" : "password"}
                      className="h-11 rounded-xl pr-12 text-base"
                    />
                  </FormControl>
                  <button
                    type="button"
                    aria-pressed={showPassword}
                    aria-label={t("lock.unlock.togglePasswordVisibility")}
                    disabled={isSubmitting}
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
          <Button
            disabled={isSubmitting || !isValid}
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
