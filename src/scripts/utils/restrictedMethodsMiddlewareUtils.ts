import {
  JsonRpcRequest,
  providerErrors,
  rpcErrors,
} from "@theqrl/qrl-wallet-provider";
import { RESTRICTED_METHODS } from "../constants/requestConstants";
import StorageUtil from "@/utilities/storageUtil";
import { assertV3Network, V3_CHAIN_ID } from "@/configuration/releaseProfile";
import { MAX_SAFE_CHAIN_ID } from "@/constants/blockchain";
import { BlockchainDataType } from "@/configuration/qrlBlockchainConfig";
import {
  areAddressesEquivalent,
  isCanonicalQrlAddress,
  isQrlAddress,
} from "@/utilities/addressUtil";
import {
  CAVEAT_TYPES,
  DAppRequestType,
  PARENT_CAPABILITIES,
  Permission,
} from "../middlewares/middlewareTypes";
import { registerDAppTransactionWatch } from "./dAppTransactionWatcher";
import LockManager from "../lockManager/lockManager";

/**
 * The single answer every authorization precheck gives while the wallet is
 * locked. It carries no address, no chain and no connection state, so it
 * reads the same for an authorized address, an unauthorized one and an
 * origin with no grant at all.
 */
const LOCKED_WALLET_REFUSAL_MESSAGE =
  "The wallet is locked. Unlock it and try again.";

const buildLockedWalletRefusal = () => ({
  canProceed: false,
  proceedError: providerErrors.unauthorized({
    message: LOCKED_WALLET_REFUSAL_MESSAGE,
  }),
});

/**
 * A locked wallet has to answer an authorization precheck identically for an
 * authorized and an unauthorized origin or address. `qrl_accounts`, the
 * provider state and `wallet_getPermissions` all report nothing while
 * locked, so a precheck that refused an unauthorized address outright and
 * opened a prompt for an authorized one handed the page an oracle for its
 * own grants through a method it cannot complete anyway (L6).
 *
 * The equality is kept by refusing every locked precheck with one shared
 * error (L-1). No approval surface opens, so a page cannot raise the unlock
 * screen on demand either. A legitimate dApp re-sends the request once the
 * user has unlocked the wallet by hand.
 *
 * @param enforceWhileLocked true for post-approval revalidation, which runs
 * after the user unlocked and decides whether a signature happens, so it
 * answers strictly on the stored grants whatever the lock state says.
 */
const shouldRefuseWhileLocked = async (
  enforceWhileLocked: boolean,
): Promise<boolean> => {
  if (enforceWhileLocked) return false;
  try {
    return (await LockManager.isLocked()).isLocked;
  } catch {
    // An unreadable lock state fails closed: refuse.
    return true;
  }
};

const getFromAddress = (req: JsonRpcRequest<JsonRpcRequest>) => {
  switch (req.method) {
    case RESTRICTED_METHODS.QRL_SEND_TRANSACTION:
      // @ts-expect-error - params is typed as JsonRpcParams but is an array at runtime for this RPC method
      return req.params?.[0]?.from ?? "";
    case RESTRICTED_METHODS.WALLET_GET_CAPABILITIES:
    case RESTRICTED_METHODS.QRL_SIGN_TYPED_DATA_V4:
    case RESTRICTED_METHODS.QRL_SIGN_MESSAGE:
    case RESTRICTED_METHODS.QRL_SIGN_TYPED_DATA:
      // @ts-expect-error - params is typed as JsonRpcParams but is an array at runtime for this RPC method
      return req.params?.[0];
    case RESTRICTED_METHODS.PERSONAL_SIGN:
      // @ts-expect-error - params is typed as JsonRpcParams but is an array at runtime for this RPC method
      return req.params?.[1];
  }
};

export const checkAccountHasBeenAuthorized = async (
  req: JsonRpcRequest<JsonRpcRequest>,
  enforceWhileLocked = false,
) => {
  // First, and before anything derived from the request is read, so the
  // locked answer is the same for every origin and every address (L6/L-1).
  if (await shouldRefuseWhileLocked(enforceWhileLocked)) {
    return buildLockedWalletRefusal();
  }
  const fromAddress = getFromAddress(req);
  const urlOrigin = new URL(req?.senderData?.url ?? "").origin;
  const connectedAccounts =
    await StorageUtil.getDAppsConnectedAccountsData(urlOrigin);
  const hasAddressConnected =
    connectedAccounts?.accounts.some((address) =>
      areAddressesEquivalent(address, fromAddress),
    ) ?? false;
  return {
    canProceed: hasAddressConnected,
    proceedError: providerErrors.unauthorized({
      message: `The requested account ${fromAddress} has not been authorized by the user.`,
    }),
  };
};

