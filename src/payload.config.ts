import path from 'path';
import { fileURLToPath } from 'url';
import { mongooseAdapter } from '@payloadcms/db-mongodb';
import { lexicalEditor, EXPERIMENTAL_TableFeature } from '@payloadcms/richtext-lexical';
import { seoPlugin } from '@payloadcms/plugin-seo';
import { s3Storage } from '@payloadcms/storage-s3';
import { buildConfig } from 'payload';

import { Users } from './collections/Users';
import { Media } from './collections/Media';
import { Categories } from './collections/Categories';
import { Posts } from './collections/Posts';
import { Redirects } from './collections/Redirects';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

export default buildConfig({
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
    features: ({ defaultFeatures }) => [...defaultFeatures, EXPERIMENTAL_TableFeature()],
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
      // Auto-generates the SEO tab (title/description/OG image) on Posts,
      // pre-filled from title/excerpt/featuredImage but editable per-post —
      // this covers "SEO Title", "Meta Description" and "OG Override".
      generateTitle: ({ doc }: any) => (doc?.title ? `${doc.title} | Cashlo` : 'Cashlo'),
      generateDescription: ({ doc }: any) => doc?.excerpt || '',
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
