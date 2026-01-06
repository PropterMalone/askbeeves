// src/bloom.ts
var DEFAULT_BITS_PER_ELEMENT = 10;
var DEFAULT_NUM_HASHES = 7;
function fnv1a(str, seed = 0) {
  let hash = 2166136261 ^ seed;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
function getHashValues(item, numHashes, size) {
  const h1 = fnv1a(item, 0);
  const h2 = fnv1a(item, h1);
  const hashes = [];
  for (let i = 0; i < numHashes; i++) {
    const hash = (h1 + i * h2) % size;
    hashes.push(Math.abs(hash));
  }
  return hashes;
}
function createBloomFilter(expectedElements, bitsPerElement = DEFAULT_BITS_PER_ELEMENT, numHashes = DEFAULT_NUM_HASHES) {
  const size = Math.max(64, Math.ceil(expectedElements * bitsPerElement));
  const byteSize = Math.ceil(size / 8);
  const bytes = new Uint8Array(byteSize);
  return {
    bits: uint8ArrayToBase64(bytes),
    size,
    numHashes,
    count: 0
  };
}
function bloomFilterFromArray(items, bitsPerElement = DEFAULT_BITS_PER_ELEMENT, numHashes = DEFAULT_NUM_HASHES) {
  const filter = createBloomFilter(items.length, bitsPerElement, numHashes);
  for (const item of items) {
    bloomFilterAdd(filter, item);
  }
  return filter;
}
function bloomFilterAdd(filter, item) {
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
function bloomFilterMightContain(filter, item) {
  const bytes = base64ToUint8Array(filter.bits);
  const hashes = getHashValues(item, filter.numHashes, filter.size);
  for (const hash of hashes) {
    const byteIndex = Math.floor(hash / 8);
    const bitIndex = hash % 8;
    if ((bytes[byteIndex] & 1 << bitIndex) === 0) {
      return false;
    }
  }
  return true;
}
function estimateFalsePositiveRate(filter) {
  const k = filter.numHashes;
  const n = filter.count;
  const m = filter.size;
  if (n === 0) return 0;
  const exponent = -k * n / m;
  return Math.pow(1 - Math.exp(exponent), k);
}
function bloomFilterSizeBytes(filter) {
  return Math.ceil(filter.size / 8);
}
function uint8ArrayToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
export {
  bloomFilterAdd,
  bloomFilterFromArray,
  bloomFilterMightContain,
  bloomFilterSizeBytes,
  createBloomFilter,
  estimateFalsePositiveRate
};
