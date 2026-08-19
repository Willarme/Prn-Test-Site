/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Runtime-read data files must ship inside the serverless bundle.
  outputFileTracingIncludes: {
    "/**": ["./data/seo-factory-policy.json"],
  },
};

export default nextConfig;
