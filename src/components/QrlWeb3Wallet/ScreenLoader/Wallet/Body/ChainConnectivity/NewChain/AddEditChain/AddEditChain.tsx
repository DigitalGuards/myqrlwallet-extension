import { BlockchainDataType } from "@/configuration/qrlBlockchainConfig";
import { ROUTES } from "@/router/router";
import StorageUtil from "@/utilities/storageUtil";
import { isRecord } from "@/utilities/storageGuards";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import BackButton from "../../../../../Shared/BackButton/BackButton";
import CircuitBackground from "../../../../../Shared/CircuitBackground/CircuitBackground";
import AddEditChainForm from "./AddEditChainForm/AddEditChainForm";

type ChainRouteState = { hasState: true; chainId?: string };

const isChainRouteState = (value: unknown): value is ChainRouteState =>
  isRecord(value) &&
  value.hasState === true &&
  (value.chainId === undefined || typeof value.chainId === "string");

const AddEditChain = observer(() => {
  const navigate = useNavigate();
  const state: unknown = useLocation().state;
  const hasState = isChainRouteState(state);
  const chainIdToEdit = hasState ? state.chainId : undefined;

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
      })().catch((error: unknown) => {
        console.error("Failed to load the chain to edit:", error);
      });
    }
  }, [chainIdToEdit]);

  useEffect(() => {
    if (!hasState) {
      Promise.resolve(navigate(ROUTES.CHAIN_CONNECTIVITY)).catch(
        (error: unknown) => {
          console.error("Failed to return to chain connectivity:", error);
        },
      );
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
