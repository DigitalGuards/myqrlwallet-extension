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
  FormLabel,
  FormMessage,
} from "@/components/UI/Form";
import { Input } from "@/components/UI/Input";
import { useStore } from "@/stores/store";
import { zodResolver } from "@hookform/resolvers/zod";
import type { TFunction } from "i18next";
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

const createFormSchema = (t: TFunction) =>
  z.object({
    contractAddress: z.string().min(1, t("validation.contractAddressRequired")),
  });

const ImportToken = observer(() => {
  const { t } = useTranslation();
  const { qrlStore } = useStore();
  const [token, setToken] =
    useState<
      Awaited<ReturnType<typeof qrlStore.getZrc20TokenDetails>>["token"]
    >();
  // The manually entered address under review. Discovered tokens are
  // picked and added from the list above the form, each one read from the
  // chain first; a manual address shows its chain-read details here before
  // anything is stored.
  const [reviewAddress, setReviewAddress] = useState("");

  const FormSchema = createFormSchema(t);

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
    formState: { isSubmitting, isValid },
    reset,
  } = form;

  async function onSubmit(formData: z.infer<typeof FormSchema>) {
    const tokenDetails = await qrlStore.getZrc20TokenDetails(
      formData.contractAddress,
    );
    if (tokenDetails.error) {
      control.setError("contractAddress", { message: tokenDetails.error });
    } else {
      setToken(tokenDetails.token);
      setReviewAddress(formData.contractAddress);
    }
  }

  const onCancelImport = () => {
    reset({ contractAddress: "" });
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
        {/* Keep the picker mounted while reviewing to reuse its results on Cancel. */}
        <div hidden={!!reviewAddress}>
          <Form {...form}>
            <BackButton />
            {/* One panel, as in the web wallet: the discovered tokens to
                pick from, then the manual contract address import. */}
            <form
              name="importAccount"
              aria-label="importAccount"
              className="w-full"
              onSubmit={(event) => {
                handleSubmit(onSubmit)(event).catch((error: unknown) => {
                  console.error(
                    "[ImportToken] Failed to fetch token details:",
                    error,
                  );
                });
              }}
            >
              <Card>
                <CardHeader>
                  <CardTitle>{t("importToken.title")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <DiscoveredTokens />
                  <FormField
                    control={control}
                    name="contractAddress"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t("importToken.contractAddress")}
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
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
                      </FormItem>
                    )}
                  />
                </CardContent>
                <CardFooter>
                  <Button
                    disabled={isSubmitting || !isValid}
                    className="h-auto min-h-10 w-full whitespace-normal py-2"
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
