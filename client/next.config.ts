import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@vault/shared'],
  async rewrites() {
    const serverUrl =
      process.env['SERVER_URL'] ||
      process.env['NEXT_PUBLIC_API_URL']?.replace(/\/api\/?$/, '') ||
      'http://localhost:5000';
    return [
      {
        source: '/api/:path*',
        destination: `${serverUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
