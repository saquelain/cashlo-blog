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
    imageSizes: [
      { name: 'thumbnail', width: 400, height: 300, position: 'centre' },
      { name: 'card', width: 768, height: 480, position: 'centre' },
      { name: 'og', width: 1200, height: 630, position: 'centre' },
    ],
    adminThumbnail: 'thumbnail',
    formatOptions: { format: 'webp', options: { quality: 80 } },
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  },
};
