import { useStore } from "@/stores/store";
import { Loader } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";
import LockPassword from "./LockPassword/LockPassword";

const Lock = observer(() => {
  const { lockStore } = useStore();
  const { isLoading } = lockStore;
  const { t } = useTranslation();

  return (
    <div className="relative flex min-h-full w-full flex-1 flex-col items-center justify-center gap-10 overflow-hidden p-8">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-secondary/20 blur-3xl"
      />
      <div className="relative z-10 flex flex-col items-center gap-4">
        <img
          className="h-16 w-16 drop-shadow-md"
          src="icons/qrl/default.png"
          alt="MyQRLWallet"
        />
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          {t("lock.title")}
        </h1>
      </div>
      <div className="relative z-10 w-full max-w-sm">
        {isLoading ? (
          <div className="flex justify-center">
            <Loader
              className="animate-spin text-secondary"
              size="48"
              data-testid="loader-icon"
            />
          </div>
        ) : (
          <LockPassword />
        )}
      </div>
    </div>
  );
});

export default Lock;
