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
import { useStore } from "@/stores/store";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader, RefreshCw } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import BackButton from "../../../Shared/BackButton/BackButton";
import CircuitBackground from "../../../Shared/CircuitBackground/CircuitBackground";
import DiscoveredNFTCollections from "./DiscoveredNFTCollections/DiscoveredNFTCollections";
import NFTCollectionImportSuccess from "./NFTCollectionImportSuccess/NFTCollectionImportSuccess";

const FormSchema = z.object({
  contractAddress: z.string().min(1, "Contract address is required"),
});

const ImportNFTCollection = observer(() => {
  const { t } = useTranslation();
  const { qrlStore } = useStore();
  const { getNftCollectionDetails } = qrlStore;

  const [collection, setCollection] =
    useState<
      Awaited<ReturnType<typeof getNftCollectionDetails>>["collection"]
    >();
  const [hasImported, setHasImported] = useState(false);

  async function onSubmit(formData: z.infer<typeof FormSchema>) {
    const details = await getNftCollectionDetails(formData.contractAddress);
    if (details.error) {
      control.setError("contractAddress", { message: details.error });
    } else {
      setCollection(details.collection);
      setHasImported(true);
    }
  }

  const onCancelImport = () => {
    reset({ contractAddress: "" });
    setHasImported(false);
  };

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
    watch,
    formState: { isSubmitting, isValid },
    reset,
  } = form;

  return (
    <>
      <CircuitBackground />
      <div className="page-enter relative z-10 p-8">
        {hasImported ? (
          <NFTCollectionImportSuccess
            collection={collection}
            onCancelImport={onCancelImport}
            contractAddress={watch().contractAddress}
          />
        ) : (
          <Form {...form}>
            <BackButton />
            <DiscoveredNFTCollections />
            <form
              name="importNFTCollection"
              aria-label="importNFTCollection"
              className="w-full"
              onSubmit={handleSubmit(onSubmit)}
            >
              <Card>
                <CardHeader>
                  <CardTitle>{t('nft.importCollection')}</CardTitle>
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
                            placeholder={t('nft.contractPlaceholder')}
                          />
                        </FormControl>
                        <FormDescription>
                          {t('nft.contractDescription')}
                        </FormDescription>
                        <FormMessage />
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
                      ? t('nft.detecting')
                      : t('nft.detectButton')}
                  </Button>
                </CardFooter>
              </Card>
            </form>
          </Form>
        )}
      </div>
    </>
  );
});

export default ImportNFTCollection;
