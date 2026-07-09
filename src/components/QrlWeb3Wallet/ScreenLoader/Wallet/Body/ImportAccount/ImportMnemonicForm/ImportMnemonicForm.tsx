import { Button } from "@/components/UI/Button";
import {
  Card,
  CardContent,
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
import { getHexSeedFromMnemonic } from "@/functions/getHexSeedFromMnemonic";
import withSuspense from "@/functions/withSuspense";
import { useStore } from "@/stores/store";
import { zodResolver } from "@hookform/resolvers/zod";
import { Web3BaseWalletAccount } from "@theqrl/web3";
import { Download, Loader } from "lucide-react";
import { observer } from "mobx-react-lite";
import { lazy } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

const MnemonicWordListing = withSuspense(
  lazy(
    () =>
      import(
        "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/CreateAccount/MnemonicDisplay/MnemonicWordListing/MnemonicWordListing"
      ),
  ),
);

const FormSchema = z.object({
  mnemonicPhrases: z.string().min(1, "Mnemonic phrases are required"),
});

interface ImportMnemonicFormProps {
  onImported: (account: Web3BaseWalletAccount) => Promise<void>;
}

const ImportMnemonicForm = observer(({ onImported }: ImportMnemonicFormProps) => {
  const { t } = useTranslation();
  const { qrlStore } = useStore();
  const { qrlInstance } = qrlStore;

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    mode: "onChange",
    reValidateMode: "onSubmit",
    defaultValues: {
      mnemonicPhrases: "",
    },
  });
  const {
    handleSubmit,
    watch,
    control,
    formState: { isSubmitting, isValid },
  } = form;

  async function onSubmit(formData: z.infer<typeof FormSchema>) {
    try {
      const account = qrlInstance?.accounts.seedToAccount(
        getHexSeedFromMnemonic(formData.mnemonicPhrases.trim()),
      );
      if (account) {
        await onImported(account);
      } else {
        control.setError("mnemonicPhrases", {
          message: t("importAccount.importFailed"),
        });
      }
    } catch (error) {
      control.setError("mnemonicPhrases", {
        message: `${t("importAccount.readError")} ${error}`,
      });
    }
  }

  return (
    <Form {...form}>
      <form
        name="importAccount"
        aria-label="importAccount"
        className="w-full"
        onSubmit={handleSubmit(onSubmit)}
      >
        <Card>
          <CardHeader>
            <CardTitle>{t("importAccount.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={control}
              name="mnemonicPhrases"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input
                      {...field}
                      aria-label={field.name}
                      autoComplete="off"
                      disabled={isSubmitting}
                      placeholder={t("mnemonic.phrases")}
                    />
                  </FormControl>
                  <FormDescription>
                    {t("importAccount.pasteMnemonic")}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <MnemonicWordListing mnemonic={watch().mnemonicPhrases} />
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
                <Download className="mr-2 h-4 w-4" />
              )}
              {isSubmitting
                ? t("importAccount.importing")
                : t("importAccount.button")}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </Form>
  );
});

export default ImportMnemonicForm;
