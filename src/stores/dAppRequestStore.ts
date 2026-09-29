import { profileStorageKey } from "@/utilities/profileStorage";
import { BlockchainDataType } from "@/configuration/qrlBlockchainConfig";
import { EXTENSION_MESSAGES } from "@/scripts/constants/streamConstants";
import {
  DAppRequestType,
  DAppResponseType,
} from "@/scripts/middlewares/middlewareTypes";
import { getSerializableObject } from "@/scripts/utils/scriptUtils";
import StorageUtil from "@/utilities/storageUtil";
import { action, makeAutoObservable, observable } from "mobx";
import browser from "webextension-polyfill";

type CurrentTabData = {
  favIconUrl: string;
  urlOrigin: string;
  title: string;
  connectedAccounts: string[];
  connectedBlockchains: BlockchainDataType[];
};

const originFromTabUrl = (url?: string): string => {
  if (!url) return "";
  try {
    const origin = new URL(url).origin;
    return origin === "null" ? "" : origin;
  } catch {
    return "";
  }
};

class DAppRequestStore {
  private currentTabFetchGeneration = 0;
  private dAppRequestReadGeneration = 0;
  // The request the user clicked on, plus the data that approval produces.
  // Both are captured at click time and survive a newer request taking the
  // slot mid-approval; see onPermission and addToResponseData.
  private inFlightRequestId?: string;
  private inFlightResponseData?: Record<string, unknown>;
  currentTabData?: CurrentTabData;
  dAppRequestData?: DAppRequestType;
  responseData: Record<string, unknown> = {};
  canProceed: boolean = false;
  onPermissionCallBack: (hasApproved: boolean) => Promise<void> = async () =>
    undefined;
  approvalProcessingStatus = {
    isProcessing: false,
    hasApproved: false,
    hasCompleted: false,
  };

  constructor() {
    makeAutoObservable(this, {
      dAppRequestData: observable.struct,
      responseData: observable.struct,
      readDAppRequestData: action.bound,
      addToResponseData: action.bound,
      setCanProceed: action.bound,
      setOnPermissionCallBack: action.bound,
      onPermission: action.bound,
      approvalProcessingStatus: observable.struct,
      fetchCurrentTabData: action.bound,
      disconnectFromCurrentTab: action.bound,
    });
    this.fetchCurrentTabData();
    this.subscribeToRequestStorage();
    this.subscribeToActiveTab();
  }

  private subscribeToActiveTab() {
    try {
      browser.tabs.onActivated.addListener(() => {
        void this.fetchCurrentTabData();
      });
      browser.tabs.onUpdated.addListener((_, changeInfo, tab) => {
        if (
          tab.active &&
          (changeInfo.url !== undefined || changeInfo.status === "complete")
        ) {
          void this.fetchCurrentTabData();
        }
      });
    } catch {
      // Tab events are unavailable in popup-only test contexts.
    }
  }

