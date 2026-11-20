import { describe, expect, it } from 'vitest';
import { releaseInstallSpecs } from '../src/cli/commands/system.js';

describe('release install specs', () => {
  it('prefers the GitHub release tarball over git installs', () => {
    const specs = releaseInstallSpecs('ComibyteOrg/comicode', '0.2.1', 'v0.2.1');
    expect(specs[0]).toBe(
      'https://github.com/ComibyteOrg/comicode/archive/refs/tags/v0.2.1.tar.gz',
    );
  });

  it('keeps a fallback spec', () => {
    const specs = releaseInstallSpecs('ComibyteOrg/comicode', '0.2.1', 'v0.2.1');
    expect(specs.length).toBeGreaterThan(1);
  });

  it('uses the npm package first when there is no git tag', () => {
    const specs = releaseInstallSpecs('ComibyteOrg/comicode', '0.2.1', null);
    expect(specs[0]).toBe('comicode@0.2.1');
  });
});
