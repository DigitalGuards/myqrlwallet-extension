import { scrollShellToTop } from "@/components/QrlWeb3Wallet/ScrollRegion/ScrollRegion";
import { Button } from "@/components/UI/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/UI/Card";
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
import { Loader, LockKeyholeOpen } from "lucide-react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { useStore } from "@/stores/store";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";

const createFormSchema = (t: TFunction) =>
  z.object({
    password: z.string().min(1, t("validation.passwordRequired")),
  });

const LockPasswordCheck = observer(() => {
  const { lockStore } = useStore();
  const { unlock } = lockStore;
  const { t } = useTranslation();
  const FormSchema = createFormSchema(t);

  const [unlockAttempt, setUnlockAttempt] = useState(0);

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
        <Card className="animate-appear-in shadow-xl">
          <CardHeader>
            <CardTitle>{t("lock.unlock.title")}</CardTitle>
            <CardDescription className="break-words">
              {t("lock.unlock.description")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FormField
              control={control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input
                      {...field}
                      aria-label={field.name}
                      disabled={isSubmitting}
                      placeholder={t("lock.unlock.passwordPlaceholder")}
                      type="password"
                    />
                  </FormControl>
                  <FormDescription>{t("lock.unlock.passwordDescription")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter>
            <Button
              disabled={isSubmitting || !isValid}
              className="w-full"
              type="submit"
            >
              {isSubmitting ? (
                <Loader className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <LockKeyholeOpen className="mr-2 h-4 w-4" />
              )}
              {isSubmitting ? t("lock.unlock.buttonLoading") : t("lock.unlock.button")}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </Form>
  );
});

export default LockPasswordCheck;
