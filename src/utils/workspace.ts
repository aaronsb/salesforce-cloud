/**
 * Workspace directory — safe sandbox for file I/O operations.
 *
 * All file operations (ContentVersion downloads) are jailed to this directory.
 * Prevents agents from accidentally operating on home directories or
 * other sensitive locations.
 *
 * Pattern adapted from google-workspace-mcp.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

const APP_NAME = 'salesforce-cloud-mcp';

function dataDir(): string {
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(base, APP_NAME);
}

const DEFAULT_WORKSPACE = path.join(dataDir(), 'workspace');

/** Paths that must never be used as the workspace root. */
const FORBIDDEN_PATHS = [
  () => process.env.HOME ?? '',
  () => process.env.USERPROFILE ?? '',
  () => process.env.HOME ? path.join(process.env.HOME, 'Documents') : '',
  () => process.env.HOME ? path.join(process.env.HOME, 'Desktop') : '',
  () => process.env.HOME ? path.join(process.env.HOME, 'Downloads') : '',
  () => process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Documents') : '',
  () => process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Desktop') : '',
  () => process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Downloads') : '',
];

/** Validate and return the workspace directory path. */
export function getWorkspaceDir(): string {
  const configured = process.env.SF_WORKSPACE_DIR;
  if (configured && !configured.includes('${')) {
    return configured;
  }
  return DEFAULT_WORKSPACE;
}

/**
 * Validate workspace dir is safe. Throws if it IS a protected directory.
 * Being a subdirectory OF a protected directory is fine.
 */
export function validateWorkspaceDir(dir: string): void {
  const resolved = path.resolve(dir);

  for (const getForbidden of FORBIDDEN_PATHS) {
    const forbidden = getForbidden();
    if (forbidden && path.resolve(forbidden) === resolved) {
      throw new Error(
        `Workspace directory cannot be ${resolved} itself — ` +
        `use a subdirectory like ${resolved}/mcp-workspace or ${DEFAULT_WORKSPACE}`,
      );
    }
  }

  if (resolved === '/' || resolved === 'C:\\') {
    throw new Error('Workspace directory cannot be the filesystem root');
  }
}

export interface WorkspaceStatus {
  path: string;
  valid: boolean;
  warning?: string;
}

/** Check workspace directory status without crashing. */
export function checkWorkspaceStatus(): WorkspaceStatus {
  const dir = getWorkspaceDir();
  try {
    validateWorkspaceDir(dir);
    return { path: dir, valid: true };
  } catch (err) {
    return {
      path: dir,
      valid: false,
      warning: (err as Error).message,
    };
  }
}

/** Ensure the workspace directory exists and is validated. */
export async function ensureWorkspaceDir(): Promise<WorkspaceStatus> {
  const status = checkWorkspaceStatus();
  if (status.valid) {
    await fs.mkdir(status.path, { recursive: true, mode: 0o755 });
  }
  return status;
}

/**
 * Sanitize a filename from external sources (Salesforce ContentVersion titles).
 * Strips null bytes, control characters, path separators, and other dangerous chars.
 */
export function sanitizeFilename(filename: string): string {
  return filename
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[/\\]/g, '_')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    || 'unnamed';
}

/**
 * Resolve a file path within the workspace directory.
 * Prevents path traversal (e.g. ../../etc/passwd).
 */
export function resolveWorkspacePath(filename: string): string {
  const dir = getWorkspaceDir();
  const sanitized = sanitizeFilename(filename);
  const resolved = path.resolve(dir, sanitized);

  const resolvedDir = path.resolve(dir);
  if (!resolved.startsWith(resolvedDir + path.sep) && resolved !== resolvedDir) {
    throw new Error(
      `Path traversal detected: "${filename}" resolves outside workspace directory`,
    );
  }

  return resolved;
}

/**
 * Verify a file path is safe to read/write after symlink resolution.
 * Must be called before any fs operation on a workspace path.
 */
export async function verifyPathSafety(filePath: string): Promise<void> {
  const dir = path.resolve(getWorkspaceDir());
  try {
    const real = await fs.realpath(filePath);
    if (!real.startsWith(dir + path.sep) && real !== dir) {
      throw new Error(
        `Symlink escape detected: "${filePath}" resolves to "${real}" outside workspace`,
      );
    }
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return;
    throw err;
  }
}
