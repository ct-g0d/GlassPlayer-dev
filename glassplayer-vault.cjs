/**
 * Glass Player - Desktop Vault Persistence Handler
 * 
 * Manages atomic disk persistence for Glass Player's local database (/db/*):
 * - Documents: manifest.json, local.json, trackCache.json, trackFeatures.json,
 *              behaviorEvents.json, userModel.json, recommendations.json
 * - Media assets: covers/<hash>.<ext>
 * 
 * Features:
 * - Optimistic Concurrency Control (OCC) via X-GP-Base revision matching
 * - SHA-256 dirty checking to skip unchanged disk writes
 * - Content-addressable cover deduplication
 * - Atomic disk writes via temporary files and safe renames
 * - Configurable vault directory (data/db or %APPDATA%/GlassPlayer/vault)
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

// Supported document names
const VALID_DOCS = new Set([
  'manifest.json',
  'local.json',
  'trackCache.json',
  'trackFeatures.json',
  'behaviorEvents.json',
  'userModel.json',
  'recommendations.json'
]);

// Cover pattern: covers/<64-hex-char-hash>.<extension>
const COVER_REGEX = /^covers\/[0-9a-f]{64}\.(png|jpe?g|webp|gif|bin)$/i;

const MIME_TYPES = {
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bin': 'application/octet-stream'
};

class GlassPlayerVault {
  constructor(options = {}) {
    this.vaultDir = this._resolveVaultDir(options);
    this._ensureDirSync(this.vaultDir);
    this._ensureDirSync(path.join(this.vaultDir, 'covers'));
  }

  /**
   * Resolve the active vault directory based on options and environment
   */
  _resolveVaultDir(options) {
    if (options.vaultDir) {
      return path.resolve(options.vaultDir);
    }
    if (process.env.GLASSPLAYER_VAULT_DIR) {
      return path.resolve(process.env.GLASSPLAYER_VAULT_DIR);
    }

    const appRoot = options.appRoot || __dirname;
    const localDb = path.join(appRoot, 'data', 'db');

    // Prefer data/db if it exists or is within project root
    if (fs.existsSync(localDb)) {
      return localDb;
    }

    // Fallback to %APPDATA%/GlassPlayer/vault if available on Windows
    if (process.env.APPDATA) {
      return path.join(process.env.APPDATA, 'GlassPlayer', 'vault');
    }

    return localDb;
  }

  _ensureDirSync(dirPath) {
    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
    } catch (err) {
      console.error(`[GP Vault] Failed to create directory: ${dirPath}`, err);
    }
  }

  getVaultDir() {
    return this.vaultDir;
  }

  /**
   * Normalize and sanitize subpath within vault
   */
  sanitizePath(rawPath) {
    if (!rawPath) return '';
    let p = String(rawPath).replace(/\\/g, '/');
    if (p.startsWith('/db/')) p = p.slice(4);
    else if (p.startsWith('db/')) p = p.slice(3);
    else if (p.startsWith('/')) p = p.slice(1);

    const normalized = path.normalize(p).replace(/^(\.\.[\/\\])+/, '').replace(/\\/g, '/');
    return normalized;
  }

  /**
   * Check if a relative path is a valid document or cover
   */
  isValidPath(subPath) {
    const clean = this.sanitizePath(subPath);
    return VALID_DOCS.has(clean) || COVER_REGEX.test(clean);
  }

  /**
   * Compute SHA-256 hex digest of data
   */
  computeHash(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Read an entry from the vault
   */
  async readEntry(rawPath) {
    const clean = this.sanitizePath(rawPath);
    if (!this.isValidPath(clean)) {
      return null;
    }

    const targetFile = path.join(this.vaultDir, clean);
    try {
      const buffer = await fsp.readFile(targetFile);
      const ext = path.extname(clean).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      return {
        name: clean,
        path: targetFile,
        buffer,
        contentType
      };
    } catch (err) {
      if (err.code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  /**
   * Write an entry to the vault with:
   * - Optimistic concurrency control (manifest.json)
   * - SHA-256 dirty checking
   * - Cover deduplication
   * - Atomic temporary file rename
   */
  async writeEntry(rawPath, data, headers = {}) {
    const clean = this.sanitizePath(rawPath);
    if (!this.isValidPath(clean)) {
      const err = new Error(`Invalid vault entry path: ${rawPath}`);
      err.status = 404;
      throw err;
    }

    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
    const targetFile = path.join(this.vaultDir, clean);

    // 1. Cover deduplication
    if (COVER_REGEX.test(clean)) {
      try {
        const stat = await fsp.stat(targetFile);
        if (stat.isFile() && stat.size > 0) {
          return { written: false, skipped: true, reason: 'cover_dedup', path: targetFile };
        }
      } catch {}
    }

    // 2. Optimistic Concurrency Control (OCC) for manifest.json
    if (clean === 'manifest.json') {
      let baseHeader = null;
      for (const [key, val] of Object.entries(headers)) {
        if (key.toLowerCase() === 'x-gp-base') {
          baseHeader = val;
          break;
        }
      }

      if (baseHeader !== null && baseHeader !== undefined && baseHeader !== '') {
        const expectedBase = Number(baseHeader);
        let currentRevision = 0;
        try {
          const currentContent = await fsp.readFile(targetFile, 'utf8');
          const parsed = JSON.parse(currentContent);
          currentRevision = Number(parsed.revision) || 0;
        } catch {}

        if (currentRevision !== expectedBase) {
          const conflictErr = new Error(`OCC Revision Conflict: disk revision is ${currentRevision}, request base was ${expectedBase}`);
          conflictErr.status = 409;
          throw conflictErr;
        }
      }
    }

    // 3. SHA-256 Dirty Checking
    try {
      const diskBuffer = await fsp.readFile(targetFile);
      const diskHash = this.computeHash(diskBuffer);
      const incomingHash = this.computeHash(buffer);
      if (diskHash === incomingHash) {
        return { written: false, skipped: true, reason: 'sha256_clean', path: targetFile };
      }
    } catch {}

    // 4. Atomic disk write via temporary file
    const targetDir = path.dirname(targetFile);
    await fsp.mkdir(targetDir, { recursive: true });

    const tempFile = path.join(
      targetDir,
      `.${path.basename(targetFile)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
    );

    try {
      await fsp.writeFile(tempFile, buffer);
      try {
        await fsp.rename(tempFile, targetFile);
      } catch (renameErr) {
        // Handle Windows file locking / atomic replacement edge-cases
        if (renameErr.code === 'EEXIST' || renameErr.code === 'EPERM') {
          try {
            await fsp.unlink(targetFile);
          } catch {}
          await fsp.rename(tempFile, targetFile);
        } else {
          throw renameErr;
        }
      }
    } catch (writeErr) {
      try {
        await fsp.unlink(tempFile);
      } catch {}
      throw writeErr;
    }

    return { written: true, skipped: false, path: targetFile };
  }

  /**
   * Handle Web standard Request (from protocol.handle('app', ...))
   */
  async handleProtocolRequest(request) {
    const url = new URL(request.url);
    const cleanPath = this.sanitizePath(url.pathname);

    if (!this.isValidPath(cleanPath)) {
      return new Response('Not Found', { status: 404, statusText: 'Not Found' });
    }

    const method = request.method.toUpperCase();

    // GET: Retrieve document or cover
    if (method === 'GET') {
      try {
        const entry = await this.readEntry(cleanPath);
        if (!entry) {
          return new Response('Not Found', { status: 404, statusText: 'Not Found' });
        }
        return new Response(entry.buffer, {
          status: 200,
          headers: {
            'Content-Type': entry.contentType,
            'Cache-Control': 'no-store'
          }
        });
      } catch (err) {
        console.error(`[GP Vault] Error reading ${cleanPath}:`, err);
        return new Response('Internal Server Error', { status: 500 });
      }
    }

    // PUT: Write document or cover
    if (method === 'PUT') {
      const xGp = request.headers.get('x-gp') || request.headers.get('X-GP');
      if (xGp !== '1') {
        return new Response('Forbidden: Missing or invalid X-GP header', { status: 403 });
      }

      try {
        const arrayBuffer = await request.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const headers = {};
        for (const [key, value] of request.headers.entries()) {
          headers[key] = value;
        }

        await this.writeEntry(cleanPath, buffer, headers);
        return new Response(null, { status: 204, statusText: 'No Content' });
      } catch (err) {
        if (err.status === 409) {
          return new Response(err.message, { status: 409, statusText: 'Conflict' });
        }
        if (err.status === 404) {
          return new Response(err.message, { status: 404, statusText: 'Not Found' });
        }
        console.error(`[GP Vault] Error writing ${cleanPath}:`, err);
        return new Response(err.message || 'Internal Server Error', { status: 500 });
      }
    }

    return new Response('Method Not Allowed', { status: 405 });
  }

  /**
   * Helper methods for direct IPC / renderer access
   */
  async getManifest() {
    const entry = await this.readEntry('manifest.json');
    if (!entry) return null;
    try {
      return JSON.parse(entry.buffer.toString('utf8'));
    } catch {
      return null;
    }
  }

  async readDocument(docName) {
    const entry = await this.readEntry(docName);
    if (!entry) return null;
    if (docName.endsWith('.json')) {
      try {
        return JSON.parse(entry.buffer.toString('utf8'));
      } catch {
        return null;
      }
    }
    return entry.buffer;
  }

  async writeDocument(docName, data, baseRevision) {
    const headers = {};
    if (baseRevision !== undefined && baseRevision !== null) {
      headers['X-GP-Base'] = String(baseRevision);
    }
    headers['X-GP'] = '1';
    return this.writeEntry(docName, data, headers);
  }

  async getStats() {
    const stats = {
      vaultDir: this.vaultDir,
      documents: {},
      coversCount: 0,
      totalBytes: 0
    };

    for (const doc of VALID_DOCS) {
      try {
        const st = await fsp.stat(path.join(this.vaultDir, doc));
        stats.documents[doc] = { size: st.size, modified: st.mtimeMs };
        stats.totalBytes += st.size;
      } catch {}
    }

    try {
      const coversDir = path.join(this.vaultDir, 'covers');
      const files = await fsp.readdir(coversDir);
      stats.coversCount = files.length;
      for (const file of files) {
        try {
          const st = await fsp.stat(path.join(coversDir, file));
          stats.totalBytes += st.size;
        } catch {}
      }
    } catch {}

    return stats;
  }
}

// Singleton instance with lazy init
let instance = null;

function getVaultInstance(options) {
  if (!instance || (options && Object.keys(options).length > 0)) {
    instance = new GlassPlayerVault(options);
  }
  return instance;
}

module.exports = {
  GlassPlayerVault,
  init: (options) => getVaultInstance(options),
  getVaultDir: (options) => getVaultInstance(options).getVaultDir(),
  isValidPath: (p) => getVaultInstance().isValidPath(p),
  readEntry: (p) => getVaultInstance().readEntry(p),
  writeEntry: (p, data, headers) => getVaultInstance().writeEntry(p, data, headers),
  handleProtocolRequest: (req) => getVaultInstance().handleProtocolRequest(req),
  getManifest: () => getVaultInstance().getManifest(),
  readDocument: (doc) => getVaultInstance().readDocument(doc),
  writeDocument: (doc, data, base) => getVaultInstance().writeDocument(doc, data, base),
  getStats: () => getVaultInstance().getStats()
};
