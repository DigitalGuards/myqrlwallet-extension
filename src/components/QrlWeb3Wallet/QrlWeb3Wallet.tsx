import RouteMonitor from "@/components/QrlWeb3Wallet/RouteMonitor/RouteMonitor";
import ScreenLoader from "@/components/QrlWeb3Wallet/ScreenLoader/ScreenLoader";
import { TooltipProvider } from "../UI/Tooltip";
import { observer } from "mobx-react-lite";
import { useStore } from "@/stores/store";
import { cva } from "class-variance-authority";

const qrlWalletBodyClasses = cva(
  // The shell never scrolls: ScrollRegion (below the static header) owns
  // the scrollbar, so the bar cannot run over the header row.
  "relative flex flex-col overflow-hidden bg-transparent text-foreground",
  {
    variants: {
      mode: {
        popup: ["w-[23rem] h-[600px]"],
        tab: ["w-full max-w-lg mx-auto h-screen border rounded-lg shadow-2xl"],
        sidepanel: ["w-full max-w-lg mx-auto h-screen"],
      },
    },
    defaultVariants: {
      mode: "popup",
    },
  },
);

const QrlWeb3Wallet = observer(() => {
  const { settingsStore } = useStore();
  const { isPopupWindow, isSidePanel } = settingsStore;

  const mode = isSidePanel ? "sidepanel" : isPopupWindow ? "popup" : "tab";

  return (
    <div className={qrlWalletBodyClasses({ mode })}>
      <RouteMonitor />
      <TooltipProvider>
        <ScreenLoader />
      </TooltipProvider>
    </div>
  );
});

export default QrlWeb3Wallet;
