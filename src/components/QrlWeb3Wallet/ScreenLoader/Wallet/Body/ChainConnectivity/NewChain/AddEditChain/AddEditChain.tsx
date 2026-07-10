import { BlockchainDataType } from "@/configuration/qrlBlockchainConfig";
import { ROUTES } from "@/router/router";
import StorageUtil from "@/utilities/storageUtil";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import BackButton from "../../../../../Shared/BackButton/BackButton";
import CircuitBackground from "../../../../../Shared/CircuitBackground/CircuitBackground";
import AddEditChainForm from "./AddEditChainForm/AddEditChainForm";

const AddEditChain = observer(() => {
  const navigate = useNavigate();
  const { state } = useLocation();
  const hasState = !!state?.hasState;
  const chainIdToEdit: string = state?.chainId;

  const [chainToEdit, setChainToEdit] = useState<
    BlockchainDataType | undefined
  >();

  useEffect(() => {
    if (chainIdToEdit) {
      (async () => {
        const blockchains = await StorageUtil.getAllBlockChains();
        setChainToEdit(
          blockchains.find((chain) => chain.chainId === chainIdToEdit),
        );
      })();
    }
  }, [chainIdToEdit]);

  useEffect(() => {
    if (!hasState) {
      navigate(ROUTES.CHAIN_CONNECTIVITY);
    }
  }, [hasState]);

  return (
    <>
      <CircuitBackground />
      <div className="page-enter relative z-10 p-8">
        <BackButton />
        <AddEditChainForm chainToEdit={chainToEdit} />
      </div>
    </>
  );
});

export default AddEditChain;
