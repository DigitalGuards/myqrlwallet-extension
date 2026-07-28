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
  FormField,
  FormItem,
  FormMessage,
} from "@/components/UI/Form";
import { Input } from "@/components/UI/Input";
import { Label } from "@/components/UI/Label";
import { getHexSeedFromMnemonic } from "@/functions/getHexSeedFromMnemonic";
import {
  decryptWalletFile,
  parseEncryptedWalletFile,
  WalletFileDecryptError,
  WalletFileFormatError,
} from "@/functions/walletFileImport";
import { useStore } from "@/stores/store";
import { cn } from "@/utilities/stylingUtil";
import { zodResolver } from "@hookform/resolvers/zod";
import { Web3BaseWalletAccount } from "@theqrl/web3";
import { Loader, Upload } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

const FormSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

interface ImportEncryptedWalletProps {
  onImported: (account: Web3BaseWalletAccount) => Promise<void>;
}

const ImportEncryptedWallet = observer(
  ({ onImported }: ImportEncryptedWalletProps) => {
    const { t } = useTranslation();
    const { qrlStore } = useStore();
    const { qrlInstance } = qrlStore;

    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [fileError, setFileError] = useState("");
    const fileInputRef = useRef<HTMLInputElement>(null);

    const form = useForm<z.infer<typeof FormSchema>>({
      resolver: zodResolver(FormSchema),
      mode: "onChange",
      reValidateMode: "onSubmit",
      defaultValues: {
        password: "",
      },
    });
    const {
      handleSubmit,
      control,
      setError,
      formState: { isSubmitting, isValid },
    } = form;

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] ?? null;
      setSelectedFile(file);
      setFileError("");
    };

    async function onSubmit(formData: z.infer<typeof FormSchema>) {
      if (!selectedFile) {
        setFileError(t("importAccount.walletFileRequired"));
        return;
      }
      try {
        const text = await selectedFile.text();
        const encryptedWallet = parseEncryptedWalletFile(text);
        const decrypted = await decryptWalletFile(
          encryptedWallet,
          formData.password,
        );
        const hexSeed =
          decrypted.hexSeed || getHexSeedFromMnemonic(decrypted.mnemonic);
        if (!hexSeed) {
          setFileError(t("importAccount.walletFileNoAccounts"));
          return;
        }
        const account = qrlInstance?.accounts.seedToAccount(hexSeed);
        if (!account) {
          setFileError(t("importAccount.walletFileNoAccounts"));
          return;
        }
        await onImported(account);
      } catch (error) {
        if (error instanceof WalletFileFormatError) {
          setFileError(t("importAccount.walletFileInvalid"));
        } else if (error instanceof WalletFileDecryptError) {
          setError("password", {
            message: t("importAccount.walletFileDecryptFailed"),
          });
        } else {
          setError("password", {
            message: `${t("importAccount.readError")} ${error}`,
          });
        }
      }
    }

    return (
      <Form {...form}>
        <form
          name="importEncryptedWallet"
          aria-label="importEncryptedWallet"
          className="w-full"
          onSubmit={handleSubmit(onSubmit)}
        >
          <Card>
            <CardHeader>
              <CardTitle>{t("importAccount.walletFileTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="walletFile">
                  {t("importAccount.walletFileLabel")}
                </Label>
                {/* The native file control renders its own "Choose File /
                    No file chosen" chrome, which no CSS can restyle. Keep
                    the real input (accessible, still the form control) but
                    visually hidden, and drive it from themed elements. */}
                <Input
                  ref={fileInputRef}
                  id="walletFile"
                  type="file"
                  accept="application/json,.json"
                  aria-label="walletFile"
                  disabled={isSubmitting}
                  onChange={handleFileChange}
                  className="sr-only"
                />
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isSubmitting}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="mr-2 h-3.5 w-3.5 shrink-0" />
                    {t("importAccount.walletFileChoose")}
                  </Button>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-sm",
                      selectedFile
                        ? "font-data text-foreground"
                        : "text-muted-foreground",
                    )}
                    title={selectedFile?.name}
                  >
                    {selectedFile?.name ?? t("importAccount.walletFileNone")}
                  </span>
                </div>
                {fileError ? (
                  <p className="text-sm font-medium text-destructive">
                    {fileError}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("importAccount.walletFileDescription")}
                  </p>
                )}
              </div>
              <FormField
                control={control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <Label htmlFor="walletFilePassword">
                      {t("importAccount.walletFilePasswordLabel")}
                    </Label>
                    <FormControl>
                      <Input
                        {...field}
                        id="walletFilePassword"
                        type="password"
                        aria-label="walletFilePassword"
                        autoComplete="off"
                        disabled={isSubmitting}
                        placeholder={t(
                          "importAccount.walletFilePasswordPlaceholder",
                        )}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter>
              <Button
                disabled={isSubmitting || !isValid || !selectedFile}
                className="w-full"
                type="submit"
              >
                {isSubmitting ? (
                  <Loader className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
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
  },
);

export default ImportEncryptedWallet;
