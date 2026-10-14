import StorageUtil from "@/utilities/storageUtil";
import { action, makeAutoObservable, observable, runInAction } from "mobx";

class HiddenAccountsStore {
  hiddenAccounts: Record<string, boolean> = {};

  constructor() {
    makeAutoObservable(this, {
      hiddenAccounts: observable,
      loadHiddenAccounts: action.bound,
      hideAccount: action.bound,
      unhideAccount: action.bound,
    });
  }

  async loadHiddenAccounts() {
    const hidden = await StorageUtil.getHiddenAccounts();
    runInAction(() => {
      this.hiddenAccounts = hidden;
    });
  }

  async hideAccount(address: string) {
    const updated = { ...this.hiddenAccounts, [address]: true };
    await StorageUtil.setHiddenAccounts(updated);
    runInAction(() => {
      this.hiddenAccounts = updated;
    });
  }

  async unhideAccount(address: string) {
    const updated = { ...this.hiddenAccounts };
    Reflect.deleteProperty(updated, address);
    await StorageUtil.setHiddenAccounts(updated);
    runInAction(() => {
      this.hiddenAccounts = updated;
    });
  }

  isHidden(address: string): boolean {
    return this.hiddenAccounts[address] ?? false;
  }

  get hiddenAddresses(): string[] {
    return Object.keys(this.hiddenAccounts).filter(
      (addr) => this.hiddenAccounts[addr],
    );
  }
}

export default HiddenAccountsStore;
