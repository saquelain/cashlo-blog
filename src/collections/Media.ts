import type { CollectionConfig } from 'payload';
import { APIError } from 'payload';
import sharp from 'sharp';

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2MB
// Matches `upload.formatOptions`' webp quality below — encoding our
// compression attempts at the same quality Payload itself will apply to the
// stored original means the size we measure here is a realistic preview of
// what actually lands in R2, not a guess a later re-encode could blow past.
const COMPRESS_QUALITY = 80;
// Floor width so auto-compression never shrinks a blog image below what the
// biggest generated size (`hero`, 1600w) would want — below this we trade
// quality instead of further dimensions.
const MIN_WIDTH = 480;

// Progressively resizes an oversized image (then, if still too big at the
// floor width, drops quality) until the re-encoded webp buffer fits under
// `maxBytes` — so an editor never has to manually compress/re-export an
// image and retry the upload; this just makes it fit. Returns null only if
// even the smallest/lowest-quality attempt can't get under the limit.
async function compressBelowLimit(buffer: Buffer, maxBytes: number): Promise<Buffer | null> {
  const { width: originalWidth } = await sharp(buffer).metadata();
  let width = originalWidth ?? 1600;

  while (width >= MIN_WIDTH) {
    const output = await sharp(buffer)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: COMPRESS_QUALITY })
      .toBuffer();
    if (output.length <= maxBytes) return output;
    width = Math.round(width * 0.85);
  }

  for (const quality of [60, 40, 20]) {
    const output = await sharp(buffer)
      .resize({ width: MIN_WIDTH, withoutEnlargement: true })
      .webp({ quality })
      .toBuffer();
    if (output.length <= maxBytes) return output;
  }
  return null;
}

// Covers: Featured Image, Image Alt Text, Image Compression, WebP/AVIF,
// Responsive Images (via Payload's imageSizes + Sharp, generated automatically
// on upload — no manual admin work needed for the resize/format part).
export const Media: CollectionConfig = {
  slug: 'media',
  labels: { singular: 'Media', plural: 'Media Library' },
  admin: { group: 'Content' },
  access: {
    read: () => true, // public site needs to fetch images without auth
  },
  hooks: {
    // There's no per-collection file-size option on Payload's UploadConfig
    // (confirmed against its type defs) — this is the documented way to
    // enforce one. Runs before the file is handed to the S3/R2 adapter, for
    // both `create` (new upload) and `update` (replacing an existing Media
    // doc's file), so an oversized file never reaches storage. Covers every
    // upload path that goes through this collection — the admin panel's own
    // upload UI, the Lexical editor's inline image feature, and the REST
    // API directly — since they all funnel through this same create/update
    // operation, not just one of them.
    beforeOperation: [
      async ({ req, operation }) => {
        if ((operation !== 'create' && operation !== 'update') || !req.file) return;
        if (req.file.size <= MAX_UPLOAD_BYTES) return;

        const { pages } = await sharp(req.file.data).metadata();
        if (pages && pages > 1) {
          // Animated (GIF / animated WebP) — re-encoding through the static
          // pipeline below would silently collapse it to a single frame,
          // changing the asset in a way the editor didn't ask for. Rare for
          // blog content, so this still asks for a manual resize rather than
          // guessing what to keep.
          throw new APIError(
            `Animated image is too large (${(req.file.size / (1024 * 1024)).toFixed(1)}MB). Maximum allowed size is 2MB — please resize/compress it manually before uploading.`,
            400,
          );
        }

        const compressed = await compressBelowLimit(req.file.data, MAX_UPLOAD_BYTES);
        if (!compressed) {
          throw new APIError(
            `Image (${(req.file.size / (1024 * 1024)).toFixed(1)}MB) couldn't be compressed under the 2MB limit — please use a smaller image.`,
            400,
          );
        }

        req.file.data = compressed;
        req.file.size = compressed.length;
        req.file.mimetype = 'image/webp';
        req.file.name = req.file.name.replace(/\.[^.]+$/, '') + '.webp';
      },
    ],
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
      admin: {
        description: 'Required — used as the <img alt> tag for accessibility and image SEO.',
      },
    },
  ],
  upload: {
    // Lets an editor drag a crosshair over the uploaded image (in its admin
    // detail view) marking the actual subject. Whenever a crop's aspect
    // ratio doesn't match the source image's own aspect ratio — true for
    // basically every size here unless the upload happens to already be
    // exactly 16:10 — Payload centers the crop on that point instead of the
    // image's literal center. Without this, `position: 'centre'` below is
    // taken completely literally: an off-center subject (common — portrait
    // photos, group shots, product-in-corner shots) gets cropped away on
    // the tighter sizes (card, thumbnail) no matter how the source was
    // composed. This is the actual fix for "the listing card is cutting off
    // the wrong part of my photo" — switching the card to `object-fit:
    // contain` was the other option, but that either letterboxes every card
    // with empty bars or forces the grid to variable-height, which is why
    // basically no blog platform does that for grid thumbnails.
    focalPoint: true,
    // Each size needs its OWN `formatOptions` — the top-level one below
    // only converts the original/base image; Payload does not fall back to
    // it per size (confirmed against Payload's own resize source), so
    // without repeating it here, thumbnail/card/og were silently being
    // generated in the source's original format (jpeg/png), never webp.
    //
    // `position: 'centre'` below is now effectively just the fallback for
    // an upload with no focal point set (Payload defaults focalX/focalY to
    // 50/50, i.e. dead-center, until an editor moves it) — focalPoint above
    // is what actually drives the crop once one is set.
    imageSizes: [
      { name: 'thumbnail', width: 400, height: 300, position: 'centre', formatOptions: { format: 'webp', options: { quality: 80 } } },
      { name: 'card', width: 768, height: 480, position: 'centre', formatOptions: { format: 'webp', options: { quality: 80 } } },
      { name: 'og', width: 1200, height: 630, position: 'centre', formatOptions: { format: 'webp', options: { quality: 80 } } },
      // Full-width banner at the top of a blog post (cashlo-final spans it
      // edge-to-edge across the TOC/content/sidebar grid) — wider than
      // `card`/`og` need, since it's rendered much larger on screen.
      { name: 'hero', width: 1600, height: 1000, position: 'centre', formatOptions: { format: 'webp', options: { quality: 80 } } },
      // AVIF siblings of `card` and `hero` — the two sizes cashlo-final
      // actually swaps into a <picture> element (the blog listing grid, and
      // every post's own hero banner — its highest-visibility image, seen
      // by every reader). Not duplicating thumbnail/og as AVIF too: og:image
      // is read by social-media crawlers that often mishandle even WebP, so
      // it deliberately stays on the plain webp/original fallback chain;
      // thumbnail is a small sidebar-only image where the extra storage
      // isn't worth it.
      { name: 'cardAvif', width: 768, height: 480, position: 'centre', formatOptions: { format: 'avif' } },
      { name: 'heroAvif', width: 1600, height: 1000, position: 'centre', formatOptions: { format: 'avif' } },
    ],
    adminThumbnail: 'thumbnail',
    formatOptions: { format: 'webp', options: { quality: 80 } },
    // `image/avif` is here for the generated `cardAvif` size's own output,
    // not for uploads — Payload validates every generated image size's
    // resulting MIME type against this same allowlist, so without it any
    // upload that's large enough to actually produce a cardAvif size fails
    // validation on that size and the whole upload is rejected.
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'],
  },
};
