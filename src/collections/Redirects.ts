import type { CollectionConfig } from 'payload';

// Populated automatically by Posts' afterChange hook when a published slug
// changes. cashlo-final reads this collection to serve 301s for old URLs.
export const Redirects: CollectionConfig = {
  slug: 'redirects',
  access: { read: () => true },
  admin: { useAsTitle: 'from' },
  fields: [
    { name: 'from', type: 'text', required: true, unique: true, index: true },
    {
      name: 'to',
      type: 'group',
      fields: [{ name: 'url', type: 'text', required: true }],
    },
  ],
};
