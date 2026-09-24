import { scrollShellToTop } from "@/components/QrlWeb3Wallet/ScrollRegion/ScrollRegion";
import { Button } from "@/components/UI/Button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/UI/Form";
import { Input } from "@/components/UI/Input";
import { zodResolver } from "@hookform/resolvers/zod";
import { TFunction } from "i18next";
import { Eye, EyeOff, Loader, LockKeyholeOpen } from "lucide-react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { useStore } from "@/stores/store";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import ResetWalletDialog from "@/components/QrlWeb3Wallet/ScreenLoader/Shared/ResetWalletDialog/ResetWalletDialog";

const createFormSchema = (t: TFunction) =>
  z.object({
    password: z.string().min(1, t("validation.passwordRequired")),
  });

/**
 * The unlocked half of the lock screen: no card chrome, it reads as the
 * wallet itself standing locked (mirrors the desktop unlock window).
 * Lock.tsx above it owns the logo, wordmark, and glow.
 */
const LockPasswordCheck = observer(() => {
  const { lockStore } = useStore();
  const { unlock } = lockStore;
  const { t } = useTranslation();
  const FormSchema = createFormSchema(t);

  const [unlockAttempt, setUnlockAttempt] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  useEffect(() => {
    setTimeout(() => {
      scrollShellToTop();
      setFocus("password");
    }, 0);
  }, [unlockAttempt]);

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
  });
  const {
    handleSubmit,
    control,
    formState: { isSubmitting, isValid },
    setError,
    setFocus,
  } = form;

  async function onSubmit(formData: z.infer<typeof FormSchema>) {
    scrollShellToTop();
    try {
      const unlocked = await unlock(formData.password);
      if (!unlocked) {
        setError("password", {
          message: t("lock.unlock.errorIncorrect"),
        });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("lock.unlock.errorFailed");
      setError("password", { message });
    }
    setUnlockAttempt((attempt) => attempt + 1);
  }

  return (
    <Form {...form}>
      <form
        name="accountUnlock"
        className="w-full"
        onSubmit={handleSubmit(onSubmit)}
      >
        <div className="page-enter flex w-full flex-col items-center gap-5 text-center">
          <FormField
            control={control}
            name="password"
            render={({ field }) => (
              <FormItem className="w-full text-left">
                {/* FormControl wraps only the Input so its id / aria-describedby /
                    aria-invalid land on the field, not the positioning wrapper. */}
                <div className="relative">
                  <FormControl>
                    <Input
                      {...field}
                      aria-label={t("lock.unlock.passwordPlaceholder")}
                      autoComplete="current-password"
                      disabled={isSubmitting}
                      placeholder={t("lock.unlock.passwordPlaceholder")}
                      type={showPassword ? "text" : "password"}
                      className="h-12 rounded-xl pr-12 text-base"
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
                <FormMessage className="text-center" />
              </FormItem>
            )}
          />

          <Button
            disabled={isSubmitting || !isValid}
            className="h-11 w-full text-base"
            type="submit"
          >
            {isSubmitting ? (
              <Loader className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <LockKeyholeOpen className="mr-2 h-4 w-4" />
            )}
            {isSubmitting
              ? t("lock.unlock.buttonLoading")
              : t("lock.unlock.button")}
          </Button>

          {/* Escape hatch for a lost password: the seeds are unrecoverable
              without it, so the only way forward is a full reset + re-import.
              Disabled while an unlock is in flight: that path can persist
              re-encrypted keystores when it completes, which would write
              seed ciphertext back to disk after the wipe. */}
          <button
            type="button"
            disabled={isSubmitting}
            className="text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:pointer-events-none disabled:opacity-50"
            onClick={() => setResetDialogOpen(true)}
          >
            {t("lock.unlock.forgotPassword")}
          </button>
          <ResetWalletDialog
            open={resetDialogOpen}
            onOpenChange={setResetDialogOpen}
          />
        </div>
      </form>
    </Form>
  );
});

export default LockPasswordCheck;
