import { Button } from "@/components/UI/Button";
import { cn } from "@/utilities/stylingUtil";
import { Eye } from "lucide-react";
import { useTranslation } from "react-i18next";

type RecoveryPhraseGridProps = {
  words: string[];
  revealed: boolean;
  onReveal: () => void;
};

/**
 * The numbered 32-word grid. While hidden it renders placeholder dots, so
 * the real words never reach the DOM until the user asks for them: a
 * blur that CSS could lift is no protection against a screenshot or a
 * shoulder surfer.
 */
const RecoveryPhraseGrid = ({
  words,
  revealed,
  onReveal,
}: RecoveryPhraseGridProps) => {
  const { t } = useTranslation();

  return (
    <div className="relative">
      <ol
        className={cn(
          // Two columns in the popup (248px of content), four in the tab and side
          // panel shell; the longest wordlist entry is six letters.
          "grid grid-cols-2 gap-1.5 sm:grid-cols-4",
          !revealed && "select-none opacity-40",
        )}
        aria-label={t("seedBackup.phraseLabel")}
        aria-hidden={!revealed}
      >
        {words.map((word, index) => (
          <li
            key={index}
            className="flex min-w-0 items-baseline gap-1 rounded-md border border-border/60 bg-background/60 px-2 py-1"
          >
            <span className="w-4 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
              {index + 1}
            </span>
            <span className="font-data min-w-0 truncate text-xs text-foreground">
              {revealed ? word : "••••"}
            </span>
          </li>
        ))}
      </ol>
      {!revealed && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Button type="button" variant="outline" onClick={onReveal}>
            <Eye className="mr-2 h-4 w-4" />
            {t("seedBackup.reveal")}
          </Button>
        </div>
      )}
    </div>
  );
};

export default RecoveryPhraseGrid;
