import { JsonRpcMiddleware } from "@theqrl/qrl-wallet-provider/json-rpc-engine";
import { Json, JsonRpcRequest } from "@theqrl/qrl-wallet-provider/utils";
import browser from "webextension-polyfill";
import { resolveTrustedSenderOrigin } from "../utils/dAppAccountNotifications";

export type MessageSenderWithOrigin = browser.Runtime.MessageSender & {
  origin?: string;
};

type appendSenderDataParams = {
  sender: MessageSenderWithOrigin;
};

// Extends the upstream `senderData` shape with `mainFrameOrigin`. Permission
// and account-authorisation checks use `url` (the trusted frame origin);
// phishing-detect and the approval popup additionally consume
// `mainFrameOrigin` (the parent tab origin) so a phishing top-level page
// hosting a connected dApp's iframe is caught.
export type ExtendedSenderData = {
  tabId?: number;
  title?: string;
  url?: string;
  favIconUrl?: string;
  mainFrameOrigin?: string;
};

export const appendSenderDataMiddleware =
  ({
    sender,
  }: appendSenderDataParams): JsonRpcMiddleware<JsonRpcRequest, Json> =>
  (req, _, next) => {
    const { tab } = sender;
    // Chrome's sender.origin is the authoritative requester identity. It can
    // be opaque for sandboxed, about, or file frames; those requests fail
    // closed. Older browsers without sender.origin fall back to sender.url.
    // sender.tab.url is the top-level tab URL and remains UI-only context.
    // tabId / title / favIconUrl stay as UI-only context (no security boundary).
    // mainFrameOrigin carries the parent tab URL for phishing-list lookup
    // and for popup display so users see both frame and parent origins.
    const senderData: ExtendedSenderData = {
      tabId: tab?.id,
      title: tab?.title,
      url: resolveTrustedSenderOrigin(sender),
      favIconUrl: tab?.favIconUrl,
      mainFrameOrigin: tab?.url,
    };
    req.senderData = senderData;
    next();
  };
