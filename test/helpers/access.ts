import { SignJWT, exportJWK, generateKeyPair } from "jose";

export const TEAM_DOMAIN = "https://test-team.cloudflareaccess.com";
export const AUDIENCE = "test-audience";

export async function makeAccessKey() {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key-1";
  jwk.alg = "ES256";
  return { privateKey, publicJwk: jwk };
}

export async function makeAccessToken(
  privateKey: CryptoKey,
  claims: { email: string; aud?: string; iss?: string },
) {
  return new SignJWT({ email: claims.email })
    .setProtectedHeader({ alg: "ES256", kid: "test-key-1" })
    .setIssuedAt()
    .setIssuer(claims.iss ?? TEAM_DOMAIN)
    .setAudience(claims.aud ?? AUDIENCE)
    .setExpirationTime("5m")
    .sign(privateKey);
}

export function accessHeaders(token: string): Record<string, string> {
  return { "Cf-Access-Jwt-Assertion": token };
}
