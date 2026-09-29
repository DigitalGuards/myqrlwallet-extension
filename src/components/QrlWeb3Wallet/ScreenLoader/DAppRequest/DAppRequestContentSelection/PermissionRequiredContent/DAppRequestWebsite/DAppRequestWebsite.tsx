import { Card } from "@/components/UI/Card";
import { Separator } from "@/components/UI/Separator";
import { useStore } from "@/stores/store";
import { registrableDomain } from "@/utilities/registrableDomain";
import { observer } from "mobx-react-lite";
import DAppRequestFeature from "./DAppRequestFeature/DAppRequestFeature";

/**
 * Renders the identity of the page asking for approval.
 *
 * The popup is 368px wide and sits inside a scroll region that is
 * overflow-x-hidden, so a long origin used to be clipped silently: an attacker
 * origin such as https://qrlwallet.com.attacker.example showed only its
 * trustworthy-looking head while the label that owns the page ran off-screen.
 * The registrable domain is therefore shown first and on its own line, with
 * the complete origin under it in a line that wraps and is never clipped.
 * registrableDomain() is a display heuristic; the full origin below it stays
 * the authoritative thing to read, and no decision here depends on the
 * shortened form.
 */
const DAppRequestWebsite = observer(() => {
  const { dAppRequestStore } = useStore();
  const { dAppRequestData } = dAppRequestStore;

  const senderData = dAppRequestData?.requestData?.senderData as
    | {
        url?: string;
        favIconUrl?: string;
        title?: string;
        mainFrameOrigin?: string;
      }
    | undefined;

  const senderUrl = senderData?.url ?? "";
  let urlOrigin = senderUrl;
  let urlHostname = senderUrl;
  try {
    const parsedUrl = new URL(senderUrl);
    urlOrigin = parsedUrl.origin;
    urlHostname = parsedUrl.hostname;
  } catch {
    // Keep the raw value on screen so the user still sees what asked.
  }

  let parentOrigin: string | undefined;
  let parentHostname: string | undefined;
  try {
    if (senderData?.mainFrameOrigin) {
      const parsedParent = new URL(senderData.mainFrameOrigin);
      parentOrigin = parsedParent.origin;
      parentHostname = parsedParent.hostname;
    }
  } catch {
    parentOrigin = undefined;
    parentHostname = undefined;
  }
  const isCrossOriginIframe =
    parentOrigin !== undefined && parentOrigin !== urlOrigin;

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-4">
        {senderData?.favIconUrl && (
          <img
            className="h-6 w-6 shrink-0 opacity-70"
            src={senderData.favIconUrl}
            alt=""
            title="page-supplied icon"
          />
        )}
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="break-all font-bold leading-tight">
            {registrableDomain(urlHostname)}
          </span>
          <span
            className="break-all font-mono text-[10px] leading-snug opacity-60"
            title="full origin of the requesting page"
          >
            {urlOrigin}
          </span>
          {senderData?.title && (
            <span
              className="text-xm break-words opacity-60"
              title="page-supplied title, do not trust it as the origin"
            >
              {senderData.title}{" "}
              <span className="text-[10px] uppercase tracking-wide">
                (page-supplied)
              </span>
            </span>
          )}
        </div>
      </div>
      {isCrossOriginIframe && (
        <div className="rounded-md border border-amber-500/60 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-200">
          <strong>Embedded request:</strong> this dApp is loaded inside an
          iframe on{" "}
          <span className="font-bold">
            {registrableDomain(parentHostname ?? parentOrigin ?? "")}
          </span>
          . Verify you trust the page hosting the iframe before approving.
          <span className="mt-1 block break-all font-mono text-[10px] opacity-80">
            {parentOrigin}
          </span>
        </div>
      )}
      <Separator />
      <DAppRequestFeature />
    </Card>
  );
});

export default DAppRequestWebsite;
