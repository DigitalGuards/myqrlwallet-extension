import { Button } from "@/components/UI/Button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/UI/Dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/UI/Form";
import { Input } from "@/components/UI/Input";
import { Label } from "@/components/UI/Label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/UI/Tooltip";
import { zodResolver } from "@hookform/resolvers/zod";
import type { TFunction } from "i18next";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

type AddUrlItemProps = {
  addUrl: (url: string) => void;
};

const createFormSchema = (t: TFunction) =>
  z.object({
    url: z
      .string()
      .min(1, t("validation.urlRequired"))
      .url(t("validation.urlInvalid")),
  });

const AddUrlItem = ({ addUrl }: AddUrlItemProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const FormSchema = createFormSchema(t);

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    mode: "onChange",
    reValidateMode: "onSubmit",
    defaultValues: {
      url: "",
    },
  });

  const {
    handleSubmit,
    control,
    formState: { isSubmitting, isValid },
  } = form;

  async function onSubmit(formData: z.infer<typeof FormSchema>) {
    addUrl(formData.url);
    setOpen(false);
    form.reset();
  }

  return (
    <div className="flex justify-between gap-2">
      <div>{t("chain.addUrlDescription")}</div>
      <Form {...form}>
        <form name="addUrlItemForm" aria-label="addUrlItemForm">
          <Dialog open={open} onOpenChange={setOpen}>
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <DialogTrigger asChild>
                  <Button
                    className="size-7 shrink-0 hover:bg-accent hover:text-secondary"
                    variant="outline"
                    size="icon"
                    type="button"
                    aria-label={t("chain.addUrl")}
                    onClick={() => {
                      setOpen(true);
                    }}
                  >
                    <Plus size="16" />
                  </Button>
                </DialogTrigger>
              </TooltipTrigger>
              <TooltipContent side="left">
                <Label>{t("chain.addUrl")}</Label>
              </TooltipContent>
            </Tooltip>
            <DialogContent className="w-80 rounded-md">
              <DialogHeader className="text-left">
                <DialogTitle>{t("chain.addUrl")}</DialogTitle>
              </DialogHeader>
              <FormField
                control={control}
                name="url"
                render={({ field }) => (
                  <FormItem>
                    <Label></Label>
                    <FormControl>
                      <Input
                        {...field}
                        aria-label={field.name}
                        autoComplete="off"
                        disabled={isSubmitting}
                        placeholder="https://url_address"
                        type="text"
                      />
                    </FormControl>
                    <FormDescription>{t("chain.enterUrl")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter className="flex flex-row gap-4">
                <DialogClose asChild>
                  <Button
                    className="w-full"
                    type="button"
                    variant="outline"
                    aria-label={t("common.cancel")}
                  >
                    <X className="mr-2 h-4 w-4" />
                    {t("common.cancel")}
                  </Button>
                </DialogClose>
                <Button
                  className="w-full"
                  type="button"
                  disabled={isSubmitting || !isValid}
                  aria-label={t("common.add")}
                  onClick={handleSubmit(onSubmit)}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {t("common.add")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </form>
      </Form>
    </div>
  );
};

export default AddUrlItem;
