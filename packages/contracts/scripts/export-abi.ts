import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface HardhatArtifact {
  readonly abi: readonly unknown[];
}

async function exportAbi(): Promise<void> {
  const artifactPath = join(process.cwd(), 'artifacts', 'contracts', 'VeloxTreasury.sol', 'VeloxTreasury.json');
  const artifact = JSON.parse(await readFile(artifactPath, 'utf8')) as HardhatArtifact;
  const outputDirectory = join(process.cwd(), 'abi');
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(join(outputDirectory, 'VeloxTreasury.json'), `${JSON.stringify(artifact.abi, null, 2)}\n`);
}

void exportAbi();
