/**
 * AskBeeves - Bloom filter implementation for space-efficient block list storage
 *
 * A bloom filter is a probabilistic data structure that can tell you:
 * - Definitely NOT in set (no false negatives)
 * - PROBABLY in set (small false positive rate)
 *
 * This allows storing block lists in ~3% of the space of full DID arrays.
 */

// Default parameters for ~0.1% false positive rate (more conservative)
// Increased from 10 bits/7 hashes to handle DID similarity better
const DEFAULT_BITS_PER_ELEMENT = 15;
const DEFAULT_NUM_HASHES = 10;

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
 * MurmurHash3-like hash function for better distribution
 * Returns a 32-bit unsigned hash
 */
function murmurHash3(str: string, seed: number = 0): number {
  let h1 = seed >>> 0;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;

  for (let i = 0; i < str.length; i++) {
    let k1 = str.charCodeAt(i);
    k1 = Math.imul(k1, c1);
    k1 = (k1 << 15) | (k1 >>> 17);
    k1 = Math.imul(k1, c2);

    h1 ^= k1;
    h1 = (h1 << 13) | (h1 >>> 19);
    h1 = Math.imul(h1, 5) + 0xe6546b64;
  }

  // Finalization
  h1 ^= str.length;
  h1 ^= h1 >>> 16;
  h1 = Math.imul(h1, 0x85ebca6b);
  h1 ^= h1 >>> 13;
  h1 = Math.imul(h1, 0xc2b2ae35);
  h1 ^= h1 >>> 16;

  return h1 >>> 0;
}

/**
 * Generate multiple independent hash values using enhanced double hashing
 * Uses two different seeds and combines them for better distribution
 */
function getHashValues(item: string, numHashes: number, size: number): number[] {
  // Use two completely independent hash values with different seeds
  const h1 = murmurHash3(item, 0);
  const h2 = murmurHash3(item, 0x9e3779b9); // Golden ratio seed

  const hashes: number[] = [];
  for (let i = 0; i < numHashes; i++) {
    // Kirsch-Mitzenmacher optimization: g(i) = h1 + i*h2 + i^2
    // The i^2 term helps break up patterns
    const combined = h1 + i * h2 + i * i;
    // Use unsigned modulo to ensure positive result
    const hash = ((combined % size) + size) % size;
    hashes.push(hash);
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
