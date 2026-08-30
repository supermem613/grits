export type RepositoryKind = "filesystem" | "memory";

export type FilesystemRepository = {
  readonly kind: "filesystem";
  readonly path: string;
};

export type MemoryRepository = {
  readonly kind: "memory";
  readonly seed?: MemorySeed;
};

export type RepositoryDescriptor = FilesystemRepository | MemoryRepository;

export type GritsConfig = {
  readonly repository: RepositoryDescriptor;
};

export type CapabilityStatus = "supported" | "open" | "unsupported";

export type CapabilityProfile = {
  readonly repository: RepositoryKind;
  readonly objects: {
    readonly read: CapabilityStatus;
  };
  readonly refs: {
    readonly resolve: CapabilityStatus;
  };
};

export type ObjectId = string;
export type RefName = string;

export type BlobObject = {
  readonly kind: "blob";
  readonly id: ObjectId;
  readonly bytes: readonly number[];
};

export type TreeEntry = {
  readonly mode: string;
  readonly name: string;
  readonly objectId: ObjectId;
};

export type TreeObject = {
  readonly kind: "tree";
  readonly id: ObjectId;
  readonly entries: readonly TreeEntry[];
};

export type CommitObject = {
  readonly kind: "commit";
  readonly id: ObjectId;
  readonly tree: ObjectId;
  readonly parents: readonly ObjectId[];
  readonly message: string;
};

export type GitObject = BlobObject | TreeObject | CommitObject;

export type RefResolution = {
  readonly name: RefName;
  readonly objectId: ObjectId;
};

export type MemorySeed = {
  readonly objects?: readonly GitObject[];
  readonly refs?: readonly RefResolution[];
};

export type ObjectsApi = {
  read(id: ObjectId): Promise<GitObject>;
};

export type RefsApi = {
  resolve(name: RefName): Promise<RefResolution | null>;
};

export type Grits = {
  readonly capabilities: CapabilityProfile;
  readonly objects: ObjectsApi;
  readonly refs: RefsApi;
};
