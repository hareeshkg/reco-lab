import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { readEnv } from "./env";

export function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

export function encrypt(value: string, key = readEnv().APP_ENCRYPTION_KEY) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), nonce);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [nonce, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString("base64url"))
    .join(".");
}

export function decrypt(value: string, key = readEnv().APP_ENCRYPTION_KEY) {
  const [nonce, tag, encrypted] = value
    .split(".")
    .map((part) => Buffer.from(part, "base64url"));
  if (!nonce || !tag || !encrypted) throw new Error("INVALID_ENCRYPTED_VALUE");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(key, "hex"),
    nonce,
  );
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8",
  );
}

export function equalSecret(left: string, right: string) {
  return timingSafeEqual(Buffer.from(sha256(left)), Buffer.from(sha256(right)));
}
