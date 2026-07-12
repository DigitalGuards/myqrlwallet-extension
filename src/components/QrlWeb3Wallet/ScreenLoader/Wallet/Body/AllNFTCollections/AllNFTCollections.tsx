import { Card, CardContent, CardHeader, CardTitle } from "@/components/UI/Card";
import { useTranslation } from "react-i18next";
import NFTCollections from "../Home/AccountCreateImport/ActiveAccountDisplay/TokensCardContent/NFTCollections/NFTCollections";
import BackButton from "../../../Shared/BackButton/BackButton";
import CircuitBackground from "../../../Shared/CircuitBackground/CircuitBackground";

const AllNFTCollections = () => {
  const { t } = useTranslation();
  return (
    <>
      <CircuitBackground />
      <div className="page-enter relative z-10 p-8">
        <BackButton />
        <Card>
          <CardHeader>
            <CardTitle>{t("nft.allCollections")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <NFTCollections shouldDisplayAllCollections={true} />
          </CardContent>
        </Card>
      </div>
    </>
  );
};

export default AllNFTCollections;
