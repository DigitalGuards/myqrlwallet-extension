import { Button } from "@/components/UI/Button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/UI/Card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/UI/Form";
import { Input } from "@/components/UI/Input";
import type { DiscoveredToken } from "@/services/assetDiscovery";
import { useStore } from "@/stores/store";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader, RefreshCw } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import BackButton from "../../../Shared/BackButton/BackButton";
import DiscoveredTokens from "./DiscoveredTokens/DiscoveredTokens";
import TokenImportSuccess from "./TokenImportSuccess/TokenImportSuccess";
import CircuitBackground from "../../../Shared/CircuitBackground/CircuitBackground";

const FormSchema = z.object({
  contractAddress: z.string().min(1, "Contract address is required"),
});

const ImportToken = observer(() => {
  const { t } = useTranslation();
  const { qrlStore } = useStore();
  const { getZrc20TokenDetails } = qrlStore;

  const [token, setToken] =
    useState<Awaited<ReturnType<typeof getZrc20TokenDetails>>["token"]>();
  // The address under review. Fed by the manual form or a discovered-token
  // pick; both land on the same review screen before anything is stored.
  const [reviewAddress, setReviewAddress] = useState("");
  // Chain-read failure for a discovered token. Kept outside react-hook-form
  // on purpose: setError flips isValid false and would leave the fetch
  // button disabled until the user edits the (already correct) address.
  const [discoveredError, setDiscoveredError] = useState("");

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    mode: "onChange",
    reValidateMode: "onSubmit",
    defaultValues: {
      contractAddress: "",
    },
  });
  const {
    handleSubmit,
    control,
    setValue,
    formState: { isSubmitting, isValid },
    reset,
  } = form;

  async function onSubmit(formData: z.infer<typeof FormSchema>) {
    setDiscoveredError("");
    const tokenDetails = await getZrc20TokenDetails(formData.contractAddress);
    if (tokenDetails.error) {
      control.setError("contractAddress", { message: tokenDetails.error });
    } else {
      setToken(tokenDetails.token);
      setReviewAddress(formData.contractAddress);
    }
  }

  const onReviewDiscovered = async (discovered: DiscoveredToken) => {
    const tokenDetails = await getZrc20TokenDetails(discovered.address);
    if (tokenDetails.error) {
      // Surface the chain-read failure on the manual field, prefilled with
      // the address, so the user can see what failed and retry from there.
      setValue("contractAddress", discovered.address, {
        shouldDirty: true,
        shouldValidate: true,
      });
      setDiscoveredError(tokenDetails.error);
      return;
    }
    setToken(tokenDetails.token);
    setReviewAddress(discovered.address);
  };

  const onCancelImport = () => {
    reset({ contractAddress: "" });
    setDiscoveredError("");
    setToken(undefined);
    setReviewAddress("");
  };

  return (
    <>
      <CircuitBackground />
      <div className="page-enter relative z-10 p-8">
        {reviewAddress && (
          <TokenImportSuccess
            token={token}
            onCancelImport={onCancelImport}
            contractAddress={reviewAddress}
          />
        )}
        {/* Hidden, not unmounted, while reviewing: the discovered picker
            would otherwise refetch the explorer on every Cancel. */}
        <div hidden={!!reviewAddress}>
          <Form {...form}>
            <BackButton />
            <DiscoveredTokens onReview={onReviewDiscovered} />
            <form
              name="importAccount"
              aria-label="importAccount"
              className="w-full"
              onSubmit={handleSubmit(onSubmit)}
            >
              <Card>
                <CardHeader>
                  <CardTitle>{t("importToken.title")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-8">
                  <FormField
                    control={control}
                    name="contractAddress"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Input
                            {...field}
                            aria-label={field.name}
                            autoComplete="off"
                            disabled={isSubmitting}
                            placeholder={t(
                              "importToken.contractAddressPlaceholder",
                            )}
                          />
                        </FormControl>
                        <FormDescription>
                          {t("importToken.contractAddressDescription")}
                        </FormDescription>
                        <FormMessage />
                        {discoveredError && (
                          <p
                            className="text-sm font-medium text-destructive"
                            role="alert"
                          >
                            {discoveredError}
                          </p>
                        )}
                      </FormItem>
                    )}
                  />
                </CardContent>
                <CardFooter>
                  <Button
                    disabled={isSubmitting || !isValid}
                    className="w-full"
                    type="submit"
                  >
                    {isSubmitting ? (
                      <Loader className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    {isSubmitting
                      ? t("importToken.importingButton")
                      : t("importToken.importButton")}
                  </Button>
                </CardFooter>
              </Card>
            </form>
          </Form>
        </div>
      </div>
    </>
  );
});

export default ImportToken;
