import { observer } from "mobx-react-lite";
import DAppConnectedAccounts from "./DAppConnectedAccounts/DAppConnectedAccounts";
import DAppConnectedBlockchains from "./DAppConnectedBlockchains/DAppConnectedBlockchains";
import { useStore } from "@/stores/store";
import { useEffect } from "react";

const DAppConnected = observer(() => {
  const { dAppRequestStore } = useStore();

  useEffect(() => {
    dAppRequestStore.fetchCurrentTabData().catch((error: unknown) => {
      console.error("Failed to load current tab:", error);
    });
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <DAppConnectedAccounts />
      <DAppConnectedBlockchains />
    </div>
  );
});

export default DAppConnected;
