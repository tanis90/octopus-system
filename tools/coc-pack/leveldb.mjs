// Minimal deterministic LevelDB WAL writer for the expansion pack.
//
// Foundry compendium packs are LevelDB directories. A single 000001.log holding
// one WriteBatch is enough to ship the pack: the reader replays the WAL, and the
// batch keys are the usual `!items!<id>` form. This file writes only that
// format, with no timestamps, no compression and a fixed sequence number, so
// consecutive builds are byte-identical.
const WAL_BLOCK = 32768;
const WAL_HEADER = 7;
const WAL_FULL = 1;
const WAL_FIRST = 2;
const WAL_MIDDLE = 3;
const WAL_LAST = 4;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes) => {
  let c = 0xFFFFFFFF;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
};

const varint = (n) => {
  const out = [];
  let value = n >>> 0;
  while (value >= 0x80) {
    out.push((value & 0x7F) | 0x80);
    value >>>= 7;
  }
  out.push(value);
  return out;
};

// WriteBatch payload: seq(8) count(4), then [tag(1) varint klen key varint vlen value].
// tag 1 = put; tag 0 (delete) is not emitted by this build.
export function makeWriteBatch(ops, seq = 1) {
  const body = [];
  for (let i = 0; i < 8; i += 1) body.push(Number((BigInt(seq) >> BigInt(8 * i)) & 0xFFn));
  body.push(ops.length & 0xFF, (ops.length >> 8) & 0xFF, (ops.length >> 16) & 0xFF, (ops.length >> 24) & 0xFF);
  for (const [key, value] of ops) {
    const keyBytes = new TextEncoder().encode(key);
    const valueBytes = new TextEncoder().encode(value);
    body.push(1, ...varint(keyBytes.length), ...keyBytes, ...varint(valueBytes.length), ...valueBytes);
  }
  return Uint8Array.from(body);
}

// WAL file: 32 KiB blocks, 7-byte record headers, fragmented records.
export function makeWal(batches) {
  const out = [];
  for (const payload of batches) {
    let pos = 0;
    let first = true;
    while (pos < payload.length) {
      const used = out.length % WAL_BLOCK;
      const available = WAL_BLOCK - used;
      if (available < WAL_HEADER) {
        for (let i = 0; i < available; i += 1) out.push(0);
        continue;
      }
      const chunkLength = Math.min(available - WAL_HEADER, payload.length - pos);
      if (chunkLength <= 0) throw new Error("WAL writer stalled: empty chunk");
      const last = pos + chunkLength >= payload.length;
      const type = first && last ? WAL_FULL : first ? WAL_FIRST : last ? WAL_LAST : WAL_MIDDLE;
      const chunk = payload.subarray(pos, pos + chunkLength);
      const crc = crc32(chunk);
      out.push(
        crc & 0xFF, (crc >>> 8) & 0xFF, (crc >>> 16) & 0xFF, (crc >>> 24) & 0xFF,
        chunkLength & 0xFF, (chunkLength >>> 8) & 0xFF, type,
      );
      for (const byte of chunk) out.push(byte);
      pos += chunkLength;
      first = false;
    }
  }
  return Uint8Array.from(out);
}

export function makePackLog(docs, seq = 1) {
  const ops = docs.map((doc) => [`!items!${doc._id}`, JSON.stringify(doc)]);
  return makeWal([makeWriteBatch(ops, seq)]);
}