  private subscribeToRequestStorage() {
    // The side panel persists across dApp interactions, so when the
    // middleware writes a new request to session storage we need to
    // re-read it; without this the panel renders stale data from the
    // previous request.
    try {
      browser.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === "session" && profileStorageKey("DAPPS") in changes) {
          this.responseData = {};
          this.canProceed = false;
          this.onPermissionCallBack = async () => undefined;
          this.approvalProcessingStatus = {
            isProcessing: false,
            hasApproved: false,
            hasCompleted: false,
          };
          void this.readDAppRequestData();
        }
        if (areaName === "local" && profileStorageKey("DAPPS") in changes) {
          void this.fetchCurrentTabData();
        }
      });
    } catch {
      // storage.onChanged unavailable. Popup-only contexts work fine
      // without it because the popup is recreated on each open.
    }
  }

  get hasDAppRequest() {
    return !!this.dAppRequestData;
  }

  get hasDAppConnected() {
    return !!this?.currentTabData?.connectedAccounts?.length;
  }

  async fetchCurrentTabData() {
    const generation = ++this.currentTabFetchGeneration;
    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    const currentTab = tabs[0];
    const urlOrigin = originFromTabUrl(currentTab?.url);
    const connectedDApp = urlOrigin
      ? await StorageUtil.getDAppsConnectedAccountsData(urlOrigin)
      : undefined;
    if (generation !== this.currentTabFetchGeneration) return;
    this.currentTabData = {
      favIconUrl: currentTab?.favIconUrl ?? "",
      title: currentTab?.title ?? "",
      urlOrigin,
      connectedAccounts: connectedDApp?.accounts ?? [],
      connectedBlockchains: connectedDApp?.blockchains ?? [],
    };
  }

  async disconnectFromCurrentTab() {
    await StorageUtil.clearDAppsConnectedAccountsData(
      this.currentTabData?.urlOrigin,
    );
    await this.fetchCurrentTabData();
  }

  async readDAppRequestData() {
    const generation = ++this.dAppRequestReadGeneration;
    const storedDAppRequestData = await StorageUtil.getDAppsRequestData();
    if (generation !== this.dAppRequestReadGeneration) return;
    this.dAppRequestData = storedDAppRequestData;
  }

  addToResponseData(data: Record<string, unknown>) {
    const serializableData = getSerializableObject(data);
    // While an approval is running, everything it produces belongs to that
    // approval's own bucket. The storage subscription above resets
    // responseData the moment a new request takes the slot, so writing a
    // signature or a transaction hash into the shared field could either
    // be wiped mid-flight or be read back as the answer to the newer
    // request.
    if (this.inFlightRequestId !== undefined) {
      this.inFlightResponseData = {
        ...(this.inFlightResponseData ?? {}),
        ...serializableData,
      };
      return;
    }
    this.responseData = { ...this.responseData, ...serializableData };
  }

  setCanProceed(decision: boolean) {
    this.canProceed = decision;
  }

  setOnPermissionCallBack(callBack: (hasApproved: boolean) => Promise<void>) {
    this.onPermissionCallBack = callBack;
  }

  async setApprovalProcessingStatus(status: {
    isProcessing?: boolean;
    hasApproved?: boolean;
    hasCompleted?: boolean;
  }) {
    this.approvalProcessingStatus = {
      ...this.approvalProcessingStatus,
      ...status,
    };
  }

  async onPermission(hasApproved: boolean) {
    // Everything that identifies the request is read once, at click time.
    // The callback below can run for a long time (signing, then a broadcast
    // that waits on the node), and the storage subscription swaps
    // dAppRequestData out the instant another request takes the slot.
    // Reading the id after the callback therefore used to address the
    // answer to whichever request happened to be pending by then, which
    // meant a dApp could receive the first request's transaction hash as
    // the answer to its retry.
    const requestId = this.dAppRequestData?.requestId;
    const method = this.dAppRequestData?.method ?? "";
    this.inFlightRequestId = requestId;
    this.inFlightResponseData = { ...this.responseData };
    try {
      this.setApprovalProcessingStatus({
        isProcessing: true,
        hasApproved,
      });
      // Tell the service worker the user has acted before the slow part
      // starts, so its idle timeout stops counting down. Without this the
      // timeout can answer the dApp 4001 while the broadcast is on the
      // wire, and the retry that follows signs a second transaction.
      if (requestId !== undefined) {
        try {
          await browser.runtime.sendMessage({
            action: EXTENSION_MESSAGES.DAPP_REQUEST_IN_PROGRESS,
            requestId,
          });
        } catch {
          // The worker will fall back to its own timeouts.
        }
      }
      await this.onPermissionCallBack(hasApproved);
      const response: DAppResponseType = {
        method,
        action: EXTENSION_MESSAGES.DAPP_RESPONSE,
        hasApproved,
        requestId,
        response: this.inFlightResponseData,
      };
      await browser.runtime.sendMessage(response);
    } catch (error) {
      console.warn(
        "QrlWeb3Wallet: Error while resolving the permission request\n",
        error,
      );
    } finally {
      this.inFlightRequestId = undefined;
      this.inFlightResponseData = undefined;
      // Scoped to this request: clearing unconditionally would wipe a newer
      // request that took the slot while this one was still running.
      await StorageUtil.clearDAppsRequestDataForRequestId(requestId);
      this.setApprovalProcessingStatus({
        isProcessing: false,
        hasCompleted: true,
      });
    }
  }
}

export default DAppRequestStore;
