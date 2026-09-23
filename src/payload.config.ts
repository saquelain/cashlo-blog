import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { mongooseAdapter } from '@payloadcms/db-mongodb';
import { lexicalEditor, EXPERIMENTAL_TableFeature, UploadFeature, FixedToolbarFeature } from '@payloadcms/richtext-lexical';
import { seoPlugin } from '@payloadcms/plugin-seo';
import { s3Storage } from '@payloadcms/storage-s3';
import { buildConfig } from 'payload';

import { Users } from './collections/Users';
import { Media } from './collections/Media';
import { Categories } from './collections/Categories';
import { Posts, postsAdvancedSeoFields } from './collections/Posts';
import { Redirects } from './collections/Redirects';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

export default buildConfig({
  // Payload 3 doesn't pick up `sharp` just from it being a dependency — it
  // must be handed in explicitly, or every `imageSizes`/`formatOptions`
  // config on an upload collection (Media.ts) silently no-ops (logged only
  // as a easy-to-miss startup warning, not an error). Every image uploaded
  // before this line existed was stored completely unprocessed — original
  // format, original dimensions, no thumbnail/card/og/cardAvif sizes at
  // all — regardless of what Media.ts's config said.
  sharp,
  admin: {
    user: Users.slug,
  },
  collections: [Users, Media, Categories, Posts, Redirects],
  // Table support (/table slash command, and pasting an HTML/Google Docs
  // table in as an actual table instead of flattened text) isn't in
  // Payload's default Lexical feature set — EXPERIMENTAL_TableFeature is an
  // opt-in "recommended default" per Payload's own docs, not actually
  // unstable; @payloadcms/richtext-lexical's defaultHTMLConverters already
  // knows how to render its TableNode to <table>, so Posts.ts's toHTML()
  // needs no changes to pick this up.
  editor: lexicalEditor({
    features: ({ defaultFeatures }) => [
      // Swap the default UploadFeature (no per-image controls) for one with
      // `displayWidth`/`alignment` fields, so editors can size and position
      // an inline image instead of it always rendering full-width, centered
      // — Posts.ts's custom HTML converter (see its comment) reads both to
      // build the output.
      ...defaultFeatures.filter((feature) => feature.key !== 'upload'),
      UploadFeature({
        collections: {
          media: {
            fields: [
              {
                name: 'displayWidth',
                type: 'select',
                defaultValue: 'full',
                options: [
                  { label: 'Small', value: 'small' },
                  { label: 'Medium', value: 'medium' },
                  { label: 'Full width (default)', value: 'full' },
                ],
                admin: {
                  description: 'How wide this image renders on the published post. Click the image in the editor to change it.',
                },
              },
              {
                name: 'alignment',
                type: 'select',
                defaultValue: 'center',
                options: [
                  { label: 'Left', value: 'left' },
                  { label: 'Center (default)', value: 'center' },
                  { label: 'Right', value: 'right' },
                ],
                admin: {
                  description:
                    'Left/Right only has a visible effect on a Small or Medium image — a Full width image has no room beside it to align within.',
                },
              },
              {
                name: 'wrapText',
                type: 'checkbox',
                defaultValue: true,
                admin: {
                  description: 'Only applies when Alignment is Left or Right. On: body text flows around the image. Off: the image sits to that side on its own line, text continues below it as normal.',
                  condition: (_: unknown, siblingData: { alignment?: string }) =>
                    siblingData?.alignment === 'left' || siblingData?.alignment === 'right',
                },
              },
            ],
          },
        },
      }),
      EXPERIMENTAL_TableFeature(),
      // Payload's default is InlineToolbarFeature only — a popup that
      // appears near selected text, not a persistent bar. FixedToolbarFeature
      // adds the always-visible toolbar (Bold, headings, table, etc.) above
      // the content field that editors expect to see without first
      // selecting text.
      FixedToolbarFeature(),
    ],
  }),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: mongooseAdapter({
    // IMPORTANT: this must point at a database SEPARATE from cashlo-backend's
    // main DB (see CLAUDE.md "Database isolation"). Do not reuse the same
    // database name as cashlo-backend's MONGO_URI.
    url: process.env.DATABASE_URI || '',
  }),
  plugins: [
    seoPlugin({
      collections: ['posts'],
      uploadsCollection: 'media',
      // Without this, the plugin appends its SEO fields flatly onto the end
      // of the fields array instead of as an actual tab — it only merges
      // into Posts.ts's own `tabs` field (fields[0]) when tabbedUI is on.
      tabbedUI: true,
      // Auto-generates the SEO tab (title/description/OG image) on Posts,
      // pre-filled from title/excerpt/featuredImage but editable per-post —
      // this covers "SEO Title", "Meta Description" and "OG Override".
      generateTitle: ({ doc }: any) => (doc?.title ? `${doc.title} | Cashlo` : 'Cashlo'),
      generateDescription: ({ doc }: any) => doc?.excerpt || '',
      // Appends Posts.ts's focusKeyword/canonicalUrlOverride/robots/
      // robotsNoarchive fields onto this same auto-generated SEO tab, so
      // every SEO control lives in one place instead of splitting "basic"
      // SEO here and "Advanced SEO" in a separate collapsible on the Write
      // tab. Runs for every collection this plugin covers (only `posts`
      // here), so it's safe to always append.
      fields: ({ defaultFields }: any) => [...defaultFields, ...postsAdvancedSeoFields],
    }),
    // Reuses the same Cloudflare R2 account/bucket cashlo-backend already
    // uploads blog/Aadhaar images to (see cashlo-backend/src/services/s3.service.js),
    // scoped to its own `cms-media/` prefix so the two never collide.
    s3Storage({
      collections: {
        media: {
          prefix: 'cms-media',
          // R2's public bucket URL, not the private S3 endpoint below —
          // matches cashlo-backend's getPublicUrl() convention.
          generateFileURL: ({ filename, prefix }) =>
            `${process.env.R2_PUBLIC_URL}/${prefix ? `${prefix}/` : ''}${filename}`,
        },
      },
      // Without this, Payload writes every upload to local disk in ADDITION
      // to R2, regardless of whether the R2 leg succeeds — on Vercel's
      // serverless runtime that local copy is ephemeral and vanishes
      // between invocations, but the Media doc still gets created as if the
      // upload fully succeeded. That's exactly how one blog post ended up
      // with a Media record pointing at an R2 URL that 404s: the file only
      // ever existed on local disk (from a local dev session) and was later
      // deleted, with no surviving R2 copy. With local storage disabled,
      // Payload surfaces an R2 upload failure as a real error instead of
      // silently succeeding with a broken reference.
      disableLocalStorage: true,
      bucket: process.env.R2_BUCKET_NAME || 'cashlo-media',
      config: {
        region: 'auto',
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
        },
      },
    }),
  ],
  // Required so `versions.drafts.schedulePublish` on Posts actually flips
  // scheduled drafts to published at the target time.
  //
  // `autoRun`'s internal timer only fires on a long-running Node process —
  // it does NOT work on Vercel's serverless runtime (no process stays alive
  // between requests), so it's kept here only as a harmless fallback for
  // self-hosted/local use. The real trigger in production is an external
  // cron (Render Cron Job) hitting GET /api/payload-jobs/run directly —
  // see CLAUDE.md "Scheduled Publishing".
  jobs: {
    tasks: [],
    autoRun: [
      {
        cron: '*/5 * * * *', // every 5 minutes
        limit: 10,
        queue: 'default',
      },
    ],
    access: {
      // The run endpoint has no logged-in user when hit by an external
      // cron — authenticate it with a shared secret instead (query param,
      // since Payload's /run endpoint is deliberately a GET so it can be
      // used by simple cron pingers that can't send custom headers).
      run: ({ req }) => {
        const secret = req.query?.cronSecret;
        return Boolean(secret) && secret === process.env.CRON_SECRET;
      },
    },
  },
});