export const normalizeChainId = (chainId: unknown): string | undefined => {
  if (
    (typeof chainId !== "string" &&
      typeof chainId !== "number" &&
      typeof chainId !== "bigint") ||
    (typeof chainId === "number" && !Number.isSafeInteger(chainId))
  ) {
    return undefined;
  }

  try {
    const value = BigInt(chainId);
    if (value <= 0n || value > BigInt(MAX_SAFE_CHAIN_ID)) return undefined;
    return `0x${value.toString(16)}`;
  } catch {
    return undefined;
  }
};

const getTypedDataChainId = (req: JsonRpcRequest<JsonRpcRequest>) => {
  // @ts-expect-error - params is typed as JsonRpcParams but is an array at runtime
  const rawTypedData = req.params?.[1];
  if (typeof rawTypedData === "string") {
    try {
      return {
        isValid: true,
        chainId: JSON.parse(rawTypedData)?.domain?.chainId,
      };
    } catch {
      return { isValid: false, chainId: undefined };
    }
  }
  return { isValid: true, chainId: rawTypedData?.domain?.chainId };
};

/**
 * Enforce the account and chain capability granted to a dApp origin.
 * Transactions and typed-data requests honor their explicit chain IDs.
 * Sensitive requests without a declared chain are bound to the active chain.
 */
export const checkAccountAndChainHaveBeenAuthorized = async (
  req: JsonRpcRequest<JsonRpcRequest>,
  expectedChainId?: string,
  enforceWhileLocked = false,
) => {
  // The account check leads, and it carries the locked-wallet refusal, so a
  // locked wallet returns that one shared error here before any part of the
  // request is inspected (L6/L-1).
  const accountResult = await checkAccountHasBeenAuthorized(
    req,
    enforceWhileLocked,
  );
  if (!accountResult.canProceed) return accountResult;

  if (req.method === RESTRICTED_METHODS.QRL_SEND_TRANSACTION) {
    const transaction = (
      req.params as unknown as Array<Record<string, unknown>>
    )?.[0];
    const to = transaction?.to;
    if (to !== undefined && to !== null && to !== "" && !isQrlAddress(to)) {
      return {
        canProceed: false,
        proceedError: rpcErrors.invalidParams({
          message:
            "Transaction recipients must use an uppercase-Q QIP-55 address with 128 hexadecimal characters and a valid checksum.",
        }),
      };
    }
  }

  const origin = new URL(req?.senderData?.url ?? "").origin;
  const connectedData = await StorageUtil.getDAppsConnectedAccountsData(origin);
  const activeChainId = normalizeChainId(
    (await StorageUtil.getActiveBlockChain())?.chainId,
  );
  if (req.method === RESTRICTED_METHODS.QRL_SEND_TRANSACTION) {
    const transaction = (
      req.params as unknown as Array<Record<string, unknown>>
    )?.[0];
    if (
      transaction &&
      Object.prototype.hasOwnProperty.call(transaction, "chainId")
    ) {
      const declaredChainId = normalizeChainId(transaction.chainId);
      if (!declaredChainId) {
        return {
          canProceed: false,
          proceedError: rpcErrors.invalidParams({
            message: "The transaction contains an invalid chain ID.",
          }),
        };
      }
      if (
        declaredChainId !== activeChainId ||
        (expectedChainId !== undefined &&
          declaredChainId !== normalizeChainId(expectedChainId))
      ) {
        return {
          canProceed: false,
          proceedError: providerErrors.unauthorized({
            message:
              "The transaction chain does not match the active, authorized wallet chain.",
          }),
        };
      }
    }
  }
  const typedDataChain =
    req.method === RESTRICTED_METHODS.QRL_SIGN_TYPED_DATA_V4 ||
    req.method === RESTRICTED_METHODS.QRL_SIGN_TYPED_DATA
      ? getTypedDataChainId(req)
      : { isValid: true, chainId: undefined };
  if (!typedDataChain.isValid) {
    return {
      canProceed: false,
      proceedError: rpcErrors.invalidParams({
        message: "The wallet cannot parse the typed-data request.",
      }),
    };
  }
  const declaredTypedDataChainId = typedDataChain.chainId;
  const hasDeclaredTypedDataChain =
    declaredTypedDataChainId !== undefined && declaredTypedDataChainId !== null;
  const effectiveChainId = normalizeChainId(
    expectedChainId ??
      (hasDeclaredTypedDataChain ? declaredTypedDataChainId : activeChainId),
  );

  if (!effectiveChainId) {
    return {
      canProceed: false,
      proceedError: rpcErrors.invalidParams({
        message: "The request contains an invalid chain ID.",
      }),
    };
  }

  // A typed signature for another chain is too easy to misread in an approval
  // tied to the active wallet network. Require an explicit switch first.
  if (
    (hasDeclaredTypedDataChain || expectedChainId !== undefined) &&
    effectiveChainId !== activeChainId
  ) {
    return {
      canProceed: false,
      proceedError: providerErrors.unauthorized({
        message: `The authorized request chain ${effectiveChainId} is not the active wallet chain.`,
      }),
    };
  }

  // A locked wallet never reaches this point: the account check above
  // returns the shared locked refusal for every origin, so the per-origin
  // chain grant is only ever read on an unlocked wallet (L6/L-1).
  const isAuthorized = (connectedData?.blockchains ?? []).some(
    (chain) => normalizeChainId(chain.chainId) === effectiveChainId,
  );
  if (!isAuthorized) {
    return {
      canProceed: false,
      proceedError: providerErrors.unauthorized({
        message: `The requesting site is not authorized to use chain ${effectiveChainId}.`,
      }),
    };
  }

  return {
    canProceed: true,
    proceedError: undefined,
    authorizedChainId: effectiveChainId,
  };
};

