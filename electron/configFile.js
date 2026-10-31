// marasi_appconfig.yaml as a YAML document, shared with v1. A write patches
// the given top-level keys of the file as it is on disk now, and leaves every
// other key, comment and style as parsed, so v1's keys and keys v2 doesn't
// know survive. Mirrors v1's config_file.go.
import { dirname, basename, join } from "node:path";
import { randomBytes } from "node:crypto";
import { isMap, parseDocument } from "yaml";

// The document in `text`. An empty file is an empty mapping; anything else
// that isn't a mapping is an error, as in v1.
function parse(text, path) {
  const doc = parseDocument(text, { keepSourceTokens: false });
  if (doc.errors.length) throw new Error(`${path}: ${doc.errors[0].message}`);
  if (doc.contents === null) doc.contents = doc.createNode({});
  if (!isMap(doc.contents)) throw new Error(`${path} is not a YAML mapping`);
  return doc;
}

export function createConfigFile({ path, fs }) {
  async function read() {
    let text;
    try {
      text = await fs.readFile(path, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return parse("", path);
      throw error;
    }
    return parse(text, path);
  }

  // Writes atomically: a temp file in the same directory, then a rename. On
  // error the original file is unchanged.
  async function writeAtomic(text) {
    const tmp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
    try {
      await fs.writeFile(tmp, text, { mode: 0o600 });
      await fs.rename(tmp, path);
    } catch (error) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw error;
    }
  }

  return {
    path,

    /** Every top-level key's value, as plain JS. */
    async values() {
      return (await read()).toJS() ?? {};
    },

    /**
     * Replaces (or appends, in key order) the top-level keys in `values` and
     * leaves the rest of the file as it is.
     */
    async write(values) {
      const doc = await read();
      for (const key of Object.keys(values).sort()) {
        doc.set(key, doc.createNode(values[key]));
      }
      await writeAtomic(doc.toString({ indent: 2, indentSeq: true, lineWidth: 0 }));
    },
  };
}
