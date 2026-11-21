// The only code that touches CyberChef's internal `window.app` (v11.6.0).
// GCHQ can change it in any release; the pin and the tool contract checks
// (issue 05, scripts/check-tools.sh) turn such a change into a failed bump.
// Everything else drives CyberChef through this adapter.

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, timeoutMs, message) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await wait(50);
  }
  throw new Error(message);
}

const asText = (value) => (typeof value === "string" ? value : value ? new TextDecoder().decode(value) : "");

/** An adapter over the CyberChef running in `win` (its frame's window). */
export function chefAdapter(win) {
  const app = () => win.app;
  const inputs = () => win.app.manager.input;
  const activeTab = () => win.app.manager.tabs.getActiveTab("input");

  async function inputNums() {
    const result = await inputs().getInputNums();
    const nums = Array.isArray(result) ? result : (result?.inputNums ?? []);
    return nums.map(Number).sort((a, b) => a - b);
  }

  /** Adds an input tab, switches to it, and fills it with `text`. */
  async function addInputTab(text) {
    const before = await inputNums();
    inputs().addInput(true);
    await until(
      async () => {
        const nums = await inputNums();
        return nums.length > before.length && activeTab() === nums.at(-1);
      },
      5000,
      "CyberChef did not add an input tab",
    );
    app().setInput(text);
  }

  async function activeInput() {
    return asText(await inputs().getInputValue(activeTab() > 0 ? activeTab() : 1));
  }

  // Back to one empty input tab and no output, as CyberChef's Clear all does.
  async function clearInputs() {
    inputs().clearAllIoClick();
    await until(
      async () => {
        const nums = await inputNums();
        return nums.length === 1 && activeTab() === nums[0] && (await activeInput()) === "";
      },
      5000,
      "CyberChef did not clear its inputs",
    );
  }

  return {
    /** Resolves once CyberChef has loaded and its input worker runs. */
    async ready(timeoutMs = 30000) {
      await until(
        () => Boolean(win.app?.manager?.input?.inputWorker && win.document.querySelector("#input-tabs")),
        timeoutMs,
        "CyberChef did not load",
      );
      await until(async () => (await inputNums()).length > 0, timeoutMs, "CyberChef has no input");
    },

    /** "dark" or "classic". */
    setTheme(name) {
      app().manager.options.changeTheme(name);
    },

    /** The recipe's operations, as CyberChef's recipe config. */
    getRecipe() {
      return app().getRecipeConfig();
    },

    setRecipe(operations) {
      app().setRecipeConfig(operations ?? []);
    },

    /** Every input tab's text, in tab order. */
    async getInputs() {
      const out = [];
      for (const num of await inputNums()) out.push(asText(await inputs().getInputValue(num)));
      return out;
    },

    /** The open tab's output as text, or "" before a bake. */
    async getOutput() {
      const output = app().manager.output;
      const dish = output.getOutputDish(activeTab());
      return dish ? await output.getDishStr(dish) : "";
    },

    /**
     * Bakes as CyberChef's Bake button does (and cancels a running bake).
     * app.bake() would resume from a breakpoint's position instead.
     */
    bake() {
      app().manager.controls.bakeClick();
    },

    /** Shows a recipe: its operations, then each input in its own tab. */
    async load(recipe) {
      await clearInputs();
      app().setRecipeConfig(recipe.operations ?? []);
      const [first = "", ...rest] = recipe.inputs ?? [];
      app().setInput(first);
      for (const text of rest) await addInputTab(text);
    },

    /** Fills the open input tab when it is empty, else adds a tab for `text`. */
    async insertInput(text) {
      if ((await activeInput()) === "") app().setInput(text);
      else await addInputTab(text);
    },

    addInputTab,
  };
}