export const revalidateAuthorizedDAppRequest = async (
  request: DAppRequestType | undefined,
) => {
  if (
    request?.method === RESTRICTED_METHODS.QRL_SIGN_TYPED_DATA_V4 ||
    request?.method === RESTRICTED_METHODS.QRL_SIGN_TYPED_DATA
  ) {
    return {
      canProceed: false,
      proceedError: providerErrors.unsupportedMethod({
        message:
          "Typed-data signing is unavailable for QIP-55 until a versioned 64-byte address layout is defined.",
      }),
    };
  }
  if (!request?.authorizedChainId || !request.requestData?.senderData) {
    return {
      canProceed: false,
      proceedError: providerErrors.unauthorized({
        message:
          "The approval request is missing its authorized chain context.",
      }),
    };
  }

  // enforceWhileLocked: the precheck answers every origin with one shared
  // refusal while the wallet is locked, so a page cannot probe its grants
  // (L6/L-1). This runs after the user unlocked and decides whether a
  // signature happens, so it skips that gate and answers strictly on the
  // stored grants whatever the lock state reads.
  const authorization = await checkAccountAndChainHaveBeenAuthorized(
    {
      id: request.requestId,
      jsonrpc: "2.0",
      method: request.method,
      params: request.params,
      senderData: request.requestData.senderData,
    } as JsonRpcRequest<JsonRpcRequest>,
    request.authorizedChainId,
    true,
  );
  if (!authorization.canProceed) return authorization;
  try {
    const chain = await StorageUtil.getActiveBlockChain();
    if (chain.chainId.toLowerCase() !== V3_CHAIN_ID) {
      throw new Error("Select the v3 Private network.");
    }
    await assertV3Network(chain.defaultRpcUrl);
    const currentChain = await StorageUtil.getActiveBlockChain();
    if (
      currentChain.chainId !== chain.chainId ||
      currentChain.defaultRpcUrl !== chain.defaultRpcUrl
    ) {
      throw new Error("The network changed. Review the request again.");
    }
  } catch (error) {
    return {
      canProceed: false,
      proceedError: providerErrors.disconnected({
        message: error instanceof Error ? error.message : String(error),
      }),
    };
  }
  return checkAccountAndChainHaveBeenAuthorized(
    {
      id: request.requestId,
      jsonrpc: "2.0",
      method: request.method,
      params: request.params,
      senderData: request.requestData.senderData,
    } as JsonRpcRequest<JsonRpcRequest>,
    request.authorizedChainId,
    true,
  );
};

/** IPv4 addresses that resolve inside the user's own machine or network. */
const isPrivateIpv4Address = (address: string): boolean => {
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (!ipv4) return false;
  const [first, second] = ipv4.slice(1).map(Number);
  if (first === 127 || first === 0 || first === 10) return true;
  if (first === 169 && second === 254) return true;
  if (first === 192 && second === 168) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  // Carrier-grade NAT (100.64.0.0/10, RFC 6598): shared address space on
  // the provider side of the user's router, reachable from the machine the
  // wallet runs on and never a public RPC endpoint.
  if (first === 100 && second >= 64 && second <= 127) return true;
  return false;
};

