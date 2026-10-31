// Reads title, artist and the embedded cover from MP3, FLAC and M4A files. Other formats fall back to the file name.
const bytesOf = (file, start, length) => file.slice(start, start + length).arrayBuffer();
const latin1 = (buffer, start, end) => new TextDecoder('latin1').decode(new Uint8Array(buffer, start, end - start));
const cleanText = (text) => text.replace(/^﻿/, '').replace(/\u0000+$/, '').replace(/\u0000+/g, ' / ').trim();
const coverBlob = (buffer, start, end, mime) => URL.createObjectURL(new Blob([buffer.slice(start, end)], { type: mime || 'image/jpeg' }));

// ID3 text is latin1 by spec, but older Chinese files often put GBK there
function id3Text(buffer, start, end) {
  const encoding = new Uint8Array(buffer)[start], body = new Uint8Array(buffer, start + 1, end - start - 1);
  const charset = encoding === 1 ? 'utf-16' : encoding === 2 ? 'utf-16be' : encoding === 3 ? 'utf-8' : 'gbk';
  return cleanText(new TextDecoder(charset).decode(body));
}

async function readID3(file) {
  const head = await bytesOf(file, 0, 10);
  if (head.byteLength < 10 || latin1(head, 0, 3) !== 'ID3') return {};
  const h = new DataView(head), major = h.getUint8(3);
  const syncsafe = (view, at) => (view.getUint8(at) & 127) << 21 | (view.getUint8(at + 1) & 127) << 14 | (view.getUint8(at + 2) & 127) << 7 | view.getUint8(at + 3) & 127;
  const end = 10 + syncsafe(h, 6), buffer = await bytesOf(file, 0, end), view = new DataView(buffer), out = {};
  let at = 10;
  if (h.getUint8(5) & 64) at += major === 4 ? syncsafe(view, at) : view.getUint32(at) + 4;
  while (at + 10 < buffer.byteLength) {
    const idLength = major >= 3 ? 4 : 3, id = latin1(buffer, at, at + idLength);
    if (!/^[A-Z0-9]+$/.test(id)) break;
    const size = major === 4 ? syncsafe(view, at + 4) : major === 3 ? view.getUint32(at + 4) : view.getUint8(at + 3) << 16 | view.getUint8(at + 4) << 8 | view.getUint8(at + 5);
    const start = at + (major >= 3 ? 10 : 6), stop = start + size;
    if (size <= 0 || stop > buffer.byteLength) break;
    if (id === 'TIT2' || id === 'TT2') out.title = id3Text(buffer, start, stop);
    else if (id === 'TPE1' || id === 'TP1') out.artist = id3Text(buffer, start, stop);
    else if ((id === 'APIC' || id === 'PIC') && !out.cover) {
      const bytes = new Uint8Array(buffer), encoding = bytes[start];
      let p = start + 1, mime = '';
      if (id === 'APIC') { const e = bytes.indexOf(0, p); mime = latin1(buffer, p, e); p = e + 1; } else p += 3;
      p += 1;
      if (encoding === 1 || encoding === 2) { while (p < stop - 1 && (bytes[p] || bytes[p + 1])) p += 2; p += 2; } else p = bytes.indexOf(0, p) + 1;
      if (stop - p > 50) out.cover = coverBlob(buffer, p, stop, mime);
    }
    at = stop;
  }
  return out;
}

