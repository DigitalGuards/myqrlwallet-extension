import { scrollShellToTop } from "@/components/QrlWeb3Wallet/ScrollRegion/ScrollRegion";
import { Button } from "@/components/UI/Button";
import {
  Form,
  FormControl,
  FormDescription,
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
import StringUtil from "@/utilities/stringUtil";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";

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
  const { lockStore, qrlStore, accountLabelsStore } = useStore();
  const { unlock } = lockStore;
  const { activeAccount } = qrlStore;
  const { accountAddress } = activeAccount;
  const { t } = useTranslation();
  const FormSchema = createFormSchema(t);

  const [unlockAttempt, setUnlockAttempt] = useState(0);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (accountAddress) {
      accountLabelsStore.loadLabels();
    }
  }, [accountAddress]);

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

  const label = accountLabelsStore.getLabel(accountAddress);
  const { prefix, addressSplit } = StringUtil.getSplitAddress(accountAddress);
  const abbreviatedAddress = accountAddress
    ? `${prefix}${addressSplit[0]}...${addressSplit[addressSplit.length - 1]}`
    : "";

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
        error instanceof Error
          ? error.message
          : t("lock.unlock.errorFailed");
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
          <div>
            <h3 className="text-xl font-bold tracking-tight">
              {t("lock.unlock.title")}
            </h3>
            <p className="mt-1 break-words text-sm text-muted-foreground">
              {t("lock.unlock.description")}
            </p>
          </div>

          {/* Who is locked: the account identity chip, blue identifies.
              The row keeps a fixed height even before the address resolves
              (it lands only after qrlStore's RPC round-trips) so the chip
              never shifts the focused password field on cold start. */}
          <div className="flex min-h-[2.125rem] w-full items-center justify-center">
            {!!accountAddress && (
              <div
                className="inline-flex max-w-full items-center gap-2 rounded-full border border-identity-accent/30 bg-identity-accent/[0.08] px-4 py-1.5"
                title={accountAddress}
              >
                {/* text-primary so the glow-dot halo (currentColor) pulses ember, not foreground */}
                <span className="glow-dot h-2 w-2 shrink-0 rounded-full bg-primary text-primary" />
                <span className="font-data truncate text-xs text-identity-accent">
                  {label || abbreviatedAddress}
                </span>
              </div>
            )}
          </div>

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
                      aria-label={field.name}
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
                <FormDescription className="text-center text-xs">
                  {t("lock.unlock.passwordDescription")}
                </FormDescription>
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
        </div>
      </form>
    </Form>
  );
});

export default LockPasswordCheck;
