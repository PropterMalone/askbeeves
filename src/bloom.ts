/**
 * AskBeeves - Bloom filter implementation for space-efficient block list storage
 *
 * A bloom filter is a probabilistic data structure that can tell you:
 * - Definitely NOT in set (no false negatives)
 * - PROBABLY in set (small false positive rate)
 *
 * This allows storing block lists in ~3% of the space of full DID arrays.
 */

// Default parameters for ~1% false positive rate
const DEFAULT_BITS_PER_ELEMENT = 10;
const DEFAULT_NUM_HASHES = 7;

export interface BloomFilterData {
  // Base64-encoded bit array
  bits: string;
  // Number of bits in the filter
  size: number;
  // Number of hash functions used
  numHashes: number;
  // Number of elements added (for stats)
  count: number;
}

/**
 * Simple hash function using FNV-1a algorithm
 * Returns a 32-bit hash
 */
function fnv1a(str: string, seed: number = 0): number {
  let hash = 2166136261 ^ seed;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0; // Convert to unsigned 32-bit
}

/**
 * Generate multiple hash values using double hashing technique
 * h(i) = h1 + i * h2
 */
function getHashValues(item: string, numHashes: number, size: number): number[] {
  const h1 = fnv1a(item, 0);
  const h2 = fnv1a(item, h1);

  const hashes: number[] = [];
  for (let i = 0; i < numHashes; i++) {
    // Combine hashes and mod by size
    const hash = (h1 + i * h2) % size;
    hashes.push(Math.abs(hash));
  }
  return hashes;
}

/**
 * Create an empty bloom filter sized for expected number of elements
 */
export function createBloomFilter(
  expectedElements: number,
  bitsPerElement: number = DEFAULT_BITS_PER_ELEMENT,
  numHashes: number = DEFAULT_NUM_HASHES
): BloomFilterData {
  // Calculate optimal size
  const size = Math.max(64, Math.ceil(expectedElements * bitsPerElement));

  // Create empty bit array (as Uint8Array, then base64 encode)
  const byteSize = Math.ceil(size / 8);
  const bytes = new Uint8Array(byteSize);

  return {
    bits: uint8ArrayToBase64(bytes),
    size,
    numHashes,
    count: 0,
  };
}

/**
 * Create a bloom filter from an array of items
 */
export function bloomFilterFromArray(
  items: string[],
  bitsPerElement: number = DEFAULT_BITS_PER_ELEMENT,
  numHashes: number = DEFAULT_NUM_HASHES
): BloomFilterData {
  const filter = createBloomFilter(items.length, bitsPerElement, numHashes);

  for (const item of items) {
    bloomFilterAdd(filter, item);
  }

  return filter;
}

/**
 * Add an item to the bloom filter
 */
export function bloomFilterAdd(filter: BloomFilterData, item: string): void {
  const bytes = base64ToUint8Array(filter.bits);
  const hashes = getHashValues(item, filter.numHashes, filter.size);

  for (const hash of hashes) {
    const byteIndex = Math.floor(hash / 8);
    const bitIndex = hash % 8;
    bytes[byteIndex] |= 1 << bitIndex;
  }

  filter.bits = uint8ArrayToBase64(bytes);
  filter.count++;
}

/**
 * Check if an item might be in the bloom filter
 * Returns true if PROBABLY in set, false if DEFINITELY NOT in set
 */
export function bloomFilterMightContain(filter: BloomFilterData, item: string): boolean {
  const bytes = base64ToUint8Array(filter.bits);
  const hashes = getHashValues(item, filter.numHashes, filter.size);

  for (const hash of hashes) {
    const byteIndex = Math.floor(hash / 8);
    const bitIndex = hash % 8;
    if ((bytes[byteIndex] & (1 << bitIndex)) === 0) {
      return false; // Definitely not in set
    }
  }

  return true; // Probably in set
}

/**
 * Estimate the false positive rate for a bloom filter
 */
export function estimateFalsePositiveRate(filter: BloomFilterData): number {
  // Formula: (1 - e^(-kn/m))^k
  // where k = numHashes, n = count, m = size
  const k = filter.numHashes;
  const n = filter.count;
  const m = filter.size;

  if (n === 0) return 0;

  const exponent = (-k * n) / m;
  return Math.pow(1 - Math.exp(exponent), k);
}

/**
 * Get the size of the bloom filter in bytes
 */
export function bloomFilterSizeBytes(filter: BloomFilterData): number {
  // Base64 encoding adds ~33% overhead, but we store the raw byte count
  return Math.ceil(filter.size / 8);
}

/**
 * Convert Uint8Array to base64 string
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert base64 string to Uint8Array
 */
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
