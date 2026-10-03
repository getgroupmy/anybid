import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extensionFor, imageKeyFor, sniffImageType } from './images.ts';

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const WEBP = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
]);

const bytes = (s: string) => new TextEncoder().encode(s);

describe('sniffImageType', () => {
  it('recognises the formats we serve', () => {
    assert.equal(sniffImageType(JPEG), 'image/jpeg');
    assert.equal(sniffImageType(PNG), 'image/png');
    assert.equal(sniffImageType(WEBP), 'image/webp');
  });

  it('rejects SVG, which is a scriptable document rather than a bitmap', () => {
    // The bucket is served from our own domain, so storing this would be a
    // stored cross-site scripting hole, not merely a wrong file type.
    assert.equal(sniffImageType(bytes('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')), null);
    assert.equal(sniffImageType(bytes('<?xml version="1.0"?><svg/>')), null);
  });

  it('rejects anything else that might be served back to a browser', () => {
    assert.equal(sniffImageType(bytes('<!doctype html><script>alert(1)</script>')), null);
    assert.equal(sniffImageType(bytes('GIF89a')), null, 'GIF is not in the allowlist');
    assert.equal(sniffImageType(bytes('%PDF-1.7')), null);
    assert.equal(sniffImageType(Uint8Array.from([0x4d, 0x5a])), null, 'DOS/PE executable');
  });

  it('does not read past the end of a short buffer', () => {
    assert.equal(sniffImageType(new Uint8Array(0)), null);
    // A truncated PNG signature and a truncated RIFF header: both are prefixes
    // of something valid, and neither may be accepted.
    assert.equal(sniffImageType(PNG.subarray(0, 7)), null);
    assert.equal(sniffImageType(WEBP.subarray(0, 11)), null);
    assert.equal(sniffImageType(JPEG.subarray(0, 2)), null);
  });

  it('believes the bytes, not the sender', () => {
    // A caller labelling a PNG as "image/jpeg" gets png: the declared
    // mimetype never reaches this function, which is the point.
    assert.equal(sniffImageType(PNG), 'image/png');
    // RIFF that is not WEBP — a WAV file — must not pass as an image.
    const wav = Uint8Array.from([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ]);
    assert.equal(sniffImageType(wav), null);
  });
});

describe('imageKeyFor', () => {
  it('scopes the key to the uploader and ends in the real extension', () => {
    const key = imageKeyFor('user123', 'image/webp');
    assert.match(key, /^listings\/user123\/[0-9a-f]{32}\.webp$/);
  });

  it('never lets a caller steer the path', () => {
    // A user id is ours, not the client's — but neither it nor the discarded
    // filename may produce traversal or a nested path.
    const key = imageKeyFor('../../etc/passwd', 'image/jpeg');
    assert.ok(!key.includes('..'), `traversal survived: ${key}`);
    assert.equal(key.split('/').length, 3, `unexpected depth: ${key}`);
    assert.match(key, /^listings\/etcpasswd\/[0-9a-f]{32}\.jpg$/);
  });

  it('gives every upload its own key, so nothing is overwritten', () => {
    const keys = new Set(
      Array.from({ length: 200 }, () => imageKeyFor('same-user', 'image/png')),
    );
    assert.equal(keys.size, 200);
  });
});

describe('extensionFor', () => {
  it('uses jpg rather than jpeg, matching the content type to one spelling', () => {
    assert.equal(extensionFor('image/jpeg'), 'jpg');
    assert.equal(extensionFor('image/png'), 'png');
    assert.equal(extensionFor('image/webp'), 'webp');
  });
});
