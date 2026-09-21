import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // El webhook de WhatsApp valida la firma HMAC sobre el cuerpo crudo:
  // ninguna capa intermedia puede reescribir el body.
  serverExternalPackages: ["pino"],
};

export default nextConfig;
