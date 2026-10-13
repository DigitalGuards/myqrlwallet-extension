import { Button } from "@/components/UI/Button";
import { Card } from "@/components/UI/Card";
import { Label } from "@/components/UI/Label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/UI/Tooltip";
import { cva } from "class-variance-authority";
import { Star, Trash } from "lucide-react";
import { useTranslation } from "react-i18next";
import AddUrlItem from "./AddUrlItem/AddUrlItem";

const defaultIconClasses = cva("", {
  variants: {
    isDefault: {
      true: ["text-secondary fill-secondary"],
    },
  },
  defaultVariants: {
    isDefault: false,
  },
});

type UrlSelectionsProps = {
  title: string;
  urls: string[];
  setUrls: (urls: string[]) => void;
  defaultUrl: string;
  setDefaultUrl: (url: string) => void;
  canBeEmpty: boolean;
};

const UrlSelections = ({
  title,
  urls,
  setUrls,
  defaultUrl,
  setDefaultUrl,
  canBeEmpty,
}: UrlSelectionsProps) => {
  const { t } = useTranslation();
  const addUrl = (url: string) => {
    const updatedList = urls.filter((urlItem) => urlItem !== url);
    setUrls([...updatedList, url]);
  };

  const deleteUrl = (url: string) => {
    const updatedList = urls.filter((urlItem) => urlItem !== url);
    setUrls(updatedList);
  };

  return (
    <div className="flex flex-col gap-2">
      <Label>{title}</Label>
      <div className="flex flex-col gap-2">
        <AddUrlItem addUrl={addUrl} />
        {urls.map((urlItem) => {
          return (
            <Card key={urlItem} className="flex items-center justify-between gap-2 rounded-md p-2">
              <div className="break-all">{urlItem}</div>
              <div className="flex shrink-0 gap-2">
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      className="size-7 hover:bg-accent hover:text-secondary"
                      variant="outline"
                      size="icon"
                      type="button"
                      aria-label="Default URL"
                      onClick={() => {
                        setDefaultUrl(urlItem);
                      }}
                    >
                      <Star
                        size="16"
                        className={defaultIconClasses({
                          isDefault: urlItem === defaultUrl,
                        })}
                      />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    <Label>{t('chain.defaultUrl')}</Label>
                  </TooltipContent>
                </Tooltip>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      className="size-7 hover:bg-accent hover:text-secondary"
                      variant="outline"
                      disabled={!canBeEmpty && urls.length === 1}
                      size="icon"
                      type="button"
                      aria-label={t('chain.deleteUrl')}
                      onClick={() => {
                        deleteUrl(urlItem);
                      }}
                    >
                      <Trash size="16" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    <Label>{t('chain.deleteUrl')}</Label>
                  </TooltipContent>
                </Tooltip>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default UrlSelections;
