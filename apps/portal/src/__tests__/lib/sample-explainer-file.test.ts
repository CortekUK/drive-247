/**
 * The sample clip on disk says what the code says about it.
 *
 * `SAMPLE_EXPLAINER_DURATION_SECONDS` is printed as "1:30" beside the sample on
 * the canary's setup checklist. That number is a promise about the file at
 * `SAMPLE_EXPLAINER_URL`, so this test reads the file's own bytes rather than
 * trusting either side: re-encode the clip to a different length and forget the
 * constant (or the reverse), and this fails.
 *
 * HOW THE LENGTH IS READ, by hand, from ISO/IEC 14496-12 (the MP4 box format):
 *
 *   A file is a sequence of boxes. Each box starts with a 4-byte big-endian
 *   size (covering the whole box, header included) and a 4-byte ASCII type.
 *   A size of 1 means a 64-bit size follows the type; a size of 0 means "to
 *   the end of the file".
 *
 *   The movie header `mvhd` sits inside `moov`. Its body starts with a 1-byte
 *   version and 3 bytes of flags, then:
 *     version 0:  creation u32 | modification u32 | timescale u32 | duration u32
 *                 -> timescale at body+12, duration at body+16
 *     version 1:  creation u64 | modification u64 | timescale u32 | duration u64
 *                 -> timescale at body+20, duration at body+24
 *   The movie's length in seconds is duration / timescale.
 *
 * WHAT IT SHOULD BE, by hand: the clip was generated as exactly 90 seconds at
 * 10 frames per second, i.e. 900 frames / 10 fps = 90 s.
 *
 * It also pins the three other properties the clip was made to have: silent
 * (its only track's handler is `vide`, no `soun`), fast-start (`moov` before
 * `mdat`, so the player can show the length before downloading the rest), and
 * small (under 500 KB, since it ships in the portal's public folder).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  SAMPLE_EXPLAINER_DURATION_SECONDS,
  SAMPLE_EXPLAINER_URL,
  formatExplainerDuration,
} from '@/lib/explainers';

// src/__tests__/lib -> up three -> apps/portal, then public/ + the URL path.
//
// Built with `path`, NOT `new URL(template, import.meta.url)`: Vite rewrites
// that exact shape into an asset import at transform time, and with a variable
// in the template it resolves to the string "undefined".
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(HERE, '../../../public', SAMPLE_EXPLAINER_URL.replace(/^\//, ''));

interface Box {
  type: string;
  bodyStart: number;
  end: number;
}

function readBoxes(buf: Buffer, start: number, end: number): Box[] {
  const boxes: Box[] = [];
  let at = start;
  while (at + 8 <= end) {
    let size = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    let header = 8;
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(at + 8));
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) {
      throw new Error(`malformed ${type} box at byte ${at}`);
    }
    boxes.push({ type, bodyStart: at + header, end: at + size });
    at += size;
  }
  return boxes;
}

function child(buf: Buffer, parent: Box, type: string): Box[] {
  return readBoxes(buf, parent.bodyStart, parent.end).filter((b) => b.type === type);
}

const buf = readFileSync(FILE);
const top = readBoxes(buf, 0, buf.length);

describe('public/explainers/sample-walkthrough.mp4', () => {
  it('is the file SAMPLE_EXPLAINER_URL names', () => {
    expect(SAMPLE_EXPLAINER_URL).toBe('/explainers/sample-walkthrough.mp4');
    expect(top[0]?.type).toBe('ftyp');
  });

  it('is exactly SAMPLE_EXPLAINER_DURATION_SECONDS long, read from its own mvhd box', () => {
    const moov = top.find((b) => b.type === 'moov');
    expect(moov, 'moov box').toBeDefined();
    const [mvhd] = child(buf, moov!, 'mvhd');
    expect(mvhd, 'mvhd box').toBeDefined();

    const body = mvhd.bodyStart;
    const version = buf.readUInt8(body);
    const timescale = version === 1 ? buf.readUInt32BE(body + 20) : buf.readUInt32BE(body + 12);
    const duration =
      version === 1 ? Number(buf.readBigUInt64BE(body + 24)) : buf.readUInt32BE(body + 16);

    expect(timescale).toBeGreaterThan(0);
    expect(duration / timescale).toBe(SAMPLE_EXPLAINER_DURATION_SECONDS);
    // 900 frames / 10 fps = 90 s; 90 s = 1 minute 30 seconds = "1:30".
    expect(SAMPLE_EXPLAINER_DURATION_SECONDS).toBe(90);
    expect(formatExplainerDuration(SAMPLE_EXPLAINER_DURATION_SECONDS)).toBe('1:30');
  });

  it('is silent: its only track is video', () => {
    const moov = top.find((b) => b.type === 'moov')!;
    const handlers = child(buf, moov, 'trak').flatMap((trak) =>
      child(buf, trak, 'mdia').flatMap((mdia) =>
        // hdlr body: version+flags (4) | pre_defined (4) | handler_type (4)
        child(buf, mdia, 'hdlr').map((h) => buf.toString('latin1', h.bodyStart + 8, h.bodyStart + 12)),
      ),
    );
    expect(handlers).toEqual(['vide']);
  });

  it('is fast-start and small', () => {
    const types = top.map((b) => b.type);
    expect(types.indexOf('moov')).toBeGreaterThan(-1);
    expect(types.indexOf('moov')).toBeLessThan(types.indexOf('mdat'));
    expect(buf.length).toBeLessThan(500_000);
  });
});
