/**
 * The setup checklist's pure rules (lib/setup-checklist.ts): which icon and
 * words a guide link gets, which links are refused outright, and which video a
 * row plays with what length.
 *
 * Every expected value below is written out by hand from the rule it pins,
 * with the working in the comment beside it — none was copied from running the
 * code. The card test (__tests__/components/checklist-card.test.tsx) pins what
 * those rules look like on screen.
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_VIDEO_DURATION_SECONDS,
  SETUP_CHECKLIST_ITEMS,
  formatChecklistDuration,
  guideLinkKind,
  guideLinkLabel,
  guideLinkText,
  resolveChecklistVideo,
  safeChecklistLink,
} from '@/lib/setup-checklist';

describe('safeChecklistLink — what may ever reach an href, the router or window.open', () => {
  it('keeps same-origin paths and absolute http(s) URLs, trimmed', () => {
    expect(safeChecklistLink('/settings?tab=payg')).toBe('/settings?tab=payg');
    expect(safeChecklistLink('https://docs.example.com/payg')).toBe('https://docs.example.com/payg');
    expect(safeChecklistLink('http://example.com/guide')).toBe('http://example.com/guide');
    // Leading and trailing spaces are what a pasted value carries.
    expect(safeChecklistLink('  /explainers/a.mp4  ')).toBe('/explainers/a.mp4');
  });

  it('refuses anything that executes, leaves the origin, or is blank', () => {
    expect(safeChecklistLink('javascript:alert(1)')).toBeNull();
    expect(safeChecklistLink('JavaScript:alert(1)')).toBeNull();
    expect(safeChecklistLink('data:text/html,<script>alert(1)</script>')).toBeNull();
    // Protocol-relative: a second slash means another host.
    expect(safeChecklistLink('//evil.example')).toBeNull();
    // safe-href.ts's recorded gap — a browser reads `/\` like `//`.
    expect(safeChecklistLink('/\\evil.example')).toBeNull();
    // The URL parser strips a tab, turning `/<TAB>/evil` into `//evil`.
    expect(safeChecklistLink('/\t/evil.example')).toBeNull();
    expect(safeChecklistLink('settings?tab=payg')).toBeNull();
    expect(safeChecklistLink('')).toBeNull();
    expect(safeChecklistLink(null)).toBeNull();
    expect(safeChecklistLink(undefined)).toBeNull();
  });

  it('refuses a same-origin path whose dot segments collapse to //host', () => {
    // How each resolves: the URL parser splits the path after its leading "/"
    // into segments, drops every "." (and "%2e", which it reads as "."), and
    // lets every ".." (or "%2e%2e") remove the segment before it — at the root
    // there is nothing to remove, so it is simply dropped.
    //
    // "/.//evil.example"   -> ".", "", "evil.example"   -> "", "evil.example"
    expect(safeChecklistLink('/.//evil.example')).toBeNull();
    // "/..//evil.example"  -> "..", "", "evil.example"  -> "", "evil.example"
    expect(safeChecklistLink('/..//evil.example')).toBeNull();
    // "/%2e//evil.example" -> "%2e" is ".", same as the first
    expect(safeChecklistLink('/%2e//evil.example')).toBeNull();
    // "/settings/..//evil.example" -> "settings", "..", "", "evil.example";
    // ".." removes "settings", leaving "", "evil.example"
    expect(safeChecklistLink('/settings/..//evil.example')).toBeNull();
    // "/settings/%2e%2e//evil.example" -> "%2e%2e" is "..", same as above
    expect(safeChecklistLink('/settings/%2e%2e//evil.example')).toBeNull();
    // Every one of those leaves the segments "", "evil.example", which join
    // back up as the pathname "/" + "" + "/" + "evil.example" = "//evil.example"
    // — a protocol-relative URL, i.e. another host.
  });

  it('hands back the resolved path, so what is classified is what gets routed', () => {
    // "settings", "..", "rentals" -> ".." removes "settings" -> "/rentals"
    expect(safeChecklistLink('/settings/../rentals')).toBe('/rentals');
    // "." is dropped -> "/settings"; the query is carried over unchanged
    expect(safeChecklistLink('/./settings?tab=payg')).toBe('/settings?tab=payg');
    // Nothing to resolve: path, query and hash all come back as typed
    expect(safeChecklistLink('/settings?tab=payg#fees')).toBe('/settings?tab=payg#fees');
    // An absolute URL is returned as typed (trimmed), never re-serialised
    expect(safeChecklistLink('https://docs.example.com/a/../b')).toBe(
      'https://docs.example.com/a/../b',
    );
  });
});

describe('guideLinkKind — the icon follows the destination', () => {
  it("calls a path under /settings 'settings'", () => {
    expect(guideLinkKind('/settings?tab=auto-extend')).toBe('settings');
    expect(guideLinkKind('/settings')).toBe('settings');
    expect(guideLinkKind('/settings/team')).toBe('settings');
    expect(guideLinkKind('/settings#payg')).toBe('settings');
  });

  it("calls any other in-portal path 'portal' — including one that merely starts with the letters", () => {
    expect(guideLinkKind('/welcome')).toBe('portal');
    expect(guideLinkKind('/rentals?status=active')).toBe('portal');
    // `/settings-old` is a different route; only `/settings` followed by
    // nothing, `/`, `?` or `#` is the settings screen.
    expect(guideLinkKind('/settings-old')).toBe('portal');
  });

  it("calls an external http(s) page 'guide'", () => {
    expect(guideLinkKind('https://docs.example.com/installments')).toBe('guide');
    expect(guideLinkKind('http://example.com/installments')).toBe('guide');
  });

  it('classifies nothing it would refuse to open', () => {
    expect(guideLinkKind('javascript:alert(1)')).toBeNull();
    expect(guideLinkKind('//evil.example/settings')).toBeNull();
    expect(guideLinkKind(null)).toBeNull();
    // Starts with the letters "/settings", but resolves to "//evil.example"
    // (worked through above), so it is not a settings screen and gets no name.
    expect(guideLinkKind('/settings/..//evil.example')).toBeNull();
    expect(guideLinkText('Auto-extension', '/settings/..//evil.example')).toBeNull();
  });

  it('classifies the resolved path, not the typed one', () => {
    // "/settings/../rentals" resolves to "/rentals": in the portal, not settings
    expect(guideLinkKind('/settings/../rentals')).toBe('portal');
  });
});

describe('guideLinkText — the guide button’s name and tooltip', () => {
  it('names the feature and says honestly where the link goes', () => {
    // settings -> "Open <title> settings"
    expect(guideLinkText('Auto-extension', '/settings?tab=auto-extend')).toBe(
      'Open Auto-extension settings',
    );
    // portal -> "Open <title> in the portal"
    expect(guideLinkText('Auto-extension', '/welcome')).toBe('Open Auto-extension in the portal');
    // guide -> "Read the <title> guide"
    expect(guideLinkText('Auto-extension', 'https://docs.example.com/ae')).toBe(
      'Read the Auto-extension guide',
    );
    expect(guideLinkText('Auto-extension', 'javascript:alert(1)')).toBeNull();
  });

  it('leaves guideLinkLabel exactly as it was', () => {
    expect(guideLinkLabel('/settings?tab=payg')).toBe('Open in the portal');
    expect(guideLinkLabel('https://docs.example.com/payg')).toBe('Read the guide');
  });
});

describe('the compiled rows', () => {
  it('carry no video and no length, and every guide is a settings screen', () => {
    // The four features named in the planning meeting, in order.
    expect(SETUP_CHECKLIST_ITEMS.map((i) => i.key)).toEqual([
      'auto_extension',
      'installments',
      'payg',
      'bonzah',
    ]);
    for (const item of SETUP_CHECKLIST_ITEMS) {
      expect(item.videoUrl, item.key).toBeNull();
      expect(item.videoDurationSeconds, item.key).toBeNull();
      expect(guideLinkKind(item.guideUrl), item.key).toBe('settings');
    }
    // Title + "settings", per the rule above, for all four.
    expect(SETUP_CHECKLIST_ITEMS.map((i) => guideLinkText(i.title, i.guideUrl))).toEqual([
      'Open Auto-extension settings',
      'Open Installments settings',
      'Open Pay as you go settings',
      'Open Bonzah insurance settings',
    ]);
  });
});

describe('resolveChecklistVideo — which video a row plays, and what length it may claim', () => {
  it('plays a real video with its own length, never as a sample', () => {
    expect(
      resolveChecklistVideo(
        { videoUrl: '/explainers/payg.mp4', videoDurationSeconds: 125 },
        { allowSample: true },
      ),
    ).toEqual({ url: '/explainers/payg.mp4', durationSeconds: 125, isSample: false });
  });

  it('prints no length for a real video that has none — never 0', () => {
    const noLength = { videoUrl: 'https://www.loom.com/embed/abc', videoDurationSeconds: null };
    expect(resolveChecklistVideo(noLength, { allowSample: false })?.durationSeconds).toBeNull();
    const zero = { videoUrl: 'https://www.loom.com/embed/abc', videoDurationSeconds: 0 };
    expect(resolveChecklistVideo(zero, { allowSample: false })?.durationSeconds).toBeNull();
  });

  it('gives the canary the sample clip, with the clip’s own 90 seconds', () => {
    // SAMPLE_EXPLAINER_DURATION_SECONDS is 90: the file is 900 frames at 10 fps.
    expect(
      resolveChecklistVideo({ videoUrl: null, videoDurationSeconds: null }, { allowSample: true }),
    ).toEqual({ url: '/explainers/sample-walkthrough.mp4', durationSeconds: 90, isSample: true });
  });

  it('gives every other tenant no video at all', () => {
    expect(
      resolveChecklistVideo({ videoUrl: null, videoDurationSeconds: null }, { allowSample: false }),
    ).toBeNull();
  });

  it('treats an unsafe video URL as absent — the sample for the canary, nothing otherwise', () => {
    const hostile = { videoUrl: 'javascript:alert(1)', videoDurationSeconds: 60 };
    expect(resolveChecklistVideo(hostile, { allowSample: false })).toBeNull();
    // The hostile row's 60 seconds must not ride along onto the sample.
    expect(resolveChecklistVideo(hostile, { allowSample: true })).toEqual({
      url: '/explainers/sample-walkthrough.mp4',
      durationSeconds: 90,
      isSample: true,
    });
  });

  it('never plays a video behind a path that collapses to //host', () => {
    // "/.//evil.example/x.mp4" -> ".", "", "evil.example", "x.mp4" -> the
    // pathname "//evil.example/x.mp4", another host.
    const collapsing = { videoUrl: '/.//evil.example/x.mp4', videoDurationSeconds: 60 };
    expect(resolveChecklistVideo(collapsing, { allowSample: false })).toBeNull();
  });

  it('caps lengths at four hours', () => {
    // 4 hours = 4 x 60 minutes x 60 seconds = 14400.
    expect(MAX_VIDEO_DURATION_SECONDS).toBe(14400);
  });
});

describe('formatChecklistDuration — the length as the operator reads it', () => {
  it('prints m:ss under an hour: minutes unpadded, seconds two digits', () => {
    // 5 = 0 x 60 + 5
    expect(formatChecklistDuration(5)).toBe('0:05');
    // 90 = 1 x 60 + 30 — the sample clip
    expect(formatChecklistDuration(90)).toBe('1:30');
    // 125 = 2 x 60 + 5
    expect(formatChecklistDuration(125)).toBe('2:05');
    // 3599 = 59 x 60 + 59 — the last second before the hour form
    expect(formatChecklistDuration(3599)).toBe('59:59');
  });

  it('prints h:mm:ss from an hour, the way the admin form writes it back', () => {
    // 3600 = 1 x 3600 + 0 x 60 + 0
    expect(formatChecklistDuration(3600)).toBe('1:00:00');
    // 3725 = 1 x 3600 + 2 x 60 + 5 (total minutes would have said "62:05")
    expect(formatChecklistDuration(3725)).toBe('1:02:05');
    // 5400 = 1 x 3600 + 30 x 60 + 0
    expect(formatChecklistDuration(5400)).toBe('1:30:00');
    // 14400 = 4 x 3600 — MAX_VIDEO_DURATION_SECONDS
    expect(formatChecklistDuration(14400)).toBe('4:00:00');
  });
});
