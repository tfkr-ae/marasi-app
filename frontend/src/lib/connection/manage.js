// Adding, editing and removing saved connections (Go's connections.go),
// then reloading the connection store's list.
import {
  AddConnection,
  RemoveConnection,
  SetConnectionAddress,
} from "../bindings/github.com/tfkr-ae/marasi-app/app.js";
import { connectionStore } from "../../stores/connectionStore.js";

/** Saves a remote, `{name, url, password, noPassword}`; resolves to it. */
export async function addConnection(input) {
  const saved = await AddConnection(input);
  await connectionStore.load();
  return saved;
}

/** Changes a remote's address; the active one is reached again there. */
export async function setAddress(id, url) {
  await SetConnectionAddress(id, url);
  await connectionStore.load();
}

/** Forgets a remote that isn't active, with its password and recents. */
export async function removeConnection(id) {
  await RemoveConnection(id);
  await connectionStore.load();
}

/** A Go error's text, for the inline error line. */
export const errorText = (err) => String(err?.message ?? err);
