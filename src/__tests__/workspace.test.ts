import {
  sanitizeFilename,
  resolveWorkspacePath,
  validateWorkspaceDir,
  getWorkspaceDir,
} from '../utils/workspace.js';
import * as path from 'node:path';

describe('sanitizeFilename', () => {
  it('should pass through normal filenames', () => {
    expect(sanitizeFilename('report.pdf')).toBe('report.pdf');
    expect(sanitizeFilename('My Document.docx')).toBe('My Document.docx');
  });

  it('should neutralize path traversal via separator replacement', () => {
    // Slashes become underscores; dots stay but leading dots stripped
    const result = sanitizeFilename('../../etc/passwd');
    expect(result).not.toContain('/');
    expect(result).not.toContain('\\');
    // The important thing: no path components survive
    expect(sanitizeFilename('..\\..\\windows\\system32')).not.toContain('\\');
  });

  it('should strip null bytes and control characters', () => {
    expect(sanitizeFilename('file\x00name.txt')).toBe('filename.txt');
    expect(sanitizeFilename('file\x1fname.txt')).toBe('filename.txt');
  });

  it('should strip leading dots (hidden files)', () => {
    expect(sanitizeFilename('.hidden')).toBe('hidden');
    expect(sanitizeFilename('...sneaky')).toBe('sneaky');
  });

  it('should strip trailing dots and spaces', () => {
    expect(sanitizeFilename('file.txt...')).toBe('file.txt');
    expect(sanitizeFilename('file.txt   ')).toBe('file.txt');
  });

  it('should replace dangerous characters', () => {
    expect(sanitizeFilename('file<>:"|?*.txt')).toBe('file_.txt');
  });

  it('should collapse multiple underscores', () => {
    expect(sanitizeFilename('a//b//c')).toBe('a_b_c');
  });

  it('should return unnamed for empty or all-invalid input', () => {
    expect(sanitizeFilename('')).toBe('unnamed');
    expect(sanitizeFilename('...')).toBe('unnamed');
    expect(sanitizeFilename('\x00\x01')).toBe('unnamed');
  });
});

describe('resolveWorkspacePath', () => {
  it('should resolve within workspace directory', () => {
    const result = resolveWorkspacePath('report.pdf');
    const wsDir = getWorkspaceDir();
    expect(result).toBe(path.resolve(wsDir, 'report.pdf'));
  });

  it('should sanitize the filename before resolving', () => {
    const result = resolveWorkspacePath('../../etc/passwd');
    const wsDir = getWorkspaceDir();
    // Path traversal neutralized — result stays inside workspace regardless
    expect(result.startsWith(path.resolve(wsDir) + path.sep)).toBe(true);
  });

  it('should stay within workspace for dotfile attempts', () => {
    const result = resolveWorkspacePath('.bashrc');
    const wsDir = getWorkspaceDir();
    expect(result).toBe(path.resolve(wsDir, 'bashrc'));
  });
});

describe('validateWorkspaceDir', () => {
  it('should allow normal subdirectories', () => {
    expect(() => validateWorkspaceDir('/tmp/salesforce-workspace')).not.toThrow();
    expect(() => validateWorkspaceDir('/home/user/projects/workspace')).not.toThrow();
  });

  it('should reject filesystem root', () => {
    expect(() => validateWorkspaceDir('/')).toThrow('filesystem root');
  });

  it('should reject HOME directory itself', () => {
    const home = process.env.HOME;
    if (home) {
      expect(() => validateWorkspaceDir(home)).toThrow('cannot be');
    }
  });

  it('should allow subdirectories of HOME', () => {
    const home = process.env.HOME;
    if (home) {
      expect(() => validateWorkspaceDir(path.join(home, 'my-workspace'))).not.toThrow();
    }
  });

  it('should reject Documents directory itself', () => {
    const home = process.env.HOME;
    if (home) {
      expect(() => validateWorkspaceDir(path.join(home, 'Documents'))).toThrow('cannot be');
    }
  });

  it('should allow subdirectories of Documents', () => {
    const home = process.env.HOME;
    if (home) {
      expect(() => validateWorkspaceDir(path.join(home, 'Documents', 'sf-files'))).not.toThrow();
    }
  });
});

describe('getWorkspaceDir', () => {
  const originalEnv = process.env.SF_WORKSPACE_DIR;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.SF_WORKSPACE_DIR = originalEnv;
    } else {
      delete process.env.SF_WORKSPACE_DIR;
    }
  });

  it('should use SF_WORKSPACE_DIR when set', () => {
    process.env.SF_WORKSPACE_DIR = '/tmp/custom-workspace';
    expect(getWorkspaceDir()).toBe('/tmp/custom-workspace');
  });

  it('should ignore unresolved template strings', () => {
    process.env.SF_WORKSPACE_DIR = '${user_config.sf_workspace_dir}';
    expect(getWorkspaceDir()).not.toContain('${');
  });

  it('should fall back to XDG-compliant default', () => {
    delete process.env.SF_WORKSPACE_DIR;
    const result = getWorkspaceDir();
    expect(result).toContain('salesforce-cloud-mcp');
    expect(result).toContain('workspace');
  });
});
