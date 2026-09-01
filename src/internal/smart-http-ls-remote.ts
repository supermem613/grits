import { GritsError } from "../api/errors.js";

export type RemoteRef = {
  name: string;
  oid: string;
};

export type LsRemoteResult = {
  refs: RemoteRef[];
  capabilities: string[];
};

export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: Uint8Array;
  },
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export async function defaultFetch(
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: Uint8Array;
  },
): Promise<{
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}> {
  return globalThis.fetch(url, {
    method: init?.method,
    headers: init?.headers,
    // SAFETY: Node fetch accepts a Uint8Array body. lib.dom BodyInit rejects Uint8Array<ArrayBufferLike>.
    body: init?.body as BodyInit | undefined,
  });
}

// gitprotocol-common: pkt-line length is four hex digits. Payload max is 65516 bytes, so the
// encoded line is at most 65520 bytes including the length header.
const PKT_LINE_MAX = 65520;
const SERVICE = "git-upload-pack";

function fail(code: GritsError["code"], message: string): never {
  throw new GritsError(code, message, "lsRemoteHttps");
}

function normalizeHttpUrl(repositoryUrl: string): string {
  if (/^https?:\/\/[^/@]+@/i.test(repositoryUrl)) {
    fail("NYI", "NYI: lsRemoteHttps does not send credentials.");
  }
  if (!/^https?:\/\//i.test(repositoryUrl)) {
    fail("INVALID_CONFIG", "lsRemoteHttps requires an http or https URL.");
  }
  return repositoryUrl.replace(/\/+$/, "");
}

function readPktLines(buffer: Buffer): Array<Buffer | null> {
  const lines: Array<Buffer | null> = [];
  let offset = 0;
  while (offset + 4 <= buffer.length) {
    const lengthText = buffer.subarray(offset, offset + 4).toString("ascii");
    const length = Number.parseInt(lengthText, 16);
    if (!Number.isInteger(length) || length < 0) {
      fail("REPOSITORY_UNAVAILABLE", "Smart HTTP advertisement has an invalid pkt-line length.");
    }
    if (length === 0) {
      lines.push(null);
      offset += 4;
      continue;
    }
    if (length < 4 || length > PKT_LINE_MAX || offset + length > buffer.length) {
      fail("REPOSITORY_UNAVAILABLE", "Smart HTTP advertisement has an invalid pkt-line.");
    }
    lines.push(buffer.subarray(offset + 4, offset + length));
    offset += length;
  }
  if (offset !== buffer.length) {
    fail("REPOSITORY_UNAVAILABLE", "Smart HTTP advertisement has trailing pkt-line bytes.");
  }
  return lines;
}

function lineText(line: Buffer): string {
  return line.toString("utf8").replace(/\n$/, "");
}

function encodePkt(payload: string): Buffer {
  const body = Buffer.from(payload, "utf8");
  if (body.length + 4 > PKT_LINE_MAX) {
    fail("REPOSITORY_UNAVAILABLE", "Smart HTTP pkt-line exceeds the protocol maximum.");
  }
  const length = (body.length + 4).toString(16).padStart(4, "0");
  return Buffer.concat([Buffer.from(length, "ascii"), body]);
}

function parseAdvertisement(buffer: Buffer): { version: 1 | 2; refs: RemoteRef[]; capabilities: string[] } {
  const lines = readPktLines(buffer);
  let index = 0;
  while (index < lines.length && lines[index] === null) {
    index += 1;
  }
  const banner = lines[index];
  if (banner === undefined || banner === null) {
    fail("REPOSITORY_UNAVAILABLE", "Smart HTTP advertisement is empty.");
  }
  const bannerText = lineText(banner);
  if (bannerText !== `# service=${SERVICE}`) {
    fail("REPOSITORY_UNAVAILABLE", "Smart HTTP advertisement is not git-upload-pack.");
  }
  index += 1;
  if (lines[index] !== null) {
    fail("REPOSITORY_UNAVAILABLE", "Smart HTTP advertisement is missing the service flush.");
  }
  index += 1;

  const refs: RemoteRef[] = [];
  const capabilities: string[] = [];
  const first = lines[index];
  if (first === undefined || first === null) {
    return { version: 1, refs, capabilities };
  }
  const firstText = lineText(first);
  if (firstText === "version 2") {
    index += 1;
    while (index < lines.length) {
      const line = lines[index];
      index += 1;
      if (line === null) {
        break;
      }
      const capability = lineText(line).trim();
      if (capability.length > 0) {
        capabilities.push(capability);
      }
    }
    return { version: 2, refs, capabilities };
  }
  const nul = firstText.indexOf("\0");
  if (nul === -1) {
    fail("REPOSITORY_UNAVAILABLE", "Smart HTTP advertisement is missing capabilities.");
  }
  const firstRef = firstText.slice(0, nul);
  const capabilityText = firstText.slice(nul + 1).trim();
  if (capabilityText.length > 0) {
    capabilities.push(...capabilityText.split(" ").filter((value) => value.length > 0));
  }
  if (firstRef !== "0000000000000000000000000000000000000000 capabilities^{}") {
    refs.push(splitRef(firstRef));
  }
  index += 1;
  while (index < lines.length) {
    const line = lines[index];
    index += 1;
    if (line === null) {
      break;
    }
    refs.push(splitRef(lineText(line)));
  }
  return { version: 1, refs, capabilities };
}

