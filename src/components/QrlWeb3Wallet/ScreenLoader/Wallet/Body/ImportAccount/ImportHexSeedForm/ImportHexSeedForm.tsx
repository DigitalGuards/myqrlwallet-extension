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
import { useStore } from "@/stores/store";
import { zodResolver } from "@hookform/resolvers/zod";
import Web3, { Web3BaseWalletAccount } from "@theqrl/web3";
import { Download, Loader } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

// Same validation the web wallet uses (ImportHexSeedForm.tsx): a 0x-prefixed
// hexadecimal string. The QRL Dilithium hex seed is what seedToAccount consumes
// directly, so no mnemonic round-trip is needed for this path.
const FormSchema = z.object({
  hexSeed: z
    .string()
    .min(1, "Hex seed is required")
    .regex(
      /^0x[0-9a-fA-F]+$/,
      "Invalid hex seed format. Must start with '0x' followed by hex characters",
    ),
});

interface ImportHexSeedFormProps {
  onImported: (account: Web3BaseWalletAccount) => Promise<void>;
}

const ImportHexSeedForm = observer(({ onImported }: ImportHexSeedFormProps) => {
  const { t } = useTranslation();
  const { qrlStore } = useStore();
  const { qrlInstance } = qrlStore;

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    mode: "onChange",
    reValidateMode: "onSubmit",
    defaultValues: {
      hexSeed: "",
    },
  });
  const {
    handleSubmit,
    control,
    formState: { isSubmitting, isValid },
  } = form;

  async function onSubmit(formData: z.infer<typeof FormSchema>) {
    try {
      const accounts = qrlInstance?.accounts ?? new Web3().qrl.accounts;
      const account = accounts.seedToAccount(formData.hexSeed.trim());
      if (account) {
        await onImported(account);
      } else {
        control.setError("hexSeed", {
          message: t("importAccount.hexSeedImportFailed"),
        });
      }
    } catch (error) {
      control.setError("hexSeed", {
        message: `${t("importAccount.readError")} ${error}`,
      });
    }
  }

  return (
    <Form {...form}>
      <form
        name="importHexSeed"
        aria-label="importHexSeed"
        className="w-full"
        onSubmit={handleSubmit(onSubmit)}
      >
        <div className="space-y-4">
          <FormField
            control={control}
            name="hexSeed"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Input
                    {...field}
                    aria-label={field.name}
                    autoComplete="off"
                    disabled={isSubmitting}
                    placeholder={t("importAccount.hexSeedPlaceholder")}
                  />
                </FormControl>
                <FormDescription>
                  {t("importAccount.pasteHexSeed")}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <Button
          disabled={isSubmitting || !isValid}
          className="mt-6 w-full"
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
      </form>
    </Form>
  );
});

export default ImportHexSeedForm;
