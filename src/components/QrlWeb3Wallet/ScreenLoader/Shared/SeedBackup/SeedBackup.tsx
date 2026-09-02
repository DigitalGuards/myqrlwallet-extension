import { Alert, AlertDescription } from "@/components/UI/Alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/UI/AlertDialog";
import { Button } from "@/components/UI/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/UI/Card";
import { Input } from "@/components/UI/Input";
import { Label } from "@/components/UI/Label";
import { getMnemonicFromHexSeed } from "@/functions/getMnemonicFromHexSeed";
import StringUtil from "@/utilities/stringUtil";
import { Web3BaseWalletAccount } from "@theqrl/web3";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  HardDriveDownload,
  Loader,
  TriangleAlert,
  Undo,
} from "lucide-react";
import { FormEvent, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import RecoveryPhraseGrid from "./RecoveryPhraseGrid";

export const CONFIRM_WORD_COUNT = 3;

/** Distinct random word positions (0-based), ascending. */
export const pickConfirmPositions = (
  wordCount: number,
  count = CONFIRM_WORD_COUNT,
): number[] => {
  const positions = new Set<number>();
  const available = Math.min(count, wordCount);
  while (positions.size < available) {
    positions.add(Math.floor(Math.random() * wordCount));
  }
  return [...positions].sort((a, b) => a - b);
};

type SeedBackupProps = {
  account: Web3BaseWalletAccount;
  // Called once the user has typed the requested words back correctly.
  // Persisting the account belongs to the caller; nothing is stored until
  // then, so a closed popup never leaves an account nobody backed up.
  onConfirmed: () => void | Promise<void>;
  // Leaves the flow before anything is stored.
  onBack?: () => void;
  // Error from the caller's persist step, shown on the confirm card.
  error?: string;
};

/**
 * Two-step recovery phrase backup: reveal the 32 words (plus hex seed and
 * the backup file), then prove the backup by re-entering three of them.
 */
const SeedBackup = ({
  account,
  onConfirmed,
  onBack,
  error,
}: SeedBackupProps) => {
  const { t } = useTranslation();
  const idPrefix = useId();
  const mnemonic = useMemo(
    () => getMnemonicFromHexSeed(account.seed),
    [account.seed],
  );
  const words = useMemo(
    () => mnemonic.split(" ").filter((word) => !!word),
    [mnemonic],
  );
  const [positions] = useState(() => pickConfirmPositions(words.length));

  const [step, setStep] = useState<"reveal" | "confirm">("reveal");
  const [revealed, setRevealed] = useState(false);
  const [showHexSeed, setShowHexSeed] = useState(false);
  const [answers, setAnswers] = useState<string[]>(() =>
    positions.map(() => ""),
  );
  const [mismatched, setMismatched] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [skipDialogOpen, setSkipDialogOpen] = useState(false);

  const { prefix, addressSplit } = StringUtil.getSplitAddress(account.address);
  const hexSeed = StringUtil.getSplitAddress(account.seed ?? "", 8);

  const onDownload = () => StringUtil.downloadRecoveryPhrases(account);

  const setAnswer = (index: number, value: string) => {
    setAnswers((prev) => prev.map((a, i) => (i === index ? value : a)));
    if (mismatched.size > 0) setMismatched(new Set());
  };

  const onConfirm = async (event: FormEvent) => {
    event.preventDefault();
    const wrong = new Set<number>();
    positions.forEach((position, index) => {
      if (
        answers[index].trim().toLowerCase() !== words[position].toLowerCase()
      ) {
        wrong.add(index);
      }
    });
    if (wrong.size > 0) {
      setMismatched(wrong);
      return;
    }
    await persist();
  };

  const persist = async () => {
    setBusy(true);
    try {
      await onConfirmed();
    } finally {
      setBusy(false);
    }
  };

  // The escape hatch persists through the same path as a passed check; the
  // dialog exists so nobody lands here by accident.
  const onSkip = async () => {
    setSkipDialogOpen(false);
    await persist();
  };

  if (step === "confirm") {
    const allFilled = answers.every((answer) => answer.trim().length > 0);
    return (
      <form
        name="confirmRecoveryPhrase"
        aria-label="confirmRecoveryPhrase"
        onSubmit={onConfirm}
      >
        <Card className="animate-appear-in">
          <CardHeader>
            <CardTitle>{t("seedBackup.confirmTitle")}</CardTitle>
            <CardDescription className="break-words">
              {t("seedBackup.confirmDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {positions.map((position, index) => {
              const inputId = `${idPrefix}-word-${position + 1}`;
              const isWrong = mismatched.has(index);
              return (
                <div key={position} className="space-y-2">
                  <Label htmlFor={inputId}>
                    {t("seedBackup.wordLabel", { position: position + 1 })}
                  </Label>
                  <Input
                    id={inputId}
                    value={answers[index]}
                    onChange={(e) => setAnswer(index, e.target.value)}
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    disabled={busy}
                    aria-invalid={isWrong || undefined}
                    className={
                      isWrong
                        ? "border-destructive focus-visible:ring-destructive"
                        : ""
                    }
                  />
                </div>
              );
            })}
            {mismatched.size > 0 && (
              <p className="text-sm font-medium text-destructive" role="alert">
                {t("seedBackup.mismatch")}
              </p>
            )}
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
          <CardFooter className="flex-col gap-2">
            <Button
              className="w-full"
              type="submit"
              disabled={!allFilled || busy}
            >
              {busy ? (
                <Loader className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              {t("seedBackup.confirmButton")}
            </Button>
            <Button
              className="w-full"
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setMismatched(new Set());
                setStep("reveal");
              }}
            >
              <Undo className="mr-2 h-4 w-4" />
              {t("seedBackup.showAgain")}
            </Button>
            <Button
              className="w-full border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setSkipDialogOpen(true)}
            >
              <TriangleAlert className="mr-2 h-4 w-4" />
              {t("seedBackup.skipButton")}
            </Button>
          </CardFooter>
        </Card>
        <AlertDialog open={skipDialogOpen} onOpenChange={setSkipDialogOpen}>
          <AlertDialogContent className="w-80 rounded-md">
            <AlertDialogHeader className="text-left">
              <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                <TriangleAlert className="h-5 w-5 shrink-0" />
                {t("seedBackup.skipTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("seedBackup.skipDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
              <AlertDialogCancel className="w-full">
                {t("seedBackup.skipCancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                className="w-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => void onSkip()}
              >
                {t("seedBackup.skipConfirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </form>
    );
  }

  return (
    <Card className="animate-appear-in">
      <CardHeader>
        <CardTitle>{t("seedBackup.title")}</CardTitle>
        <CardDescription className="break-words">
          {t("seedBackup.description", { count: words.length })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-1">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            {t("seedBackup.addressLabel")}
          </div>
          <div className="font-data break-all text-sm font-bold text-identity-accent">
            {prefix} {addressSplit.join(" ")}
          </div>
        </div>
        <RecoveryPhraseGrid
          words={words}
          revealed={revealed}
          onReveal={() => setRevealed(true)}
        />
        {revealed && (
          <div className="space-y-2">
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              aria-expanded={showHexSeed}
              onClick={() => setShowHexSeed((value) => !value)}
            >
              {showHexSeed ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              {showHexSeed
                ? t("seedBackup.hideHexSeed")
                : t("seedBackup.showHexSeed")}
            </button>
            {showHexSeed && (
              <div className="rounded-md border border-border/60 bg-background/60 p-2">
                <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                  {t("seedBackup.hexSeedLabel")}
                </div>
                <div className="font-data flex flex-wrap gap-x-2 gap-y-0.5 text-xs">
                  <span>{hexSeed.prefix}</span>
                  {hexSeed.addressSplit.map((segment, index) => (
                    <span key={index}>{segment}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {t("seedBackup.warning")}
        </p>
      </CardContent>
      <CardFooter className="flex-col gap-2">
        {revealed && (
          <Button
            className="w-full"
            type="button"
            variant="outline"
            onClick={onDownload}
          >
            <HardDriveDownload className="mr-2 h-4 w-4" />
            {t("seedBackup.download")}
          </Button>
        )}
        <Button
          className="w-full"
          type="button"
          disabled={!revealed}
          onClick={() => setStep("confirm")}
        >
          <ArrowRight className="mr-2 h-4 w-4" />
          {t("seedBackup.savedButton")}
        </Button>
        {onBack && (
          <Button
            className="w-full"
            type="button"
            variant="ghost"
            onClick={onBack}
          >
            <Undo className="mr-2 h-4 w-4" />
            {t("seedBackup.back")}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
};

export default SeedBackup;