/**
 * The IPv4 address embedded in an IPv4-mapped IPv6 literal, in dotted form.
 * The URL parser rewrites `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]`, so the
 * hex-group spelling has to be recognised alongside the dotted one. The
 * leading run of zero hextets covers the fully written
 * `0:0:0:0:0:ffff:127.0.0.1`, and the optional zero hextet after `ffff:`
 * covers the IPv4-translated `::ffff:0:0/96` form.
 */
const getIpv4MappedAddress = (host: string): string | undefined => {
  const mapped = /^(?:0{1,4}:){0,5}:{0,2}ffff:(?:0{1,4}:)?(.+)$/.exec(host);
  if (!mapped) return undefined;
  const tail = mapped[1];
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(tail)) return tail;
  const hexPair = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail);
  if (!hexPair) return undefined;
  const high = parseInt(hexPair[1], 16);
  const low = parseInt(hexPair[2], 16);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
};

/**
 * Hosts that resolve inside the user's own machine or LAN. A dApp-supplied
 * RPC URL pointing at one of these turns the wallet into a proxy the page
 * can aim at services it cannot reach itself, so only a chain the user adds
 * in the wallet's own form may use them.
 */
const isPrivateOrLoopbackHost = (hostname: string): boolean => {
  // A trailing dot makes the name absolute, so `localhost.` and
  // `printer.local.` resolve exactly like their dotless spellings while
  // slipping past every equality and suffix test below (L5).
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host === "::1" || host === "::" || host === "0.0.0.0") return true;
  // IPv6 unique-local (fc00::/7, so a first hextet of fc00 through fdff)
  // and link-local (fe80::/10, so fe80 through febf).
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
  // The NAT64 well-known prefix (64:ff9b::/96 and 64:ff9b:1::/48, RFC 6052
  // and RFC 8215) carries an embedded IPv4 destination, so a host inside it
  // reaches whatever that IPv4 address reaches.
  if (/^64:ff9b:/.test(host)) return true;
  // An IPv4-mapped literal reaches the embedded IPv4 address, so it has to
  // answer to the IPv4 rules.
  const mappedIpv4 = getIpv4MappedAddress(host);
  if (mappedIpv4 !== undefined) return isPrivateIpv4Address(mappedIpv4);
  return isPrivateIpv4Address(host);
};

/**
 * @param allowPrivateHosts true only for the wallet's own add-chain form,
 * where the user typed the URL themselves and running a local node is a
 * legitimate thing to want.
 */
