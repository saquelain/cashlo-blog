import type { CollectionConfig } from 'payload';

// Covers: Featured Image, Image Alt Text, Image Compression, WebP/AVIF,
// Responsive Images (via Payload's imageSizes + Sharp, generated automatically
// on upload — no manual admin work needed for the resize/format part).
export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    read: () => true, // public site needs to fetch images without auth
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
    // Each size needs its OWN `formatOptions` — the top-level one below
    // only converts the original/base image; Payload does not fall back to
    // it per size (confirmed against Payload's own resize source), so
    // without repeating it here, thumbnail/card/og were silently being
    // generated in the source's original format (jpeg/png), never webp.
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
