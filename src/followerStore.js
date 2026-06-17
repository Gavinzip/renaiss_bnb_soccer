import fs from "node:fs/promises";
import path from "node:path";

export class FollowerStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
  }

  async ensureReady() {
    await fs.mkdir(this.dataDir, { recursive: true });
  }

  async getAccount(handle) {
    const accounts = await this.#readAccounts();
    return accounts[handle] || null;
  }

  async saveAccount(account) {
    await this.ensureReady();
    const accounts = await this.#readAccounts();
    accounts[account.handle] = {
      ...account,
      resolvedAt: new Date().toISOString(),
    };
    await writeJsonAtomic(this.#accountsPath(), accounts);
    return accounts[account.handle];
  }

  async loadFollowerCache(targetXUserId) {
    const filePath = this.#followersPath(targetXUserId);
    const cache = await readJson(filePath, null);
    if (cache) {
      return cache;
    }

    return {
      targetXUserId,
      handle: null,
      updatedAt: null,
      followers: {},
    };
  }

  async saveFollowerCache(targetXUserId, cache) {
    await this.ensureReady();
    await writeJsonAtomic(this.#followersPath(targetXUserId), {
      ...cache,
      targetXUserId,
      updatedAt: new Date().toISOString(),
    });
  }

  async appendSyncRun(targetXUserId, run) {
    await this.ensureReady();
    const line = `${JSON.stringify(run)}\n`;
    await fs.appendFile(this.#syncRunsPath(targetXUserId), line, "utf8");
  }

  async #readAccounts() {
    return readJson(this.#accountsPath(), {});
  }

  #accountsPath() {
    return path.join(this.dataDir, "accounts.json");
  }

  #followersPath(targetXUserId) {
    return path.join(this.dataDir, `followers-${targetXUserId}.json`);
  }

  #syncRunsPath(targetXUserId) {
    return path.join(this.dataDir, `sync-runs-${targetXUserId}.jsonl`);
  }
}

async function readJson(filePath, fallback) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}
