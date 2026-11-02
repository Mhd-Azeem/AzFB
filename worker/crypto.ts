const encoder = new TextEncoder();
export function hex(bytes: ArrayBuffer | Uint8Array) {
  return Array.from(new Uint8Array(bytes instanceof Uint8Array ? bytes : bytes))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export function randomToken() {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}
export async function sha(value: string | ArrayBuffer) {
  return hex(
    await crypto.subtle.digest(
      "SHA-256",
      typeof value === "string" ? encoder.encode(value) : value,
    ),
  );
}
export function equal(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
export async function hmac(secret: string, value: string | ArrayBuffer) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(
    await crypto.subtle.sign(
      "HMAC",
      key,
      typeof value === "string" ? encoder.encode(value) : value,
    ),
  );
}
// Workers Web Crypto caps PBKDF2 at 100,000 iterations. A separate server pepper
// prevents a stolen D1 snapshot from enabling offline password guessing by itself.
export async function hashPassword(
  password: string,
  pepper: string,
  salt = randomToken(),
) {
  const input = await hmac(pepper, password);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(input),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(salt),
      iterations: 100000,
      hash: "SHA-256",
    },
    key,
    256,
  );
  return `pbkdf2-sha256$100000$${salt}$${hex(bits)}`;
}
export async function verifyPassword(
  password: string,
  hash: string,
  pepper: string,
) {
  const parts = hash.split("$");
  if (
    parts.length !== 4 ||
    parts[0] !== "pbkdf2-sha256" ||
    parts[1] !== "100000"
  )
    return false;
  return equal(await hashPassword(password, pepper, parts[2]), hash);
}
function decodeKey(secret: string) {
  const raw = Uint8Array.from(atob(secret), (c) => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error("Encryption key must be 32 bytes.");
  return raw;
}
export async function encrypt(secret: string, plaintext: string, aad: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    decodeKey(secret),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(aad) },
    key,
    encoder.encode(plaintext),
  );
  return `v1.${btoa(String.fromCharCode(...iv))}.${btoa(String.fromCharCode(...new Uint8Array(encrypted)))}`;
}
export async function decrypt(secret: string, payload: string, aad: string) {
  const [version, iv, data] = payload.split(".");
  if (version !== "v1" || !iv || !data)
    throw new Error("Invalid encrypted token.");
  const key = await crypto.subtle.importKey(
    "raw",
    decodeKey(secret),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const result = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: Uint8Array.from(atob(iv), (c) => c.charCodeAt(0)),
      additionalData: encoder.encode(aad),
    },
    key,
    Uint8Array.from(atob(data), (c) => c.charCodeAt(0)),
  );
  return new TextDecoder().decode(result);
}
export async function verifySignature(
  secret: string,
  raw: ArrayBuffer,
  signature: string | null,
) {
  if (!signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  return equal(signature.slice(7), await hmac(secret, raw));
}
