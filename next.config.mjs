/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'www.abbott.com' },
      { protocol: 'https', hostname: 'electrophysiology.abbott.com' },
      { protocol: 'https', hostname: 'idnet.bayer.com' },
      { protocol: 'https', hostname: 'regeneronpharmaceuticalsinc.gcs-web.com' },
    ],
  },
};
export default nextConfig;
