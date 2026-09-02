export function nodeHttpBody(bytes: Buffer): BodyInit {
  // SAFETY: Node Response accepts Buffer. TypeScript lib.dom BodyInit does not include Buffer.
  return bytes as BodyInit;
}
