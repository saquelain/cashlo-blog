import type { CollectionConfig } from 'payload';

// Maps 1:1 onto Harender's SEO requirements doc (2026-09-21 email).
// MANUAL fields are editable in the admin UI below.
// AUTOMATIC items are handled either by a hook here, by the @payloadcms/plugin-seo
// tab injected via `fields`, or by the consuming frontend (cashlo-final) at
// render time — see the comment on each automatic item for where it lives.

const ROBOTS_OPTIONS = [
  { label: 'Index, Follow (default)', value: 'index,follow' },
  { label: 'Noindex, Follow', value: 'noindex,follow' },
  { label: 'Index, Nofollow', value: 'index,nofollow' },
  { label: 'Noindex, Nofollow', value: 'noindex,nofollow' },
];

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-');

export const Posts: CollectionConfig = {
  slug: 'posts',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'category', '_status', 'publishedAt'],
  },
  access: {
    read: ({ req: { user } }) => {
      // Public (unauthenticated) requests only ever see published posts;
      // logged-in CMS users see everything, including drafts/scheduled.
      if (user) return true;
      return { _status: { equals: 'published' } };
    },
  },
  versions: {
    drafts: {
      autosave: { interval: 1000 },
      // Built-in Payload feature — this alone covers "Schedule Publishing":
      // an editor sets a future publish date and Payload flips the doc to
      // published automatically at that time (needs the scheduled-publish
      // job enabled in payload.config.ts).
      schedulePublish: true,
    },
    maxPerDoc: 20,
  },
  hooks: {
    beforeValidate: [
      ({ data }) => {
        if (data && !data.slug && data.title) {
          data.slug = slugify(data.title);
        } else if (data?.slug) {
          data.slug = slugify(data.slug);
        }
        return data;
      },
    ],
    beforeChange: [
      ({ data }) => {
        // Reading Time (automatic) — derived from the lexical content's
        // approximate word count, ~200 wpm. Recomputed on every save so
        // editors never have to fill this in by hand.
        if (data?.content) {
          const text = JSON.stringify(data.content);
          const wordCount = text.split(/\s+/).filter(Boolean).length;
          data.readingTimeMinutes = Math.max(1, Math.round(wordCount / 200));
        }
        return data;
      },
    ],
    afterChange: [
      async ({ doc, previousDoc, req }) => {
        // 301 Redirect on Slug Change (automatic) — if a published post's
        // slug changes, record the old -> new mapping in the `redirects`
        // collection so cashlo-final's middleware can 301 old URLs instead
        // of 404ing them.
        if (previousDoc?.slug && previousDoc.slug !== doc.slug) {
          await req.payload.create({
            collection: 'redirects',
            data: {
              from: `/blog/${previousDoc.slug}`,
              to: { url: `/blog/${doc.slug}` },
            },
          });
        }
      },
    ],
  },
  fields: [
    // --- MANUAL: Basic content ---
    { name: 'title', type: 'text', required: true },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: { description: 'Auto-generated from the title. Edit to override (Slug Override).' },
    },
    { name: 'excerpt', type: 'textarea', required: true, maxLength: 500 },
    {
      name: 'content',
      type: 'richText',
      required: true,
    },
    {
      name: 'featuredImage',
      type: 'upload',
      relationTo: 'media',
      required: true,
      admin: { description: 'Alt text is set on the media asset itself once uploaded.' },
    },
    {
      name: 'author',
      type: 'relationship',
      relationTo: 'users',
      required: true,
    },
    {
      name: 'category',
      type: 'relationship',
      relationTo: 'categories',
      required: true,
    },
    {
      name: 'tags',
      type: 'array',
      fields: [{ name: 'tag', type: 'text', required: true }],
    },

    // --- MANUAL: FAQ Content ---
    {
      name: 'faqsTitle',
      type: 'text',
      defaultValue: 'Frequently Asked Questions',
    },
    {
      name: 'faqs',
      type: 'array',
      fields: [
        { name: 'question', type: 'text', required: true },
        { name: 'answer', type: 'richText', required: true },
      ],
    },

    // --- MANUAL: Internal Links ---
    {
      name: 'internalLinks',
      type: 'array',
      admin: { description: 'Hand-picked links to other posts/pages to surface in-content or in a sidebar block.' },
      fields: [
        { name: 'label', type: 'text', required: true },
        { name: 'url', type: 'text', required: true },
      ],
    },

    // --- MANUAL: Related Blogs (manual override; automatic fallback lives in cashlo-final) ---
    {
      name: 'relatedPosts',
      type: 'relationship',
      relationTo: 'posts',
      hasMany: true,
      maxRows: 3,
      admin: { description: 'Leave empty to let the frontend auto-pick recent posts from the same category.' },
    },

    // --- MANUAL: Advanced SEO overrides not covered by the SEO plugin tab ---
    {
      type: 'collapsible',
      label: 'Advanced SEO',
      fields: [
        {
          name: 'focusKeyword',
          type: 'text',
          admin: { description: 'Reference only for the editor — not rendered on the page.' },
        },
        {
          name: 'canonicalUrlOverride',
          type: 'text',
          admin: { description: 'Leave empty to use the default https://www.cashlo.app/blog/<slug> canonical URL.' },
        },
        {
          name: 'robots',
          type: 'select',
          defaultValue: 'index,follow',
          options: ROBOTS_OPTIONS,
        },
        {
          name: 'robotsNoarchive',
          type: 'checkbox',
          defaultValue: false,
          label: 'Add noarchive',
        },
      ],
    },

    // --- AUTOMATIC (read-only, computed): Reading Time ---
    {
      name: 'readingTimeMinutes',
      type: 'number',
      admin: { readOnly: true, position: 'sidebar', description: 'Auto-calculated on save.' },
    },

    // --- MANUAL: Publish scheduling date; AUTOMATIC: Published/Modified Date ---
    {
      name: 'publishedAt',
      type: 'date',
      admin: {
        position: 'sidebar',
        date: { pickerAppearance: 'dayAndTime' },
        description: 'Set a future date + use the "Schedule" publish action to schedule this post.',
      },
    },
    // `updatedAt` (Modified Date) and `createdAt` are added automatically by
    // Payload on every collection — no field needed here.
  ],
};

/*
 * AUTOMATIC items NOT represented as fields above, because they are computed
 * at request time by the consuming frontend (cashlo-final) rather than stored
 * on the document — listed here so nobody re-implements them as fields:
 *
 * - Breadcrumb / Breadcrumb Schema        -> rendered in cashlo-final from the
 *                                            category + slug already on the doc.
 * - BlogPosting/Article Schema            -> JSON-LD built in cashlo-final from
 *                                            title/excerpt/featuredImage/author/dates.
 * - FAQ Schema                            -> JSON-LD built from the `faqs` array above.
 * - Author Schema                         -> JSON-LD built from the `author` relationship.
 * - Canonical URL / OG Tags / Twitter Tags-> handled by @payloadcms/plugin-seo
 *   (see payload.config.ts) with `canonicalUrlOverride`/`robots` above as escape hatches.
 * - XML Sitemap / Sitemap Updates         -> generated by cashlo-final's
 *   app/sitemap.ts, querying published posts via the Local API.
 * - 404 Monitoring / Broken Link Detection-> external tooling (see CLAUDE.md), not a CMS field.
 */
