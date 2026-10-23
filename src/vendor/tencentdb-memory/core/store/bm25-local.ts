/**
 * Local BM25 Sparse Vector Encoder.
 *
 * Pure TypeScript replacement for the Python sidecar BM25 client.
 * Uses @tencentdb-agent-memory/tcvdb-text package for tokenization (jieba) and BM25 encoding.
 * Falls back gracefully if the package is not installed.
 *
 * Two operations (same contract as the old BM25Client):
 * - `encodeTexts(texts)` — encode documents for upsert (TF-based)
 * - `encodeQueries(texts)` — encode queries for search (IDF-based)
 */

/** Sparse vector: array of [token_hash, weight] pairs. */
export type SparseVector = Array<[number, number]>;

/**
 * The package is ESM-only (`"type": "module"`, no `require` export condition),
 * so it must be loaded with a dynamic `import()` — `require()` fails with
 * ERR_PACKAGE_PATH_NOT_EXPORTED from the CJS main bundle.
 */
async function loadBM25EncoderClass(): Promise<any> {
  try {
    const mod = await import("@tencentdb-agent-memory/tcvdb-text");
    return mod.BM25Encoder ?? null;
  } catch {
    return null;
  }
}

interface Logger {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

export interface BM25LocalConfig {
  /** Whether BM25 sparse encoding is enabled (default: true) */
  enabled: boolean;
  /** Language for BM25 pre-trained params: "zh" or "en" (default: "zh") */
  language?: "zh" | "en";
}

const TAG = "[memory-tdai][bm25-local]";

// ============================
// Implementation
// ============================

export class BM25LocalEncoder {
  private readonly encoder: any;
  private readonly logger?: Logger;

  private constructor(encoder: any, logger?: Logger) {
    this.encoder = encoder;
    this.logger = logger;
  }

  /** Load the ESM package and construct an encoder for the given language. */
  static async create(language: "zh" | "en" = "zh", logger?: Logger): Promise<BM25LocalEncoder> {
    const EncoderClass = await loadBM25EncoderClass();
    if (!EncoderClass) {
      throw new Error(`${TAG} @tencentdb-agent-memory/tcvdb-text not installed — run: npm install @tencentdb-agent-memory/tcvdb-text`);
    }
    const encoder = EncoderClass.default(language);
    logger?.debug?.(`${TAG} Initialized BM25 local encoder (language=${language})`);
    return new BM25LocalEncoder(encoder, logger);
  }

  /**
   * Encode document texts for upsert (TF-based BM25 scoring).
   * Returns one SparseVector per input text.
   */
  encodeTexts(texts: string[]): SparseVector[] {
    if (texts.length === 0) return [];
    try {
      return this.encoder.encodeTexts(texts);
    } catch (err) {
      this.logger?.warn(
        `${TAG} encodeTexts failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  /**
   * Encode query texts for search (IDF-based BM25 scoring).
   * Returns one SparseVector per input text.
   */
  encodeQueries(texts: string[]): SparseVector[] {
    if (texts.length === 0) return [];
    try {
      return this.encoder.encodeQueries(texts);
    } catch (err) {
      this.logger?.warn(
        `${TAG} encodeQueries failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }
}

// ============================
// Factory
// ============================

/**
 * Create a BM25LocalEncoder if BM25 is enabled in config.
 * Returns undefined if disabled — callers should check before using.
 */
export async function createBM25Encoder(
  config: BM25LocalConfig,
  logger?: Logger,
): Promise<BM25LocalEncoder | undefined> {
  if (!config.enabled) {
    logger?.debug?.(`${TAG} BM25 sparse encoding disabled`);
    return undefined;
  }
  try {
    return await BM25LocalEncoder.create(config.language ?? "zh", logger);
  } catch (err) {
    logger?.warn(`${TAG} BM25 unavailable, falling back to keyword-only: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}
