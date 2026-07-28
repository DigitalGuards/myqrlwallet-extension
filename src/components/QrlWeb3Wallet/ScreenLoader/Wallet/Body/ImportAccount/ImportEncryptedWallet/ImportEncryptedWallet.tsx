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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/UI/Select";
import { getHexSeedFromMnemonic } from "@/functions/getHexSeedFromMnemonic";
import {
  decryptWalletFile,
  WalletFileDecryptError,
  WalletFileFormatError,
} from "@/functions/walletFileImport";
import {
  decryptBackupKeystore,
  parseWalletImportFile,
  WalletBackupEmptyError,
  type ParsedWalletImportFile,
} from "@/functions/walletBackupImport";
import { useStore } from "@/stores/store";
import { cn } from "@/utilities/stylingUtil";
import { zodResolver } from "@hookform/resolvers/zod";
import { Web3BaseWalletAccount } from "@theqrl/web3";
import { Loader, Upload } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

const FormSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

interface ImportEncryptedWalletProps {
  onImported: (account: Web3BaseWalletAccount) => Promise<void>;
}

// Above the recommended write params (keystoreParams.ts): legal per the
// bounds, but worth a warning before a long or memory-hungry decrypt.
const HEAVY_KDF_MEMORY_KIB = 262144;

const shortAddress = (address: string, index: number): string =>
  address.length >= 12
    ? `${address.slice(0, 10)}...${address.slice(-8)}`
    : `Account ${index + 1}`;

const ImportEncryptedWallet = observer(
  ({ onImported }: ImportEncryptedWalletProps) => {
    const { t } = useTranslation();
    const { qrlStore } = useStore();
    const { qrlInstance } = qrlStore;

    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [parsed, setParsed] = useState<ParsedWalletImportFile | null>(null);
    const [selectedKeystore, setSelectedKeystore] = useState("0");
    const [isParsing, setIsParsing] = useState(false);
    const [fileError, setFileError] = useState("");
    const fileInputRef = useRef<HTMLInputElement>(null);
    // Monotonic token so a slow read of a previous file cannot overwrite the
    // parse result of a newer selection.
    const parseTokenRef = useRef(0);
    // A multi-second KDF can outlive the screen (Back button, dialog close).
    // The worker cannot be aborted mid-derivation, but a canceled flow must
    // never land the import: onImported mutates stores (active account,
    // keystore persistence), which unmount does not neutralize.
    const mountedRef = useRef(true);
    useEffect(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
      };
    }, []);

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

    const handleFileChange = async (
      event: React.ChangeEvent<HTMLInputElement>,
    ) => {
      const file = event.target.files?.[0] ?? null;
      const token = ++parseTokenRef.current;
      setSelectedFile(file);
      setSelectedKeystore("0");
      setParsed(null);
      setFileError("");
      if (!file) return;
      setIsParsing(true);
      try {
        const text = await file.text();
        const result = parseWalletImportFile(text);
        if (token !== parseTokenRef.current) return;
        setParsed(result);
      } catch (error) {
        if (token !== parseTokenRef.current) return;
        if (error instanceof WalletBackupEmptyError) {
          setFileError(t("importAccount.walletFileNoAccounts"));
        } else if (error instanceof WalletFileFormatError) {
          setFileError(t("importAccount.walletFileInvalid"));
        } else {
          setFileError(`${t("importAccount.readError")} ${error}`);
        }
      } finally {
        if (token === parseTokenRef.current) {
          setIsParsing(false);
        }
      }
    };

    async function onSubmit(formData: z.infer<typeof FormSchema>) {
      if (isParsing) return;
      if (!selectedFile || !parsed) {
        setFileError(t("importAccount.walletFileRequired"));
        return;
      }
      try {
        let hexSeed: string;
        if (parsed.kind === "backup") {
          const keystore =
            parsed.keystores[Number(selectedKeystore)] ?? parsed.keystores[0];
          if (!keystore) {
            setFileError(t("importAccount.walletFileNoAccounts"));
            return;
          }
          hexSeed = await decryptBackupKeystore(keystore, formData.password);
        } else {
          const decrypted = await decryptWalletFile(
            parsed.wallet,
            formData.password,
          );
          hexSeed =
            decrypted.hexSeed || getHexSeedFromMnemonic(decrypted.mnemonic);
        }
        if (!mountedRef.current) return;
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
            message: t(
              parsed.kind === "backup"
                ? "importAccount.walletFileBackupDecryptFailed"
                : "importAccount.walletFileDecryptFailed",
            ),
          });
        } else {
          setError("password", {
            message: `${t("importAccount.readError")} ${error}`,
          });
        }
      }
    }

    const isBackup = parsed?.kind === "backup";
    const keystores = isBackup ? parsed.keystores : [];
    const activeKeystore = isBackup
      ? (keystores[Number(selectedKeystore)] ?? keystores[0])
      : undefined;
    const busy = isSubmitting || isParsing;

    return (
      <Form {...form}>
        <form
          name="importEncryptedWallet"
          aria-label="importEncryptedWallet"
          className="w-full min-w-0"
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
                  disabled={busy}
                  onChange={handleFileChange}
                  // sr-only clips rather than hiding, so the input would
                  // otherwise stay in the tab order as an invisible stop
                  // whose focus ring is clipped away. The themed button is
                  // the keyboard path; the label still activates this input.
                  tabIndex={-1}
                  className="sr-only"
                />
                <div className="flex min-w-0 items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
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
              {isBackup && keystores.length > 1 && (
                <div className="space-y-2">
                  <Label htmlFor="walletFileAccount">
                    {t("importAccount.walletFileAccountLabel")}
                  </Label>
                  <Select
                    value={selectedKeystore}
                    onValueChange={setSelectedKeystore}
                    disabled={busy}
                  >
                    <SelectTrigger
                      id="walletFileAccount"
                      aria-label="walletFileAccount"
                      className="w-full font-data"
                    >
                      <SelectValue
                        placeholder={t(
                          "importAccount.walletFileAccountPlaceholder",
                        )}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {keystores.map((ks, i) => (
                        <SelectItem
                          key={ks.id || i}
                          value={String(i)}
                          className="font-data"
                        >
                          {shortAddress(ks.address, i)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-sm text-muted-foreground">
                    {t("importAccount.walletFileMultiAccountNote", {
                      count: keystores.length,
                    })}
                  </p>
                </div>
              )}
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
                        disabled={busy}
                        placeholder={t(
                          "importAccount.walletFilePasswordPlaceholder",
                        )}
                      />
                    </FormControl>
                    {isBackup && (
                      <p className="text-sm text-muted-foreground">
                        {t("importAccount.walletFileBackupPasswordHint")}
                      </p>
                    )}
                    {activeKeystore &&
                      activeKeystore.crypto.kdfparams.m > HEAVY_KDF_MEMORY_KIB && (
                        <p className="text-sm text-yellow-400">
                          {t("importAccount.walletFileHeavyKdf")}
                        </p>
                      )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter>
              <Button
                disabled={busy || !isValid || !selectedFile || !parsed}
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
