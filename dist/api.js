// src/api.ts
var BSKY_PUBLIC_API = "https://public.api.bsky.app";
var BSKY_PDS_DEFAULT = "https://bsky.social";
var PLC_DIRECTORY = "https://plc.directory";
var getLocalStorage = () => {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  return null;
};
function getSession() {
  try {
    const localStorageProxy = getLocalStorage();
    if (!localStorageProxy) {
      console.log("[AskBeeves API] localStorage not available");
      return null;
    }
    const allKeys = Object.keys(localStorageProxy);
    console.log("[AskBeeves API] All localStorage keys:", allKeys);
    const possibleKeys = allKeys.filter(
      (k) => k.includes("BSKY") || k.includes("bsky") || k.includes("session")
    );
    console.log("[AskBeeves API] Filtered keys:", possibleKeys);
    for (const storageKey of possibleKeys) {
      try {
        const raw = localStorageProxy.getItem(storageKey);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        let account = null;
        if (parsed?.session?.currentAccount) {
          const currentDid = parsed.session.currentAccount.did;
          account = parsed.session.accounts?.find((a) => a.did === currentDid) || null;
        }
        if (!account && parsed?.currentAccount) {
          const currentDid = parsed.currentAccount.did;
          account = parsed.accounts?.find((a) => a.did === currentDid) || null;
        }
        if (!account && parsed?.accessJwt && parsed?.did) {
          account = parsed;
        }
        if (account && account.accessJwt && account.did) {
          let pdsUrl = account.pdsUrl || account.service || BSKY_PDS_DEFAULT;
          pdsUrl = pdsUrl.replace(/\/+$/, "");
          if (!pdsUrl.startsWith("http://") && !pdsUrl.startsWith("https://")) {
            pdsUrl = "https://" + pdsUrl;
          }
          return {
            accessJwt: account.accessJwt,
            refreshJwt: account.refreshJwt,
            did: account.did,
            handle: account.handle || "",
            pdsUrl
          };
        }
      } catch {
      }
    }
    return null;
  } catch {
    return null;
  }
}
async function resolvePds(did) {
  try {
    if (!did.startsWith("did:plc:")) {
      return null;
    }
    const response = await fetch(`${PLC_DIRECTORY}/${did}`);
    if (!response.ok) return null;
    const doc = await response.json();
    const pds = doc.service?.find((s) => s.id === "#atproto_pds");
    return pds?.serviceEndpoint || null;
  } catch {
    return null;
  }
}
async function fetchWithRetry(url, options = {}, retries = 3, backoff = 1e3) {
  try {
    const response = await fetch(url, options);
    if (response.status === 429 && retries > 0) {
      await sleep(backoff);
      return fetchWithRetry(url, options, retries - 1, backoff * 2);
    }
    return response;
  } catch (error) {
    if (retries > 0) {
      await sleep(backoff);
      return fetchWithRetry(url, options, retries - 1, backoff * 2);
    }
    throw error;
  }
}
async function getProfile(actor) {
  try {
    const url = `${BSKY_PUBLIC_API}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`;
    const response = await fetchWithRetry(url);
    if (!response.ok) return null;
    const data = await response.json();
    return {
      did: data.did,
      handle: data.handle,
      displayName: data.displayName,
      avatar: data.avatar
    };
  } catch {
    return null;
  }
}
async function getFollows(did, cursor) {
  const params = new URLSearchParams({
    actor: did,
    limit: "100"
  });
  if (cursor) params.set("cursor", cursor);
  const url = `${BSKY_PUBLIC_API}/xrpc/app.bsky.graph.getFollows?${params}`;
  const response = await fetchWithRetry(url);
  if (!response.ok) {
    throw new Error(`Failed to get follows: ${response.status}`);
  }
  const data = await response.json();
  return {
    follows: data.follows.map((f) => ({
      did: f.did,
      handle: f.handle,
      displayName: f.displayName,
      avatar: f.avatar
    })),
    cursor: data.cursor
  };
}
async function getAllFollows(did) {
  const allFollows = [];
  let cursor;
  do {
    const result = await getFollows(did, cursor);
    allFollows.push(...result.follows);
    cursor = result.cursor;
    if (cursor) await sleep(100);
  } while (cursor);
  return allFollows;
}
async function getUserBlocks(did, pdsUrl) {
  const blocks = [];
  let pds = pdsUrl;
  if (!pds) {
    pds = await resolvePds(did);
  }
  if (!pds) {
    pds = BSKY_PDS_DEFAULT;
  }
  pds = pds.replace(/\/+$/, "");
  let cursor;
  do {
    const params = new URLSearchParams({
      repo: did,
      collection: "app.bsky.graph.block",
      limit: "100"
    });
    if (cursor) params.set("cursor", cursor);
    const url = `${pds}/xrpc/com.atproto.repo.listRecords?${params}`;
    const response = await fetchWithRetry(url);
    if (!response.ok) {
      return blocks;
    }
    const data = await response.json();
    for (const record of data.records || []) {
      if (record.value?.subject) {
        blocks.push(record.value.subject);
      }
    }
    cursor = data.cursor;
  } while (cursor);
  return blocks;
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
export {
  chunk,
  fetchWithRetry,
  getAllFollows,
  getFollows,
  getProfile,
  getSession,
  getUserBlocks,
  resolvePds,
  sleep
};
