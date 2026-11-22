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

// CyberChef has no bake-complete event. Every bake starts with its
// WorkerWaiter's setBakingStatus(true) and ends with setBakingStatus(false),
// from bakingComplete or cancelBake. bakeInputs also calls cancelBake (so
// false) before it starts, so a bake's end is a false after its true. The
// adapter wraps that method once per CyberChef and tells its listeners
// each status. One end skips it: App.autoBake cancels a one-input bake
// (cancelBakeForAutoBake) and sets app.baking = false itself, so the wait
// also ends when a started bake's app.baking turns false.
const BAKE_ENDS = Symbol("marasi.bakeEnds");

function bakeEnds(worker) {
  if (!worker[BAKE_ENDS]) {
    const listeners = new Set();
    const setBakingStatus = worker.setBakingStatus;
    worker.setBakingStatus = function (baking, ...rest) {
      const result = setBakingStatus.call(this, baking, ...rest);
      for (const listener of [...listeners]) listener(Boolean(baking));
      return result;
    };
    worker[BAKE_ENDS] = listeners;
  }
  return worker[BAKE_ENDS];
}

// How long CyberChef may claim to bake with no work in flight before the
// adapter takes the bake as stuck. Overlapping bakes (an Auto Bake and a
// Bake) can leave its count of loading outputs below zero: it then stays
// "baking" with its Bake button on Cancel, and bakingComplete never runs.
const STUCK_MS = 2000;

const asText = (value) => (typeof value === "string" ? value : value ? new TextDecoder().decode(value) : "");

/** An adapter over the CyberChef running in `win` (its frame's window). */
export function chefAdapter(win) {
  const app = () => win.app;
  const inputs = () => win.app.manager.input;
  const activeTab = () => win.app.manager.tabs.getActiveTab("input");

  const worker = () => win.app.manager.worker;

  // No ChefWorker baking and no input queued or loading: nothing left that
  // could end the bake. A negative loading count is stuck at once.
  function idleWork() {
    const w = worker();
    if (w.loadingOutputs < 0) return "now";
    const busy = w.chefWorkers.some((c) => c.active) || w.inputs.length > 0 || w.inputNums.length > 0 || w.loadingOutputs > 0;
    return busy ? "" : "quiet";
  }

  /**
   * Resolves at the end of the bake `start` begins (or of whichever bake
   * CyberChef runs instead), on CyberChef's own bake-complete call. With no
   * `start`, the bake already running is the one waited for. A bake that
   * is stuck is cancelled as CyberChef's Cancel does, which ends it.
   */
  async function untilBakeEnds(start, timeoutMs, message) {
    const listeners = bakeEnds(worker());
    let started = !start;
    let ended = false;
    let wake = () => {};
    const listener = (baking) => {
      if (baking) started = true;
      else if (started) {
        ended = true;
        wake();
      }
    };
    listeners.add(listener);
    try {
      start?.();
      const begin = Date.now();
      let quietSince = 0;
      while (!ended) {
        if (Date.now() - begin > timeoutMs) throw new Error(message);
        // A tick only to notice a stuck bake; the end itself wakes this.
        await new Promise((resolve) => {
          wake = resolve;
          setTimeout(resolve, 100);
        });
        if (ended) continue;
        if (!app().baking) {
          if (started) ended = true;
          continue;
        }
        const idle = idleWork();
        quietSince = idle ? quietSince || Date.now() : 0;
        if (idle === "now" || (idle && Date.now() - quietSince >= STUCK_MS)) worker().cancelBake(true, false);
      }
    } finally {
      listeners.delete(listener);
    }
  }

  /** Resolves once CyberChef isn't baking: at once, or when its bake ends. */
  async function settled(timeoutMs = 60000) {
    if (!app().baking) return;
    await untilBakeEnds(null, timeoutMs, "CyberChef is still baking");
  }

  async function getOutput() {
    await settled();
    const output = app().manager.output;
    const dish = output.getOutputDish(activeTab());
    return dish ? await output.getDishStr(dish) : "";
  }

  let baking = null;

  /**
   * Bakes every input as CyberChef's Bake button does, and resolves to the
   * open tab's output once CyberChef says the bake is complete. A running
   * bake is let finish first rather than cancelled (the button would cancel
   * it), and a call while one is asked for shares it. app.bake() would
   * resume from a breakpoint's position instead.
   */
  function bake(timeoutMs = 60000) {
    baking ??= (async () => {
      // A bake can end cancelled: CyberChef's debounced statechange handler
      // (autoBake, which runs even with Auto Bake off) cancels a running
      // bake when a recipe or input change lands after it started. Bake
      // again until a bake covers the open tab as it stands.
      for (let attempt = 0; attempt < 3; attempt++) {
        await settled(timeoutMs);
        await untilBakeEnds(() => inputs().bakeAll(), timeoutMs, "CyberChef didn't finish baking");
        if (current()) break;
      }
      return getOutput();
    })().finally(() => (baking = null));
    return baking;
  }

  // Whether CyberChef's last bake covers the recipe and inputs as they
  // stand (its own stale test) and finished the open tab.
  function current() {
    const status = app().manager.output.outputs?.[activeTab()]?.status;
    return app().bakeStateId >= app().stateChangeId && (status === "baked" || status === "error");
  }

  /**
   * Sets the open tab's input as typing into it does: app.setInput alone
   * tells CyberChef's input worker silently, so Auto Bake never hears of
   * it. The statechange event is what CyberChef's own input handling fires
   * (InputWaiter.inputChange); Auto Bake and the stale-output mark follow it.
   */
  function setInput(text) {
    app().setInput(text);
    win.dispatchEvent(app().manager.statechange);
  }

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
    setInput(text);
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

    /**
     * Sets the widths of CyberChef's Operations, Recipe and Input/Output
     * columns, as percentages (chefColumns in chefTheme.js).
     */
    setColumns(sizes) {
      app().columnSplitter.setSizes(sizes);
      app().adjustComponentSizes();
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

    /** The open input tab's number, as its tab shows it. */
    openTab() {
      return activeTab() > 0 ? activeTab() : 1;
    },

    /**
     * The open tab's output as text, or "" before a bake. A running bake
     * is waited for, so this is never a bake's half-written output.
     */
    getOutput,

    /** Resolves once CyberChef isn't baking (a stuck bake is cancelled). */
    settled,

    bake,

    /**
     * The open tab's output for the recipe and inputs as they stand now:
     * when CyberChef's last bake doesn't cover them (its own stale test, or
     * the tab has no finished output), it bakes first and waits.
     */
    async currentOutput(timeoutMs = 60000) {
      await settled(timeoutMs);
      return current() ? getOutput() : bake(timeoutMs);
    },

    /** Shows a recipe: its operations, then each input in its own tab. */
    async load(recipe) {
      await settled();
      await clearInputs();
      app().setRecipeConfig(recipe.operations ?? []);
      const [first = "", ...rest] = recipe.inputs ?? [];
      setInput(first);
      for (const text of rest) await addInputTab(text);
    },

    /** Fills the open input tab when it is empty, else adds a tab for `text`. */
    async insertInput(text) {
      if ((await activeInput()) === "") setInput(text);
      else await addInputTab(text);
    },

    addInputTab,
  };
}