async function readFLAC(file) {
  if (latin1(await bytesOf(file, 0, 4), 0, 4) !== 'fLaC') return {};
  const out = {};
  for (let at = 4, last = false; !last && at + 4 < file.size;) {
    const head = new Uint8Array(await bytesOf(file, at, 4)), type = head[0] & 127, size = head[1] << 16 | head[2] << 8 | head[3];
    last = (head[0] & 128) !== 0;
    if (type === 4 || type === 6) {
      const buffer = await bytesOf(file, at + 4, size), view = new DataView(buffer);
      if (type === 4) {
        let p = 4 + view.getUint32(0, true);
        for (let n = view.getUint32(p, true), i = (p += 4, 0); i < n; i++) {
          const length = view.getUint32(p, true), comment = new TextDecoder().decode(new Uint8Array(buffer, p + 4, length)), split = comment.indexOf('=');
          const key = comment.slice(0, split).toUpperCase(), value = cleanText(comment.slice(split + 1));
          if (key === 'TITLE') out.title ||= value; else if (key === 'ARTIST') out.artist ||= value;
          p += 4 + length;
        }
      } else if (!out.cover) {
        let p = 4;
        const mimeLength = view.getUint32(p), mime = latin1(buffer, p + 4, p + 4 + mimeLength);
        p += 4 + mimeLength;
        p += 4 + view.getUint32(p) + 16;
        const length = view.getUint32(p);
        out.cover = coverBlob(buffer, p + 4, p + 4 + length, mime);
      }
    }
    at += 4 + size;
  }
  return out;
}

async function readMP4(file) {
  let at = 0, moov = null;
  while (at + 8 <= file.size && !moov) {
    const head = await bytesOf(file, at, 16), view = new DataView(head);
    let size = view.getUint32(0), type = latin1(head, 4, 8);
    if (size === 1) size = Number(view.getBigUint64(8)); else if (size === 0) size = file.size - at;
    if (size < 8) break;
    if (type === 'moov') moov = await bytesOf(file, at, size);
    at += size;
  }
  if (!moov) return {};
  const view = new DataView(moov), out = {};
  (function walk(start, end) {
    for (let p = start; p + 8 <= end;) {
      const size = view.getUint32(p), type = latin1(moov, p + 4, p + 8);
      if (size < 8 || p + size > end) return;
      if (type === 'moov' || type === 'udta' || type === 'ilst') walk(p + 8, p + size);
      else if (type === 'meta') walk(p + 12, p + size);
      else if (type === '©nam' || type === '©ART' || type === 'covr') {
        const flags = view.getUint32(p + 16), from = p + 24, to = p + 8 + view.getUint32(p + 8);
        if (type === 'covr') out.cover ||= coverBlob(moov, from, to, flags === 14 ? 'image/png' : 'image/jpeg');
        else out[type === '©nam' ? 'title' : 'artist'] = cleanText(new TextDecoder().decode(new Uint8Array(moov, from, to - from)));
      }
      p += size;
    }
  })(0, moov.byteLength);
  return out;
}

async function readTags(file) {
  const name = file.name.toLowerCase();
  const reader = name.endsWith('.flac') ? readFLAC : /\.(m4a|mp4|aac)$/.test(name) ? readMP4 : readID3;
  const tags = await reader(file).catch(() => ({}));
  const base = file.name.replace(/\.[^.]+$/, ''), split = base.indexOf(' - ');
  return {
    title: tags.title || (split > 0 ? base.slice(split + 3) : base),
    artist: tags.artist || (split > 0 ? base.slice(0, split) : '未知艺人'),
    cover: tags.cover || null,
  };
}

// The most vivid common colour in a cover, kept bright enough for white icons on a dark window
function coverAccent(url) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onerror = () => resolve(null);
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 32;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0, 32, 32);
      const data = ctx.getImageData(0, 0, 32, 32).data, buckets = new Map();
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
        if (l < .1 || l > .94) continue;
        const s = d / (1 - Math.abs(2 * l - 1) || 1);
        const h = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
        const key = Math.round(h * 4), bucket = buckets.get(key) || { score: 0, h: 0, s: 0, n: 0 };
        bucket.score += .15 + s; bucket.h += h; bucket.s += s; bucket.n += 1;
        buckets.set(key, bucket);
      }
      const best = [...buckets.values()].sort((a, b) => b.score - a.score)[0];
      if (!best) return resolve(null);
      resolve(`hsl(${Math.round(best.h / best.n * 60)} ${Math.round(Math.min(.72, Math.max(.32, best.s / best.n)) * 100)}% 54%)`);
    };
    image.src = url;
  });
}
