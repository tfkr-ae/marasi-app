// The content-type exclusion: loading it with the project (populate, resync), saving it, the app default, and the Types menu's counts.
import { normalizeContentType } from "../../lib/ledger/contentTypes.js";

/** The exclusion over the window `win`, which reads the results again after a change. */
export function createExclusion(core, api, win) {
  const { update, track } = core;
  const { reload, refresh, countNewMatches } = win;
  const rerunQuery = reload;

  // Bumped on a project switch, so the old project's exclusion is dropped.
  let projectVersion = 0;
  // Settles once the project's exclusion has loaded; counts wait for it.
  let exclusionLoaded = Promise.resolve();

  // Loads the project's first page and content-type exclusion. Each arrives
  // on its own; a failure leaves the other in place.
  async function populate() {
    const version = projectVersion;
    const fresh = () => version === projectVersion;
    exclusionLoaded = api
      .getExclusion()
      .then((exclusion) => {
        if (fresh()) update((state) => ({ ...state, exclusion: exclusion ?? [], exclusionLoaded: true }));
      })
      .catch((err) => {
        console.error("Loading the content-type exclusion failed:", err);
        if (fresh()) update((state) => ({ ...state, exclusionLoaded: true }));
      });
    await Promise.all([
      reload(),
      exclusionLoaded,
      api
        .hasOwnExclusion()
        .then((own) => {
          if (fresh()) update((state) => ({ ...state, ownExclusion: own }));
        })
        .catch((err) => console.error("Reading whether the project has its own exclusion failed:", err)),
    ]);
  }

  /**
   * Brings the Ledger up to date after a stream reset (expired or invalid), in
   * place: the project's exclusion is read again (another client may have
   * changed it), the rows are read again where they are, as after a bulk
   * change, and the matches captured meanwhile are counted. The scroll,
   * selection, drawer, query and sort stay. A changed exclusion reads the
   * results again from the top instead, as saving one does.
   */
  async function resync() {
    const version = projectVersion;
    api.forgetExclusion?.();
    let exclusion = core.current.exclusion;
    let ownExclusion = core.current.ownExclusion;
    try {
      [exclusion, ownExclusion] = await Promise.all([api.getExclusion(), api.hasOwnExclusion()]);
    } catch (err) {
      console.error("Reading the content-type exclusion failed:", err);
    }
    if (version !== projectVersion) return;
    exclusion = exclusion ?? [];
    const changedExclusion =
      exclusion.length !== core.current.exclusion.length || exclusion.some((type, i) => type !== core.current.exclusion[i]);
    update((state) => ({ ...state, exclusion, ownExclusion, exclusionLoaded: true }));
    if (core.current.typeCounts.loaded) track(loadTypeCounts());
    if (changedExclusion) {
      await reload();
      return;
    }
    await refresh();
    await track(countNewMatches());
  }

  // Stores a new exclusion. The caller reads the results again so they
  // reflect it, which drops the pairs it hides from the selection.
  function applyExclusion(exclusion, ownExclusion) {
    update((state) => ({ ...state, exclusion, ownExclusion }));
  }

  /**
   * Loads the Types menu's pair counts. Counts for a project that has
   * since closed are dropped; a failure keeps the last counts.
   */
  async function loadTypeCounts() {
    const version = projectVersion;
    try {
      const result = await api.countContentTypes();
      if (version !== projectVersion) return;
      update((state) => ({
        ...state,
        typeCounts: {
          counts: result?.Counts ?? [],
          complete: result?.Complete?.sitemap ?? true,
          loaded: true,
        },
      }));
    } catch (err) {
      console.error("Counting content types failed:", err);
    }
  }

  return {
    populate,
    resync,
    // Settles once the project's exclusion has loaded.
    loaded: () => exclusionLoaded,

    // Gives the project its own content-type exclusion, normalised as Marasi
    // does, then reads the results again from the top so they reflect it.
    // The drawer closes when the exclusion hides its pair.
    saveExclusion: async (types) => {
      const exclusion = [...new Set(types.map(normalizeContentType))];
      applyExclusion(exclusion, true);
      await api.setExclusion(exclusion);
      await rerunQuery();
    },
    // Drops the project's own exclusion so it follows the app default again.
    resetExclusion: async () => {
      await api.resetExclusion();
      applyExclusion(await api.getExclusion(), false);
      await rerunQuery();
    },
    loadTypeCounts,
    // Reads the app default exclusion into `defaultExclusion` and returns it.
    loadDefaultExclusion: async () => {
      const defaultExclusion = await api.getDefaultExclusion();
      update((state) => ({ ...state, defaultExclusion }));
      return defaultExclusion;
    },
    // Replaces the app default exclusion. A project that follows it hides
    // the new list at once.
    saveDefaultExclusion: async (types) => {
      const defaultExclusion = [...new Set(types.map(normalizeContentType))];
      update((state) => ({ ...state, defaultExclusion }));
      const follows = core.current.ownExclusion === false;
      if (follows) applyExclusion(defaultExclusion, false);
      await api.setDefaultExclusion(defaultExclusion);
      if (follows) await rerunQuery();
    },

    // A project switch: the old project's exclusion is dropped.
    reset: () => {
      projectVersion++;
      exclusionLoaded = Promise.resolve();
      // The next project has its own exclusion.
      api.forgetExclusion?.();
    },
  };
}
