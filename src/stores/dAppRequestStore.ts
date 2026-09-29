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

/**
 * Records a result into one specific approval run. Each permission callback
 * gets its own, bound to the request id that was on screen when the user
 * clicked, so a second approval starting while the first is still
 * broadcasting cannot collect the first one's transaction hash.
 */
export type ResponseRecorder = (data: Record<string, unknown>) => void;

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
  // What each running approval has produced, kept per request id. A
  // surface can have more than one approval in flight (a request that is
  // still broadcasting while the user answers the next one), so a single
  // shared bucket could hand one approval's transaction hash to another.
  // Writes land here through the recorder handed to that run's callback,
  // which is bound to the id that was on screen when the user clicked.
  private inFlightResponseData = new Map<string, Record<string, unknown>>();
  currentTabData?: CurrentTabData;
  dAppRequestData?: DAppRequestType;
  responseData: Record<string, unknown> = {};
  canProceed: boolean = false;
  onPermissionCallBack: (
    hasApproved: boolean,
    record: ResponseRecorder,
  ) => Promise<void> = async () => undefined;
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
      reportPendingTransactionHash: action.bound,
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

  /**
   * What the screen has collected for the request currently on display,
   * before the user clicks: the account and chain selections. Everything an
   * approval produces after the click goes through that run's own recorder.
   */
  addToResponseData(data: Record<string, unknown>) {
    const serializableData = getSerializableObject(data);
    this.responseData = { ...this.responseData, ...serializableData };
  }

  /** Merge into one approval run's own bucket. */
  private recordForRequest(
    bucketKey: string,
    data: Record<string, unknown>,
  ): void {
    const serializableData = getSerializableObject(data);
    this.inFlightResponseData.set(bucketKey, {
      ...(this.inFlightResponseData.get(bucketKey) ?? {}),
      ...serializableData,
    });
  }

  setCanProceed(decision: boolean) {
    this.canProceed = decision;
  }

  setOnPermissionCallBack(
    callBack: (hasApproved: boolean, record: ResponseRecorder) => Promise<void>,
  ) {
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
    const bucketKey = requestId ?? "";
    // Bound to this run for as long as it lasts, whatever the screen goes
    // on to show.
    const record: ResponseRecorder = (data) =>
      this.recordForRequest(bucketKey, data);
    this.inFlightResponseData.set(bucketKey, { ...this.responseData });
    try {
      this.setApprovalProcessingStatus({
        isProcessing: true,
        hasApproved,
      });

      // Ask the service worker whether this request is still live before
      // anything irreversible happens. It answers only while it is still
      // waiting on this exact request, which both stands its idle timeout
      // down (so it cannot answer 4001 while a broadcast is on the wire)
      // and stops this surface signing for a request the worker has
      // already given up on.
      if (!(await this.confirmRequestIsLive(requestId, hasApproved))) {
        // The worker has already answered or abandoned this one, so the
        // entry on screen is stale. Clearing it takes the surface back to
        // the wallet. Leaving it up would show a prompt whose buttons can
        // no longer do anything.
        try {
          await StorageUtil.clearDAppsRequestDataForRequestId(requestId);
        } catch {
          // best-effort cleanup
        }
        return;
      }

      await this.onPermissionCallBack(hasApproved, record);
      const response: DAppResponseType = {
        method,
        action: EXTENSION_MESSAGES.DAPP_RESPONSE,
        hasApproved,
        requestId,
        response: this.inFlightResponseData.get(bucketKey),
      };
      // The service worker clears the pending-request slot when it takes
      // this answer, which keeps the clear ahead of the next request being
      // written. Nothing clears it from here on the success path.
      await browser.runtime.sendMessage(response);
    } catch (error) {
      console.warn(
        "QrlWeb3Wallet: Error while resolving the permission request\n",
        error,
      );
      // The answer never reached the worker, so nothing there will clear
      // the slot and the surface would keep showing a request that can no
      // longer be resolved. Scoped to this request id, so a newer one that
      // took the slot in the meantime is left alone.
      try {
        await StorageUtil.clearDAppsRequestDataForRequestId(requestId);
      } catch {
        // best-effort cleanup
      }
    } finally {
      this.inFlightResponseData.delete(bucketKey);
      this.setApprovalProcessingStatus({
        isProcessing: false,
        hasCompleted: true,
      });
    }
  }

  /**
   * Tell the service worker the hash of the transaction this approval is
   * about to broadcast. It arrives before the broadcast does, so a request
   * whose surface dies mid-flight can still be named in the answer and
   * watched for on chain. Best effort: a failure here leaves the broadcast
   * itself untouched.
   */
  async reportPendingTransactionHash(transactionHash: string): Promise<void> {
    const requestId = this.dAppRequestData?.requestId;
    if (requestId === undefined || !transactionHash) return;
    try {
      await browser.runtime.sendMessage({
        action: EXTENSION_MESSAGES.DAPP_REQUEST_PENDING_TRANSACTION,
        requestId,
        transactionHash,
      });
    } catch {
      // The worker falls back to answering without a hash.
    }
  }

  /**
   * Whether the service worker is still waiting on this request. A missing
   * or negative acknowledgement means the approval has already been
   * answered or abandoned there, and this surface must do no further work
   * for it.
   */
  private async confirmRequestIsLive(
    requestId: string | undefined,
    hasApproved: boolean,
  ): Promise<boolean> {
    // A request with no id predates the acknowledgement protocol, so there
    // is nothing to ask about.
    if (requestId === undefined) return true;
    try {
      const acknowledgement = (await browser.runtime.sendMessage({
        action: EXTENSION_MESSAGES.DAPP_REQUEST_IN_PROGRESS,
        requestId,
        // Which way the user answered, so a surface that dies before the
        // answer arrives is reported as the rejection it was.
        hasApproved,
      })) as { accepted?: boolean } | undefined;
      return acknowledgement?.accepted === true;
    } catch {
      // No listener answered, so the worker is no longer waiting on it.
      return false;
    }
  }
}

export default DAppRequestStore;