function splitRef(line: string): RemoteRef {
  const space = line.indexOf(" ");
  if (space === -1) {
    fail("REPOSITORY_UNAVAILABLE", "Smart HTTP advertisement has a malformed ref.");
  }
  const oid = line.slice(0, space);
  const name = line.slice(space + 1).trim();
  if (!/^[0-9a-f]{40}$/i.test(oid) || name.length === 0) {
    fail("REPOSITORY_UNAVAILABLE", "Smart HTTP advertisement has a malformed ref.");
  }
  return { name, oid: oid.toLowerCase() };
}

function parseLsRefs(buffer: Buffer): LsRemoteResult {
  const lines = readPktLines(buffer);
  const refs: RemoteRef[] = [];
  const capabilities: string[] = [];
  for (const line of lines) {
    if (line === null) {
      break;
    }
    const text = lineText(line);
    const space = text.indexOf(" ");
    if (space === -1) {
      fail("REPOSITORY_UNAVAILABLE", "Smart HTTP ls-refs has a malformed ref.");
    }
    const oid = text.slice(0, space);
    const rest = text.slice(space + 1).trim();
    const tokens = rest.split(" ").filter((value) => value.length > 0);
    const name = tokens[0];
    if (!/^[0-9a-f]{40}$/i.test(oid) || name === undefined || name.length === 0) {
      fail("REPOSITORY_UNAVAILABLE", "Smart HTTP ls-refs has a malformed ref.");
    }
    refs.push({ name, oid: oid.toLowerCase() });
    if (name === "HEAD") {
      const symref = tokens.slice(1).find((attr) => attr.startsWith("symref-target:"));
      if (symref !== undefined) {
        capabilities.push(`symref=HEAD:${symref.slice("symref-target:".length)}`);
      }
    }
  }
  return { refs, capabilities };
}

async function lsRefsHttps(url: string, fetchImpl: FetchLike): Promise<LsRemoteResult> {
  const response = await fetchImpl(`${url}/${SERVICE}`, {
    method: "POST",
    headers: {
      "content-type": `application/x-${SERVICE}-request`,
      accept: `application/x-${SERVICE}-result`,
      "Git-Protocol": "version=2",
    },
    body: new Uint8Array(
      Buffer.concat([
        encodePkt("command=ls-refs\n"),
        Buffer.from("0001", "ascii"),
        encodePkt("symrefs\n"),
        Buffer.from("0000", "ascii"),
      ]),
    ),
  });
  if (response.status === 401) {
    fail("NYI", "NYI: lsRemoteHttps does not send credentials.");
  }
  if (response.status !== 200) {
    fail("REPOSITORY_UNAVAILABLE", "Smart HTTP ls-refs did not return refs.");
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith(`application/x-${SERVICE}-result`)) {
    fail("REPOSITORY_UNAVAILABLE", "Smart HTTP ls-refs is not a protocol result.");
  }
  return parseLsRefs(Buffer.from(await response.arrayBuffer()));
}

export function advertisedDefaultBranch(result: LsRemoteResult): string {
  const symref = result.capabilities.find((capability) => capability.startsWith("symref=HEAD:"));
  if (symref !== undefined) {
    const target = symref.slice("symref=HEAD:".length);
    if (target.startsWith("refs/heads/") && target.length > "refs/heads/".length) {
      return target.slice("refs/heads/".length);
    }
    fail("REPOSITORY_UNAVAILABLE", "Smart HTTP HEAD symref is not a branch.");
  }
  const head = result.refs.find((ref) => ref.name === "HEAD");
  if (head !== undefined) {
    const match = result.refs.find(
      (ref) => ref.name.startsWith("refs/heads/") && ref.oid === head.oid,
    );
    if (match !== undefined) {
      return match.name.slice("refs/heads/".length);
    }
  }
  fail("REPOSITORY_UNAVAILABLE", "Smart HTTP advertisement does not name a default branch.");
}

export async function lsRemoteHttps(
  repositoryUrl: string,
  fetchImpl: FetchLike = defaultFetch,
): Promise<LsRemoteResult> {
  const url = normalizeHttpUrl(repositoryUrl);
  // Do not send Git-Protocol version=2 until fetchHttps speaks command=fetch.
  // A v2 advertisement plus a v1 want body fails against current hosts.
  const response = await fetchImpl(`${url}/info/refs?service=${SERVICE}`, {
    method: "GET",
    headers: {
      accept: `application/x-${SERVICE}-advertisement`,
    },
  });
  if (response.status === 401) {
    fail("NYI", "NYI: lsRemoteHttps does not send credentials.");
  }
  if (response.status !== 200) {
    fail("REPOSITORY_UNAVAILABLE", "Smart HTTP ls-remote did not return an advertisement.");
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith(`application/x-${SERVICE}-advertisement`)) {
    fail("REPOSITORY_UNAVAILABLE", "Smart HTTP ls-remote is not a smart advertisement.");
  }
  const advertisement = parseAdvertisement(Buffer.from(await response.arrayBuffer()));
  if (advertisement.version === 2) {
    const hasLsRefs = advertisement.capabilities.some(
      (capability) => capability === "ls-refs" || capability.startsWith("ls-refs="),
    );
    if (!hasLsRefs) {
      fail("REPOSITORY_UNAVAILABLE", "Smart HTTP v2 advertisement does not offer ls-refs.");
    }
    return lsRefsHttps(url, fetchImpl);
  }
  return { refs: advertisement.refs, capabilities: advertisement.capabilities };
}
