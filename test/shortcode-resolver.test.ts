import { describe, it, expect } from 'vitest';
import { findShortcodes, resolveShortcodes } from '../src/services/shortcode-resolver.js';

// NOTE: resolveShortcodes/findShortcodes are pure when no siteId is passed —
// getSiteRules is only consulted with a siteId and is wrapped in try/catch,
// so these tests never touch the SQLite database.

describe('findShortcodes — parsing', () => {
  it('parses a self-closing shortcode [sc /]', () => {
    const [sc] = findShortcodes('before [gallery ids="1,2,3" /] after');
    expect(sc.tag).toBe('gallery');
    expect(sc.selfClosing).toBe(true);
    expect(sc.content).toBe('');
    expect(sc.attrs).toEqual({ ids: '1,2,3' });
  });

  it('parses a bare self-closing shortcode [sc] (no slash, no closing tag)', () => {
    const [sc] = findShortcodes('[wpforms id="42"]');
    expect(sc.tag).toBe('wpforms');
    expect(sc.selfClosing).toBe(true);
    expect(sc.attrs).toEqual({ id: '42' });
  });

  it('parses an enclosing shortcode [sc]...[/sc]', () => {
    const [sc] = findShortcodes('[button url="/x"]Click me[/button]');
    expect(sc.tag).toBe('button');
    expect(sc.selfClosing).toBe(false);
    expect(sc.content).toBe('Click me');
    expect(sc.attrs).toEqual({ url: '/x' });
  });

  it('parses quoted (double/single), unquoted, and valueless attributes', () => {
    const [sc] = findShortcodes('[x a="one two" b=\'three\' c=four flag]content[/x]');
    expect(sc.attrs.a).toBe('one two');
    expect(sc.attrs.b).toBe('three');
    expect(sc.attrs.c).toBe('four');
    // valueless attribute defaults to "true"
    expect(sc.attrs.flag).toBe('true');
  });

  it('records the index of each match', () => {
    const content = 'xx [foo /]';
    const [sc] = findShortcodes(content);
    expect(sc.index).toBe(content.indexOf('[foo'));
    expect(content.substr(sc.index, sc.full.length)).toBe('[foo /]');
  });

  it('finds multiple shortcodes in one string', () => {
    const matches = findShortcodes('[a /] middle [b]x[/b]');
    expect(matches.map((m) => m.tag)).toEqual(['a', 'b']);
  });

  it('does not match malformed brackets (unclosed / no valid tag)', () => {
    expect(findShortcodes('[not closed')).toHaveLength(0);
    expect(findShortcodes('[123invalid]x[/123invalid]')).toHaveLength(0);
    expect(findShortcodes('plain text, no shortcodes')).toHaveLength(0);
  });
});

describe('resolveShortcodes — built-in handlers', () => {
  it('button → <a class="button"> using content as text', () => {
    const { content } = resolveShortcodes('[button url="https://e.com"]Buy[/button]');
    expect(content).toBe('<a href="https://e.com" class="button">Buy</a>');
  });

  it('caption with an <img> wraps in <figure><figcaption>', () => {
    const { content } = resolveShortcodes('[caption caption="Hello"]<img src="a.jpg" />[/caption]');
    expect(content).toContain('<figure>');
    expect(content).toContain('<figcaption>Hello</figcaption>');
  });

  it('audio with src → <audio> element', () => {
    const { content } = resolveShortcodes('[audio src="song.mp3" /]');
    expect(content).toBe('<audio controls src="song.mp3"></audio>');
  });

  it('contact-form-7 becomes a descriptive comment marker', () => {
    const { content } = resolveShortcodes('[contact-form-7 id="99" title="Reach Us" /]');
    expect(content).toContain('<!-- Contact Form: Reach Us');
    expect(content).toContain('id=99');
  });

  it('vc_column_text strips the wrapper and keeps inner content', () => {
    const { content } = resolveShortcodes('[vc_column_text]inner body[/vc_column_text]');
    expect(content).toBe('inner body');
  });
});

describe('resolveShortcodes — unknown / passthrough behaviour', () => {
  it('unknown enclosing shortcode keeps its content (keep_content_default)', () => {
    const r = resolveShortcodes('[mystery]keep this[/mystery]');
    expect(r.content).toBe('keep this');
    // content was preserved, so it is NOT reported as unresolved
    expect(r.unresolved).not.toContain('mystery');
  });

  it('unknown self-closing shortcode is replaced by a comment marker and reported unresolved', () => {
    const r = resolveShortcodes('[totally_unknown id="1" /]');
    // The tag is reported unresolved (correct).
    expect(r.unresolved).toContain('totally_unknown');
    // The placeholder retains the tag name and is wrapped in a comment marker.
    expect(r.content).toContain('[totally_unknown]');
    expect(r.content.startsWith('<!-- shortcode:')).toBe(true);

    // KNOWN BUG (documented, not fixed): the replacement comment itself contains
    // the bracketed token "[totally_unknown]", which SHORTCODE_REGEX re-matches on
    // the next pass, so the marker nests once per pass up to maxPasses (10).
    // Correct behaviour would be a single, non-recursive marker.
    const markerCount = (r.content.match(/<!-- shortcode:/g) || []).length;
    expect(markerCount).toBeGreaterThan(1); // demonstrates the recursion
  });

  it('de-duplicates repeated unresolved tags', () => {
    const r = resolveShortcodes('[zz /][zz /][zz /]');
    expect(r.unresolved).toEqual(['zz']);
  });

  it('resolves nested shortcodes across multiple passes', () => {
    // outer keeps content; inner button resolves to an anchor
    const r = resolveShortcodes('[vc_row][button url="/go"]Go[/button][/vc_row]');
    expect(r.content).toBe('<a href="/go" class="button">Go</a>');
  });

  it('reports the resolved actions taken', () => {
    const r = resolveShortcodes('[button url="/a"]A[/button][weird /]');
    const actions = Object.fromEntries(r.resolved.map((x) => [x.tag, x.action]));
    expect(actions.button).toBe('builtin');
    expect(actions.weird).toBe('comment');
  });

  it('leaves plain content untouched and reports nothing', () => {
    const r = resolveShortcodes('no shortcodes here at all');
    expect(r.content).toBe('no shortcodes here at all');
    expect(r.resolved).toHaveLength(0);
    expect(r.unresolved).toHaveLength(0);
  });
});
