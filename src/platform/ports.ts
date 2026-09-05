export type Frontmatter = Readonly<Record<string, unknown>>;

export interface VaultPort {
  create(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  listMarkdownFiles(rootPath: string): Promise<readonly string[]>;
  process(path: string, update: (current: string) => string): Promise<string>;
  read(path: string): Promise<string>;
  stat(path: string): Promise<VaultStat>;
}

export interface VaultStat {
  ctime: number;
  mtime: number;
  size: number;
}

export interface VaultTreePort extends VaultPort {
  createFolder(path: string): Promise<void>;
  delete(path: string): Promise<void>;
  isFile(path: string): Promise<boolean>;
  isFolder(path: string): Promise<boolean>;
  listFolders(rootPath: string): Promise<readonly string[]>;
  move(from: string, to: string): Promise<void>;
}

export interface FrontmatterPort {
  process(path: string, update: (current: Frontmatter) => Record<string, unknown>): Promise<void>;
  read(path: string): Promise<Frontmatter | null>;
}

export interface SecretResolver {
  get(reference: SecretReference): string | null;
}

export interface SecretReference {
  name: string;
}

export interface HTTPRequest {
  body?: string;
  headers?: Record<string, string>;
  maxResponseBytes: number;
  method: 'GET' | 'POST';
  timeoutMs: number;
  url: string;
}

export interface HTTPResponse {
  body: string;
  headers: Record<string, string>;
  status: number;
}

export interface HTTPTransport {
  request(request: HTTPRequest): Promise<HTTPResponse>;
}

export interface TemporalContext {
  now(): Date;
  timeZone(): string;
}
