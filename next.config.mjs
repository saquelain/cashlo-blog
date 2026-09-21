import { withPayload } from '@payloadcms/next/withPayload';

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      // R2 bucket used for media uploads — matches the pattern already used
      // by cashlo-backend for blog/Aadhaar image uploads.
      { protocol: 'https', hostname: '**.r2.dev' },
      { protocol: 'https', hostname: '**.r2.cloudflarestorage.com' },
    ],
  },
};

export default withPayload(nextConfig, { devBundleServerPackages: false });