const isAcceptableUrl = (urlString: string, allowPrivateHosts = false) => {
  try {
    const url = new URL(urlString);

    if (
      url === null ||
      url.hostname.length === 0 ||
      url.pathname.length === 0 ||
      url.hostname !== decodeURIComponent(url.hostname)
    ) {
      return false;
    }

    if (isPrivateOrLoopbackHost(url.hostname)) {
      return (
        allowPrivateHosts &&
        (url.protocol === "http:" || url.protocol === "https:")
      );
    }

    return url.protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * The URL the wallet will actually talk to for a newly added chain. EIP-3085
 * treats rpcUrls as a preference-ordered list, so this walks it in order and
 * takes the first entry the wallet is willing to use. Taking rpcUrls[0]
 * blindly let a page pass validation on a later, acceptable entry while the
 * wallet adopted an unacceptable first one.
 */
export const pickDefaultRpcUrl = (
  rpcUrls: unknown,
  allowPrivateHosts = false,
): string => {
  if (!Array.isArray(rpcUrls)) return "";
  return (
    rpcUrls.find(
      (rpcUrl): rpcUrl is string =>
        typeof rpcUrl === "string" &&
        isAcceptableUrl(rpcUrl, allowPrivateHosts),
    ) ?? ""
  );
};

export const checkWalletAddQrlChainParams = async (
  chainData: BlockchainDataType,
  hasInternalKeys: boolean = false,
) => {
  if (!chainData || typeof chainData !== "object") {
    return {
      canProceed: false,
      proceedError: rpcErrors.invalidParams({
        message: `Expected an object parameter. Received: ${JSON.stringify(
          chainData,
        )}`,
      }),
    };
  }

  const internalKeys = [
    "defaultRpcUrl",
    "defaultBlockExplorerUrl",
    "defaultIconUrl",
    "isTestnet",
    "defaultWsRpcUrl",
    "isCustomChain",
    "qrnsRegistryAddress",
  ];
  const allowedKeys = [
    "chainName",
    "chainId",
    "nativeCurrency",
    "rpcUrls",
    "blockExplorerUrls",
    "iconUrls",
    ...(hasInternalKeys ? internalKeys : []),
  ];
  const extraKeys = Object.keys(chainData).filter((key) => {
    return !allowedKeys.includes(key);
  });
  if (extraKeys.length) {
    return {
      canProceed: false,
      proceedError: rpcErrors.invalidParams({
        message: `Received unexpected keys on object parameter. Unsupported keys: ${extraKeys}`,
      }),
    };
  }

  const chainId = chainData?.chainId;
  if (
    typeof chainId !== "string" ||
    !/^0x[1-9a-f]+[0-9a-f]*$/iu.test(chainId.toLowerCase())
  ) {
    return {
      canProceed: false,
      proceedError: rpcErrors.invalidParams({
        message: `Expected 0x-prefixed, unpadded, non-zero hexadecimal string 'chainId'. Received: ${chainId}`,
      }),
    };
  }
  const chainIdNumber = parseInt(chainId, 16);
  if (
    !Number.isSafeInteger(chainIdNumber) ||
    chainIdNumber < 0 ||
    chainIdNumber > MAX_SAFE_CHAIN_ID
  ) {
    return {
      canProceed: false,
      proceedError: rpcErrors.invalidParams({
        message: `Invalid chain ID "${chainId}": numerical value should be in the inclusive range of 0 and ${MAX_SAFE_CHAIN_ID}. Received: ${chainId}`,
      }),
    };
  }

  const chainName = chainData?.chainName;
  if (typeof chainName !== "string" || !chainName) {
    return {
      canProceed: false,
      proceedError: rpcErrors.invalidParams({
        message: `Expected non-empty string 'chainName'. Received: ${chainName}`,
      }),
    };
  }

  const rpcUrls = chainData?.rpcUrls;
  // Every entry has to be acceptable, because the wallet keeps the whole
  // list and can fall back to any of them. Accepting the list as soon as one
  // entry passed let a page smuggle a loopback or plain-http endpoint in
  // beside a presentable https one.
  if (
    !rpcUrls ||
    !Array.isArray(rpcUrls) ||
    rpcUrls.length === 0 ||
    !rpcUrls.every((rpcUrl) => isAcceptableUrl(rpcUrl, hasInternalKeys))
  ) {
    return {
      canProceed: false,
      proceedError: rpcErrors.invalidParams({
        message: `Expected an array of HTTPS urls on a public host for 'rpcUrls'. Received: ${rpcUrls}`,
      }),
    };
  }

  const nativeCurrency = chainData?.nativeCurrency;
  if (nativeCurrency !== null) {
    if (typeof nativeCurrency !== "object" || Array.isArray(nativeCurrency)) {
      return {
        canProceed: false,
        proceedError: rpcErrors.invalidParams({
          message: `Expected null or object 'nativeCurrency'. Received: ${nativeCurrency}`,
        }),
      };
    }
    if (nativeCurrency.decimals !== 18) {
      return {
        canProceed: false,
        proceedError: rpcErrors.invalidParams({
          message: `Expected the number 18 for 'nativeCurrency.decimals' when 'nativeCurrency' is provided. Received: ${nativeCurrency.decimals}`,
        }),
      };
    }
    if (!nativeCurrency.symbol || typeof nativeCurrency.symbol !== "string") {
      return {
        canProceed: false,
        proceedError: rpcErrors.invalidParams({
          message: `Expected a string 'nativeCurrency.symbol'. Received: ${nativeCurrency.symbol}`,
        }),
      };
    }
  }
  const ticker = nativeCurrency?.symbol;
  if (
    ticker &&
    (typeof ticker !== "string" || ticker.length < 1 || ticker.length > 6)
  ) {
    return {
      canProceed: false,
      proceedError: rpcErrors.invalidParams({
        message: `Expected 1-6 character string 'nativeCurrency.symbol'. Received: ${ticker}`,
      }),
    };
  }

  const qrnsRegistryAddress = chainData.qrnsRegistryAddress as unknown;
  if (
    hasInternalKeys &&
    qrnsRegistryAddress !== undefined &&
    qrnsRegistryAddress !== null &&
    qrnsRegistryAddress !== "" &&
    !isCanonicalQrlAddress(qrnsRegistryAddress)
  ) {
    return {
      canProceed: false,
      proceedError: rpcErrors.invalidParams({
        message:
          "Expected 'qrnsRegistryAddress' to be empty or an uppercase-Q QIP-55 address with 128 hexadecimal characters and a valid checksum.",
      }),
    };
  }

  const blockchains = await StorageUtil.getAllBlockChains();
  const existingChain = blockchains.find((chain) => chain.chainId === chainId);
  if (existingChain && existingChain?.nativeCurrency?.symbol !== ticker) {
    return {
      canProceed: false,
      proceedError: rpcErrors.invalidParams({
        message: `nativeCurrency.symbol does not match currency symbol for a network the user already has added with the same chainId. Received: ${ticker}`,
      }),
    };
  }

  return {
    canProceed: true,
    proceedError: undefined,
  };
};

/**
 * The connection gate `wallet_addQRLChain`, `wallet_getCapabilities` and
 * `wallet_switchQRLChain` run before their own parameter checks, and its
 * refusal names the connection state. With `refuseWhileLocked` those three
 * answer a locked wallet with the shared locked refusal (L6/L-1): none of
 * them can do useful work while locked, and a page must learn nothing about
 * its grants from any of them.
 *
 * `qrl_accounts` uses this same gate and must keep its own locked answer,
 * the empty array EIP-1193 clients expect (F8, unrestrictedMethodExecutor),
 * so the flag is off by default and that caller is left alone.
 *
 * @param refuseWhileLocked true for the restricted-method connection gate.
 */
export const checkUrlOriginHasBeenConnected = async (
  url: string,
  refuseWhileLocked = false,
) => {
  if (refuseWhileLocked && (await shouldRefuseWhileLocked(false))) {
    return buildLockedWalletRefusal();
  }
  const urlOrigin = new URL(url).origin;
  const connectedAccounts =
    (await StorageUtil.getDAppsConnectedAccountsData(urlOrigin))?.accounts ??
    [];
  const hasConnectedAccounts = connectedAccounts.length > 0;
  return {
    canProceed: hasConnectedAccounts,
    proceedError: providerErrors.unauthorized({
      message: "The dApp is not connected to MyQRLWallet.",
    }),
  };
};

export const checkWalletSwitchQrlChainParams = async (paramObject: {
  chainId: string;
}) => {
  if (!paramObject || typeof paramObject !== "object") {
    return {
      canProceed: false,
      proceedError: rpcErrors.invalidParams({
        message: `Expected single, object parameter. Received: ${JSON.stringify(
          paramObject,
        )}`,
      }),
    };
  }

  const allowedKeys = ["chainId"];
  const extraKeys = Object.keys(paramObject).filter((key) => {
    return !allowedKeys.includes(key);
  });
  if (extraKeys.length) {
    return {
      canProceed: false,
      proceedError: rpcErrors.invalidParams({
        message: `Received unexpected keys on object parameter. Unsupported keys: ${extraKeys}`,
      }),
    };
  }

  const chainId = paramObject?.chainId;
  if (
    typeof chainId !== "string" ||
    !/^0x[1-9a-f]+[0-9a-f]*$/iu.test(chainId.toLowerCase())
  ) {
    return {
      canProceed: false,
      proceedError: rpcErrors.invalidParams({
        message: `Expected 0x-prefixed, unpadded, non-zero hexadecimal string 'chainId'. Received: ${chainId}`,
      }),
    };
  }
  const chainIdNumber = parseInt(chainId, 16);
  if (
    !Number.isSafeInteger(chainIdNumber) ||
    chainIdNumber < 0 ||
    chainIdNumber > MAX_SAFE_CHAIN_ID
  ) {
    return {
      canProceed: false,
      proceedError: rpcErrors.invalidParams({
        message: `Invalid chain ID "${chainId}": numerical value should be in the inclusive range of 0 and ${MAX_SAFE_CHAIN_ID}. Received: ${chainId}`,
      }),
    };
  }

  const blockchains = await StorageUtil.getAllBlockChains();
  const existingChain = blockchains.find(
    (chain) => chain.chainId.toLowerCase() === chainId.toLowerCase(),
  );
  if (!existingChain) {
    return {
      canProceed: false,
      proceedError: providerErrors.custom({
        code: 4902,
        message: `Unrecognized chain ID "${chainId}". Try adding the chain using ${RESTRICTED_METHODS.WALLET_ADD_QRL_CHAIN} first.`,
      }),
    };
  }

  return {
    canProceed: true,
    proceedError: undefined,
  };
};

export const checkWalletWatchAssetParams = async (paramObject: {
  type: string;
  options: {
    address: string;
    symbol: string;
    decimals: number;
    image: string;
  };
}) => {
  if (!paramObject || typeof paramObject !== "object") {
    return {
      canProceed: false,
      proceedError: rpcErrors.invalidParams({
        message: `Expected single, object parameter. Received: ${JSON.stringify(
          paramObject,
        )}`,
      }),
    };
  }

  if (!paramObject?.type || paramObject?.type?.toLowerCase() !== "zrc20") {
    return {
      canProceed: false,
      proceedError: rpcErrors.invalidParams({
        message: "Asset type should be ZRC20.",
      }),
    };
  }

  if (
    !paramObject?.options?.address ||
    !paramObject?.options?.decimals ||
    !paramObject?.options?.symbol
  ) {
    return {
      canProceed: false,
      proceedError: rpcErrors.invalidParams({
        message: "Must specify address, symbol, and decimals.",
      }),
    };
  }

  if (typeof paramObject?.options?.symbol !== "string") {
    return {
      canProceed: false,
      proceedError: rpcErrors.invalidParams({
        message: "Invalid symbol: not a string.",
      }),
    };
  }

  if (paramObject?.options?.symbol?.length > 11) {
    return {
      canProceed: false,
      proceedError: rpcErrors.invalidParams({
        message: "Invalid symbol '${symbol}': longer than 11 characters.",
      }),
    };
  }

  if (
    paramObject?.options?.decimals < 0 ||
    paramObject?.options?.decimals > 36
  ) {
    return {
      canProceed: false,
      proceedError: rpcErrors.invalidParams({
        message: "Invalid decimals '${decimals}': must be 0 <= 36.",
      }),
    };
  }

  return {
    canProceed: true,
    proceedError: undefined,
  };
};

export const checkWalletRequestPermissionParams = async (paramObject: {
  [k: string]: unknown;
}) => {
  const isAnObject =
    Boolean(paramObject) &&
    typeof paramObject === "object" &&
    !Array.isArray(paramObject);
  if (!isAnObject) {
    return {
      canProceed: false,
      proceedError: rpcErrors.invalidParams(),
    };
  }
  const allowedCapabilities: string[] = Object.values(PARENT_CAPABILITIES);
  const requestedCapability = Object.keys(paramObject)?.[0] ?? "";
  if (!allowedCapabilities.includes(requestedCapability)) {
    return {
      canProceed: false,
      proceedError: rpcErrors.methodNotFound({
        message: `The method "${requestedCapability}" does not exist / is not available.`,
      }),
    };
  }

  return {
    canProceed: true,
    proceedError: undefined,
  };
};

export const updateAccountsAndBlockchainsForUrlOrigin = async ({
  urlOrigin,
  accounts,
  blockchains,
}: {
  urlOrigin: string;
  accounts: string[];
  blockchains: BlockchainDataType[];
}) => {
  const origin = new URL(urlOrigin ?? "").origin;
  // Do not silently force-switch the globally-active chain when granting
  // permissions. The user approved the connect, not a chain change. If the
  // dApp needs a different chain, it can call wallet_switchQRLChain, which
  // will surface to the user via the popup (F-3).
  const blockchainIds = blockchains.map((blockchain) => blockchain.chainId);
  const permissions: Permission[] = [
    {
      invoker: origin,
      parentCapability: PARENT_CAPABILITIES.QRL_ACCOUNTS,
      caveats: [
        {
          type: CAVEAT_TYPES.RESTRICT_RETURNED_ACCOUNTS,
          value: [...accounts],
        },
      ],
    },
    {
      invoker: origin,
      parentCapability: PARENT_CAPABILITIES.QRL_CHAINS,
      caveats: [
        {
          type: CAVEAT_TYPES.RESTRICT_NETWORK_SWITCHING,
          value: [...blockchainIds],
        },
      ],
    },
  ];
  await StorageUtil.setDAppsConnectedAccountsData({
    urlOrigin: origin,
    accounts: [...accounts],
    blockchains: [...blockchains],
    permissions,
  });
  return accounts;
};

export const includeChainForUrlOrigin = async ({
  urlOrigin,
  chainId,
}: {
  urlOrigin: string;
  chainId: string;
}) => {
  const origin = new URL(urlOrigin ?? "").origin;
  const dAppConnectedData =
    await StorageUtil.getDAppsConnectedAccountsData(origin);
  const allBlockchains = await StorageUtil.getAllBlockChains();
  const blockchain = allBlockchains.find(
    (chain) => chain?.chainId?.toLowerCase() === chainId?.toLowerCase(),
  );
  const isAdditionRequired = !(dAppConnectedData?.blockchains ?? []).find(
    (chain) =>
      chain.chainId?.toLowerCase() === blockchain?.chainId?.toLowerCase(),
  );
  const updatedBlockchains = [
    ...(dAppConnectedData?.blockchains ?? []),
    ...(isAdditionRequired && blockchain ? [blockchain] : []),
  ];

  await updateAccountsAndBlockchainsForUrlOrigin({
    urlOrigin: origin,
    accounts: dAppConnectedData?.accounts ?? [],
    blockchains: updatedBlockchains,
  });
};

/**
 * A qrl_sendTransaction response that timed out waiting for the broadcast
 * (QrlSendTransactionForContent's TransactionMayStillBeProcessingError)
 * still carries the locally computed hash, under `error.data`, because the
 * transaction may have reached the node regardless of what the dApp was
 * told. Reads that hash back out so the watch below still gets registered
 * for it.
 */
export const extractPendingDAppTransactionHash = (
  response: unknown,
): string | undefined => {
  const errorData = (
    response as { error?: { data?: { transactionHash?: unknown } } }
  )?.error?.data;
  return typeof errorData?.transactionHash === "string"
    ? errorData.transactionHash
    : undefined;
};

/**
 * Builds the `data` payload for the JSON-RPC error a failed
 * qrl_sendTransaction gets. `response.error` is already the sanitized
 * shape (sanitizeError/getSerializableObject, scriptUtils.ts) the approval
 * surface produced, e.g. `{ message, data: { transactionHash, pending } }`
 * for a broadcast timeout. That is kept nested as-is for anything already
 * reading it there, and the transaction hash (if any) is also hoisted to
 * this object's own top level, so the dApp can read it directly as
 * `error.data.transactionHash`.
 */
export const buildDAppSendTransactionErrorData = (
  response: unknown,
): Record<string, unknown> => {
  const errorPayload = (response as { error?: unknown })?.error;
  const pendingTransactionHash = extractPendingDAppTransactionHash(response);
  return {
    ...(errorPayload && typeof errorPayload === "object"
      ? (errorPayload as Record<string, unknown>)
      : {}),
    ...(pendingTransactionHash && {
      transactionHash: pendingTransactionHash,
    }),
  };
};

/**
 * Called by restrictedMethodsMiddleware once it has an approved
 * qrl_sendTransaction response, whether that response carries a result
 * hash or (see extractPendingDAppTransactionHash) a still-pending one under
 * an error. The approval surface answers the dApp as soon as the
 * transaction broadcasts (see QrlSendTransactionForContent's own comment),
 * and its history poller lives in the document that response closes.
 * Registering the hash here hands confirmation and notification to the
 * service worker's own watcher, so both still happen whether or not that
 * surface is still open.
 *
 * A no-op for any response without a usable hash or sender, and safe to
 * await unconditionally: every failure is caught and logged internally.
 * This runs from restrictedMethodsMiddleware's `finally`, where an
 * uncaught throw here would stop `end()` from ever running and void an
 * otherwise-successful response.
 */
export const registerDAppTransactionWatchIfApproved = async (
  req: JsonRpcRequest<JsonRpcRequest>,
  transactionHash: unknown,
  authorizedChainId?: string,
): Promise<void> => {
  try {
    if (typeof transactionHash !== "string" || !transactionHash) return;
    const from = getFromAddress(req);
    if (typeof from !== "string" || !from) return;
    await registerDAppTransactionWatch({
      hash: transactionHash,
      account: from,
      chainId: authorizedChainId ?? V3_CHAIN_ID,
    });
  } catch (error) {
    console.error(
      "QrlWeb3Wallet: Failed to register a dApp transaction watch:",
      error,
    );
  }
};

export const excludeChainForUrlOrigin = async ({
  urlOrigin,
  chainId,
}: {
  urlOrigin: string;
  chainId: string;
}) => {
  const origin = new URL(urlOrigin ?? "").origin;
  const dAppConnectedData =
    await StorageUtil.getDAppsConnectedAccountsData(origin);
  const updatedBlockchains =
    dAppConnectedData?.blockchains?.filter(
      (chain) => chain?.chainId?.toLowerCase() !== chainId.toLowerCase(),
    ) ?? [];

  await updateAccountsAndBlockchainsForUrlOrigin({
    urlOrigin: origin,
    accounts: dAppConnectedData?.accounts ?? [],
    blockchains: updatedBlockchains,
  });
};
