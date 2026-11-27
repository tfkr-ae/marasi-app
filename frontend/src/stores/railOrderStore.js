// App-wide rail order store backed by the Go app config bindings
// (marasi_appconfig.yaml `rail_order`). The pure logic lives in
// createRailOrderStore.js and lib/railOrder.js so tests load without bindings.
import {
  GetRailOrder,
  ResetRailOrder,
  SaveRailOrder,
} from "../lib/bindings/github.com/tfkr-ae/marasi-app/app.js";
import { createRailOrderStore } from "./createRailOrderStore.js";

export const railOrderStore = createRailOrderStore({
  get: () => GetRailOrder(),
  save: (order) => SaveRailOrder(order),
  reset: () => ResetRailOrder(),
});

export const railOrder = railOrderStore.railOrder;
export const railPages = railOrderStore.railPages;
export const railOrderIsDefault = railOrderStore.isDefault;
export const readRailOrder = railOrderStore.read;
export const saveRailOrder = railOrderStore.save;
export const resetRailOrder = railOrderStore.reset;
