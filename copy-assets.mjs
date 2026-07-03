import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const sourceDirectory = join(root, "src", "renderer");
const targetDirectory = join(root, "dist", "renderer");

await mkdir(targetDirectory, { recursive: true });
await copyFile(join(sourceDirectory, "index.html"), join(targetDirectory, "index.html"));
await copyFile(join(sourceDirectory, "styles.css"), join(targetDirectory, "styles.css"));
