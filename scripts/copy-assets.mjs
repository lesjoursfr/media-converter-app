import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sourceDirectory = path.join(root, "src", "renderer");
const targetDirectory = path.join(root, "dist", "renderer");

await mkdir(targetDirectory, { recursive: true });
await copyFile(path.join(sourceDirectory, "index.html"), path.join(targetDirectory, "index.html"));
await copyFile(path.join(sourceDirectory, "styles.css"), path.join(targetDirectory, "styles.css"));
