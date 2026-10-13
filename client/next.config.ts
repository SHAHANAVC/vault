import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@vault/shared'],
  async rewrites() {
    const serverUrl = process.env['SERVER_URL'] || 'http://localhost:5000';
    return [
      {
        source: '/api/:path*',
        destination: `${serverUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
