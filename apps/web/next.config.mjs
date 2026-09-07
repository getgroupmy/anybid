/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@anybid/shared'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'picsum.photos' },
      { protocol: 'https', hostname: '**' },
    ],
  },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
